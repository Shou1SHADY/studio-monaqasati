// Sales-order write flows — where a decision becomes documents.
//
// Each flow writes ONE batch so the business fact and its side effects land
// together: a delivery that confirms also empties the shelf; an invoice that
// issues also stamps the notes it bills. Accounting entries ride the safe
// hooks after commit — the ledger mirrors the documents, never gates them.

import {
  collection,
  doc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore"
import {
  MANUFACTURING_REQUESTS,
  SALES_DELIVERY_NOTES,
  SALES_INVOICES,
  SALES_ORDERS,
  SALES_RETURNS,
  computeInvoice,
  deliveryNoteCost,
  deliveryShortfalls,
  depositNet,
  generateDeliveryNoteNumber,
  generateMfgRequestNumber,
  generateReturnNumber,
  generateSalesInvoiceNumber,
  isExternal,
  isFullyDelivered,
  linesFromQuotationItems,
  nextSalesOrderNumber,
  orderLineProgress,
  returnValue,
  returnableQty,
  signedLines,
  validateSignature,
  type ManufacturingRequest,
  type ReturnDisposition,
  type SalesDeliveryNote,
  type SalesInvoice,
  type SalesOrder,
  type SalesOrderLine,
  type SalesReturn,
} from "./sales-orders"
import { advanceInstallment, type CrmQuotation } from "./crm"
import {
  onSalesCreditNoteIssued,
  onSalesDelivered,
  onSalesInvoiceIssued,
  onSalesInvoicePaid,
  type HookActor,
} from "./accounting/hooks"
import { MFG_DEPARTMENTS, WORK_ORDERS, buildStagesFromDepartments, nextWorkOrderNumber, type MfgDepartment } from "./manufacturing"
import { drawDocNumber } from "./manufacturing-writes"
import { MFG_COST_ESTIMATES, itemKey, type MfgCostEstimate } from "./manufacturing-engine"

const nowIso = () => new Date().toISOString()

/** The row a sale draws from: a plain row (not a block-tracked slab, not a
 * manufacturing remnant) that holds enough, else any plain row, else the first. */
function pickStockRow<R extends { id: string; name: string; quantity?: number; lot?: string | null; remnant?: boolean | null }>(rows: R[], name: string, quantity: number): R | undefined {
  const same = rows.filter((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase())
  const plain = same.filter((r) => !r.remnant && !r.lot)
  return plain.find((r) => r.quantity == null || r.quantity >= quantity) || plain[0] || same.find((r) => !r.remnant) || same[0]
}

export interface Actor {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Order creation
// ---------------------------------------------------------------------------

/**
 * Payment terms derived from the quotation's own schedule: a before-production
 * instalment makes an advance-gated order (nothing reserved, made or delivered
 * until Finance confirms it — D8); anything else is credit. The order remembers
 * WHICH instalment is its advance, so confirming that one — and only that one —
 * releases it. Nobody re-types terms that were already agreed.
 */
export function paymentFromQuotation(quotation: Pick<CrmQuotation, "installments">): SalesOrder["payment"] {
  const advance = advanceInstallment(quotation.installments)
  if (advance) return { kind: "deposit", depositPercent: advance.percent, depositPaid: false, advanceInstallmentId: advance.id }
  return { kind: "credit", creditDays: 30 }
}

/**
 * The acceptance's second half: the accepted quotation becomes the order every
 * later document hangs off. Skips quietly when the quotation already has one —
 * re-saving an accepted quotation must not spawn a twin.
 */
export async function createSalesOrderFromQuotation(
  firestore: Firestore,
  input: {
    organizationId: string
    quotation: Pick<CrmQuotation, "id" | "quotationNumber" | "contactId" | "contactName" | "items" | "installments" | "amount">
    priceItems: Array<{ name: string; cost?: number | null; requiresApproval?: boolean | null }>
    vatPercent?: number
    /** The date promised to the client — never earlier than honest readiness (SO-05). */
    promiseDate?: string | null
    /** Flip the quotation to "accepted" in the SAME batch as the order, so a
     * won quote always has its order and a failed conversion can be retried. */
    accept?: boolean
    actor: Actor
  }
): Promise<string | null> {
  const existing = await getDocs(
    query(collection(firestore, SALES_ORDERS), where("organizationId", "==", input.organizationId))
  )
  const twin = existing.docs.find((d) => d.data().quotationId === input.quotation.id)
  if (twin) {
    // The order exists (an earlier conversion got this far): finish the flip.
    if (input.accept) {
      const fix = writeBatch(firestore)
      fix.update(doc(firestore, "crmQuotations", input.quotation.id), { salesOrderId: twin.id, status: "accepted", acceptedAt: nowIso(), updatedAt: serverTimestamp() })
      await fix.commit()
    }
    return null
  }

  const items = input.quotation.items || []
  const lines: SalesOrderLine[] =
    items.length > 0
      ? linesFromQuotationItems(items, input.priceItems)
      : [{ name: input.quotation.quotationNumber, unit: "", quantity: 1, unitPrice: input.quotation.amount, unitCost: null }]

  const payment = paymentFromQuotation(input.quotation)
  const batch = writeBatch(firestore)
  const orderRef = doc(collection(firestore, SALES_ORDERS))
  batch.set(orderRef, {
    organizationId: input.organizationId,
    orderNumber: nextSalesOrderNumber(existing.docs.map((d) => d.data())),
    type: "standard",
    status: payment.kind === "deposit" ? "awaiting_deposit" : "running",
    contactId: input.quotation.contactId,
    contactName: input.quotation.contactName ?? null,
    projectId: null,
    projectName: null,
    quotationId: input.quotation.id,
    quotationNumber: input.quotation.quotationNumber,
    frameworkId: null,
    frameworkCap: null,
    frameworkValidUntil: null,
    payment,
    // The schedule as the client accepted it — read-only on the order; changing
    // it means a revised quote (SO-02).
    paymentSchedule: input.quotation.installments ?? null,
    promiseDate: input.promiseDate ?? null,
    vatPercent: input.vatPercent ?? 15,
    lines,
    measurementRecordedAt: null,
    // The approval gate arms itself from the catalog: any line whose item
    // needs a shop-drawing sign-off starts the order waiting for it.
    approvalStatus: lines.some((l) =>
      input.priceItems.some(
        (p) => p.requiresApproval && p.name.trim().toLowerCase() === l.name.trim().toLowerCase()
      )
    )
      ? "awaiting"
      : "not_required",
    log: [{ at: nowIso(), by: input.actor.name, kind: "created", detail: input.quotation.quotationNumber }],
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closedAt: null,
  })
  batch.update(doc(firestore, "crmQuotations", input.quotation.id), {
    salesOrderId: orderRef.id,
    ...(input.accept ? { status: "accepted", acceptedAt: nowIso() } : {}),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return orderRef.id
}

/**
 * SO-11 — reset the promise. The new date is never in the past, the change
 * carries its reason, and both go into the order's trail under the user's
 * name: a promise moved silently is a promise broken twice.
 */
export async function resetOrderPromise(
  firestore: Firestore,
  input: { orderId: string; promiseDate: string; reason: string; today: string; actor: Actor }
): Promise<void> {
  if (!input.reason.trim()) throw new Error("reason_required")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.promiseDate) || input.promiseDate < input.today) throw new Error("promise_in_past")
  const ref = doc(firestore, SALES_ORDERS, input.orderId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("order_missing")
    const fresh = snap.data() as SalesOrder
    if (fresh.status === "closed" || fresh.status === "cancelled") throw new Error("order_closed")
    const was = fresh.promiseDate ? fresh.promiseDate.slice(0, 10) : null
    tx.update(ref, {
      promiseDate: input.promiseDate,
      log: [...(fresh.log || []), { at: nowIso(), by: input.actor.name, kind: was ? "promise_reset" : "promise_set", detail: `${was || "—"} → ${input.promiseDate} · ${input.reason.trim()}` }],
      updatedAt: serverTimestamp(),
    })
  })
}

/** Sales reports the client says the deposit was sent — Finance still confirms it. */
export async function reportDepositReceived(firestore: Firestore, order: SalesOrder, actor: { id: string; name: string }): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_ORDERS, order.id), {
    "payment.depositReportedAt": nowIso(),
    "payment.depositReportedBy": actor.name,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/** The deposit arrived: the gate opens and the order starts running. */
export async function markDepositPaid(firestore: Firestore, order: SalesOrder): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_ORDERS, order.id), {
    "payment.depositPaid": true,
    "payment.depositPaidAt": nowIso(),
    status: "running",
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

export type ScheduleError = "order_not_running" | "lines_required" | "over_open" | "insufficient_stock"

/** What stops a delivery being scheduled (DLV-01, T16) — checked by the dialog
 * as you type and again by the write: only an order in progress ships (one
 * awaiting its advance does not), never more than is still open, never more
 * than the warehouse truly has after the other open notes drawing on it. */
export function scheduleBlock(input: {
  order: SalesOrder
  lines: Array<{ name: string; quantity: number }>
  warehouseId: string
  stockRows: Array<{ name: string; quantity?: number | null }>
  allNotes: SalesDeliveryNote[]
}): ScheduleError | null {
  if (input.order.status !== "running") return "order_not_running"
  const wanted = input.lines.filter((l) => l.quantity > 0)
  if (!wanted.length) return "lines_required"
  const progress = orderLineProgress(input.order, input.allNotes)
  for (const l of wanted) {
    const line = progress.find((x) => itemKey(x.name) === itemKey(l.name))
    if (!line || l.quantity > line.open + 0.005) return "over_open"
  }
  return deliveryShortfalls(wanted, input.warehouseId, input.stockRows, input.allNotes).length ? "insufficient_stock" : null
}

/** Step 1 — Sales requests the issue; nothing moves yet. Inventory authorises
 * it, and stock leaves only when the client signs. */
export async function scheduleDelivery(
  firestore: Firestore,
  input: {
    order: SalesOrder
    lines: Array<{ name: string; quantity: number }>
    warehouseId: string
    warehouseName: string
    receiverName?: string | null
    /** The chosen warehouse's rows and every note — the availability check. */
    stockRows: Array<{ name: string; quantity?: number | null }>
    allNotes: SalesDeliveryNote[]
    actor: Actor
  }
): Promise<string> {
  const block = scheduleBlock(input)
  if (block) throw new Error(block)
  const ref = doc(collection(firestore, SALES_DELIVERY_NOTES))
  const batch = writeBatch(firestore)
  batch.set(ref, {
    organizationId: input.order.organizationId,
    noteNumber: generateDeliveryNoteNumber(),
    orderId: input.order.id,
    orderNumber: input.order.orderNumber,
    contactId: input.order.contactId ?? null,
    contactName: input.order.contactName ?? null,
    status: "requested",
    lines: input.lines.filter((l) => l.quantity > 0),
    warehouseId: input.warehouseId,
    warehouseName: input.warehouseName,
    receiverName: input.receiverName ?? null,
    holdReason: null,
    varianceNote: null,
    requestedAt: nowIso(),
    deliveredAt: null,
    deliveredByUserId: null,
    deliveredByUserName: null,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return ref.id
}

/** Thrown by the handshake writes; the screens map the code to a sentence. */
export type DeliveryError =
  | "note_missing"
  | "not_requested"
  | "not_authorized"
  | "held"
  | "insufficient_stock"
  | "signer_required"
  | "nothing_received"
  | "invalid_quantity"
  | "over_requested"
  | "reason_required"
  | "not_held"

type StockRow = { id: string; name: string; quantity?: number; lot?: string | null; remnant?: boolean | null }

/**
 * Step 2 — Inventory authorises the issue (T17). The storekeeper's figure
 * decides, not ours: every line must fit what the warehouse truly has after
 * the other open notes drawing on it. Nothing moves yet.
 */
export async function authorizeDelivery(
  firestore: Firestore,
  input: { note: SalesDeliveryNote; stockRows: StockRow[]; allNotes: SalesDeliveryNote[]; actor: Actor }
): Promise<void> {
  const ref = doc(firestore, SALES_DELIVERY_NOTES, input.note.id)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("note_missing")
    const fresh = snap.data() as SalesDeliveryNote
    if (fresh.status === "held") throw new Error("held")
    if (fresh.status !== "requested") throw new Error("not_requested")
    if (fresh.warehouseId && deliveryShortfalls(fresh.lines, fresh.warehouseId, input.stockRows, input.allNotes, input.note.id).length) throw new Error("insufficient_stock")
    tx.update(ref, {
      status: "authorized",
      authorizedAt: nowIso(),
      authorizedByUserId: input.actor.id,
      authorizedByUserName: input.actor.name,
      updatedAt: serverTimestamp(),
    })
  })
}

/**
 * Step 3 — the client signs (T18). The goods leave at the quantity actually
 * received, under the signer's name: the note's lines become what was signed,
 * so value, stock, the invoice and what is still owed all follow it. Units the
 * client refused are simply still open on the order — no return is invented.
 * The order closes itself when nothing is left. The cost entry follows through
 * the safe hook.
 *
 * `stockRows` is the source warehouse's inventory — lines are matched by name
 * (this codebase's convention). A name with no stock row still delivers; a row
 * that holds less than the signed quantity blocks (INV-09).
 */
export async function confirmDelivery(
  firestore: Firestore,
  input: {
    note: SalesDeliveryNote
    order: SalesOrder
    allNotes: SalesDeliveryNote[]
    stockRows: StockRow[]
    signerName: string
    /** Omit a line to sign for all of it. */
    signed?: Array<{ name: string; quantity: number }>
    varianceNote?: string | null
    actor: Actor
  }
): Promise<SalesDeliveryNote> {
  const { order } = input
  const signatureError = validateSignature(input.note, input.signerName, input.signed || [])
  if (signatureError) throw new Error(signatureError)
  const ref = doc(firestore, SALES_DELIVERY_NOTES, input.note.id)
  const deliveredAt = nowIso()

  const delivered = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("note_missing")
    const fresh = { ...(snap.data() as SalesDeliveryNote), id: snap.id }
    if (fresh.status === "held") throw new Error("held")
    if (fresh.status !== "authorized") throw new Error("not_authorized")
    const lines = signedLines(fresh, input.signed || [])

    // A transaction reads everything before it writes anything.
    const draws: Array<{ rowId: string; quantity: number }> = []
    if (fresh.warehouseId) {
      for (const line of lines) {
        if (!(line.quantity > 0)) continue
        const row = pickStockRow(input.stockRows, line.name, line.quantity)
        if (!row) continue
        const rowSnap = await tx.get(doc(firestore, "warehouses", fresh.warehouseId, "inventoryItems", row.id))
        const onHand = rowSnap.exists() ? Number(rowSnap.data().quantity) || 0 : 0
        if (line.quantity > onHand + 0.005) throw new Error("insufficient_stock")
        draws.push({ rowId: row.id, quantity: line.quantity })
      }
    }

    tx.update(ref, {
      status: "delivered",
      lines,
      signerName: input.signerName.trim(),
      signedAt: deliveredAt,
      deliveredAt,
      deliveredByUserId: input.actor.id,
      deliveredByUserName: input.actor.name,
      varianceNote: input.varianceNote ?? null,
      updatedAt: serverTimestamp(),
    })
    for (const d of draws) {
      tx.update(doc(firestore, "warehouses", fresh.warehouseId!, "inventoryItems", d.rowId), {
        quantity: increment(-d.quantity),
        updatedAt: serverTimestamp(),
      })
    }

    // Would-be state after this note flips: it plus the already-delivered ones.
    const signedNote: SalesDeliveryNote = { ...fresh, status: "delivered", lines, deliveredAt }
    const after = input.allNotes.map((n) => (n.id === fresh.id ? signedNote : n))
    if (isFullyDelivered(order, after)) {
      tx.update(doc(firestore, SALES_ORDERS, order.id), { status: "closed", closedAt: deliveredAt, updatedAt: serverTimestamp() })
    }
    return signedNote
  })

  const actor: HookActor = { organizationId: order.organizationId, userId: input.actor.id, userName: input.actor.name }
  onSalesDelivered(firestore, actor, {
    deliveryNoteId: delivered.id,
    noteNumber: delivered.noteNumber,
    orderNumber: order.orderNumber,
    date: deliveredAt.slice(0, 10),
    cost: deliveryNoteCost(delivered, order),
    contactId: order.contactId,
    contactName: order.contactName ?? null,
    projectId: order.projectId ?? null,
    projectName: order.projectName ?? null,
  })
  return delivered
}

/**
 * Finance holds a shipment (T19) — from "requested" or "authorized", never one
 * that already left. The reason is Finance's own; Sales sees the state only.
 */
export async function holdDelivery(firestore: Firestore, input: { noteId: string; reason: string; actor: Actor }): Promise<void> {
  if (!input.reason.trim()) throw new Error("reason_required")
  const ref = doc(firestore, SALES_DELIVERY_NOTES, input.noteId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("note_missing")
    const status = (snap.data() as SalesDeliveryNote).status
    if (status !== "requested" && status !== "authorized") throw new Error("not_requested")
    tx.update(ref, {
      status: "held",
      heldFrom: status,
      holdReason: input.reason.trim(),
      heldAt: nowIso(),
      heldByUserName: input.actor.name,
      releaseRequestedAt: null,
      releaseRequestedByUserName: null,
      updatedAt: serverTimestamp(),
    })
  })
}

/** Finance releases: the note returns to where it stood when it was held. */
export async function releaseDelivery(firestore: Firestore, input: { noteId: string; actor: Actor }): Promise<void> {
  const ref = doc(firestore, SALES_DELIVERY_NOTES, input.noteId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("note_missing")
    const fresh = snap.data() as SalesDeliveryNote
    if (fresh.status !== "held") throw new Error("not_held")
    tx.update(ref, {
      status: fresh.heldFrom === "authorized" ? "authorized" : "requested",
      heldFrom: null,
      releasedAt: nowIso(),
      releasedByUserName: input.actor.name,
      updatedAt: serverTimestamp(),
    })
  })
}

/** The seller's only act on a held shipment: ask Finance to release it. */
export async function requestDeliveryRelease(firestore: Firestore, input: { noteId: string; actor: Actor }): Promise<void> {
  const ref = doc(firestore, SALES_DELIVERY_NOTES, input.noteId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("note_missing")
    if ((snap.data() as SalesDeliveryNote).status !== "held") throw new Error("not_held")
    tx.update(ref, { releaseRequestedAt: nowIso(), releaseRequestedByUserName: input.actor.name, updatedAt: serverTimestamp() })
  })
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/**
 * Bill delivered notes. The invoice stores only which notes it covers — its
 * money is recomputed from them forever after, so it can never drift from what
 * was actually delivered. Revenue posts here, net of the deposit share the
 * delivery earns back.
 */
export async function issueInvoiceFromDeliveries(
  firestore: Firestore,
  input: {
    order: SalesOrder
    notes: SalesDeliveryNote[]
    allNotes: SalesDeliveryNote[]
    creditDays?: number
    actor: Actor
  }
): Promise<string> {
  const issueDate = nowIso().slice(0, 10)
  const due = new Date()
  due.setDate(due.getDate() + (input.creditDays ?? input.order.payment.creditDays ?? 30))

  const ref = doc(collection(firestore, SALES_INVOICES))
  const invoice: Omit<SalesInvoice, "id" | "createdAt" | "updatedAt"> = {
    organizationId: input.order.organizationId,
    invoiceNumber: generateSalesInvoiceNumber(),
    contactId: input.order.contactId ?? null,
    contactName: input.order.contactName ?? null,
    deliveryNoteIds: input.notes.map((n) => n.id),
    advance: false,
    orderId: input.order.id,
    orderNumber: input.order.orderNumber,
    advanceNet: null,
    vatPercent: isExternal(input.order) ? input.order.vatPercent : 0,
    issueDate,
    dueDate: due.toISOString().slice(0, 10),
    paid: false,
    paidAt: null,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
  }
  const batch = writeBatch(firestore)
  batch.set(ref, { ...invoice, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  await batch.commit()

  const calc = computeInvoice({ ...invoice, id: ref.id }, input.allNotes, [input.order])
  onSalesInvoiceIssued(
    firestore,
    { organizationId: input.order.organizationId, userId: input.actor.id, userName: input.actor.name },
    {
      invoiceId: ref.id,
      invoiceNumber: invoice.invoiceNumber,
      date: issueDate,
      net: calc.net,
      advanceRecovery: calc.depositRecovery,
      vat: calc.vat,
      contactId: input.order.contactId,
      clientName: input.order.contactName ?? null,
    }
  )
  return ref.id
}

/** Cash in: the invoice settles and the ledger clears the receivable. */
export async function markInvoicePaid(
  firestore: Firestore,
  input: {
    invoice: SalesInvoice
    notes: SalesDeliveryNote[]
    orders: SalesOrder[]
    actor: Actor
  }
): Promise<void> {
  const paidAt = nowIso()
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_INVOICES, input.invoice.id), {
    paid: true,
    paidAt,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()

  const calc = computeInvoice(input.invoice, input.notes, input.orders)
  onSalesInvoicePaid(
    firestore,
    { organizationId: input.invoice.organizationId, userId: input.actor.id, userName: input.actor.name },
    {
      invoiceId: input.invoice.id,
      invoiceNumber: input.invoice.invoiceNumber,
      date: paidAt.slice(0, 10),
      amount: calc.total,
      contactId: input.invoice.contactId,
      contactName: input.invoice.contactName ?? null,
    }
  )
}

// ---------------------------------------------------------------------------
// Frameworks
// ---------------------------------------------------------------------------

export async function createCallOff(
  firestore: Firestore,
  input: {
    framework: SalesOrder
    quantity: number
    actor: Actor
    allOrders: Array<{ orderNumber?: number }>
  }
): Promise<string> {
  const priceLine = input.framework.lines[0]
  const ref = doc(collection(firestore, SALES_ORDERS))
  const batch = writeBatch(firestore)
  batch.set(ref, {
    organizationId: input.framework.organizationId,
    orderNumber: nextSalesOrderNumber(input.allOrders),
    type: "standard",
    status: "running",
    contactId: input.framework.contactId,
    contactName: input.framework.contactName ?? null,
    projectId: null,
    projectName: null,
    quotationId: null,
    quotationNumber: null,
    frameworkId: input.framework.id,
    frameworkCap: null,
    frameworkValidUntil: null,
    payment: input.framework.payment,
    promiseDate: null,
    vatPercent: input.framework.vatPercent,
    lines: [{ ...priceLine, quantity: input.quantity }],
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closedAt: null,
  })
  await batch.commit()
  return ref.id
}

/** What can still be scheduled per line — the create-delivery dialog's rows. */
export function schedulableLines(order: SalesOrder, notes: SalesDeliveryNote[]) {
  return orderLineProgress(order, notes).filter((l) => l.open > 0)
}

// ---------------------------------------------------------------------------
// Returns — Sales decides, Finance issues the credit note
// ---------------------------------------------------------------------------

export async function requestReturn(
  firestore: Firestore,
  input: {
    order: SalesOrder
    deliveryNote: SalesDeliveryNote
    lines: Array<{ name: string; quantity: number }>
    reason: string
    /** Earlier returns against the same note — they cap what may still come back. */
    existingReturns?: Array<Pick<SalesReturn, "deliveryNoteId" | "lines" | "status">>
    actor: Actor
  }
): Promise<string> {
  // No return on a shipment the client never signed for: the delivered
  // quantity is corrected at signing instead of inventing a return (T21).
  if (input.deliveryNote.status !== "delivered") throw new Error("not_delivered")
  if (!input.reason.trim()) throw new Error("reason_required")
  const wanted = input.lines.filter((l) => l.quantity > 0)
  if (!wanted.length) throw new Error("lines_required")
  for (const l of wanted) {
    if (l.quantity > returnableQty(input.deliveryNote, l.name, input.existingReturns || []) + 0.005) throw new Error("over_delivered")
  }
  const ref = doc(collection(firestore, SALES_RETURNS))
  const batch = writeBatch(firestore)
  batch.set(ref, {
    organizationId: input.order.organizationId,
    returnNumber: generateReturnNumber(),
    orderId: input.order.id,
    orderNumber: input.order.orderNumber,
    contactId: input.order.contactId ?? null,
    contactName: input.order.contactName ?? null,
    deliveryNoteId: input.deliveryNote.id,
    lines: input.lines.filter((l) => l.quantity > 0),
    reason: input.reason,
    status: "awaiting_decision",
    decidedAt: null,
    decidedByUserId: null,
    decidedByUserName: null,
    creditNoteIssuedAt: null,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return ref.id
}

/** The decision is a prices-&-returns role's, never a rep's (DLV-05, S8). An
 * approval names what happens to the goods: back to stock, or scrapped. */
export async function decideReturn(
  firestore: Firestore,
  input: { salesReturn: SalesReturn; approve: boolean; disposition?: ReturnDisposition | null; actor: Actor }
): Promise<void> {
  if (input.salesReturn.status !== "awaiting_decision") throw new Error("already_decided")
  if (input.approve && !input.disposition) throw new Error("disposition_required")
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_RETURNS, input.salesReturn.id), {
    status: input.approve ? "approved" : "rejected",
    disposition: input.approve ? input.disposition : null,
    decidedAt: nowIso(),
    decidedByUserId: input.actor.id,
    decidedByUserName: input.actor.name,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/**
 * Finance's half: the credit note. One batch — the return closes and, when the
 * goods physically came back, the stock returns to the shelf it left. The
 * ledger reversal (revenue, VAT, receivable, cost) follows through the hook.
 */
export async function issueCreditNote(
  firestore: Firestore,
  input: {
    salesReturn: SalesReturn
    order: SalesOrder
    /** The delivering warehouse's rows, to restock by name. Empty = no restock. */
    stockRows: Array<{ id: string; name: string; quantity?: number; lot?: string | null; remnant?: boolean | null }>
    warehouseId?: string | null
    actor: Actor
  }
): Promise<void> {
  if (input.salesReturn.status !== "approved") throw new Error("not_approved")
  const issuedAt = nowIso()
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_RETURNS, input.salesReturn.id), {
    status: "credit_note_issued",
    creditNoteIssuedAt: issuedAt,
    creditNoteByUserId: input.actor.id,
    creditNoteByUserName: input.actor.name,
    updatedAt: serverTimestamp(),
  })
  // Scrapped goods never go back on the shelf; a return from before the
  // disposition existed restocks, as it always did.
  if (input.warehouseId && input.salesReturn.disposition !== "scrap") {
    for (const line of input.salesReturn.lines) {
      const row = pickStockRow(input.stockRows, line.name, 0)
      if (row) {
        batch.update(doc(firestore, "warehouses", input.warehouseId, "inventoryItems", row.id), {
          quantity: increment(line.quantity),
          updatedAt: serverTimestamp(),
        })
      }
    }
  }
  await batch.commit()

  const net = returnValue(input.salesReturn, input.order)
  const vat = isExternal(input.order) ? Math.round(net * input.order.vatPercent) / 100 : 0
  const cost = deliveryNoteCost(input.salesReturn, input.order)
  onSalesCreditNoteIssued(
    firestore,
    { organizationId: input.order.organizationId, userId: input.actor.id, userName: input.actor.name },
    {
      returnId: input.salesReturn.id,
      returnNumber: input.salesReturn.returnNumber,
      date: issuedAt.slice(0, 10),
      net,
      vat,
      cost: cost > 0 ? cost : null,
      contactId: input.order.contactId,
      contactName: input.order.contactName ?? null,
    }
  )
}

// ---------------------------------------------------------------------------
// Manufacturing requests — Sales asks, the plant answers
// ---------------------------------------------------------------------------

/**
 * A manufacturing request for a sales order's uncovered line
 * (sales.mfg_request.created). It carries the PRD 1.2 contract — source,
 * kind, lines with the product card, and the promise date as the need-by —
 * and keeps the single-item fields older screens read. The number is drawn
 * from the workshop's yearly MR sequence in the same transaction (ORD-07).
 */
export async function createManufacturingRequest(
  firestore: Firestore,
  input: {
    order: SalesOrder
    itemName: string
    unit: string
    quantity: number
    /** The manufacturing product card matched to the line, when one exists. */
    productId?: string | null
    actor: Actor
  }
): Promise<string> {
  const ref = doc(collection(firestore, MANUFACTURING_REQUESTS))
  const organizationId = input.order.organizationId
  // A line priced on the workshop's cost statement carries it into the order,
  // so the manager answers against the costed route and the variance has a
  // baseline (REQ-08). Best effort: no statement is not an error.
  let estimateId: string | null = null
  try {
    const won = await getDocs(
      query(collection(firestore, MFG_COST_ESTIMATES), where("organizationId", "==", organizationId), where("salesOrderNumber", "==", input.order.orderNumber))
    )
    const match = won.docs
      .map((d) => ({ ...(d.data() as MfgCostEstimate), id: d.id }))
      .find((e) => e.state === "won" && e.lines.some((l) => (input.productId && l.productId === input.productId) || itemKey(l.productName) === itemKey(input.itemName)))
    estimateId = match?.id ?? null
  } catch (err) {
    console.warn("cost statement lookup skipped:", (err as { code?: string })?.code || err)
  }
  await runTransaction(firestore, async (tx) => {
    let requestNumber: string
    try {
      requestNumber = (await drawDocNumber(firestore, tx, organizationId, "MR")).docNumber
    } catch (err) {
      // A counter the member cannot read must not stop the request.
      console.warn("MR sequence unavailable:", (err as { code?: string })?.code || err)
      requestNumber = generateMfgRequestNumber()
    }
    tx.set(ref, {
      organizationId,
      requestNumber,
      kind: "make",
      sourceKind: "sales",
      orderId: input.order.id,
      orderNumber: input.order.orderNumber,
      contactName: input.order.contactName ?? null,
      itemName: input.itemName,
      unit: input.unit,
      quantity: input.quantity,
      lines: [{ productId: input.productId ?? null, itemName: input.itemName, unit: input.unit, quantity: input.quantity }],
      estimateId,
      // Two days before the promise: the plant's date, not the client's (SO-16).
      neededBy: neededByFor(input.order.promiseDate),
      note: null,
      status: "new",
      workOrderId: null,
      workOrderNumber: null,
      rejectionReason: null,
      decidedAt: null,
      decidedByUserId: null,
      decidedByUserName: null,
      createdByUserId: input.actor.id,
      createdByUserName: input.actor.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      requestedAt: nowIso(),
    })
  })
  return ref.id
}

/** The plant needs it two days before we promised it to the client. */
export function neededByFor(promiseDate: string | null | undefined): string | null {
  if (!promiseDate) return null
  const d = new Date(`${promiseDate.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() - 2)
  return d.toISOString().slice(0, 10)
}

export interface ProductionNeed {
  itemName: string
  unit: string
  quantity: number
  productId: string
}

/**
 * What an order needs MADE: lines the workshop makes (they have a product
 * card) beyond what the stores hold, that are not already with the plant. A
 * stocked line is never asked of Manufacturing — and never of Procurement
 * either: available stock is a ceiling, and the fix is the order or the promise.
 */
export function productionNeeds(
  order: Pick<SalesOrder, "id" | "lines">,
  products: Array<{ id: string; name: string; unit?: string | null; archived?: boolean | null }>,
  stockByName: Map<string, number> | Array<{ name: string; available: number }>,
  existingRequests: Array<Pick<ManufacturingRequest, "orderId" | "itemName" | "status">>
): ProductionNeed[] {
  const stock = new Map<string, number>()
  if (stockByName instanceof Map) for (const [k, v] of stockByName) stock.set(itemKey(k), (stock.get(itemKey(k)) || 0) + (Number(v) || 0))
  else for (const r of stockByName) stock.set(itemKey(r.name), (stock.get(itemKey(r.name)) || 0) + (Number(r.available) || 0))
  const cards = new Map(products.filter((p) => !p.archived).map((p) => [itemKey(p.name), p]))
  const asked = new Set(
    existingRequests.filter((r) => r.orderId === order.id && ["new", "accepted", "partial", "estimated"].includes(r.status)).map((r) => itemKey(r.itemName || ""))
  )
  const out: ProductionNeed[] = []
  for (const line of order.lines) {
    const card = cards.get(itemKey(line.name))
    if (!card || asked.has(itemKey(line.name))) continue
    const short = Math.round((line.quantity - (stock.get(itemKey(line.name)) || 0)) * 100) / 100
    if (short > 0) out.push({ itemName: line.name, unit: line.unit || card.unit || "", quantity: Math.min(short, line.quantity), productId: card.id })
  }
  return out
}

/**
 * PAY-07 / D8 — reporting the advance sends the production request. It reaches
 * the plant while the order still waits for Finance, so the plant PLANS and
 * does not execute: its answer clock does not run and nothing releases until
 * the advance is confirmed (Manufacturing reads that off the sales order).
 * Best effort per line — a request that cannot be written never undoes the
 * transfer notice it follows.
 */
export async function requestProductionForAdvance(
  firestore: Firestore,
  input: { order: SalesOrder; needs: ProductionNeed[]; actor: Actor }
): Promise<string[]> {
  const ids: string[] = []
  for (const need of input.needs) {
    try {
      ids.push(await createManufacturingRequest(firestore, { order: input.order, itemName: need.itemName, unit: need.unit, quantity: need.quantity, productId: need.productId, actor: input.actor }))
    } catch (err) {
      console.warn("production request not sent:", (err as { code?: string })?.code || err)
    }
  }
  return ids
}

/**
 * The plant says yes: a work order opens through its own department chain, and
 * the request records which one — the salesperson watches readiness from the
 * order they asked on, not by walking to the workshop.
 */
export async function acceptManufacturingRequest(
  firestore: Firestore,
  input: { request: ManufacturingRequest; actor: Actor }
): Promise<string> {
  const [departmentsSnap, ordersSnap] = await Promise.all([
    getDocs(query(collection(firestore, MFG_DEPARTMENTS), where("organizationId", "==", input.request.organizationId))),
    getDocs(query(collection(firestore, WORK_ORDERS), where("organizationId", "==", input.request.organizationId))),
  ])
  const departments = departmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as MfgDepartment)
  if (departments.length === 0) throw new Error("no_departments")

  const orderNumber = nextWorkOrderNumber(ordersSnap.docs.map((d) => d.data()))
  const woRef = doc(collection(firestore, WORK_ORDERS))
  const batch = writeBatch(firestore)
  batch.set(woRef, {
    organizationId: input.request.organizationId,
    orderNumber,
    title: `${input.request.itemName} — ${input.request.requestNumber}`,
    items: [{ name: input.request.itemName, quantity: input.request.quantity, unit: input.request.unit }],
    output: { name: input.request.itemName, quantity: input.request.quantity, unit: input.request.unit },
    source: { kind: "manual" },
    salesOrderId: input.request.orderId,
    status: "open",
    currentStageIndex: 0,
    stages: buildStagesFromDepartments(departments),
    dueDate: null,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  })
  batch.update(doc(firestore, MANUFACTURING_REQUESTS, input.request.id), {
    status: "accepted",
    workOrderId: woRef.id,
    workOrderNumber: orderNumber,
    decidedAt: nowIso(),
    decidedByUserId: input.actor.id,
    decidedByUserName: input.actor.name,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return woRef.id
}

/** The plant says no, with a reason the salesperson can read to the customer. */
export async function rejectManufacturingRequest(
  firestore: Firestore,
  input: { request: ManufacturingRequest; reason: string; actor: Actor }
): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, MANUFACTURING_REQUESTS, input.request.id), {
    status: "rejected",
    rejectionReason: input.reason,
    decidedAt: nowIso(),
    decidedByUserId: input.actor.id,
    decidedByUserName: input.actor.name,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/** Record the site measurement — gate 1 opens. */
export async function recordOrderMeasurement(firestore: Firestore, orderId: string): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_ORDERS, orderId), {
    measurementRecordedAt: nowIso(),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/** The client signed the shop drawing — gate 2 opens. */
export async function approveOrderDrawings(firestore: Firestore, orderId: string): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_ORDERS, orderId), {
    approvalStatus: "approved",
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/** Sum of a paid deposit still unrecovered across issued invoices — shown so
 * the last invoice's recovery is visibly the remainder, not a surprise. */
export function unrecoveredDeposit(order: SalesOrder, invoices: SalesInvoice[], notes: SalesDeliveryNote[]): number {
  if (order.payment.kind !== "deposit" || !order.payment.depositPaid) return 0
  const recovered = invoices
    .filter((i) => i.orderId === order.id && !i.advance)
    .reduce((sum, i) => sum + computeInvoice(i, notes, [order]).depositRecovery, 0)
  return Math.max(0, Math.round((depositNet(order) - recovered) * 100) / 100)
}

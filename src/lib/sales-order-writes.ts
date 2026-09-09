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
  type ManufacturingRequest,
  type SalesDeliveryNote,
  type SalesInvoice,
  type SalesOrder,
  type SalesOrderLine,
  type SalesReturn,
} from "./sales-orders"
import { INSTALLMENT_DEPOSIT_ID, type CrmQuotation } from "./crm"
import {
  onSalesCreditNoteIssued,
  onSalesDelivered,
  onSalesInvoiceIssued,
  onSalesInvoicePaid,
  type HookActor,
} from "./accounting/hooks"
import { MFG_DEPARTMENTS, WORK_ORDERS, buildStagesFromDepartments, nextWorkOrderNumber, type MfgDepartment } from "./manufacturing"

const nowIso = () => new Date().toISOString()

export interface Actor {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Order creation
// ---------------------------------------------------------------------------

/**
 * Payment terms derived from the quotation's own schedule: a schedule that
 * opens with the deposit installment makes a deposit order (gated until paid);
 * anything else is credit. Nobody re-types terms that were already agreed.
 */
export function paymentFromQuotation(quotation: Pick<CrmQuotation, "installments">): SalesOrder["payment"] {
  const deposit = (quotation.installments || []).find((i) => i.id === INSTALLMENT_DEPOSIT_ID)
  if (deposit && deposit.percent > 0 && deposit.percent < 100) {
    return { kind: "deposit", depositPercent: deposit.percent, depositPaid: false }
  }
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
    actor: Actor
  }
): Promise<string | null> {
  const existing = await getDocs(
    query(collection(firestore, SALES_ORDERS), where("organizationId", "==", input.organizationId))
  )
  if (existing.docs.some((d) => d.data().quotationId === input.quotation.id)) return null

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
    promiseDate: null,
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
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closedAt: null,
  })
  batch.update(doc(firestore, "crmQuotations", input.quotation.id), { salesOrderId: orderRef.id })
  await batch.commit()
  return orderRef.id
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

/** Sales schedules; nothing moves yet — the warehouse owns the actual exit. */
export async function scheduleDelivery(
  firestore: Firestore,
  input: {
    order: SalesOrder
    lines: Array<{ name: string; quantity: number }>
    warehouseId: string
    warehouseName: string
    receiverName?: string | null
    actor: Actor
  }
): Promise<string> {
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

/**
 * The goods leave. One batch: the note delivers, the shelf empties, and the
 * order closes itself when this was the last outstanding quantity. The cost
 * entry follows through the safe hook.
 *
 * `stockRows` is the source warehouse's inventory — lines are matched by name
 * (this codebase's convention) and decremented; a name with no stock row still
 * delivers, it just cannot move stock it never had.
 */
export async function confirmDelivery(
  firestore: Firestore,
  input: {
    note: SalesDeliveryNote
    order: SalesOrder
    allNotes: SalesDeliveryNote[]
    stockRows: Array<{ id: string; name: string }>
    varianceNote?: string | null
    actor: Actor
  }
): Promise<void> {
  const { note, order } = input
  const deliveredAt = nowIso()
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_DELIVERY_NOTES, note.id), {
    status: "delivered",
    deliveredAt,
    deliveredByUserId: input.actor.id,
    deliveredByUserName: input.actor.name,
    varianceNote: input.varianceNote ?? null,
    updatedAt: serverTimestamp(),
  })

  if (note.warehouseId) {
    for (const line of note.lines) {
      const row = input.stockRows.find((r) => r.name.trim().toLowerCase() === line.name.trim().toLowerCase())
      if (row) {
        batch.update(doc(firestore, "warehouses", note.warehouseId, "inventoryItems", row.id), {
          quantity: increment(-line.quantity),
          updatedAt: serverTimestamp(),
        })
      }
    }
  }

  // Would-be state after this note flips: it plus the already-delivered ones.
  const after = input.allNotes.map((n) => (n.id === note.id ? { ...n, status: "delivered" as const } : n))
  if (isFullyDelivered(order, after)) {
    batch.update(doc(firestore, SALES_ORDERS, order.id), {
      status: "closed",
      closedAt: deliveredAt,
      updatedAt: serverTimestamp(),
    })
  }
  await batch.commit()

  const actor: HookActor = { organizationId: order.organizationId, userId: input.actor.id, userName: input.actor.name }
  onSalesDelivered(firestore, actor, {
    deliveryNoteId: note.id,
    noteNumber: note.noteNumber,
    orderNumber: order.orderNumber,
    date: deliveredAt.slice(0, 10),
    cost: deliveryNoteCost(note, order),
    contactId: order.contactId,
    contactName: order.contactName ?? null,
    projectId: order.projectId ?? null,
    projectName: order.projectName ?? null,
  })
}

/** Finance freezes a shipment; the reason travels with the note. */
export async function holdDelivery(firestore: Firestore, noteId: string, reason: string): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_DELIVERY_NOTES, noteId), {
    status: "held",
    holdReason: reason,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
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
    actor: Actor
  }
): Promise<string> {
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

export async function decideReturn(
  firestore: Firestore,
  input: { salesReturn: SalesReturn; approve: boolean; actor: Actor }
): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_RETURNS, input.salesReturn.id), {
    status: input.approve ? "approved" : "rejected",
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
    stockRows: Array<{ id: string; name: string }>
    warehouseId?: string | null
    actor: Actor
  }
): Promise<void> {
  const issuedAt = nowIso()
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, SALES_RETURNS, input.salesReturn.id), {
    status: "credit_note_issued",
    creditNoteIssuedAt: issuedAt,
    updatedAt: serverTimestamp(),
  })
  if (input.warehouseId) {
    for (const line of input.salesReturn.lines) {
      const row = input.stockRows.find((r) => r.name.trim().toLowerCase() === line.name.trim().toLowerCase())
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

export async function createManufacturingRequest(
  firestore: Firestore,
  input: {
    order: SalesOrder
    itemName: string
    unit: string
    quantity: number
    actor: Actor
  }
): Promise<string> {
  const ref = doc(collection(firestore, MANUFACTURING_REQUESTS))
  const batch = writeBatch(firestore)
  batch.set(ref, {
    organizationId: input.order.organizationId,
    requestNumber: generateMfgRequestNumber(),
    orderId: input.order.id,
    orderNumber: input.order.orderNumber,
    contactName: input.order.contactName ?? null,
    itemName: input.itemName,
    unit: input.unit,
    quantity: input.quantity,
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
  await batch.commit()
  return ref.id
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

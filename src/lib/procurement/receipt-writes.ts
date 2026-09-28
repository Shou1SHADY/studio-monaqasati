// The goods receipt's write (PRD 3.0 §5.2 steps 5–7) — where the gate's count
// becomes a document. ONE transaction re-validates the form against the order
// (`./receipts`), draws the `GR-yyyy/nnn` number, moves the order's line
// counters (`applyReceipt`) and flips the delivery to `confirmed` with the
// lines, the receiver and the checklist. What must happen next — stock into
// the warehouse, the books, Manufacturing's purchase request, the preparer and
// Finance, the supplier — rides AFTER the commit, each step on its own and
// best-effort: a receipt that landed no stock is still a receipt, and the
// result says which of its consequences did not happen so the screen can.
//
// Three doors into the same room:
//   `recordReceipt`             the supplier's (or guest's) notice, counted at the gate;
//                               a legacy notice with no lines confirms all, as before;
//   `createArrivalWithoutNotice` a truck with no notice against a live order;
//   `createManualReceipt`        an off-platform purchase — no order, no posting,
//                               a `GR` number so the regularisation queue can name it.
//
// Nothing here decides for Procurement: an order that is complete after the
// receipt stays `accepted` (its status is derived) until Procurement closes it.

import { addDoc, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, type DocumentReference, type Firestore, type Transaction } from "firebase/firestore"
import { onGoodsReceived } from "../accounting/hooks"
import { markPurchaseArrived, type WorkOrderV2 } from "../manufacturing-writes"
import { orderRef as workOrderRef } from "../manufacturing-view"
import { emitMfgEvent, mfgLinks } from "../mfg-events"
import { receiveDelivery, type ReceiveDeliveryItem } from "../warehouse-transfer"
import { emitProcEvent, procLinks } from "./events"
import { drawProcDocNumber } from "./numbering"
import { receiveRight, selfReceivedFlag } from "./policy-enforce"
import { round2 } from "./po"
import { acceptedOf, legacyLinesOf, linesForReceipt, receiptErrors, receiptLineErrors, receiptNetValue, type ReceiptError } from "./receipts"
import { matchReceiptToOrder } from "./receipt-regularise"
import { PURCHASE_ORDERS, type DeliveryLine, type ProcActor, type ProcurementPolicies, type PurchaseOrder, type ReceiptCheck } from "./types"
import { applyReceipt, emitReceiptRecorded, ProcWriteError, type WriteOpts } from "./writes"

const DELIVERIES = "deliveries"

/** The delivery as the desk holds it — the fields the write reads. */
export interface ReceiptDeliveryLike {
  id: string
  status?: string | null
  contractorOrgId?: string | null
  poId?: string | null
  poNumber?: string | null
  offerId?: string | null
  rfqId?: string | null
  rfqTitle?: string | null
  supplierId?: string | null
  supplierOrgId?: string | null
  supplierName?: string | null
  isGuestDelivery?: boolean | null
  projectId?: string | null
  deliveryPersonName?: string | null
  warehouseId?: string | null
  lines?: DeliveryLine[] | null
  items?: Array<{ name?: string | null; quantity?: number | string | null; unit?: string | null; unitOfMeasure?: string | null }> | null
}

export type PurchaseSource = { kind: string; workOrderId?: string; purchaseRequestId?: string } | null | undefined

/** Thrown when the form fails the domain's validation — codes, never sentences. */
export class ReceiptValidationError extends Error {
  constructor(readonly errors: ReceiptError[]) {
    super(errors.map((e) => e.code).join(","))
    this.name = "ReceiptValidationError"
  }
}

export interface ReceiptWriteOpts extends WriteOpts {
  /** Words for a central warehouse created on the fly (`Portal.Contractor.wh_central_*`). */
  centralWarehouseCopy?: { name: string; location: string; description: string } | null
}

export interface ReceiptEffects {
  /** The accepted quantities entered the warehouse. */
  stockLanded: boolean
  /** The books were handed the receipt (silent when Accounting is off). */
  posted: boolean
  /** Manufacturing's purchase request was marked arrived. */
  mfgClosed: boolean
  /** Where the stock went, when it went anywhere. */
  landedWarehouseId: string | null
}

export interface RecordReceiptResult extends ReceiptEffects {
  deliveryId: string
  docNumber: string
  /** The order as written, when there was one. */
  po: PurchaseOrder | null
}

// ---------------------------------------------------------------------------
// Lines — what the gate counts against
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}

// Pure, so they live in ./receipts — the receiver's link page builds its lines
// on the server with exactly the ids this form counts against.
export { legacyLinesOf, linesForReceipt } from "./receipts"

/** Lines the gate filled in (a blank line is skipped — a partial receipt of a
 * multi-line shipment is allowed), with `accepted` computed and the rest normalised. */
export function countedLines(lines: DeliveryLine[]): DeliveryLine[] {
  return lines
    .filter((l) => l.counted != null && String(l.counted) !== "")
    .map((l) => {
      const rejected = Math.max(0, num(l.rejected))
      const held = Math.max(0, num(l.held))
      return {
        poLineId: l.poLineId,
        name: l.name,
        unit: l.unit,
        noticeQuantity: Math.max(0, num(l.noticeQuantity)),
        counted: num(l.counted),
        rejected,
        rejectReason: rejected > 0 ? l.rejectReason ?? null : null,
        rejectNote: rejected > 0 ? l.rejectNote?.trim() || null : null,
        held,
        holdReason: held > 0 ? l.holdReason ?? null : null,
        accepted: acceptedOf({ counted: num(l.counted), rejected, held }),
      }
    })
}

/** The form's errors: against the order when there is one, per line otherwise. */
export function validateReceiptLines(po: PurchaseOrder | null, lines: DeliveryLine[], policies: ProcurementPolicies): ReceiptError[] {
  const counted = countedLines(lines)
  if (po) return receiptErrors(po, counted, policies)
  const out = counted.flatMap(receiptLineErrors)
  if (!out.length && !counted.some((l) => num(l.counted) > 0)) out.push({ code: "nothing_counted", params: {} })
  return out
}

/** What enters the warehouse: the accepted quantity per line, at the order's
 * unit price when it has one. A legacy delivery of ONE line priced as a lot
 * gets that lot's price per unit — never a total split across lines. */
export function stockItemsOf(lines: DeliveryLine[], po: PurchaseOrder | null, legacyNet?: number | null): ReceiveDeliveryItem[] {
  const priced = new Map(po ? po.lines.map((l) => [l.id, l.unitPrice]) : [])
  const items = lines.map((l) => ({ name: l.name, unit: l.unit, quantity: acceptedOf(l), unitCost: po ? (priced.get(l.poLineId) ?? null) : null })).filter((it) => it.name && it.unit && it.quantity > 0)
  if (!po && items.length === 1 && legacyNet != null && legacyNet > 0) items[0].unitCost = round2(legacyNet / items[0].quantity)
  return items
}

// ---------------------------------------------------------------------------
// Where the stock lands
// ---------------------------------------------------------------------------

const AR_CENTRAL = { name: "المستودع المركزي", location: "المقر الرئيسي", description: "المخزون الرئيسي للشركة — مستودعات المشاريع تسحب منه وتُرجع إليه" }

/** The warehouse the accepted goods enter: the one the receiver chose, else
 * the project's, else the org's central warehouse (created on the fly with
 * the same deterministic id `useCentralWarehouse` uses). */
export async function resolveLandingWarehouse(
  firestore: Firestore,
  orgId: string,
  input: { landedWarehouseId?: string | null; projectId?: string | null },
  copy?: ReceiptWriteOpts["centralWarehouseCopy"]
): Promise<string> {
  if (input.landedWarehouseId) return input.landedWarehouseId
  if (input.projectId) {
    const snap = await getDoc(doc(firestore, "projects", input.projectId))
    const wh = (snap.exists() ? (snap.data() as { warehouseId?: string | null }).warehouseId : null) || null
    if (wh) return wh
  }
  const centralId = `central_${orgId}`
  const centralRef = doc(firestore, "warehouses", centralId)
  const central = await getDoc(centralRef)
  if (!central.exists()) {
    const words = copy || AR_CENTRAL
    await setDoc(centralRef, { name: words.name, location: words.location, description: words.description, organizationId: orgId, isCentral: true, projectId: null, projectName: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  }
  return centralId
}

// ---------------------------------------------------------------------------
// The consequences — after the commit, each on its own
// ---------------------------------------------------------------------------

interface EffectsInput {
  orgId: string
  deliveryId: string
  docNumber: string
  delivery: ReceiptDeliveryLike
  po: PurchaseOrder | null
  lines: DeliveryLine[]
  landedWarehouseId: string
  net: number | null
  legacyNet: number | null
  projectName: string | null
  purchaseSource: PurchaseSource
  notifySupplier: boolean
}

async function runEffects(firestore: Firestore, actor: ProcActor, e: EffectsInput, opts: ReceiptWriteOpts): Promise<ReceiptEffects> {
  const out: ReceiptEffects = { stockLanded: false, posted: false, mfgClosed: false, landedWarehouseId: null }
  const items = stockItemsOf(e.lines, e.po, e.legacyNet)

  // 1 · Stock. Nothing to land is not a failure (a receipt of held goods only).
  try {
    if (items.length) await receiveDelivery({ firestore, warehouseId: e.landedWarehouseId, items, organizationId: e.orgId })
    // "Landed" means quantities reached a warehouse — a receipt with nothing
    // to land (held goods only, or no counted lines) posts nothing and says so.
    out.stockLanded = items.length > 0
    out.landedWarehouseId = items.length > 0 ? e.landedWarehouseId : null
    if (!items.length) await updateDoc(doc(firestore, DELIVERIES, e.deliveryId), { landedWarehouseId: null, postedNet: null }).catch(() => undefined)
  } catch (err) {
    console.error("Goods receipt into warehouse failed:", err)
    // The document said where it was going; it did not get there.
    await updateDoc(doc(firestore, DELIVERIES, e.deliveryId), { landedWarehouseId: null, postedNet: null }).catch(() => undefined)
  }

  // 2 · The books — only once the company holds the goods; per delivery, so
  // partial receipts (separate deliveries) never share an entry id.
  if (out.stockLanded && e.net != null && e.net > 0) {
    try {
      onGoodsReceived(
        firestore,
        { organizationId: e.orgId, userId: actor.uid, userName: actor.name },
        {
          deliveryId: e.deliveryId,
          net: e.net,
          supplierId: e.po ? (e.po.isGuestSupplier ? null : e.po.supplierOrgId) : e.delivery.supplierOrgId && e.delivery.supplierOrgId !== "guest" ? e.delivery.supplierOrgId : null,
          supplierName: e.po?.supplierName || e.delivery.supplierName || null,
          rfqTitle: e.po?.rfqTitle || e.delivery.rfqTitle || null,
          projectId: e.po?.projectId ?? e.delivery.projectId ?? null,
          projectName: e.projectName ?? e.po?.projectName ?? null,
        }
      )
      out.posted = true
    } catch (err) {
      console.warn("goods receipt not posted:", err)
    }
  }

  // 3 · Manufacturing: the purchase request this order answered is "arrived".
  const src = e.purchaseSource
  if (out.stockLanded && src?.kind === "mfg_purchase" && src.workOrderId && src.purchaseRequestId) {
    try {
      await markPurchaseArrived(firestore, { orderId: src.workOrderId, purchaseRequestId: src.purchaseRequestId, actor: { id: actor.uid, name: actor.name } })
      out.mfgClosed = true
      if (opts.copy) {
        const woSnap = await getDoc(doc(firestore, "workOrders", src.workOrderId))
        const wo = woSnap.exists() ? ({ ...(woSnap.data() as WorkOrderV2), id: woSnap.id } as WorkOrderV2) : null
        const pr = wo?.purchaseRequests?.find((p) => p.id === src.purchaseRequestId)
        if (wo && pr) {
          await emitMfgEvent(firestore, {
            kind: "purchase_arrived",
            copy: opts.copy,
            organizationId: e.orgId,
            actor: { id: actor.uid, name: actor.name },
            to: [{ permission: "manufacturing.manage" }, { users: [pr.byId] }],
            params: { ref: workOrderRef(wo), qty: String(pr.quantity), unit: pr.unit, item: pr.itemName, block: "" },
            workOrderId: wo.id,
            link: mfgLinks.order(wo.id),
          })
        }
      }
    } catch (err) {
      // Stock has landed either way; the request can still be closed from the inbox.
      console.warn("purchase request not closed:", err)
    }
  }

  // 4 · The preparer and Finance: accepted X of Y, the invoicing ceiling.
  if (e.po) {
    try {
      await emitReceiptRecorded(firestore, actor, e.po, { deliveryId: e.deliveryId, docNumber: e.docNumber }, opts)
    } catch (err) {
      console.warn("receipt event not delivered:", err)
    }
  }

  // 5 · The supplier — the same notification the offers view has always sent;
  // a guest has no user to tell and reads it on his offer page.
  const supplierUid = e.delivery.supplierId
  if (e.notifySupplier && supplierUid && supplierUid !== "guest" && !e.delivery.isGuestDelivery) {
    try {
      await addDoc(collection(firestore, "users", supplierUid, "notifications"), {
        userId: supplierUid,
        organizationId: e.delivery.supplierOrgId || supplierUid,
        type: "delivery_confirmed",
        i18n: { title: "pn_delivery_confirmed_title", message: "pn_delivery_confirmed", params: { rfq: e.delivery.rfqTitle || e.po?.rfqTitle || "" } },
        title: "✅ تم تأكيد الاستلام",
        message: `أكد المقاول استلام الشحنة لطلب عروض الأسعار: ${e.delivery.rfqTitle || e.po?.rfqTitle || ""}`,
        offerId: e.delivery.offerId ?? e.po?.offerId ?? null,
        rfqId: e.delivery.rfqId ?? e.po?.rfqId ?? null,
        createdAt: new Date().toISOString(),
        read: false,
      })
    } catch (err) {
      console.warn("supplier not told of the receipt:", err)
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// recordReceipt — the notice, counted at the gate
// ---------------------------------------------------------------------------

export interface RecordReceiptInput {
  /** The pending delivery (supplier or guest notice); may or may not name an order. */
  delivery: ReceiptDeliveryLike
  po: PurchaseOrder | null
  /** The gate's form; for a legacy delivery pass `legacyLinesOf(delivery)` (or nothing — it is built here). */
  lines?: DeliveryLine[] | null
  receiverName: string
  checklist?: ReceiptCheck[] | null
  signatureData?: string | null
  vehiclePlate?: string | null
  paperNoteNumber?: string | null
  note?: string | null
  /** Where the goods go; resolved from the project / the central warehouse when absent. */
  landedWarehouseId?: string | null
  policies: ProcurementPolicies
  /** Manufacturing's request this purchase answered — the order's, else the RFQ's. */
  purchaseSource?: PurchaseSource
  /** Σ `postedNet` of this order's earlier receipts — a lump-sum order posts the rest on completion. */
  alreadyPostedNet?: number | null
  /** A legacy delivery's value (the offer's price, ex-VAT) — what the books and the one-line unit cost read. */
  legacyNet?: number | null
  projectName?: string | null
}

/**
 * Confirm a pending delivery as a goods receipt. One transaction: validate,
 * draw the number, move the order's counters, flip the delivery. Then the
 * consequences, best-effort, reported in the result.
 */
export async function recordReceipt(firestore: Firestore, actor: ProcActor, input: RecordReceiptInput, opts: ReceiptWriteOpts = {}): Promise<RecordReceiptResult> {
  // The gate's own right, or — in a firm with no separate receiver — the buyer's
  // under the `buyerReceives` policy, flagged «استلمه مُعِدّ الأمر».
  const right = receiveRight(actor, input.policies)
  if (!right) throw new ProcWriteError("no_permission")
  const receiverName = (input.receiverName || "").trim()
  if (!receiverName) throw new ProcWriteError("reason_required", { field: "receiverName" })
  const orgId = input.delivery.contractorOrgId || ""
  if (!orgId) throw new ProcWriteError("order_missing", { field: "contractorOrgId" })
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const legacy = !input.po
  // A delivery that names an order is received against that order or not at
  // all — confirming it "legacy" would leave the order's lines at zero while
  // the books say the goods arrived.
  if (legacy && input.delivery.poId) throw new ProcWriteError("order_missing", { poId: input.delivery.poId })
  const lines = countedLines(input.lines && input.lines.length ? input.lines : legacy ? legacyLinesOf(input.delivery) : linesForReceipt(input.delivery, input.po))
  // A notice from before this module may carry no items at all (registered
  // suppliers' notices did): it confirms whole, as it always has, with nothing
  // to count — the value still reaches the books when the offer priced it.
  const confirmAll = legacy && lines.length === 0
  const errors = confirmAll ? [] : validateReceiptLines(input.po, lines, input.policies)
  if (errors.length) throw new ReceiptValidationError(errors)

  // Reads that need no transaction, before it: where the goods will go.
  const landedWarehouseId = await resolveLandingWarehouse(firestore, orgId, { landedWarehouseId: input.landedWarehouseId, projectId: input.delivery.projectId }, opts.centralWarehouseCopy)

  const deliveryRef = doc(firestore, DELIVERIES, input.delivery.id)
  const poRef = input.po ? (doc(firestore, PURCHASE_ORDERS, input.po.id) as DocumentReference) : null
  const committed = await runTransaction(firestore, async (tx) => {
    const dSnap = await tx.get(deliveryRef)
    if (!dSnap.exists()) throw new ProcWriteError("order_missing", { doc: "delivery" })
    if ((dSnap.data() as { status?: string }).status === "confirmed") throw new ProcWriteError("wrong_state")
    let po: PurchaseOrder | null = null
    if (poRef) {
      const pSnap = await tx.get(poRef)
      if (!pSnap.exists()) throw new ProcWriteError("order_missing")
      po = { ...(pSnap.data() as Omit<PurchaseOrder, "id">), id: pSnap.id, lines: (pSnap.data() as PurchaseOrder).lines || [], log: (pSnap.data() as PurchaseOrder).log || [] }
      // The order as it is NOW — a stale screen is refused, not trimmed.
      const again = receiptErrors(po, lines, input.policies)
      if (again.length) throw new ReceiptValidationError(again)
    }
    const docNumber = await drawProcDocNumber(firestore, tx, orgId, "GR", now.getUTCFullYear())
    let net: number | null = null
    let after: PurchaseOrder | null = null
    if (po && poRef) {
      net = receiptNetValue(po, lines, input.alreadyPostedNet ?? 0)
      const newLines = applyReceipt(tx, poRef, po, lines, actor, { deliveryId: input.delivery.id, docNumber, at })
      after = { ...po, lines: newLines, status: po.status === "sent" ? "accepted" : po.status }
    } else if (input.legacyNet != null && input.legacyNet > 0) {
      net = round2(input.legacyNet)
    }
    tx.update(deliveryRef, {
      status: "confirmed",
      docNumber,
      lines,
      receivedByName: receiverName,
      receiverUserId: actor.uid,
      confirmedAt: serverTimestamp(),
      confirmedByUserId: actor.uid,
      confirmedByName: actor.name,
      checklist: input.checklist || [],
      vehiclePlate: input.vehiclePlate?.trim() || null,
      paperNoteNumber: input.paperNoteNumber?.trim() || null,
      receiptNote: input.note?.trim() || null,
      receiverSignatureData: input.signatureData || null,
      landedWarehouseId,
      selfReceived: selfReceivedFlag(actor, right, po),
      postedNet: net,
      ...(po ? { poId: po.id, poNumber: po.docNumber } : {}),
    })
    return { docNumber, po: after, net }
  })

  const effects = await runEffects(
    firestore,
    actor,
    {
      orgId,
      deliveryId: input.delivery.id,
      docNumber: committed.docNumber,
      delivery: input.delivery,
      po: committed.po,
      lines,
      landedWarehouseId,
      net: committed.net,
      legacyNet: input.legacyNet ?? null,
      projectName: input.projectName ?? null,
      purchaseSource: input.purchaseSource ?? committed.po?.purchaseSource ?? null,
      notifySupplier: true,
    },
    opts
  )
  return { deliveryId: input.delivery.id, docNumber: committed.docNumber, po: committed.po, ...effects }
}

// ---------------------------------------------------------------------------
// createArrivalWithoutNotice — a truck with no notice, against an order
// ---------------------------------------------------------------------------

export interface ArrivalWithoutNoticeInput {
  po: PurchaseOrder
  lines: DeliveryLine[]
  receiverName: string
  /** `YYYY-MM-DD`; today when absent. */
  deliveryDate?: string | null
  driverName?: string | null
  checklist?: ReceiptCheck[] | null
  signatureData?: string | null
  vehiclePlate?: string | null
  paperNoteNumber?: string | null
  note?: string | null
  landedWarehouseId?: string | null
  policies: ProcurementPolicies
  purchaseSource?: PurchaseSource
  alreadyPostedNet?: number | null
  projectName?: string | null
  /** Procurement typed it into the manual form (flagged `source: manual`) rather than the gate recording an arrival. */
  manual?: boolean
  /** The invoice or note, uploaded before the write (the manual form's photo). */
  attachmentUrls?: string[] | null
}

/**
 * A contractor-born `deliveries` document, born `confirmed` and flagged
 * `noNotice`. It carries only `poId`/`poNumber` of the order — the create rule
 * forbids `offerId`/`rfqId`/`supplierOrgId`/`supplierId` on a contractor's own
 * delivery (so nobody impersonates a supplier), and the order names them.
 */
export async function createArrivalWithoutNotice(firestore: Firestore, actor: ProcActor, input: ArrivalWithoutNoticeInput, opts: ReceiptWriteOpts = {}): Promise<RecordReceiptResult> {
  // The gate records an arrival; the manual form is Procurement's (S-13).
  const right = receiveRight(actor, input.policies)
  if (!right && !(input.manual && (actor.canPrepare || actor.canApprove))) throw new ProcWriteError("no_permission")
  const receiverName = (input.receiverName || "").trim()
  if (!receiverName) throw new ProcWriteError("reason_required", { field: "receiverName" })
  const orgId = input.po.organizationId
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const lines = countedLines(input.lines)
  const errors = receiptErrors(input.po, lines, input.policies)
  if (errors.length) throw new ReceiptValidationError(errors)

  const landedWarehouseId = await resolveLandingWarehouse(firestore, orgId, { landedWarehouseId: input.landedWarehouseId, projectId: input.po.projectId }, opts.centralWarehouseCopy)
  const deliveryRef = doc(collection(firestore, DELIVERIES))
  const poRef = doc(firestore, PURCHASE_ORDERS, input.po.id) as DocumentReference
  const pendingIds = await pendingNoticeIds(firestore, input.po.id)
  const committed = await runTransaction(firestore, async (tx) => {
    const pendingNotices = await readPendingNotices(tx, firestore, pendingIds)
    const pSnap = await tx.get(poRef)
    if (!pSnap.exists()) throw new ProcWriteError("order_missing")
    const po: PurchaseOrder = { ...(pSnap.data() as Omit<PurchaseOrder, "id">), id: pSnap.id, lines: (pSnap.data() as PurchaseOrder).lines || [], log: (pSnap.data() as PurchaseOrder).log || [] }
    const again = receiptErrors(po, lines, input.policies)
    if (again.length) throw new ReceiptValidationError(again)
    const docNumber = await drawProcDocNumber(firestore, tx, orgId, "GR", now.getUTCFullYear())
    const net = receiptNetValue(po, lines, input.alreadyPostedNet ?? 0)
    const newLines = applyReceipt(tx, poRef, po, lines, actor, { deliveryId: deliveryRef.id, docNumber, at })
    closeNoticesByReceipt(tx, pendingNotices, lines, { deliveryId: deliveryRef.id, docNumber })
    tx.set(deliveryRef, {
      contractorOrgId: orgId,
      contractorId: actor.uid,
      poId: po.id,
      poNumber: po.docNumber,
      docNumber,
      supplierName: po.supplierName,
      rfqTitle: po.rfqTitle,
      projectId: po.projectId ?? null,
      deliveryPersonName: input.driverName?.trim() || null,
      deliveryDate: input.deliveryDate || at.slice(0, 10),
      lines,
      status: "confirmed",
      noNotice: true,
      ...(input.manual ? { source: "manual" } : {}),
      ...(input.attachmentUrls?.length ? { attachmentUrls: input.attachmentUrls } : {}),
      receivedByName: receiverName,
      receiverUserId: actor.uid,
      confirmedAt: serverTimestamp(),
      confirmedByUserId: actor.uid,
      confirmedByName: actor.name,
      createdAt: serverTimestamp(),
      checklist: input.checklist || [],
      vehiclePlate: input.vehiclePlate?.trim() || null,
      paperNoteNumber: input.paperNoteNumber?.trim() || null,
      receiptNote: input.note?.trim() || null,
      receiverSignatureData: input.signatureData || null,
      landedWarehouseId,
      selfReceived: input.manual ? po.preparedById === actor.uid : selfReceivedFlag(actor, right, po),
      postedNet: net,
    })
    return { docNumber, po: { ...po, lines: newLines, status: po.status === "sent" ? ("accepted" as const) : po.status }, net }
  })

  if (input.manual) {
    await emitProcEvent(firestore, actor, {
      kind: "receipt_manual",
      organizationId: orgId,
      to: [{ permission: "invoices.manage" }, { permission: "accounting.post" }],
      params: { receipt: committed.docNumber, supplier: input.po.supplierName, order: ` — ${input.po.docNumber}` },
      poId: input.po.id,
      rfqId: input.po.rfqId,
      offerId: input.po.offerId,
      link: procLinks.receipt(deliveryRef.id),
      copy: opts.copy,
    })
  }
  const delivery: ReceiptDeliveryLike = { id: deliveryRef.id, contractorOrgId: orgId, poId: input.po.id, supplierName: input.po.supplierName, rfqTitle: input.po.rfqTitle, projectId: input.po.projectId, supplierId: input.po.supplierUserId, supplierOrgId: input.po.supplierOrgId, isGuestDelivery: input.po.isGuestSupplier }
  const effects = await runEffects(
    firestore,
    actor,
    {
      orgId,
      deliveryId: deliveryRef.id,
      docNumber: committed.docNumber,
      delivery,
      po: committed.po,
      lines,
      landedWarehouseId,
      net: committed.net,
      legacyNet: null,
      projectName: input.projectName ?? null,
      purchaseSource: input.purchaseSource ?? committed.po.purchaseSource ?? null,
      notifySupplier: true,
    },
    opts
  )
  return { deliveryId: deliveryRef.id, docNumber: committed.docNumber, po: committed.po, ...effects }
}

// ---------------------------------------------------------------------------
// createManualReceipt — an off-platform purchase, no order
// ---------------------------------------------------------------------------

export interface ManualReceiptInput {
  organizationId: string
  supplierName: string
  /** `YYYY-MM-DD`, today or earlier. */
  deliveryDate: string
  receiverName: string
  driverName?: string | null
  notes?: string | null
  /** Why it was bought outside the platform. */
  reason?: string | null
  warehouseId?: string | null
  projectId?: string | null
  items: Array<{ name: string; quantity: number; unit: string; unitPrice?: number | null; inventoryItemId?: string | null }>
  paperNoteNumber?: string | null
  supplierCrNumber?: string | null
  supplierVatNumber?: string | null
  contractorCrNumber?: string | null
  contractorVatNumber?: string | null
  supplierSignatureData?: string | null
  contractorSignatureData?: string | null
  /** The registered supplier the typed name belongs to, when picked — the regularisation starts from it. */
  supplierGuessOrgId?: string | null
  /** The invoice or note, uploaded before the write. */
  attachmentUrls?: string[] | null
}

/**
 * A receipt with no order: `source: "manual"`, born confirmed, numbered so the
 * regularisation queue can name it. Lands stock when a warehouse was chosen
 * (by name and unit, like every receipt); posts nothing — Finance books it
 * once it is regularised or declared a cash expense.
 */
export async function createManualReceipt(firestore: Firestore, actor: ProcActor, input: ManualReceiptInput, opts: ReceiptWriteOpts = {}): Promise<{ deliveryId: string; docNumber: string; stockLanded: boolean }> {
  // A purchase made outside the platform is Procurement's to declare (S-13): buyer or manager.
  if (!actor.isOwner && !actor.canPrepare && !actor.canApprove) throw new ProcWriteError("no_permission")
  const supplierName = input.supplierName.trim()
  const receiverName = input.receiverName.trim()
  const items = input.items.map((it) => ({ ...it, name: it.name.trim(), unit: (it.unit || "").trim(), quantity: num(it.quantity) })).filter((it) => it.name && it.quantity > 0)
  if (!supplierName || !receiverName || !items.length || !/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate)) throw new ProcWriteError("reason_required", { field: "form" })
  const now = opts.now ?? new Date()
  const deliveryRef = doc(collection(firestore, DELIVERIES))
  const lines: DeliveryLine[] = items.map((it, i) => ({ poLineId: `i${i + 1}`, name: it.name, unit: it.unit, noticeQuantity: 0, counted: it.quantity, rejected: 0, held: 0, accepted: it.quantity }))
  const docNumber = await runTransaction(firestore, async (tx) => {
    const number = await drawProcDocNumber(firestore, tx, input.organizationId, "GR", now.getUTCFullYear())
    tx.set(deliveryRef, {
      contractorOrgId: input.organizationId,
      contractorId: actor.uid,
      supplierName,
      deliveryPersonName: input.driverName?.trim() || null,
      receivedByName: receiverName,
      receiverUserId: actor.uid,
      deliveryDate: input.deliveryDate,
      notes: input.notes?.trim() || null,
      receiptNote: input.reason?.trim() || null,
      warehouseId: input.warehouseId || null,
      landedWarehouseId: input.warehouseId || null,
      projectId: input.projectId || null,
      items: items.map((it) => ({ itemId: it.inventoryItemId || null, name: it.name, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice ?? null })),
      lines,
      docNumber: number,
      paperNoteNumber: input.paperNoteNumber?.trim() || null,
      supplierCrNumber: input.supplierCrNumber?.trim() || null,
      supplierVatNumber: input.supplierVatNumber?.trim() || null,
      contractorCrNumber: input.contractorCrNumber?.trim() || null,
      contractorVatNumber: input.contractorVatNumber?.trim() || null,
      supplierSignatureData: input.supplierSignatureData || null,
      contractorSignatureData: input.contractorSignatureData || null,
      status: "confirmed",
      confirmedByUserId: actor.uid,
      confirmedByName: actor.name,
      confirmedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      source: "manual",
      supplierGuessOrgId: input.supplierGuessOrgId || null,
      ...(input.attachmentUrls?.length ? { attachmentUrls: input.attachmentUrls } : {}),
      postedNet: null,
    })
    return number
  })
  let stockLanded = false
  if (input.warehouseId) {
    try {
      await receiveDelivery({ firestore, warehouseId: input.warehouseId, items: items.filter((it) => it.unit).map((it) => ({ name: it.name, unit: it.unit, quantity: it.quantity, unitCost: it.unitPrice ?? null })), organizationId: input.organizationId })
      stockLanded = true
    } catch (err) {
      console.error("Manual receipt into warehouse failed:", err)
    }
  }
  await emitProcEvent(firestore, actor, {
    kind: "receipt_manual",
    organizationId: input.organizationId,
    to: [{ permission: "invoices.manage" }, { permission: "accounting.post" }],
    params: { receipt: docNumber, supplier: supplierName, order: "" },
    poId: "",
    link: procLinks.receipt(deliveryRef.id),
    copy: opts.copy,
  })
  return { deliveryId: deliveryRef.id, docNumber, stockLanded }
}

/** The no-PO receipt is booked as a cash expense — a note-only marker Finance
 * reads. Only for a receipt Procurement typed by hand, and only once. */
export async function markReceiptAsExpense(firestore: Firestore, actor: ProcActor, deliveryId: string, opts: Pick<WriteOpts, "now" | "copy"> = {}): Promise<void> {
  if (!actor.isOwner && !actor.canPrepare && !actor.canApprove) throw new ProcWriteError("no_permission")
  const ref = doc(firestore, DELIVERIES, deliveryId)
  const d = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ProcWriteError("order_missing", { doc: "delivery" })
    const d = snap.data() as { source?: string | null; poId?: string | null; offerId?: string | null; regularisation?: string | null; contractorOrgId?: string; docNumber?: string; supplierName?: string }
    if (d.source !== "manual" || d.poId || d.offerId || d.regularisation) throw new ProcWriteError("not_no_po")
    tx.update(ref, { regularisation: "expense", regularisedAt: (opts.now ?? new Date()).toISOString(), regularisedById: actor.uid, regularisedByName: actor.name })
    return d
  })
  // The prototype's `proc:EXP` — Finance books the invoice as a cash expense.
  await emitProcEvent(firestore, actor, {
    kind: "receipt_expensed",
    organizationId: d.contractorOrgId || "",
    to: [{ permission: "invoices.manage" }, { permission: "accounting.post" }],
    params: { receipt: d.docNumber || "", supplier: d.supplierName || "" },
    poId: "",
    link: procLinks.receipt(deliveryId),
    copy: opts.copy,
  })
}

// ---------------------------------------------------------------------------
// linkReceiptToOrder — a no-PO receipt counted against an order already open
// ---------------------------------------------------------------------------

export interface LinkReceiptResult {
  poNumber: string
  /** The books heard of it (the goods had landed in a warehouse). */
  posted: boolean
}

/**
 * Tie a receipt that had no order to an order already open for the same
 * material. ONE transaction reads both, matches every line (all or nothing),
 * moves the order's counters and stamps the receipt with the order. No new
 * commitment: the quantity was already ordered. The books hear of it after the
 * commit when the goods landed in a warehouse, as with any receipt.
 */
export async function linkReceiptToOrder(firestore: Firestore, actor: ProcActor, input: { deliveryId: string; poId: string }, opts: ReceiptWriteOpts = {}): Promise<LinkReceiptResult> {
  if (!actor.isOwner && !actor.canPrepare && !actor.canApprove) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const deliveryRef = doc(firestore, DELIVERIES, input.deliveryId)
  const poRef = doc(firestore, PURCHASE_ORDERS, input.poId) as DocumentReference
  type ManualDoc = ReceiptDeliveryLike & { source?: string | null; regularisation?: string | null; docNumber?: string | null; landedWarehouseId?: string | null }
  const committed = await runTransaction(firestore, async (tx) => {
    const dSnap = await tx.get(deliveryRef)
    if (!dSnap.exists()) throw new ProcWriteError("order_missing", { doc: "delivery" })
    const d: ManualDoc = { ...(dSnap.data() as ManualDoc), id: dSnap.id }
    if (d.source !== "manual" || d.poId || d.offerId || d.regularisation) throw new ProcWriteError("not_no_po")
    const pSnap = await tx.get(poRef)
    if (!pSnap.exists()) throw new ProcWriteError("order_missing")
    const po: PurchaseOrder = { ...(pSnap.data() as Omit<PurchaseOrder, "id">), id: pSnap.id, lines: (pSnap.data() as PurchaseOrder).lines || [], log: (pSnap.data() as PurchaseOrder).log || [] }
    if (po.status !== "accepted") throw new ProcWriteError("wrong_state")
    const lines = matchReceiptToOrder(d.lines && d.lines.length ? d.lines : legacyLinesOf(d), po)
    if (!lines) throw new ProcWriteError("no_matching_order")
    const net = receiptNetValue(po, lines, 0)
    const newLines = applyReceipt(tx, poRef, po, lines, actor, { deliveryId: d.id, docNumber: d.docNumber || null, at })
    const posts = Boolean(d.landedWarehouseId) && net != null && net > 0
    tx.update(deliveryRef, {
      poId: po.id,
      poNumber: po.docNumber,
      lines,
      regularisedAt: at,
      regularisedById: actor.uid,
      regularisedByName: actor.name,
      postedNet: posts ? net : null,
    })
    return { po: { ...po, lines: newLines }, net: posts ? net : null, delivery: d }
  })
  const { po, net, delivery } = committed
  let posted = false
  if (net != null) {
    try {
      onGoodsReceived(
        firestore,
        { organizationId: po.organizationId, userId: actor.uid, userName: actor.name },
        { deliveryId: delivery.id, net, supplierId: po.isGuestSupplier ? null : po.supplierOrgId, supplierName: po.supplierName, rfqTitle: po.rfqTitle || null, projectId: po.projectId ?? null, projectName: po.projectName ?? null }
      )
      posted = true
    } catch (err) {
      console.warn("regularised receipt not posted:", err)
    }
  }
  try {
    await emitReceiptRecorded(firestore, actor, po, { deliveryId: delivery.id, docNumber: delivery.docNumber || null }, opts)
  } catch (err) {
    console.warn("receipt event not delivered:", err)
  }
  return { poNumber: po.docNumber, posted }
}

// ---------------------------------------------------------------------------
// A receipt recorded without the notice closes what the notice announced
// ---------------------------------------------------------------------------

interface PendingNotice {
  ref: DocumentReference
  lines: DeliveryLine[]
}

/** The order's notices still «في الطريق» — read before the transaction (a query cannot run inside one). */
async function pendingNoticeIds(firestore: Firestore, poId: string): Promise<string[]> {
  try {
    const q = await getDocs(query(collection(firestore, DELIVERIES), where("poId", "==", poId), where("status", "==", "pending_confirmation")))
    return q.docs.filter((d) => !(d.data() as { closedByReceipt?: unknown }).closedByReceipt).map((d) => d.id)
  } catch (err) {
    console.warn("pending notices not read:", (err as { code?: string })?.code || err)
    return []
  }
}

async function readPendingNotices(tx: Transaction, firestore: Firestore, ids: string[]): Promise<PendingNotice[]> {
  const out: PendingNotice[] = []
  for (const id of ids) {
    const ref = doc(firestore, DELIVERIES, id) as DocumentReference
    const snap = await tx.get(ref)
    const d = snap.exists() ? (snap.data() as { status?: string; lines?: DeliveryLine[]; closedByReceipt?: unknown }) : null
    if (d && d.status === "pending_confirmation" && !d.closedByReceipt) out.push({ ref, lines: d.lines || [] })
  }
  return out
}

/**
 * Pure: what the receipt's counted quantities leave of the notices, oldest
 * first, per order line. A notice with nothing left is closed by the receipt;
 * one with something left is trimmed and stays on the way.
 */
export function trimNotices(notices: Array<{ lines: DeliveryLine[] }>, received: DeliveryLine[]): Array<{ lines: DeliveryLine[]; closed: boolean; changed: boolean }> {
  const left = new Map<string, number>()
  for (const l of received) left.set(l.poLineId, round2((left.get(l.poLineId) || 0) + Math.max(0, num(l.counted))))
  return notices.map((n) => {
    let changed = false
    const lines = n.lines.map((l) => {
      const take = Math.min(left.get(l.poLineId) || 0, Math.max(0, num(l.noticeQuantity)))
      if (!(take > 0)) return l
      left.set(l.poLineId, round2((left.get(l.poLineId) || 0) - take))
      changed = true
      return { ...l, noticeQuantity: round2(num(l.noticeQuantity) - take) }
    })
    return { lines, changed, closed: changed && lines.every((l) => !(num(l.noticeQuantity) > 0)) }
  })
}

function closeNoticesByReceipt(tx: Transaction, notices: PendingNotice[], received: DeliveryLine[], by: { deliveryId: string; docNumber: string }): void {
  const trimmed = trimNotices(notices, received)
  trimmed.forEach((t, i) => {
    if (!t.changed) return
    tx.update(notices[i].ref, { lines: t.lines, ...(t.closed ? { closedByReceipt: by } : {}), updatedAt: serverTimestamp() })
  })
}

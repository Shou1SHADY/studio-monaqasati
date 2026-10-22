// What Procurement still WRITES on a receipt from the browser (PRD 2.0): regularising a receipt that has no order — tie it to an order
// already open, or rule it a cash expense. The receipt itself is the RECEIVER's and is made on the server the moment he confirms
// (`./receipt-confirm-server`; G-09), and a manual receipt is made by `./manual-receipt-server`; nothing here counts goods.

import { doc, runTransaction, type DocumentReference } from "firebase/firestore"
import type { Firestore } from "firebase/firestore"
import { onGoodsReceived } from "../accounting/hooks"
import { emitProcEvent, procLinks } from "./events"
import { legacyLinesOf, receiptNetValue, type ReceiptLineSource } from "./receipts"
import { matchReceiptToOrder } from "./receipt-regularise"
import { PURCHASE_ORDERS, type ProcActor, type PurchaseOrder } from "./types"
import { applyReceipt, emitReceiptRecorded, ProcWriteError, type WriteOpts } from "./writes"

const DELIVERIES = "deliveries"

export interface ReceiptWriteOpts extends WriteOpts {
  centralWarehouseCopy?: { name: string; location: string; description: string } | null
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
  type ManualDoc = ReceiptLineSource & { id: string; poId?: string | null; offerId?: string | null; source?: string | null; regularisation?: string | null; docNumber?: string | null; landedWarehouseId?: string | null }
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

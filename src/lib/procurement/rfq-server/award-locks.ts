// Which request lines a live order of an RFQ already carries (`rfqLocks`, WF-25): after a re-award only the lines of the cancelled
// order are open again; the others stay with the orders that hold them, and the offers behind those orders are not picked twice.

import type { Firestore, Transaction } from "firebase-admin/firestore"
import { PURCHASE_ORDERS, type PurchaseOrder } from "../types"

export interface Locks {
  locked: Record<number, { poId: string; poNumber: string }>
  liveOfferIds: Set<string>
}

export const locksOf = (orders: ReadonlyArray<Pick<PurchaseOrder, "id" | "docNumber" | "status" | "offerId" | "lines">>): Locks => {
  const out: Locks = { locked: {}, liveOfferIds: new Set() }
  for (const po of orders) {
    if (po.status === "cancelled") continue
    if (po.offerId) out.liveOfferIds.add(po.offerId)
    for (const l of po.lines || []) if (l.rfqProductIndex != null) out.locked[l.rfqProductIndex] = { poId: po.id, poNumber: po.docNumber }
  }
  return out
}

export async function listLiveOrdersOf(db: Firestore, tx: Transaction, rfqId: string): Promise<Locks> {
  const snap = await tx.get(db.collection(PURCHASE_ORDERS).where("rfqId", "==", rfqId))
  return locksOf(snap.docs.map((d) => ({ ...(d.data() as Omit<PurchaseOrder, "id">), id: d.id })))
}

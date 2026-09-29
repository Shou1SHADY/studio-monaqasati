// Telling a need which RFQ or order answers it. A work order's shortfall is
// linked through Manufacturing's own write; a project's request gets the link
// on its document (the rules let Procurement write only these fields, once);
// a stock gap stores nothing — it reads the open RFQs and orders.

import { deleteField, doc, getDoc, runTransaction, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore"
import { linkPurchaseRequestOrder, linkPurchaseRequestRfq } from "../manufacturing-writes"
import { WORK_ORDERS } from "../manufacturing"
import type { PurchaseRequestRecord } from "../manufacturing-engine"
import type { Need } from "./needs"
import type { LineNeedSource } from "./rfq-view"

export async function linkNeed(
  firestore: Firestore,
  source: Need["source"],
  link: { rfqId: string; rfqNumber?: string | null } | { poId: string; poNumber: string },
  byName: string
): Promise<void> {
  if (source.kind === "mfg_purchase" && source.workOrderId && source.purchaseRequestId) {
    if ("rfqId" in link) await linkPurchaseRequestRfq(firestore, { orderId: source.workOrderId, purchaseRequestId: source.purchaseRequestId, rfqId: link.rfqId, rfqNumber: link.rfqNumber ?? null })
    else await linkPurchaseRequestOrder(firestore, { orderId: source.workOrderId, purchaseRequestId: source.purchaseRequestId, poId: link.poId, poNumber: link.poNumber })
    return
  }
  if (source.kind === "project_request" && source.projectId && source.purchaseRequestId) {
    const fields = "rfqId" in link ? { rfqId: link.rfqId, rfqNumber: link.rfqNumber ?? null } : { poId: link.poId, poNumber: link.poNumber }
    await updateDoc(doc(firestore, "projects", source.projectId, "purchaseRequests", source.purchaseRequestId), {
      ...fields,
      orderedAt: new Date().toISOString(),
      orderedByName: byName,
      updatedAt: serverTimestamp(),
    })
  }
}

/** A work order's request that this RFQ took, handed back as it was before: sent, no RFQ. */
export function releaseRfqFromRequests(rows: PurchaseRequestRecord[], purchaseRequestId: string, rfqId: string): PurchaseRequestRecord[] {
  return rows.map((p) => (p.id !== purchaseRequestId || p.state !== "ordered" || p.rfqId !== rfqId || p.poId ? p : { ...p, state: "sent" as const, rfqId: null, rfqNumber: null, orderedAt: null }))
}

/**
 * A draft RFQ is deleted: every need it held goes back to the desk (R-19).
 * Only a link to THIS RFQ is undone — a need that has since moved on is left
 * alone. Each need is its own write; one refused does not stop the others.
 * Returns how many could not be handed back.
 */
export async function unlinkNeedsFromRfq(firestore: Firestore, rfqId: string, sources: LineNeedSource[]): Promise<number> {
  let failed = 0
  for (const s of sources) {
    try {
      if (s.kind === "mfg_purchase" && s.workOrderId && s.purchaseRequestId) {
        const { workOrderId, purchaseRequestId } = s
        await runTransaction(firestore, async (tx) => {
          const ref = doc(firestore, WORK_ORDERS, workOrderId)
          const snap = await tx.get(ref)
          if (!snap.exists()) return
          const rows = (snap.data() as { purchaseRequests?: PurchaseRequestRecord[] }).purchaseRequests || []
          const next = releaseRfqFromRequests(rows, purchaseRequestId, rfqId)
          if (next.some((p, i) => p !== rows[i])) tx.update(ref, { purchaseRequests: next, updatedAt: serverTimestamp() })
        })
      } else if (s.kind === "project_request" && s.projectId && s.purchaseRequestId) {
        const ref = doc(firestore, "projects", s.projectId, "purchaseRequests", s.purchaseRequestId)
        const snap = await getDoc(ref)
        const data = snap.exists() ? (snap.data() as { rfqId?: string | null; poId?: string | null }) : null
        if (data?.rfqId === rfqId && !data.poId) await updateDoc(ref, { rfqId: deleteField(), rfqNumber: deleteField(), orderedAt: deleteField(), orderedByName: deleteField(), updatedAt: serverTimestamp() })
      }
    } catch (err) {
      console.error("need ↔ RFQ unlink failed:", err)
      failed++
    }
  }
  return failed
}

// Telling a need which RFQ or order answers it. A work order's shortfall is
// linked through Manufacturing's own write; a project's request gets the link
// on its document (the rules let Procurement write only these fields, once);
// a stock gap stores nothing — it reads the open RFQs and orders.

import { doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore"
import { linkPurchaseRequestOrder, linkPurchaseRequestRfq } from "../manufacturing-writes"
import type { Need } from "./needs"

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

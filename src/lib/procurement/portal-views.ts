// «اطّلع عليه N مرة» (RFQ-02) counts every supplier who opened the RFQ — through the visitor link (link-views.ts) AND inside his
// portal. A registered supplier's open is counted once per supplier COMPANY: a team of five reading the same request is one view,
// and opening it again tomorrow is not a new one. The mark lives in the server-only `rfqPortalViews/{rfqId}__{orgId}` (no client
// rule reads or writes it) and moves `rfqs/{id}.viewsCount` in the same transaction. Nothing here is ever fabricated: no view, no
// count. Server-only.

import type { Firestore } from "firebase-admin/firestore"

export const RFQ_PORTAL_VIEWS = "rfqPortalViews"

export const portalViewDocId = (rfqId: string, orgId: string): string => `${rfqId}__${orgId}`

type Rec = Record<string, unknown>

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

export type PortalViewRefusal = "not_found" | "draft" | "own_rfq" | "not_invited"

/** Whether this supplier company may be counted as having seen this RFQ: published, not his own, and — when the RFQ is private or
 * a direct award — one he was invited to. A public RFQ outside his field still counts: he read it. */
export function portalViewRefusal(rfq: Rec | null | undefined, orgId: string): PortalViewRefusal | null {
  if (!rfq) return "not_found"
  if (rfq.status === "Draft") return "draft"
  if (rfq.organizationId === orgId || rfq.contractorId === orgId) return "own_rfq"
  const closed = rfq.visibility === "private" || rfq.directAward === true
  if (closed && ![...ids(rfq.invitedSupplierOrgIds), ...ids(rfq.allowedSupplierOrgIds)].includes(orgId)) return "not_invited"
  return null
}

/** Counts the company's first open of the RFQ; later opens change nothing. Returns whether this call counted. */
export async function countPortalView(db: Firestore, rfqId: string, orgId: string, now: Date = new Date()): Promise<{ counted: boolean; refusal: PortalViewRefusal | null }> {
  const rfqRef = db.collection("rfqs").doc(rfqId)
  const markRef = db.collection(RFQ_PORTAL_VIEWS).doc(portalViewDocId(rfqId, orgId))
  return db.runTransaction(async (tx) => {
    const [rfqSnap, markSnap] = await Promise.all([tx.get(rfqRef), tx.get(markRef)])
    const rfq = rfqSnap.exists ? ((rfqSnap.data() || {}) as Rec) : null
    const refusal = portalViewRefusal(rfq, orgId)
    if (refusal) return { counted: false, refusal }
    if (markSnap.exists) return { counted: false, refusal: null }
    tx.set(markRef, { rfqId, orgId, rfqOrganizationId: typeof rfq?.organizationId === "string" ? rfq.organizationId : null, at: now.toISOString() })
    tx.update(rfqRef, { viewsCount: (Number(rfq?.viewsCount) || 0) + 1 })
    return { counted: true, refusal: null }
  })
}

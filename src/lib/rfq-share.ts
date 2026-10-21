// Server-only helpers for the guest RFQ share-link flow.
// Never import this file in client components.

import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { deadlineEnd, shareLinkState } from "@/lib/procurement/guest-supplier"
import { findLinkByToken } from "@/lib/links/hash"

export type ShareLinkResolution =
  | { ok: true; linkId: string; link: FirebaseFirestore.DocumentData; rfq: FirebaseFirestore.DocumentData; rfqId: string }
  | { ok: false; code: "INVALID_TOKEN" | "NOT_FOUND" | "LINK_EXPIRED" | "LINK_REVOKED" | "RFQ_NOT_FOUND"; status: number }

// Resolves a share token to its link + RFQ documents, enforcing revocation and
// expiry: a link minted for the deadline lives while the RFQ is open (view only
// once the deadline passes — an extension reopens it), an older link keeps its
// fixed expiry. Submitting is the callers' call ("view only" vs "can submit").
export async function resolveShareToken(token: string): Promise<ShareLinkResolution> {
  const db = getAdminFirestore()
  const found = await findLinkByToken(db, "rfq", token)
  if (!found.ok) return { ok: false, code: found.code, status: found.status }

  const { link, linkId } = found
  if (link.revoked) return { ok: false, code: "LINK_REVOKED", status: 410 }
  if (link.expiresWith !== "deadline" && new Date(link.expiresAt as string).getTime() <= Date.now()) {
    return { ok: false, code: "LINK_EXPIRED", status: 410 }
  }

  const rfqSnap = await db.collection("rfqs").doc(link.rfqId as string).get()
  if (!rfqSnap.exists) return { ok: false, code: "RFQ_NOT_FOUND", status: 404 }
  if (shareLinkState(link, rfqSnap.data() ?? null, new Date()) === "gone") return { ok: false, code: "LINK_EXPIRED", status: 410 }

  return { ok: true, linkId, link, rfq: rfqSnap.data()!, rfqId: rfqSnap.id }
}

/** Past the end of the deadline's day in Riyadh — not the server's day (UTC on Vercel). */
export function isRfqDeadlinePassed(rfq: FirebaseFirestore.DocumentData, now: Date = new Date()): boolean {
  const end = deadlineEnd(rfq.deadline as string | null)
  return end != null && new Date(end).getTime() < now.getTime()
}

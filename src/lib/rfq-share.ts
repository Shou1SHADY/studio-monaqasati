// Server-only helpers for the guest RFQ share-link flow.
// Never import this file in client components.

import { getAdminFirestore } from "@/lib/firebaseAdmin"

// Guest links are handed to suppliers outside the platform (Gmail, WhatsApp,
// ...), so they must always point at the canonical production domain — never a
// localhost/preview NEXT_PUBLIC_APP_URL.
export const PUBLIC_BASE_URL = "https://www.mdmaktech.sa"

export type ShareLinkResolution =
  | { ok: true; linkId: string; link: FirebaseFirestore.DocumentData; rfq: FirebaseFirestore.DocumentData; rfqId: string }
  | { ok: false; code: "INVALID_TOKEN" | "NOT_FOUND" | "LINK_EXPIRED" | "LINK_REVOKED" | "RFQ_NOT_FOUND"; status: number }

// Resolves a share token to its link + RFQ documents, enforcing the 3-day
// expiry and revocation. RFQ closed/awarded states are left to the callers,
// which need to distinguish "view only" from "can submit".
export async function resolveShareToken(token: string): Promise<ShareLinkResolution> {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return { ok: false, code: "INVALID_TOKEN", status: 400 }
  }

  const db = getAdminFirestore()
  const snap = await db.collection("rfqShareLinks").where("token", "==", token).limit(1).get()
  if (snap.empty) return { ok: false, code: "NOT_FOUND", status: 404 }

  const linkDoc = snap.docs[0]
  const link = linkDoc.data()
  if (link.revoked) return { ok: false, code: "LINK_REVOKED", status: 410 }
  if (new Date(link.expiresAt as string).getTime() <= Date.now()) {
    return { ok: false, code: "LINK_EXPIRED", status: 410 }
  }

  const rfqSnap = await db.collection("rfqs").doc(link.rfqId as string).get()
  if (!rfqSnap.exists) return { ok: false, code: "RFQ_NOT_FOUND", status: 404 }

  return { ok: true, linkId: linkDoc.id, link, rfq: rfqSnap.data()!, rfqId: rfqSnap.id }
}

export function isRfqDeadlinePassed(rfq: FirebaseFirestore.DocumentData): boolean {
  if (!rfq.deadline) return false
  const deadline = new Date(rfq.deadline as string)
  deadline.setHours(23, 59, 59, 999)
  return deadline.getTime() < Date.now()
}

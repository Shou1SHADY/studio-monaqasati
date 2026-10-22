// The order link a visitor is handed once a request was awarded to him (LNK-11): the order's own link, `orderLinks/{poId}`,
// minted when the buyer sent the order. Only hashes are stored, so showing it again hands out a fresh token on the same
// link. No link, no URL: the page then shows «رُسّي عليك» without a button. Server-only.

import type { Firestore } from "firebase-admin/firestore"
import { mintLinkToken } from "@/lib/links/hash"
import { linkUrl } from "@/lib/links/url"

export async function orderUrlOf(db: Firestore, poId: string): Promise<string | null> {
  const snap = await db.collection("orderLinks").doc(poId).get()
  const link = snap.data() as { revoked?: unknown } | undefined
  if (!snap.exists || !link || link.revoked) return null
  return linkUrl("po", await mintLinkToken(db, "po", poId))
}

// How many times a link was opened, and by how many different people (LNK-13, R-21). Only the public page counts: the buyer's
// own preview goes through an authenticated route that never touches the link, so looking at his own link is not a view.
// A browser is told apart by a random id it keeps; the id is stored only as a short hash, and one browser opening the page
// again within half an hour is the same view. Server-only.

import { createHash } from "crypto"
import type { Firestore } from "firebase-admin/firestore"

export const VIEW_WINDOW_MS = 30 * 60 * 1000
export const MAX_VIEWERS_KEPT = 500
const CLIENT_ID = /^[A-Za-z0-9_-]{16,64}$/

export const isViewerId = (v: unknown): v is string => typeof v === "string" && CLIENT_ID.test(v)

const hashViewer = (clientId: string) => createHash("sha256").update(`link_view:${clientId}`).digest("hex").slice(0, 16)

export interface LinkStats {
  views: number
  reachedCount: number
  offersSubmitted: number
}

export const statsOf = (link: Record<string, unknown> | undefined): LinkStats => ({
  views: Number(link?.views) || 0,
  reachedCount: Number(link?.reachedCount) || 0,
  offersSubmitted: Number(link?.offersSubmitted) || 0,
})

/** Counts one open of the link by this browser, unless the same browser was counted within the window. */
export async function countLinkView(db: Firestore, linkId: string, clientId: string, now: number = Date.now()): Promise<boolean> {
  const ref = db.collection("rfqShareLinks").doc(linkId)
  const key = hashViewer(clientId)
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return false
      const link = (snap.data() || {}) as Record<string, unknown>
      const seen = { ...((link.viewers as Record<string, number> | undefined) || {}) }
      const last = seen[key]
      if (typeof last === "number" && now - last < VIEW_WINDOW_MS) return false
      seen[key] = now
      const kept = Object.entries(seen)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_VIEWERS_KEPT)
      const rfqId = typeof link.rfqId === "string" ? link.rfqId : ""
      const rfqRef = rfqId ? db.collection("rfqs").doc(rfqId) : null
      const rfqSnap = rfqRef ? await tx.get(rfqRef) : null
      if (rfqRef && rfqSnap?.exists) tx.update(rfqRef, { viewsCount: (Number((rfqSnap.data() || {}).viewsCount) || 0) + 1 })
      tx.update(ref, {
        views: (Number(link.views) || 0) + 1,
        reachedCount: (Number(link.reachedCount) || 0) + (typeof last === "number" ? 0 : 1),
        viewers: Object.fromEntries(kept),
        lastViewAt: new Date(now).toISOString(),
      })
      return true
    })
  } catch {
    return false
  }
}

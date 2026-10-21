import { createHash } from "crypto"
import type { Firestore } from "firebase-admin/firestore"
import { mintToken, tokenFormat } from "./token"

export const LINK_TOKEN_INDEX = "linkTokens"
export const MAX_TOKENS_PER_LINK = 25

export type LinkKind = "rfq" | "offer"

export const LINK_COLLECTIONS: Record<LinkKind, string> = {
  rfq: "rfqShareLinks",
  offer: "guestOfferLinks",
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex")

/** Adds a fresh token to a link and returns it once. Only its hash is stored (on the link and in the lookup index); the
 * link keeps up to MAX_TOKENS_PER_LINK live tokens so a buyer can be handed the link again without ever storing it. */
export async function mintLinkToken(db: Firestore, kind: LinkKind, linkId: string): Promise<string> {
  const token = mintToken()
  const hash = hashToken(token)
  const linkRef = db.collection(LINK_COLLECTIONS[kind]).doc(linkId)
  const indexRef = db.collection(LINK_TOKEN_INDEX).doc(hash)

  const evicted = await db.runTransaction(async (tx) => {
    const snap = await tx.get(linkRef)
    const current = ((snap.data()?.tokenHashes as string[] | undefined) ?? []).filter((h) => typeof h === "string")
    const next = [...current, hash]
    const dropped = next.length > MAX_TOKENS_PER_LINK ? next.slice(0, next.length - MAX_TOKENS_PER_LINK) : []
    tx.update(linkRef, { tokenHashes: next.slice(dropped.length) })
    tx.create(indexRef, { kind, linkId, createdAt: new Date().toISOString() })
    return dropped
  })

  for (const h of evicted) {
    try {
      await db.collection(LINK_TOKEN_INDEX).doc(h).delete()
    } catch {
      // The link's own list no longer names it, so an orphaned index entry resolves to nothing.
    }
  }
  return token
}

export type FoundLink =
  | { ok: true; linkId: string; link: FirebaseFirestore.DocumentData; legacy: boolean }
  | { ok: false; code: "INVALID_TOKEN" | "NOT_FOUND"; status: 400 | 404 }

/** Finds a link by the presented token: by the hash of the token first, then by the plaintext `token` field of links
 * issued before tokens were hashed. A legacy match never changes the link. */
export async function findLinkByToken(db: Firestore, kind: LinkKind, token: string): Promise<FoundLink> {
  const format = tokenFormat(token)
  if (!format) return { ok: false, code: "INVALID_TOKEN", status: 400 }

  const collection = LINK_COLLECTIONS[kind]
  const hash = hashToken(token)
  const index = await db.collection(LINK_TOKEN_INDEX).doc(hash).get()
  const entry = index.data()
  if (index.exists && entry && entry.kind === kind) {
    const linkSnap = await db.collection(collection).doc(entry.linkId as string).get()
    const link = linkSnap.data()
    if (linkSnap.exists && link && Array.isArray(link.tokenHashes) && link.tokenHashes.includes(hash)) {
      return { ok: true, linkId: linkSnap.id, link, legacy: false }
    }
  }

  if (format === "legacy") {
    const snap = await db.collection(collection).where("token", "==", token).limit(1).get()
    if (!snap.empty) return { ok: true, linkId: snap.docs[0].id, link: snap.docs[0].data(), legacy: true }
  }
  return { ok: false, code: "NOT_FOUND", status: 404 }
}

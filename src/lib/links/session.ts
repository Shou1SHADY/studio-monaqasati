import { createHash, randomBytes } from "crypto"
import type { Firestore } from "firebase-admin/firestore"
import type { LinkKind } from "./hash"

export const LINK_SESSIONS = "linkSessions"
export const LINK_SESSION_TTL_MS = 12 * 3_600_000
export const LINK_SESSION_HEADER = "x-link-session"

const SECRET = /^[a-f0-9]{64}$/

const hashSecret = (secret: string) => createHash("sha256").update(`link_session:${secret}`).digest("hex")

export type SessionRefusal = "NO_SESSION" | "SESSION_EXPIRED" | "SESSION_SCOPE"

export const sessionStatus: Record<SessionRefusal, 401 | 403> = { NO_SESSION: 401, SESSION_EXPIRED: 401, SESSION_SCOPE: 403 }

/** After a verified code: a random secret the visitor's browser keeps, stored here only as its hash, good for one link. */
export async function openLinkSession(db: Firestore, scope: { kind: LinkKind; linkId: string; phone: string }, now = Date.now()): Promise<{ secret: string; expiresAt: string }> {
  const secret = randomBytes(32).toString("hex")
  const expiresAt = new Date(now + LINK_SESSION_TTL_MS).toISOString()
  await db.collection(LINK_SESSIONS).doc(hashSecret(secret)).set({ kind: scope.kind, linkId: scope.linkId, phone: scope.phone, createdAt: new Date(now).toISOString(), expiresAt })
  return { secret, expiresAt }
}

export type LinkSessionResult = { ok: true; phone: string } | { ok: false; code: SessionRefusal; status: 401 | 403 }

const refuse = (code: SessionRefusal): LinkSessionResult => ({ ok: false, code, status: sessionStatus[code] })

/** A session works on the one link it was opened for: another RFQ's link, or another kind of link, is refused. */
export async function readLinkSession(db: Firestore, secret: string | null | undefined, scope: { kind: LinkKind; linkId: string }, now = Date.now()): Promise<LinkSessionResult> {
  if (!secret || !SECRET.test(secret)) return refuse("NO_SESSION")
  const snap = await db.collection(LINK_SESSIONS).doc(hashSecret(secret)).get()
  const session = snap.data()
  if (!snap.exists || !session) return refuse("NO_SESSION")
  if (session.kind !== scope.kind || session.linkId !== scope.linkId) return refuse("SESSION_SCOPE")
  if (!(Date.parse(session.expiresAt as string) > now)) return refuse("SESSION_EXPIRED")
  return { ok: true, phone: session.phone as string }
}

export const sessionSecretOf = (headers: Pick<Headers, "get">): string | null => headers.get(LINK_SESSION_HEADER)

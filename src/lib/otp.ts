// Server-only — one-time codes sent by SMS, issued and checked on the server.
// Never import this file in client components.
//
// The code never reaches the browser that asked for it: it is generated here,
// only its hash is stored, and the stored challenge lives in a collection the
// security rules close to every client. A browser can ask for a code and can
// submit a guess; it can never read the answer. That is the whole point, and
// the reason the older sign-in check (a code made in the browser and kept in a
// document the user could read) proved nothing.

import { createHash, randomInt, timingSafeEqual } from "node:crypto"
import type { Firestore } from "firebase-admin/firestore"

export const OTP_CHALLENGES = "otpChallenges"

/** Six digits, five minutes, five guesses, and one new code a minute per subject. */
export const OTP_DIGITS = 6
export const OTP_TTL_MS = 5 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RESEND_MS = 60 * 1000

/** What a code protects. A challenge issued for one purpose never answers another. */
export type OtpPurpose = "receipt_sign"

export interface OtpChallenge {
  purpose: OtpPurpose
  /** The thing being confirmed — for a receipt, the receipt link's id. */
  subjectId: string
  /** E.164, the number the code was sent to. */
  phone: string
  codeHash: string
  createdAt: number
  expiresAt: number
  attempts: number
  consumedAt: number | null
}

export type OtpVerdict = "ok" | "wrong" | "expired" | "exhausted" | "consumed" | "missing" | "mismatch"

export function generateCode(): string {
  return String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, "0")
}

/** The code is bound to its challenge: the same six digits hash differently
 * under another challenge, so a stored hash cannot be replayed elsewhere. */
export function hashCode(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex")
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex")
  const y = Buffer.from(b, "hex")
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The whole decision, with no I/O — which is what the tests exercise.
 *
 * Order matters: a consumed or exhausted challenge answers "no" even to the
 * right code, so a code that has done its job, or has been guessed at too
 * often, cannot be used afterwards.
 */
export function judge(
  challenge: OtpChallenge | null,
  expected: { purpose: OtpPurpose; subjectId: string },
  challengeId: string,
  code: string,
  now: number
): OtpVerdict {
  if (!challenge) return "missing"
  if (challenge.purpose !== expected.purpose || challenge.subjectId !== expected.subjectId) return "mismatch"
  if (challenge.consumedAt) return "consumed"
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) return "exhausted"
  if (now > challenge.expiresAt) return "expired"
  if (!/^\d+$/.test(code) || code.length !== OTP_DIGITS) return "wrong"
  return sameHash(hashCode(challengeId, code), challenge.codeHash) ? "ok" : "wrong"
}

/** Whether a new code may be sent for this subject, given the last one's time. */
export function mayResend(lastCreatedAt: number | null, now: number): boolean {
  return lastCreatedAt === null || now - lastCreatedAt >= OTP_RESEND_MS
}

/**
 * Issue a challenge and return the plain code — to be SENT, never returned to
 * the caller's browser. Refuses (returns null) inside the resend window, so a
 * button held down cannot turn into a bill.
 */
export async function issueOtp(
  db: Firestore,
  input: { purpose: OtpPurpose; subjectId: string; phone: string },
  now = Date.now()
): Promise<{ challengeId: string; code: string } | null> {
  // One equality filter and the newest found in memory: a subject only ever
  // has a handful of challenges, and a composite index would be one more thing
  // to deploy before this works.
  const recent = await db.collection(OTP_CHALLENGES).where("subjectId", "==", input.subjectId).get()
  const last = recent.docs
    .map((d) => d.data() as OtpChallenge)
    .filter((c) => c.purpose === input.purpose)
    .reduce<number | null>((max, c) => (max === null || c.createdAt > max ? c.createdAt : max), null)
  if (!mayResend(last, now)) return null

  const ref = db.collection(OTP_CHALLENGES).doc()
  const code = generateCode()
  const challenge: OtpChallenge = {
    purpose: input.purpose,
    subjectId: input.subjectId,
    phone: input.phone,
    codeHash: hashCode(ref.id, code),
    createdAt: now,
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    consumedAt: null,
  }
  await ref.set(challenge)
  return { challengeId: ref.id, code }
}

/**
 * Check a guess. Every wrong guess is counted in the same transaction that
 * reads the challenge, so parallel guesses cannot each see "4 attempts left".
 * A right guess consumes the challenge — it can confirm exactly one thing.
 */
export async function verifyOtp(
  db: Firestore,
  challengeId: string,
  expected: { purpose: OtpPurpose; subjectId: string },
  code: string,
  now = Date.now()
): Promise<OtpVerdict> {
  const ref = db.collection(OTP_CHALLENGES).doc(challengeId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const challenge = snap.exists ? (snap.data() as OtpChallenge) : null
    const verdict = judge(challenge, expected, challengeId, code, now)
    if (verdict === "ok") tx.update(ref, { consumedAt: now })
    else if (verdict === "wrong") tx.update(ref, { attempts: (challenge?.attempts ?? 0) + 1 })
    return verdict
  })
}

/** The last four digits, for "we sent a code to •••• 4521" — never the number. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "")
  return `•••• ${digits.slice(-4)}`
}

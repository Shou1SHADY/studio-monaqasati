import { createHash } from "crypto"
import type { Firestore } from "firebase-admin/firestore"

export const LINK_RATE_LIMITS = "linkRateLimits"

export interface RateRule {
  max: number
  windowMs: number
}

const HOUR = 3_600_000

/** Across every link, per mobile: a number is not an SMS gateway and not a way round a link's own cap. */
export const RATE_RULES = {
  otp: { max: 5, windowMs: HOUR },
  write: { max: 20, windowMs: HOUR },
} as const satisfies Record<string, RateRule>

export type RateKind = keyof typeof RATE_RULES

export type RateVerdict =
  | { ok: true; remaining: number }
  | { ok: false; code: "RATE_LIMITED"; status: 429; retryAfterSec: number }
  | { ok: false; code: "RATE_UNAVAILABLE"; status: 503 }

export const rateKey = (kind: RateKind, subject: string): string => `${kind}:${subject}`

const docId = (key: string) => createHash("sha256").update(`link_rate:${key}`).digest("hex")

/** Counts one attempt for the key inside a transaction. The key (a mobile) is stored only as a hash. When the counter
 * cannot be read or written the attempt is refused, never let through. */
export async function consumeRate(db: Firestore, key: string, rule: RateRule, now = Date.now()): Promise<RateVerdict> {
  const ref = db.collection(LINK_RATE_LIMITS).doc(docId(key))
  try {
    return await db.runTransaction(async (tx): Promise<RateVerdict> => {
      const snap = await tx.get(ref)
      const state = snap.data() as { count?: number; windowStart?: number } | undefined
      const fresh = !snap.exists || !state || typeof state.windowStart !== "number" || now - state.windowStart >= rule.windowMs
      const count = fresh ? 0 : Number(state?.count) || 0
      const windowStart = fresh ? now : (state?.windowStart as number)
      if (count >= rule.max) return { ok: false, code: "RATE_LIMITED", status: 429, retryAfterSec: Math.max(1, Math.ceil((windowStart + rule.windowMs - now) / 1000)) }
      if (snap.exists) tx.update(ref, { count: count + 1, windowStart })
      else tx.set(ref, { count: 1, windowStart })
      return { ok: true, remaining: rule.max - count - 1 }
    })
  } catch {
    return { ok: false, code: "RATE_UNAVAILABLE", status: 503 }
  }
}

export const consumeMobileRate = (db: Firestore, kind: RateKind, phoneE164: string, now?: number): Promise<RateVerdict> =>
  consumeRate(db, rateKey(kind, phoneE164), RATE_RULES[kind], now)

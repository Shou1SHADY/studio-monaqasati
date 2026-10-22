// The small parts the visitor routes share: the error answer, the environment test, and the session / code check every
// act that needs an identity runs. Server-only.

import { NextResponse } from "next/server"
import type { Firestore } from "firebase-admin/firestore"
import { z } from "zod"
import { verifyOtp } from "@/lib/otp"
import { canSendCodes } from "@/lib/sms"
import { guestCodeAvailable, guestOtpSubject } from "@/lib/procurement/guest-supplier"
import { consumeMobileRate } from "@/lib/links/rate"
import { openLinkSession, readLinkSession, sessionSecretOf } from "@/lib/links/session"
import { saudiMobileE164 } from "@/lib/supplier-free/phone-auth"
import { VisitorError } from "./visitor-offer-server"

/** Where a code may be shown on screen instead of sent: UAT and development, never production. */
export const testingEnvironment = (): boolean => process.env.NEXT_PUBLIC_APP_ENV === "uat" || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "mdmaktech-uat" || process.env.NODE_ENV !== "production"

export const failure = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export function visitorFailure(err: unknown): NextResponse | null {
  if (!(err instanceof VisitorError)) return null
  return NextResponse.json({ error: true, message: err.code, code: err.code, ...(err.detail ? { detail: err.detail } : {}) }, { status: err.status })
}

export const otpSchema = z.object({
  challengeId: z.string().trim().min(1).max(128),
  code: z.string().trim().regex(/^\d{6}$/),
})

export type OtpCheck = "ok" | "wrong" | "expired" | "unavailable"

/** Checks a code against this link and this mobile; the code is spent on success. */
export async function checkCode(db: Firestore, linkId: string, phone: string, challengeId: string, code: string): Promise<OtpCheck> {
  const verdict = await verifyOtp(db, challengeId, { purpose: "guest_offer", subjectId: guestOtpSubject(linkId, phone) }, code)
  return verdict === "ok" ? "ok" : verdict === "wrong" ? "wrong" : verdict === "unavailable" ? "unavailable" : "expired"
}

export function codeFailure(check: Exclude<OtpCheck, "ok">): NextResponse {
  if (check === "wrong") return failure("Wrong code", "WRONG_CODE", 400)
  if (check === "unavailable") return failure("The code could not be checked — try again", "CODE_UNCHECKED", 503)
  return failure("The code has expired — ask for a new one", "CODE_EXPIRED", 410)
}

export const codesPossible = (): boolean => guestCodeAvailable(canSendCodes(), testingEnvironment())

/** A mobile proven by the session he holds, or — on the first send — by a code in the same request. */
export async function proveMobile(
  db: Firestore,
  req: { headers: Pick<Headers, "get"> },
  linkId: string,
  phone: string,
  code: { challengeId?: string; code?: string } | null
): Promise<{ ok: true; viaCode: boolean } | { ok: false; response: NextResponse }> {
  const secret = sessionSecretOf(req.headers)
  if (secret) {
    const session = await readLinkSession(db, secret, { kind: "rfq", linkId })
    if (session.ok && session.phone === phone) return { ok: true, viaCode: false }
    if (!session.ok && !code?.code) return { ok: false, response: failure(session.code, session.code, session.status) }
    if (session.ok && !code?.code) return { ok: false, response: failure("This number is not the one you verified", "CODE_REQUIRED", 400) }
  }
  const parsed = otpSchema.safeParse({ challengeId: code?.challengeId, code: code?.code })
  if (!parsed.success) return { ok: false, response: failure("Verify your mobile number first", "CODE_REQUIRED", 400) }
  const check = await checkCode(db, linkId, phone, parsed.data.challengeId, parsed.data.code)
  if (check !== "ok") return { ok: false, response: codeFailure(check) }
  return { ok: true, viaCode: true }
}

export async function openSession(db: Firestore, linkId: string, phone: string): Promise<{ secret: string; expiresAt: string } | null> {
  return openLinkSession(db, { kind: "rfq", linkId, phone }).catch((err) => {
    console.error("Failed to open the visitor session:", err)
    return null
  })
}

export async function writeRate(db: Firestore, phone: string): Promise<NextResponse | null> {
  const rate = await consumeMobileRate(db, "write", phone)
  if (rate.ok) return null
  const res = failure(rate.code === "RATE_LIMITED" ? "Too many submissions from this number — try again later" : "Offers cannot be received right now — try again later", rate.code, rate.status)
  if (rate.code === "RATE_LIMITED") res.headers.set("Retry-After", String(rate.retryAfterSec))
  return res
}

export const phoneOf = (raw: unknown): string | null => saudiMobileE164(raw)

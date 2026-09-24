import { NextResponse } from "next/server"
import { randomInt } from "node:crypto"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { isSmsConfigured, isVerifyConfigured, normalizePhoneE164, sendSms, startVerification } from "@/lib/sms"
import { OTP_RESEND_MS } from "@/lib/otp"
import { offersSealed } from "@/lib/procurement/award"
import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"
import { resolvePolicies } from "@/lib/procurement/policies"
import type { ProcurementPolicies } from "@/lib/procurement/types"
import arMessages from "../../../../messages/ar.json"
import enMessages from "../../../../messages/en.json"

// The only way this app sends a text, and it no longer takes free text.
//
// It used to accept any `to` and any `body` from anyone — harmless while
// Twilio was unconfigured, and an open relay on the account the day it was:
// anyone on the internet could text any number, at the company's expense,
// from the company's sender. Now the caller must be signed in, the message is
// one of two the SERVER writes, and the recipient is looked up here, never
// taken from the request. A caller can choose which of their own texts to
// trigger; they can no longer choose who receives it or what it says.

const body = z.discriminatedUnion("kind", [
  // The second sign-in step: a code to the caller's own number on file.
  z.object({ kind: z.literal("login_code"), locale: z.enum(["ar", "en"]).default("ar") }),
  // A supplier's new offer: tell the contractor who asked for it, once.
  z.object({ kind: z.literal("new_offer"), offerId: z.string().min(1).max(128) }),
])

const fail = (message: string, code: string, status: number) =>
  NextResponse.json({ error: true, message, code }, { status })

const loginText = (locale: "ar" | "en", code: string) =>
  (locale === "en" ? enMessages : arMessages).Auth.Login.sms_body.replace("{code}", code)

// UAT has no Twilio: the code is handed back so a tester can still sign in.
// Never in production — there a missing SMS means no code, as before.
const isUat = () =>
  process.env.NEXT_PUBLIC_APP_ENV === "uat" || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "mdmaktech-uat"

export async function POST(req: Request) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)

  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }

  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Unknown message", "BAD_REQUEST", 400)

  const db = getAdminFirestore()

  try {
    if (parsed.data.kind === "login_code") {
      const user = (await db.collection("users").doc(uid).get()).data() as
        | { twoFactorEnabled?: boolean; phone?: string }
        | undefined
      const phone = normalizePhoneE164(user?.phone)
      if (!user?.twoFactorEnabled || !phone) return fail("Two-step sign-in is not set up", "NO_2FA", 409)

      const ref = db.collection("users").doc(uid).collection("2fa").doc("current")
      const previous = (await ref.get()).data() as { issuedAt?: number } | undefined
      if (previous?.issuedAt && Date.now() - previous.issuedAt < OTP_RESEND_MS) {
        return fail("Wait a minute before asking for another code", "TOO_SOON", 429)
      }

      if (isVerifyConfigured()) {
        const started = await startVerification(phone, parsed.data.locale)
        if (!started.sent) return fail("The code could not be sent", started.error, 502)
        await ref.set({ verificationSid: started.verificationSid, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), issuedAt: Date.now() })
        return NextResponse.json({ success: true, data: { sent: true } })
      }

      const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
      await ref.set({ code, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), issuedAt: Date.now() })

      if (!isSmsConfigured()) {
        return NextResponse.json({ success: true, data: { sent: false, testCode: isUat() ? code : undefined } })
      }
      const result = await sendSms({ to: phone, body: loginText(parsed.data.locale, code) })
      if (!result.sent) return fail("The code could not be sent", result.error || "SMS_FAILED", 502)
      return NextResponse.json({ success: true, data: { sent: true } })
    }

    // new_offer
    const offerRef = db.collection("offers").doc(parsed.data.offerId)
    const offer = (await offerRef.get()).data() as
      | { supplierId?: string; rfqId?: string; price?: string | number; smsNotifiedAt?: string; companyName?: string; supplierName?: string }
      | undefined
    if (!offer) return fail("Offer not found", "NOT_FOUND", 404)
    if (offer.supplierId !== uid) return fail("Not your offer", "FORBIDDEN", 403)
    if (offer.smsNotifiedAt) return NextResponse.json({ success: true, data: { sent: false, already: true } })

    const rfq = offer.rfqId ? ((await db.collection("rfqs").doc(offer.rfqId).get()).data() as
      | { contractorId?: string; organizationId?: string; title?: string; deadline?: string; status?: string }
      | undefined) : undefined
    const contractor = rfq?.contractorId
      ? ((await db.collection("users").doc(rfq.contractorId).get()).data() as
          | { phone?: string; whatsapp?: string; mobile?: string }
          | undefined)
      : undefined
    const phone = normalizePhoneE164(contractor?.phone || contractor?.whatsapp || contractor?.mobile)

    // A sealed round names no amount — not in the bell, the push or the text.
    // Only the server can tell: the policy is the contractor's, unreadable to
    // the supplier whose client used to write this notification itself.
    const orgId = rfq?.organizationId || rfq?.contractorId || null
    const settings = orgId ? (await db.collection("procurementSettings").doc(orgId).get()).data() : undefined
    const sealed = offersSealed(rfq, resolvePolicies(settings as Partial<ProcurementPolicies> | undefined), new Date())
    const notice = newOfferNotice({ supplier: offer.companyName || offer.supplierName || "", rfqTitle: rfq?.title || "", price: Number(offer.price) || 0, sealed })

    // Marked before sending: a double tap must not become two texts.
    const nowIso = new Date().toISOString()
    await offerRef.update({ smsNotifiedAt: nowIso })
    if (rfq?.contractorId) {
      await db
        .collection("users")
        .doc(rfq.contractorId)
        .collection("notifications")
        .doc(newOfferNoticeId(parsed.data.offerId))
        .set({
          userId: rfq.contractorId,
          organizationId: orgId,
          type: "new_offer",
          i18n: notice.i18n,
          title: notice.title,
          message: notice.message,
          offerId: parsed.data.offerId,
          rfqId: offer.rfqId || null,
          createdAt: nowIso,
          read: false,
        })
    }
    if (!phone || !isSmsConfigured()) return NextResponse.json({ success: true, data: { sent: false, notified: Boolean(rfq?.contractorId) } })

    const result = await sendSms({ to: phone, body: notice.smsText })
    return NextResponse.json({ success: true, data: { sent: result.sent } })
  } catch (error) {
    console.error("SMS route error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { OTP_CHALLENGES, issueOtp, issueRemoteOtp, maskPhone } from "@/lib/otp"
import { canSendCodes, isSmsConfigured, isVerifyConfigured, normalizePhoneE164, sendSms, startVerification } from "@/lib/sms"
import { PHONE_CODES_PER_HOUR, phoneSubject } from "@/lib/supplier-free/phone-auth"

// Public: sends a one-time code to a mobile so a supplier can open or enter a free account with it (Supplier 1.0,
// LNK-02). Our own OTP stack — one code a minute per number, a few an hour, five wrong guesses, one use — and no
// password anywhere. UAT without an SMS route shows the code on screen; production never does.

const bodySchema = z.object({
  phone: z.string().trim().min(7).max(20),
  locale: z.enum(["ar", "en"]).optional(),
})

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const isUat = () => process.env.NEXT_PUBLIC_APP_ENV === "uat" || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "mdmaktech-uat"

export async function POST(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail("Enter a mobile number", "INVALID_INPUT", 400)
    const phone = normalizePhoneE164(parsed.data.phone)
    if (!phone) return fail("Enter a valid mobile number", "INVALID_PHONE", 400)
    const locale = parsed.data.locale === "en" ? "en" : "ar"
    if (!canSendCodes() && !isUat()) return fail("Codes cannot be sent right now", "SMS_UNAVAILABLE", 503)

    const db = getAdminFirestore()
    const subjectId = phoneSubject(phone)
    const hourAgo = Date.now() - 60 * 60 * 1000
    const recent = await db.collection(OTP_CHALLENGES).where("subjectId", "==", subjectId).get()
    if (recent.docs.filter((d) => Number(d.data().createdAt) > hourAgo).length >= PHONE_CODES_PER_HOUR) {
      return fail("Too many codes were requested for this number — try again later", "PHONE_OTP_LIMIT", 429)
    }

    const input = { purpose: "supplier_phone" as const, subjectId, phone }
    if (isVerifyConfigured()) {
      const remote = await issueRemoteOtp(db, input, () => startVerification(phone, locale))
      if ("error" in remote) {
        return remote.error === "TOO_SOON" ? fail("A code was sent less than a minute ago", "TOO_SOON", 429) : fail("The code could not be sent", remote.error, 502)
      }
      return NextResponse.json({ success: true, data: { challengeId: remote.challengeId, phoneMasked: maskPhone(phone), sent: true } })
    }

    const issued = await issueOtp(db, input)
    if (!issued) return fail("A code was sent less than a minute ago", "TOO_SOON", 429)
    if (!isSmsConfigured()) {
      return NextResponse.json({ success: true, data: { challengeId: issued.challengeId, phoneMasked: maskPhone(phone), sent: false, testCode: isUat() ? issued.code : undefined } })
    }
    const text =
      locale === "en"
        ? `Mdmak Tech: your sign-in code is ${issued.code}. Valid for 5 minutes. Do not share it.`
        : `مدماك تيك: رمز الدخول هو ${issued.code}. صالح لمدة 5 دقائق. لا تشاركه مع أحد.`
    const result = await sendSms({ to: phone, body: text })
    if (!result.sent) return fail("The code could not be sent", result.error || "SMS_FAILED", 502)
    return NextResponse.json({ success: true, data: { challengeId: issued.challengeId, phoneMasked: maskPhone(phone), sent: true } })
  } catch (error) {
    console.error("Supplier phone code error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

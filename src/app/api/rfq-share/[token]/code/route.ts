import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { OTP_CHALLENGES, issueOtp, issueRemoteOtp, maskPhone } from "@/lib/otp"
import { isSmsConfigured, isVerifyConfigured, sendSms, startVerification } from "@/lib/sms"
import { resolveShareToken } from "@/lib/rfq-share"
import { GUEST_OTP_LINK_CAP_PER_HOUR, guestOtpSubject, guestOtpSubjectRange } from "@/lib/procurement/guest-supplier"
import { saudiMobileE164 } from "@/lib/supplier-free/phone-auth"
import { consumeMobileRate } from "@/lib/links/rate"
import { codesPossible, testingEnvironment } from "@/lib/procurement/visitor-http"

// Public endpoint: sends a one-time code to the mobile a guest supplier typed
// on the RFQ's guest page (prototype «يُوثَّق برمز تحقق»). The offer route checks
// it; the code is bound to this link and this number. One code a minute per
// number, a ceiling per link per hour and a ceiling per mobile across every
// link, so neither a link nor a number can be turned into an SMS gateway. A closed request still gives a code: a visitor
// who quoted comes back for his result. Without an SMS route the send is refused (R-05) — only a test environment shows the code.

const bodySchema = z.object({
  phone: z.string().trim().min(7).max(20),
  locale: z.enum(["ar", "en"]).optional(),
})

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail("Enter a mobile number", "INVALID_INPUT", 400)
    const phone = saudiMobileE164(parsed.data.phone)
    if (!phone) return fail("Enter a valid mobile number", "INVALID_PHONE", 400)
    const locale = parsed.data.locale === "en" ? "en" : "ar"

    if (!codesPossible()) return fail("Codes cannot be sent right now", "CODE_UNAVAILABLE", 503)

    const resolution = await resolveShareToken(token)
    if (!resolution.ok) return fail("This link is invalid or has expired", resolution.code, resolution.status)
    const { linkId } = resolution

    const db = getAdminFirestore()
    const [from, to] = guestOtpSubjectRange(linkId)
    const hourAgo = Date.now() - 60 * 60 * 1000
    const recent = await db.collection(OTP_CHALLENGES).where("subjectId", ">=", from).where("subjectId", "<=", to).get()
    if (recent.docs.filter((d) => Number(d.data().createdAt) > hourAgo).length >= GUEST_OTP_LINK_CAP_PER_HOUR) {
      return fail("Too many codes were requested on this link — try again later", "LINK_OTP_LIMIT", 429)
    }

    const rate = await consumeMobileRate(db, "otp", phone)
    if (!rate.ok) {
      const res = fail(rate.code === "RATE_LIMITED" ? "Too many codes were requested for this number — try again later" : "Codes cannot be sent right now — try again later", rate.code, rate.status)
      if (rate.code === "RATE_LIMITED") res.headers.set("Retry-After", String(rate.retryAfterSec))
      return res
    }

    const input = { purpose: "guest_offer" as const, subjectId: guestOtpSubject(linkId, phone), phone }
    if (isVerifyConfigured()) {
      const remote = await issueRemoteOtp(db, input, () => startVerification(phone, locale))
      if ("error" in remote) {
        return remote.error === "TOO_SOON" ? fail("A code was sent less than a minute ago", "TOO_SOON", 429) : fail("The code could not be sent", remote.error, 502)
      }
      return NextResponse.json({ success: true, data: { required: true, challengeId: remote.challengeId, phoneMasked: maskPhone(phone), sent: true } })
    }

    const issued = await issueOtp(db, input)
    if (!issued) return fail("A code was sent less than a minute ago", "TOO_SOON", 429)

    if (!isSmsConfigured()) {
      // UAT has no SMS gateway: hand the tester the code. Never in production.
      return NextResponse.json({
        success: true,
        data: { required: true, challengeId: issued.challengeId, phoneMasked: maskPhone(phone), sent: false, testCode: testingEnvironment() ? issued.code : undefined },
      })
    }
    const text =
      locale === "en"
        ? `Mdmak Tech: your code to submit your offer is ${issued.code}. Valid for 5 minutes. Do not share it.`
        : `مدماك تيك: رمز تأكيد عرض السعر هو ${issued.code}. صالح لمدة 5 دقائق. لا تشاركه مع أحد.`
    const result = await sendSms({ to: phone, body: text })
    if (!result.sent) return fail("The code could not be sent", result.error || "SMS_FAILED", 502)
    return NextResponse.json({ success: true, data: { required: true, challengeId: issued.challengeId, phoneMasked: maskPhone(phone), sent: true } })
  } catch (error) {
    console.error("Guest offer code error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

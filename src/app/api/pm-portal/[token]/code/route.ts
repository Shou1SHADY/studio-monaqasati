import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { issueOtp, issueRemoteOtp } from "@/lib/otp"
import { isSmsConfigured, isVerifyConfigured, sendSms, startVerification } from "@/lib/sms"
import { maskPhone, resolvePortalLink } from "@/lib/pm/portal-links"

// The consultant's one-time code, sent to the mobile the project named when
// it sent the link — never one the page supplies. One code a minute per link.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const isUat = () => process.env.NEXT_PUBLIC_APP_ENV === "uat" || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "mdmaktech-uat"

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const locale = new URL(req.url).searchParams.get("locale") === "en" ? "en" : "ar"
    const db = getAdminFirestore()
    const resolved = await resolvePortalLink(db, token)
    if (!resolved.ok) return fail("This link is invalid, replaced, or has expired", resolved.code, resolved.status)

    const { linkId, link } = resolved
    const phone = link.consultant.phone
    const phoneMasked = maskPhone(phone)
    if (isVerifyConfigured()) {
      const remote = await issueRemoteOtp(db, { purpose: "pm_portal", subjectId: linkId, phone }, () => startVerification(phone, locale))
      if ("error" in remote) {
        return remote.error === "TOO_SOON" ? fail("A code was sent less than a minute ago", "TOO_SOON", 429) : fail("The code could not be sent", remote.error, 502)
      }
      return NextResponse.json({ success: true, data: { challengeId: remote.challengeId, phoneMasked, sent: true } })
    }

    const issued = await issueOtp(db, { purpose: "pm_portal", subjectId: linkId, phone })
    if (!issued) return fail("A code was sent less than a minute ago", "TOO_SOON", 429)

    if (!isSmsConfigured()) {
      return NextResponse.json({ success: true, data: { challengeId: issued.challengeId, phoneMasked, sent: false, testCode: isUat() ? issued.code : undefined } })
    }
    const text =
      locale === "en"
        ? `Mdmak Tech: your code to open the consultant portal is ${issued.code}. Valid for 5 minutes. Do not share it.`
        : `مدماك تيك: رمز الدخول إلى بوابة الاستشاري هو ${issued.code}. صالح لمدة 5 دقائق. لا تشاركه مع أحد.`
    const result = await sendSms({ to: phone, body: text })
    if (!result.sent) return fail("The code could not be sent", result.error || "SMS_FAILED", 502)
    return NextResponse.json({ success: true, data: { challengeId: issued.challengeId, phoneMasked, sent: true } })
  } catch (error) {
    console.error("PM portal code error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

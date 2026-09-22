import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { issueOtp } from "@/lib/otp"
import { isSmsConfigured, sendSms } from "@/lib/sms"
import { maskPhone, resolveReceiptLink } from "@/lib/receipt-links"

// Send the signing code to the receiver's mobile — the number Procurement set
// when forwarding, never one the page supplies. One code a minute per link.

const fail = (message: string, code: string, status: number) =>
  NextResponse.json({ error: true, message, code }, { status })

const isUat = () =>
  process.env.NEXT_PUBLIC_APP_ENV === "uat" || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "mdmaktech-uat"

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const locale = new URL(req.url).searchParams.get("locale") === "en" ? "en" : "ar"
    const db = getAdminFirestore()
    const resolved = await resolveReceiptLink(db, token)
    if (!resolved.ok) return fail("This link is invalid, used, or has expired", resolved.code, resolved.status)

    const { linkId, link } = resolved
    const issued = await issueOtp(db, { purpose: "receipt_sign", subjectId: linkId, phone: link.receiver.phone })
    if (!issued) return fail("A code was sent less than a minute ago", "TOO_SOON", 429)

    const text =
      locale === "en"
        ? `Mdmak Tech: your code to confirm receipt is ${issued.code}. Valid for 5 minutes. Do not share it.`
        : `مدماك تيك: رمز تأكيد الاستلام هو ${issued.code}. صالح لمدة 5 دقائق. لا تشاركه مع أحد.`

    if (!isSmsConfigured()) {
      // UAT has no SMS gateway: hand the tester the code. Never in production.
      return NextResponse.json({
        success: true,
        data: { challengeId: issued.challengeId, phoneMasked: maskPhone(link.receiver.phone), sent: false, testCode: isUat() ? issued.code : undefined },
      })
    }
    const result = await sendSms({ to: link.receiver.phone, body: text })
    if (!result.sent) return fail("The code could not be sent", result.error || "SMS_FAILED", 502)
    return NextResponse.json({ success: true, data: { challengeId: issued.challengeId, phoneMasked: maskPhone(link.receiver.phone), sent: true } })
  } catch (error) {
    console.error("Receipt code error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

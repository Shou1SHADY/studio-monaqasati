import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveShareToken } from "@/lib/rfq-share"
import { maskPhone } from "@/lib/otp"
import { checkCode, codeFailure, failure, openSession, otpSchema, phoneOf } from "@/lib/procurement/visitor-http"

// Public: the code he was sent proves the mobile; the proof buys a short session on this one link (R-05, LNK-09). With it he
// sends and edits his quote, answers what is asked of him and reads his result — nothing needs a second code, and no other
// link accepts it. The code is spent here; a wrong or expired one opens nothing.

const bodySchema = otpSchema.extend({ phone: z.string().trim().min(7).max(20) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return failure("Enter the code", "INVALID_INPUT", 400)
    const phone = phoneOf(parsed.data.phone)
    if (!phone) return failure("Enter a valid mobile number", "INVALID_PHONE", 400)
    const resolution = await resolveShareToken(token)
    if (!resolution.ok) return failure("This link is invalid or has expired", resolution.code, resolution.status)

    const db = getAdminFirestore()
    const check = await checkCode(db, resolution.linkId, phone, parsed.data.challengeId, parsed.data.code)
    if (check !== "ok") return codeFailure(check)
    const session = await openSession(db, resolution.linkId, phone)
    if (!session) return failure("Could not open your session", "SESSION_UNAVAILABLE", 503)
    return NextResponse.json({ success: true, data: { session, phoneMasked: maskPhone(phone) } })
  } catch (err) {
    console.error("Visitor verify error:", err)
    return failure("Internal server error", "INTERNAL", 500)
  }
}

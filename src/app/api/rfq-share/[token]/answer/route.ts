import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveShareToken } from "@/lib/rfq-share"
import { answerClarification, visitorOf } from "@/lib/procurement/visitor-offer-server"
import { failure, visitorFailure, writeRate } from "@/lib/procurement/visitor-http"

// Session-only: the answer to a clarification the buyer asked on HIS quote. It goes back to the buyer on that question and to
// nobody else — a question about one quote is not served to the other suppliers. Allowed after the submission closed.

const bodySchema = z.object({ inquiryId: z.string().trim().min(1).max(128), answer: z.string().trim().min(1).max(1000) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return failure("Write your answer", "INVALID_INPUT", 400)
    const resolution = await resolveShareToken(token)
    if (!resolution.ok) return failure("This link is invalid or has expired", resolution.code, resolution.status)
    const db = getAdminFirestore()
    const visitor = await visitorOf(db, req.headers, resolution.linkId)
    const blocked = await writeRate(db, visitor.phone)
    if (blocked) return blocked
    await answerClarification(db, visitor, { rfqId: resolution.rfqId, inquiryId: parsed.data.inquiryId, answer: parsed.data.answer })
    return NextResponse.json({ success: true, data: {} })
  } catch (err) {
    const known = visitorFailure(err)
    if (known) return known
    console.error("Visitor answer error:", err)
    return failure("Internal server error", "INTERNAL", 500)
  }
}

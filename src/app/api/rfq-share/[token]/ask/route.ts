import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveShareToken } from "@/lib/rfq-share"
import { consumeRate } from "@/lib/links/rate"
import { readLinkSession, sessionSecretOf } from "@/lib/links/session"
import { askQuestion, type Visitor } from "@/lib/procurement/visitor-offer-server"
import { failure, visitorFailure, writeRate } from "@/lib/procurement/visitor-http"
import { INQUIRY_TEXT_MAX } from "@/lib/procurement/rfq-inquiries"

// Public: a question to the buyer before he prices. With a session (a verified mobile) it carries his company, so the buyer can
// answer him alone; without one it is nameless and can only be answered for everyone (LNK-08). A link is not a way to flood the
// buyer: a ceiling per link per hour, and a verified mobile is held to the per-mobile ceiling as well.

const bodySchema = z.object({ question: z.string().trim().min(1).max(INQUIRY_TEXT_MAX), li: z.number().int().min(0).max(999).nullish() })
const PER_LINK = { max: 30, windowMs: 3_600_000 }

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return failure("Write your question", "INVALID_INPUT", 400)
    const resolution = await resolveShareToken(token)
    if (!resolution.ok) return failure("This link is invalid or has expired", resolution.code, resolution.status)
    const db = getAdminFirestore()

    const secret = sessionSecretOf(req.headers)
    const session = secret ? await readLinkSession(db, secret, { kind: "rfq", linkId: resolution.linkId }) : null
    const visitor: Visitor | null = session?.ok ? { phone: session.phone, linkId: resolution.linkId } : null

    const link = await consumeRate(db, `ask:${resolution.linkId}`, PER_LINK)
    if (!link.ok) return failure("Too many questions on this link — try again later", link.code, link.status)
    if (visitor) {
      const blocked = await writeRate(db, visitor.phone)
      if (blocked) return blocked
    }
    const asked = await askQuestion(db, { rfqId: resolution.rfqId, question: parsed.data.question, visitor, li: parsed.data.li ?? null })
    return NextResponse.json({ success: true, data: asked })
  } catch (err) {
    const known = visitorFailure(err)
    if (known) return known
    console.error("Visitor ask error:", err)
    return failure("Internal server error", "INTERNAL", 500)
  }
}

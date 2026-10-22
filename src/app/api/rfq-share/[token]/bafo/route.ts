import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveShareToken } from "@/lib/rfq-share"
import { answerBafo, visitorOf } from "@/lib/procurement/visitor-offer-server"
import { failure, visitorFailure, writeRate } from "@/lib/procurement/visitor-http"

// Session-only: the reply to «اطلب سعراً أفضل» — one round, the same price or a lower one, by the day he was given (his own
// clock, so it answers even after the submission closed). It is his quote's NEXT version; the first stays on record and the
// buyer's decisions about it are not touched (G-15). Packs, warranties and what he does not supply carry over from his quote.

const bodySchema = z.object({
  lines: z.array(z.object({ rfqProductIndex: z.coerce.number().int().min(0).max(999), unitPrice: z.union([z.string().max(32), z.number()]) })).max(200).optional(),
  total: z.union([z.string().max(32), z.number()]).optional(),
  note: z.string().trim().max(1000).default(""),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return failure("Please enter a valid price", "INVALID_INPUT", 400)
    const resolution = await resolveShareToken(token)
    if (!resolution.ok) return failure("This link is invalid or has expired", resolution.code, resolution.status)
    const db = getAdminFirestore()
    const visitor = await visitorOf(db, req.headers, resolution.linkId)
    const blocked = await writeRate(db, visitor.phone)
    if (blocked) return blocked
    const reply = await answerBafo(db, visitor, resolution.rfqId, parsed.data)
    return NextResponse.json({ success: true, data: reply })
  } catch (err) {
    const known = visitorFailure(err)
    if (known) return known
    console.error("Visitor bafo error:", err)
    return failure("Internal server error", "INTERNAL", 500)
  }
}

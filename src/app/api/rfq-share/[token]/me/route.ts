import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveShareToken } from "@/lib/rfq-share"
import { orderUrlOf } from "@/lib/procurement/visitor-order-link"
import { visitorMe, visitorOf } from "@/lib/procurement/visitor-offer-server"
import { failure, visitorFailure } from "@/lib/procurement/visitor-http"

// Session-only: his own quote on this request, what became of it once the request is decided (awarded to him, with the order's
// link · not awarded · under review · cancelled) and what is asked of him — a better price, a question — which he can answer
// even after the submission closed (LNK-11). Only his: the quote is found by the mobile the session proves.

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const resolution = await resolveShareToken(token)
    if (!resolution.ok) return failure("This link is invalid or has expired", resolution.code, resolution.status)
    const db = getAdminFirestore()
    const visitor = await visitorOf(db, req.headers, resolution.linkId)
    const me = await visitorMe(db, visitor, { rfqId: resolution.rfqId, rfq: resolution.rfq, orderUrlOf: (poId) => orderUrlOf(db, poId) })
    return NextResponse.json({ success: true, data: me })
  } catch (err) {
    const known = visitorFailure(err)
    if (known) return known
    console.error("Visitor me error:", err)
    return failure("Internal server error", "INTERNAL", 500)
  }
}

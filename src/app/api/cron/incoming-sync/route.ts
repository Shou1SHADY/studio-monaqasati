import { createHash, timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { syncAllIncoming } from "@/lib/procurement/incoming-server"
import { sweepTeamApprovals } from "@/lib/procurement/team-approval-server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// The scheduled half of «الطلب الوارد» (Procurement 2.0, WP-S2-03): brings in the project requests the project manager approved and
// the workshop's shortfalls, moves the legacy team requests across, reads the RFQs and orders back onto every open request (a
// cancelled RFQ hands its lines back; an order that arrived completes the request) and tells each requester whose request moved.
// A Procurement page asks for the same pass on demand (/api/procurement/incoming, action `sync`). Vercel Cron calls this daily with
// `Authorization: Bearer $CRON_SECRET`. The same pass sweeps the team requests awaiting approval (REQ-05): released where the policy
// was turned off, escalated to the owner once when they waited past the window.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })
const digest = (s: string) => createHash("sha256").update(s).digest()

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get("authorization") || ""
  if (!header.startsWith("Bearer ")) return false
  return timingSafeEqual(digest(header.slice(7)), digest(secret))
}

async function run(req: NextRequest) {
  if (!process.env.CRON_SECRET) return fail("Cron is not configured", "NOT_CONFIGURED", 401)
  if (!authorised(req)) return fail("Unauthorised", "UNAUTHORISED", 401)
  try {
    const db = getAdminFirestore()
    const totals = await syncAllIncoming(db)
    const approvals = await sweepTeamApprovals(db).catch((e) => (console.error("team approval sweep:", e), { released: 0, escalated: 0 }))
    return NextResponse.json({ success: true, data: { ...totals, approvals } })
  } catch (error) {
    console.error("Incoming sync cron error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

export const GET = run
export const POST = run

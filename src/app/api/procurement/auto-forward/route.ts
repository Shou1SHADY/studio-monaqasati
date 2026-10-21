import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { runAutoForward } from "@/lib/procurement/auto-forward-server"
import { syncTeamRequests } from "@/lib/procurement/team-request-notify-server"

export const dynamic = "force-dynamic"
export const maxDuration = 30

// PUR-06: «مهلة التحويل يوم، ثم تحويل تلقائي موسوم» never happened on UAT (no
// scheduler) and on prod only at 07:00. A Procurement page asks for this run when it
// opens: the CALLER's company only, the same rule as the daily job, and only for
// someone who may forward a notice by hand. Nothing the caller sends changes whom a
// notice goes to; `overdue` only lifts the age limit — the «forward everything
// overdue» button, which a person pressed.

const body = z.object({ overdue: z.boolean().optional() }).strict()

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function POST(req: NextRequest) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("No profile", "FORBIDDEN", 403)
    const mayForward = ["deliveries.confirm", "po.expedite", "offers.accept", "po.approve"] as const
    if (!mayForward.some((p) => caller.can(p))) return fail("Not yours to forward", "FORBIDDEN", 403)
    const parsed = body.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("Bad request", "BAD_REQUEST", 400)
    const totals = await runAutoForward(db, Date.now(), caller.orgId, { ignoreAge: parsed.data.overdue === true })
    await syncTeamRequests(db, caller.orgId).catch((error) => console.error("Team request sync error:", error))
    return NextResponse.json({ success: true, data: { forwarded: totals.forwarded } })
  } catch (error) {
    console.error("On-demand auto-forward error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

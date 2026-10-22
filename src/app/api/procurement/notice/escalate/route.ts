import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { ESCALATE_PERMISSIONS } from "@/lib/procurement/escalation"
import { EscalationRefusal, escalateDelivery } from "@/lib/procurement/escalation-server"

// «صعّد» (TDY-05): a delivery forwarded to a receiver and left uncounted past the company's window goes — once — to the project manager of
// its site, or to the owner without Projects. Whoever follows deliveries up may press it; the server re-runs the window rule itself.
const body = z.object({ deliveryId: z.string().min(1).max(128) }).strict()
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
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Which delivery?", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !ESCALATE_PERMISSIONS.some((p) => caller.can(p))) return fail("Escalating is for whoever follows deliveries up", "FORBIDDEN", 403)
    const res = await escalateDelivery(db, { deliveryId: parsed.data.deliveryId, orgId: caller.orgId, by: { uid: caller.uid, name: caller.name } })
    return NextResponse.json({ success: true, data: { to: res.escalation.toKind, toName: res.escalation.toName ?? null, days: res.days, already: res.already } })
  } catch (error) {
    if (error instanceof EscalationRefusal) return fail(error.code, error.code.toUpperCase(), error.status)
    console.error("escalate delivery:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

import { NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { OfferActError, offerActBody, runOfferAct } from "@/lib/procurement/offer-acts-server"

// The buying side's small writes on an offer — ask for a sample, record a guest's invitation, mark an offer rated (WP-S1-11). The
// browser holds no write path to an offer's decision keys any more: these three were the last users of the contractor-update branch.

const fail = (message: string, code: string, status: number, reason?: string) => NextResponse.json({ error: true, message, code, ...(reason ? { reason } : {}) }, { status })

export async function POST(req: Request) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const parsed = offerActBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Invalid request", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("No permission", "FORBIDDEN", 403, "no_permission")
    return NextResponse.json({ success: true, data: await runOfferAct(db, caller, parsed.data) })
  } catch (error) {
    if (error instanceof OfferActError) return fail(error.reason.replace(/_/g, " "), error.reason.toUpperCase(), error.status, error.reason)
    console.error("Offer act error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

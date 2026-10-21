import { NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { DecisionError, decideSchema, runOfferDecision } from "@/lib/procurement/offer-decisions-server"

// The buyer's decisions about an offer — shortlist, exclude with a reason, restore, ask for a better price, ask for a
// price confirmation, ask for a clarification — written here and nowhere else (G-15, G-16). The record is separate from
// the supplier's offer, so his edits can never erase it, and no browser holds a write path to it.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const STATUS: Record<string, number> = {
  no_permission: 403,
  offer_missing: 404,
  rfq_missing: 404,
  offer_taken: 409,
  offer_withdrawn: 409,
  offer_excluded: 409,
  not_excluded: 409,
  already_excluded: 409,
  already_asked: 409,
  already_shortlisted: 409,
  not_shortlisted: 409,
  rfq_not_open: 409,
  date_invalid: 400,
  reason_required: 422,
  reason_text_short: 422,
}

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
  const parsed = decideSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Invalid request", "invalid", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("No permission", "no_permission", 403)
    return NextResponse.json({ success: true, data: await runOfferDecision(db, caller, parsed.data) })
  } catch (error) {
    if (error instanceof DecisionError) return fail(error.code, error.code, STATUS[error.code] || 400)
    console.error("Offer decision error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

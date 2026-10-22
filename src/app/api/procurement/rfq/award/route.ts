import { NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { AwardError, awardSchema, runAward } from "@/lib/procurement/rfq-server/award-server"

// «رسِّ وأصدر»: the ONLY door an award has. The browser names which offer version won which line and gives its reasons; the
// prices, the packs, the totals, the approval class and the early close are all decided here, in one transaction (G-14, G-16).

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

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
  const parsed = awardSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Invalid request", "invalid", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("No permission", "no_permission", 403)
    return NextResponse.json({ success: true, data: await runAward(db, caller, parsed.data) })
  } catch (error) {
    if (error instanceof AwardError) return NextResponse.json({ error: true, message: error.code, code: error.code, params: error.params }, { status: error.status })
    console.error("RFQ award error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

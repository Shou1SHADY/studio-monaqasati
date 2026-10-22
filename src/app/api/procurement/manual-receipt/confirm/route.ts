import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { ManualReceiptRefusal, answerManualDraft } from "@/lib/procurement/manual-receipt-server"

// The storekeeper's answer to a manual receipt waiting at his main warehouse (`proc:GRN:<no>:MAN`): confirming lands the stock, declining
// moves nothing and tells the buyer. Inventory's act — Procurement has no door into it.
const body = z.object({ deliveryId: z.string().min(1).max(128), answer: z.enum(["confirm", "decline"]), note: z.string().trim().max(300).nullish() }).strict()
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
  if (!parsed.success) return fail("Which receipt?", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !(caller.uid === caller.orgId || caller.can("warehouses.receive") || caller.can("warehouses.manage"))) return fail("Confirming stock is the storekeeper's", "FORBIDDEN", 403)
    if (parsed.data.answer === "decline" && !parsed.data.note) return fail("Say why", "REASON_REQUIRED", 400)
    const res = await answerManualDraft(db, { uid: caller.uid, name: caller.name, orgId: caller.orgId }, parsed.data)
    return NextResponse.json({ success: true, data: res })
  } catch (error) {
    if (error instanceof ManualReceiptRefusal) return fail(error.code, error.code.toUpperCase(), error.status)
    console.error("manual receipt answer:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

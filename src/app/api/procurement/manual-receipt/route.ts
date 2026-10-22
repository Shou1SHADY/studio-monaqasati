import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { manualReceiptBody } from "@/lib/procurement/manual-receipt-form"
import { ManualReceiptRefusal, createManualReceipt } from "@/lib/procurement/manual-receipt-server"

// «سجّل سند استلام يدوياً» (RCV-05): something bought outside the platform. A buyer or the owner records it; it is tagged «يدوي» and listed
// under «بلا أمر شراء». At a project's store it lands at once; at a main warehouse it is a DRAFT the storekeeper confirms — no stock moves before.
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
  const parsed = manualReceiptBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Check the receipt", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    // A purchase made outside the platform is Procurement's to declare: whoever prepares or approves orders, or the owner.
    if (!caller || !(caller.uid === caller.orgId || caller.can("offers.accept") || caller.can("po.approve"))) return fail("Recording a manual receipt is for Procurement", "FORBIDDEN", 403)
    const res = await createManualReceipt(db, { uid: caller.uid, name: caller.name, orgId: caller.orgId }, parsed.data)
    return NextResponse.json({ success: true, data: res })
  } catch (error) {
    if (error instanceof ManualReceiptRefusal) return fail(error.code, error.code.toUpperCase(), error.status)
    console.error("manual receipt:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

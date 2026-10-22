import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { NoticeRefusal, createDeliveryNotice } from "@/lib/procurement/notice-server"

// «سجّل إشعار تسليم» (PUR-06): a supplier OUTSIDE the platform who did not use his order link cannot notify, so whoever follows the
// order up records what his phone call said — the day and a note, never a quantity (G-08; `.strict()` refuses one) — and it is then
// forwarded to the receiver like any notice, marked `onBehalf`. A registered supplier's notice stays his to send.
const body = z.object({ poId: z.string().min(1).max(128), deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(500).nullish() }).strict()
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
  if (!parsed.success) return fail("Check the notice", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    const mayFollow = ["po.expedite", "offers.accept", "po.approve", "deliveries.confirm"] as const
    if (!caller || !mayFollow.some((p) => caller.can(p))) return fail("Not yours to record", "FORBIDDEN", 403)
    const res = await createDeliveryNotice(db, {
      poId: parsed.data.poId,
      deliveryDate: parsed.data.deliveryDate,
      note: parsed.data.note,
      by: { source: "onBehalf", uid: caller.uid, name: caller.name },
      authorize: (po) => {
        if (po.organizationId !== caller.orgId) throw new NoticeRefusal("order_missing")
        if (!po.isGuestSupplier && po.supplierOrgId && po.supplierOrgId !== "guest") throw new NoticeRefusal("supplier_on_platform")
      },
    })
    return NextResponse.json({ success: true, data: { deliveryId: res.deliveryId, seq: res.seq } })
  } catch (error) {
    if (error instanceof NoticeRefusal) return fail(error.code, error.code.toUpperCase(), error.status)
    console.error("record notice:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

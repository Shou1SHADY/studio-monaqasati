import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { NoticeRefusal, createDeliveryNotice } from "@/lib/procurement/notice-server"

// The registered supplier's delivery notice (G-08): a day and a note, nothing else — `.strict()` refuses a quantity, a driver, a
// plate or a paper. The server numbers it per order (two trucks in a day are two notices) and writes it beside the order's log.
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
    if (!caller) return fail("Account not found", "FORBIDDEN", 403)
    const res = await createDeliveryNotice(db, {
      poId: parsed.data.poId,
      deliveryDate: parsed.data.deliveryDate,
      note: parsed.data.note,
      by: { source: "supplier", uid: caller.uid, name: caller.name },
      authorize: (po) => {
        if (!po.supplierOrgId || po.supplierOrgId === "guest" || po.supplierOrgId !== caller.orgId) throw new NoticeRefusal("not_yours")
      },
    })
    return NextResponse.json({ success: true, data: { deliveryId: res.deliveryId, seq: res.seq } })
  } catch (error) {
    if (error instanceof NoticeRefusal) return fail(error.code, error.code.toUpperCase(), error.status)
    console.error("delivery notice:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

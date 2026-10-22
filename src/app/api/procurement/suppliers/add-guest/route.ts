import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { mayInviteSuppliers } from "@/lib/procurement/team"
import { AddGuestError, addGuestSupplier } from "@/lib/procurement/supplier-offplatform-server"

// «أضِفه إلى موردينا» for a supplier with no account (SUP-03): the procurement manager and the buyer keep a record of the guest who
// quoted through a visitor link, keyed by the mobile a code proved. The offer (or the order on it) names him — nothing typed.

const body = z
  .object({ offerId: z.string().trim().min(1).max(128).optional(), poId: z.string().trim().min(1).max(128).optional() })
  .strict()
  .refine((v) => Boolean(v.offerId || v.poId), { message: "offer_or_order" })

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
  if (!parsed.success) return fail("Which offer?", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !mayInviteSuppliers(caller.can)) return fail("Only the procurement manager or a buyer keeps the supplier file", "FORBIDDEN", 403)
    return NextResponse.json({ success: true, data: await addGuestSupplier(db, caller, parsed.data) })
  } catch (error) {
    if (error instanceof AddGuestError) return fail(error.code.replace(/_/g, " "), error.code.toUpperCase(), error.status)
    console.error("add guest supplier:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

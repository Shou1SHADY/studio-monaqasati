import { NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { mayInviteSuppliers } from "@/lib/procurement/team"

// «ألغِ» on a supplier invitation (PUR-05): whoever may invite suppliers for the company
// cancels a pending one — its link stops working at once. Only `status` changes.

const body = z.object({ invitationId: z.string().min(1).max(128) })
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
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Which invitation?", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !mayInviteSuppliers(caller.can)) return fail("Not yours to cancel", "FORBIDDEN", 403)
    const ref = db.collection("invitations").doc(parsed.data.invitationId)
    const inv = (await ref.get()).data()
    if (!inv || inv.type !== "supplier_invite" || inv.contractorOrgId !== caller.orgId) return fail("Invitation not found", "NOT_FOUND", 404)
    if (inv.status !== "pending") return fail("Only a pending invitation is cancelled", "NOT_PENDING", 409)
    await ref.update({ status: "cancelled", cancelledAt: new Date().toISOString(), cancelledByName: caller.name })
    return NextResponse.json({ success: true, data: {} })
  } catch (error) {
    console.error("cancel invitation:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

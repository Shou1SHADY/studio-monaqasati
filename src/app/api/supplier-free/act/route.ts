import { NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { ActError, actSchema, isBuyerAct, runBuyerAct, runSupplierAct } from "@/lib/supplier-free/server-acts"

// The supplier journey's acts on a document the other company owns (decline, delivery report, answer to a transfer,
// warranty; and the contractor's transfer report and warranty acceptance). One door, checked on the server (NFR-08).

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const STATUS: Record<string, number> = { not_found: 404, order_missing: 404, no_permission: 403, not_yours: 403, wrong_state: 409, already_reported: 409, reminded_today: 409, nothing_left: 409, no_report: 409, no_receipt: 409, not_paid: 409, already_rated: 409 }

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
  const parsed = actSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Invalid request", "invalid", 400)
  const act = parsed.data
  try {
    const db = getAdminFirestore()
    if (isBuyerAct(act)) return NextResponse.json({ success: true, data: await runBuyerAct(db, uid, act) })
    const user = (await db.collection("users").doc(uid).get()).data() as { role?: string; organizationId?: string; name?: string; companyName?: string } | undefined
    if (!user || user.role !== "Supplier") return fail("Suppliers only", "no_permission", 403)
    const name = user.name || user.companyName || ""
    return NextResponse.json({ success: true, data: await runSupplierAct(db, { uid, name, orgId: user.organizationId || uid, company: user.companyName || name }, act) })
  } catch (error) {
    if (error instanceof ActError) return fail(error.code, error.code, STATUS[error.code] || 400)
    console.error("Supplier act error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

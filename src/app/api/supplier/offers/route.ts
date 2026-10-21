import { NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { createSupplierOffer, SupplierOfferError } from "@/lib/supplier-offer-server"
import { monthlyLimitFor } from "@/lib/supplier-approval-server"
import { supplierCompanyOf } from "@/lib/supplier-free/supplier-company"

// A supplier's quotation from the full portal, the AI assistant or the mobile app — written here, after the company's
// approval and the request's state — open, in time, reaching him — are checked (supplier-offer-server.ts, G-07). The rules no longer
// take it from a browser.

const fail = (message: string, code: string, status: number, detail?: string) => NextResponse.json({ error: true, message, code, detail: detail ?? null }, { status })

const STATUS: Record<string, number> = { not_approved: 403, quota: 429, rfq_missing: 404, rfq_closed: 409, deadline: 409, not_reached: 403, already_quoted: 409, too_large: 413 }

const schema = z.object({ rfqId: z.string().trim().min(1).max(200), offer: z.record(z.unknown()) })

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
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Invalid request", "invalid", 400)
  try {
    const db = getAdminFirestore()
    const user = (await db.collection("users").doc(uid).get()).data() as ({ role?: string } & Record<string, unknown>) | undefined
    if (!user || user.role !== "Supplier") return fail("Suppliers only", "no_permission", 403)
    const company = await supplierCompanyOf(db, uid, user)
    const monthlyLimit = company.approved ? await monthlyLimitFor(db, company.orgId) : null
    const data = await createSupplierOffer(db, company, parsed.data.rfqId, parsed.data.offer, { monthlyLimit })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof SupplierOfferError) return fail(error.code, error.code, STATUS[error.code] || 400, error.detail)
    console.error("Supplier offer error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

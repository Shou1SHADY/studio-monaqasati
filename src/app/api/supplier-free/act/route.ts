import { NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { ActError, actSchema, isBuyerAct, runBuyerAct, runSupplierAct } from "@/lib/supplier-free/server-acts"
import { isQuoteAct, QuoteActError, quoteActSchema, runQuoteAct } from "@/lib/supplier-free/server-quote-acts"
import { supplierCompanyOf } from "@/lib/supplier-free/supplier-company"
import { monthlyLimitFor } from "@/lib/supplier-approval-server"

// The supplier journey's acts on a document the other company owns (decline, delivery report, answer to a transfer,
// warranty; and the contractor's transfer report and warranty acceptance). One door, checked on the server (NFR-08).

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const STATUS: Record<string, number> = { not_found: 404, order_missing: 404, no_permission: 403, not_yours: 403, wrong_state: 409, already_reported: 409, reminded_today: 409, nothing_left: 409, no_report: 409, no_receipt: 409, not_paid: 409, already_rated: 409 }
const QUOTE_STATUS: Record<string, number> = { not_approved: 403, quota: 429, rfq_missing: 404, offer_missing: 404, not_yours: 403, not_reached: 403, rfq_closed: 409, deadline: 409, reply_closed: 409, already_quoted: 409, wrong_state: 409 }

/** The supplier's quote acts (new quote, version, final price, withdraw, sample sent, decline) — dispatched first. */
async function quoteAct(uid: string, body: unknown) {
  const parsed = quoteActSchema.safeParse(body)
  if (!parsed.success) return fail("Invalid request", "invalid", 400)
  try {
    const db = getAdminFirestore()
    const user = (await db.collection("users").doc(uid).get()).data() as ({ role?: string } & Record<string, unknown>) | undefined
    if (!user || user.role !== "Supplier") return fail("Suppliers only", "no_permission", 403)
    // The active company — its name, its field, its VAT standing and its approval — never the caller's own doc (a member,
    // a secondary company). A new quote also carries the free plan's monthly allowance, when the admin set one.
    const company = await supplierCompanyOf(db, uid, user)
    const monthlyLimit = parsed.data.action === "quote.new" && company.approved ? await monthlyLimitFor(db, company.orgId) : null
    return NextResponse.json({ success: true, data: await runQuoteAct(db, { ...company, monthlyLimit }, parsed.data) })
  } catch (error) {
    if (error instanceof QuoteActError) return NextResponse.json({ error: true, message: error.code, code: error.code, detail: error.detail ?? null }, { status: QUOTE_STATUS[error.code] || 400 })
    console.error("Supplier quote act error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
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
  const body = await req.json().catch(() => null)
  if (isQuoteAct(body)) return quoteAct(uid, body)
  const parsed = actSchema.safeParse(body)
  if (!parsed.success) return fail("Invalid request", "invalid", 400)
  const act = parsed.data
  try {
    const db = getAdminFirestore()
    if (isBuyerAct(act)) return NextResponse.json({ success: true, data: await runBuyerAct(db, uid, act) })
    const user = (await db.collection("users").doc(uid).get()).data() as ({ role?: string } & Record<string, unknown>) | undefined
    if (!user || user.role !== "Supplier") return fail("Suppliers only", "no_permission", 403)
    return NextResponse.json({ success: true, data: await runSupplierAct(db, await supplierCompanyOf(db, uid, user), act) })
  } catch (error) {
    if (error instanceof ActError) return fail(error.code, error.code, STATUS[error.code] || 400)
    console.error("Supplier act error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

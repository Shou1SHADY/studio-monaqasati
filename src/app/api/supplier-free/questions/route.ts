import { NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { QuoteActError, questionsFor } from "@/lib/supplier-free/server-quote-acts"
import { supplierCompanyOf } from "@/lib/supplier-free/supplier-company"

// The questions on a request as a supplier reads them (decision 10): his company's own with their state, and the
// answered ones of other bidders without who asked. The rules no longer let a supplier list a request's questions
// (another bidder's unanswered question and his name are not his to read), so the server serves this view. Asking is
// the `quote.ask` act on /api/supplier-free/act.

const query = z.object({ rfqId: z.string().trim().min(1).max(128) })

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function GET(req: Request) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const parsed = query.safeParse({ rfqId: new URL(req.url).searchParams.get("rfqId") })
  if (!parsed.success) return fail("Invalid request", "invalid", 400)
  try {
    const db = getAdminFirestore()
    const user = (await db.collection("users").doc(uid).get()).data() as ({ role?: string } & Record<string, unknown>) | undefined
    if (!user || user.role !== "Supplier") return fail("Suppliers only", "no_permission", 403)
    const c = await supplierCompanyOf(db, uid, user)
    return NextResponse.json({ success: true, data: await questionsFor(db, c.orgId, parsed.data.rfqId) })
  } catch (error) {
    if (error instanceof QuoteActError) return fail(error.code, error.code, error.code === "rfq_missing" ? 404 : 403)
    console.error("Supplier questions error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

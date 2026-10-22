import { NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { InquiryError, inquirySchema, runInquiry } from "@/lib/procurement/rfq-server/inquiry"

// The buyer's side of the RFQ's questions — «أجب للجميع», «للسائل فقط», and a clarification to every invitee. The rules give
// a browser no write path to `inquiries`; a supplier's question enters through `quote.ask` and the visitors' link, both of
// which call `createInquiry`.

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const STATUS: Record<string, number> = {
  no_permission: 403,
  rfq_missing: 404,
  inquiry_missing: 404,
  not_a_question: 409,
  already_answered: 409,
  rfq_not_open: 409,
  anonymous_to_all: 422,
  text_missing: 422,
  question_missing: 422,
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
  const parsed = inquirySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Invalid request", "invalid", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("No permission", "no_permission", 403)
    return NextResponse.json({ success: true, data: await runInquiry(db, caller, parsed.data) })
  } catch (error) {
    if (error instanceof InquiryError) return fail(error.code, error.code, STATUS[error.code] || 400)
    console.error("RFQ inquiry error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

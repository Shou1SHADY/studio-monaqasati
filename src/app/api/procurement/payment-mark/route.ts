import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"
import { PAYMENT_STATES, datedFromAdvance, paymentMarkRefusal, type PaymentMark } from "@/lib/procurement/payment-mark"
import { financeOn, mayMarkPayment, orderFileRefusal, saveOrderFile } from "@/lib/procurement/financeless-server"
import { riyadhDay } from "@/lib/hr/format"

// «علّم الدفع» (PUR-10, question 5): without Finance in the package, the order's optional payment
// status — or its advance marked paid with the day — is recorded here, logged on the order, with an
// optional copy of the transfer (PDF or image). With Finance it is refused: paying is Finance's own
// act there. JSON, or multipart when a copy of the transfer goes with it.

const body = z.object({
  poId: z.string().min(1).max(128),
  kind: z.enum(["status", "advance"]),
  state: z.enum(PAYMENT_STATES).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().min(0).max(1e12).nullable().optional(),
  reference: z.string().trim().max(80).nullable().optional(),
})
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : undefined)

async function readInput(req: NextRequest): Promise<{ input: unknown; file: File | null } | null> {
  if (!(req.headers.get("content-type") || "").includes("multipart/form-data")) return { input: await req.json().catch(() => null), file: null }
  const form = await req.formData().catch(() => null)
  if (!form) return null
  const picked = form.get("file")
  const amount = text(form.get("amount"))?.trim()
  return {
    input: {
      poId: text(form.get("poId")),
      kind: text(form.get("kind")),
      state: text(form.get("state")) || undefined,
      day: text(form.get("day")),
      amount: amount ? Number(amount) : null,
      reference: text(form.get("reference"))?.trim() || null,
    },
    file: picked instanceof File && picked.size > 0 ? picked : null,
  }
}

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
  const read = await readInput(req)
  const parsed = body.safeParse(read?.input)
  if (!read || !parsed.success || (parsed.data.kind === "status" && !parsed.data.state)) return fail("Check the payment", "BAD_REQUEST", 400)
  if (read.file) {
    const refusal = orderFileRefusal(read.file)
    if (refusal) return fail(refusal === "BAD_TYPE" ? "PDF or image only" : "4 MB at most", refusal, 400)
  }
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !mayMarkPayment(caller.can)) return fail("Marking payment is the owner's or the procurement manager's", "FORBIDDEN", 403)
    if (await financeOn(db, caller.orgId)) return fail("Finance records the payments of this company", "FINANCE_ON", 409)
    const ref = db.collection(PURCHASE_ORDERS).doc(parsed.data.poId)
    const snap = await ref.get()
    const po = snap.exists ? ({ id: snap.id, ...(snap.data() as Omit<PurchaseOrder, "id">) } as PurchaseOrder) : null
    if (!po || po.organizationId !== caller.orgId) return fail("Order not found", "NOT_FOUND", 404)
    if (!po.approvedAt || po.status === "cancelled") return fail("Only an approved order is paid", "WRONG_STATE", 409)
    const refusal = paymentMarkRefusal({ state: parsed.data.state || "paid", day: parsed.data.day, amount: parsed.data.amount }, po, riyadhDay(new Date()))
    if (refusal) return fail("Check the day or the amount", refusal === "day" ? "BAD_DAY" : "BAD_AMOUNT", 400)
    const at = new Date().toISOString()
    const copy = read.file ? await saveOrderFile(caller.orgId, po.id, "transfers", read.file) : null
    const entry = (action: string, params: Record<string, unknown>) => ({ action, at, byId: caller.uid, byName: caller.name, note: null, params })
    if (parsed.data.kind === "advance") {
      // The supplier's date counts from the advance (PUR-10): the day it was paid + the lead time his offer gave.
      // A date he already committed to stays unless the late advance pushes it later.
      const dated = datedFromAdvance(parsed.data.day, po.leadTimeDays)
      const moves = dated && (!po.promisedDate || dated > po.promisedDate)
      await ref.update({
        advancePaidDay: parsed.data.day,
        ...(copy ? { advanceFile: copy } : {}),
        ...(moves ? { promisedDate: dated } : {}),
        log: FieldValue.arrayUnion(entry("advance_marked_paid", { date: parsed.data.day, ref: parsed.data.reference || "" }), ...(moves ? [entry("date_updated", { date: dated })] : [])),
      })
    } else {
      const mark: PaymentMark = { state: parsed.data.state!, day: parsed.data.day, amount: parsed.data.amount ?? null, reference: parsed.data.reference || null, ...(copy ? { file: copy } : {}), byName: caller.name, at }
      await ref.update({ paymentMark: mark, paymentMarks: FieldValue.arrayUnion(mark), log: FieldValue.arrayUnion(entry(`payment_marked_${mark.state}`, { date: mark.day, ref: mark.reference || "" })) })
    }
    return NextResponse.json({ success: true, data: { file: copy } })
  } catch (error) {
    console.error("payment mark:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { UPLOAD_MAX_BYTES } from "@/lib/upload-fit"
import { randomUUID } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore, getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { PURCHASE_ORDERS } from "@/lib/procurement/types"
import type { InvoiceFile } from "@/lib/procurement/payment-mark"
import { financeOn } from "@/lib/procurement/financeless-server"

// The supplier's invoice as a FILE on the order (PUR-10): uploaded by the buyer when it came
// outside the platform. Whoever prepares or approves orders (or the owner) attaches it; PDF or
// image, 4 MB at most. Only a company without Finance keeps invoices as files: with Finance the accountant is inside.

// Under Vercel's 4.5 MB request-body limit (prod); the browser shrinks a photo first (upload-fit.ts).
const MAX_BYTES = UPLOAD_MAX_BYTES
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
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !(caller.can("offers.accept") || caller.can("po.approve"))) return fail("Not yours to attach", "FORBIDDEN", 403)
    if (await financeOn(db, caller.orgId)) return fail("Finance receives the invoices of this company", "FINANCE_ON", 409)
    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    const poId = String(form?.get("poId") || "")
    const number = String(form?.get("number") || "").slice(0, 60)
    if (!(file instanceof File) || !poId) return fail("Choose a file", "BAD_REQUEST", 400)
    if (!(file.type === "application/pdf" || file.type.startsWith("image/"))) return fail("PDF or image only", "BAD_TYPE", 400)
    if (file.size > MAX_BYTES) return fail("4 MB at most", "TOO_BIG", 400)
    const ref = db.collection(PURCHASE_ORDERS).doc(poId)
    const po = (await ref.get()).data()
    if (!po || po.organizationId !== caller.orgId) return fail("Order not found", "NOT_FOUND", 404)
    const bucketName = getStorageBucketName()
    const path = `purchase-orders/${caller.orgId}/${poId}/invoices/${Date.now()}-${file.name.replace(/[^\w.؀-ۿ-]+/g, "_").slice(-80)}`
    const token = randomUUID()
    await getAdminStorage().bucket(bucketName).file(path).save(Buffer.from(await file.arrayBuffer()), { contentType: file.type, metadata: { metadata: { firebaseStorageDownloadTokens: token } } })
    const entry: InvoiceFile = { name: file.name.slice(0, 120), url: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`, path, from: "buyer", number: number || null, at: new Date().toISOString(), sentToAccountantAt: null }
    const log = { action: "invoice_attached", at: entry.at, byId: caller.uid, byName: caller.name, note: null, params: { invoice: entry.number || entry.name } }
    await ref.update({ invoiceFiles: FieldValue.arrayUnion(entry), log: FieldValue.arrayUnion(log) })
    return NextResponse.json({ success: true, data: { file: entry } })
  } catch (error) {
    console.error("invoice file:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

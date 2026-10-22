import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { fail } from "@/lib/procurement/po-route"
import { MessageRefusal, mayTalkToSupplier, sideOf, storeMessageFile } from "@/lib/procurement/po-messages-server"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"

// A file for the order's conversation (an image or a PDF, 4 MB at most), stored under the order; its address is attached to the
// next message. Multipart: `file` and `poId`.
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
    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    const poId = String(form?.get("poId") || "")
    if (!(file instanceof File) || !poId) return fail("Choose a file", "BAD_REQUEST", 400)
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    const snap = await db.collection(PURCHASE_ORDERS).doc(poId).get()
    const po = snap.exists ? (snap.data() as PurchaseOrder) : null
    if (!caller || !po) return fail("Order not found", "NOT_FOUND", 404)
    const side = sideOf(po, caller)
    if (!side || (side === "us" && !mayTalkToSupplier(caller))) return fail("Not yours", "FORBIDDEN", 403)
    return NextResponse.json({ success: true, data: { file: await storeMessageFile(po.organizationId, poId, file) } })
  } catch (error) {
    if (error instanceof MessageRefusal) return fail(error.code, error.code.toUpperCase(), error.status)
    console.error("po message file:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

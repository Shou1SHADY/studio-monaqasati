import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { buildDeliveryNotice, noticeErrors } from "@/lib/procurement/supplier"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"

// «سجّل إشعار تسليم» (PUR-06): a supplier OUTSIDE the platform cannot send his own notice,
// so whoever follows the order up records it for him — its date and quantities — and it is
// then forwarded to the receiver like any notice. Built with the supplier's own builder,
// marked `recordedOnBehalf`. A registered supplier's notice stays his to send.

const body = z.object({
  poId: z.string().min(1).max(128),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(z.object({ poLineId: z.string().min(1).max(128), quantity: z.number().finite().min(0).max(1e9) })).min(1).max(200),
  driverName: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
})
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
  if (!parsed.success) return fail("Check the notice", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    const mayFollow = ["po.expedite", "offers.accept", "po.approve", "deliveries.confirm"] as const
    if (!caller || !mayFollow.some((p) => caller.can(p))) return fail("Not yours to record", "FORBIDDEN", 403)
    const snap = await db.collection(PURCHASE_ORDERS).doc(parsed.data.poId).get()
    const po = snap.exists ? ({ id: snap.id, ...(snap.data() as Omit<PurchaseOrder, "id">) } as PurchaseOrder) : null
    if (!po || po.organizationId !== caller.orgId) return fail("Order not found", "NOT_FOUND", 404)
    if (!po.isGuestSupplier && po.supplierOrgId && po.supplierOrgId !== "guest") return fail("A registered supplier sends his own notice", "SUPPLIER_ON_PLATFORM", 409)
    if (!["sent", "accepted"].includes(po.status)) return fail("The order is not on its way", "WRONG_STATE", 409)
    const errors = noticeErrors(po, parsed.data.lines, parsed.data.deliveryDate, new Date())
    if (errors.length) return fail("The notice does not fit the order", errors[0].code.toUpperCase(), 400)

    const at = new Date().toISOString()
    const doc = buildDeliveryNotice({
      po,
      lines: parsed.data.lines,
      deliveryDate: parsed.data.deliveryDate,
      driverName: parsed.data.driverName || null,
      notes: parsed.data.notes || null,
      supplier: { uid: po.supplierUserId || "guest", orgId: po.supplierOrgId || "guest", name: po.supplierName },
      contractorId: po.preparedById,
      createdAt: at,
    })
    const ref = await db.collection("deliveries").add({ ...doc, isGuestDelivery: true, recordedOnBehalf: { byId: caller.uid, byName: caller.name, at } })
    return NextResponse.json({ success: true, data: { deliveryId: ref.id } })
  } catch (error) {
    console.error("record notice:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

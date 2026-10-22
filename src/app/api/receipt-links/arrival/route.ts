import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { LINK_TTL_MS, RECEIPT_LINKS, callerOf, newToken, type ReceiptLink } from "@/lib/receipt-links"
import { lineToArrive } from "@/lib/procurement/po"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"

// «وصلت بلا إشعار» — a truck came and the supplier never notified. The member who receives it (deliveries.confirm) asks for the
// receipt page of that ORDER; nothing is stored until he confirms, and the receipt is then born tagged «بلا إشعار». Procurement
// cannot start this for him: it is the receiver's own act, signed in, with the same blind count as a forwarded notice.

const body = z.object({ poId: z.string().min(1).max(128) }).strict()
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
  if (!parsed.success) return fail("Which order?", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !caller.can("deliveries.confirm")) return fail("Receiving needs the receiving permission", "FORBIDDEN", 403)
    const snap = await db.collection(PURCHASE_ORDERS).doc(parsed.data.poId).get()
    const po = snap.exists ? ({ ...(snap.data() as Omit<PurchaseOrder, "id">), id: snap.id } as PurchaseOrder) : null
    if (!po || po.organizationId !== caller.orgId) return fail("Order not found", "NOT_FOUND", 404)
    if ((po.status !== "sent" && po.status !== "accepted") || !(po.lines || []).some((l) => lineToArrive(l) > 0)) return fail("Nothing is left to receive on this order", "NOTHING_TO_RECEIVE", 409)

    const now = Date.now()
    const open = await db.collection(RECEIPT_LINKS).where("poId", "==", po.id).get()
    for (const d of open.docs) {
      const l = d.data() as ReceiptLink
      if (l.arrival && l.status === "open" && l.receiver.userId === uid) await d.ref.update({ status: "revoked" })
    }
    const token = newToken()
    const profile = (await db.collection("users").doc(uid).get()).data() as { phone?: string } | undefined
    const link: ReceiptLink = {
      token,
      deliveryId: db.collection("deliveries").doc().id,
      arrival: true,
      poId: po.id,
      organizationId: caller.orgId,
      receiver: { kind: "user", userId: uid, name: caller.name, phone: profile?.phone || "" },
      status: "open",
      viaAccount: true,
      createdById: uid,
      createdByName: caller.name,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LINK_TTL_MS).toISOString(),
      note: null,
    }
    await db.collection(RECEIPT_LINKS).doc().set(link)
    return NextResponse.json({ success: true, data: { token } })
  } catch (error) {
    console.error("Receipt arrival link error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { SITE_URL } from "@/lib/app-env"
import {
  LINK_TTL_MS,
  RECEIPT_LINKS,
  callerOf,
  createBody,
  maskPhone,
  newToken,
  receiverFrom,
  type ReceiptLink,
} from "@/lib/receipt-links"

// Procurement forwards a delivery to whoever will receive it (22 Sep review).
// Only someone who may confirm deliveries for this company may do so; the
// link replaces any earlier open link for the same delivery, so exactly one
// person can sign for it.

const fail = (message: string, code: string, status: number) =>
  NextResponse.json({ error: true, message, code }, { status })

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

  const parsed = createBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Choose who receives it", "BAD_REQUEST", 400)

  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller) return fail("No profile", "FORBIDDEN", 403)
    if (!caller.can("deliveries.confirm")) return fail("Forwarding a receipt needs delivery confirmation rights", "FORBIDDEN", 403)

    const deliveryRef = db.collection("deliveries").doc(parsed.data.deliveryId)
    const delivery = (await deliveryRef.get()).data()
    if (!delivery || delivery.contractorOrgId !== caller.orgId) return fail("Delivery not found", "NOT_FOUND", 404)
    if (delivery.status === "confirmed") return fail("This delivery has already been received", "ALREADY_RECEIVED", 409)

    type Profile = { name?: string; email?: string; phone?: string; organizationId?: string }
    let receiverUser: Profile | null = null
    if (parsed.data.receiver.kind === "user") {
      receiverUser = ((await db.collection("users").doc(parsed.data.receiver.userId).get()).data() as Profile | undefined) || null
      if (!receiverUser || (receiverUser.organizationId || parsed.data.receiver.userId) !== caller.orgId) {
        return fail("That person is not in your company", "NOT_A_MEMBER", 400)
      }
    }
    const receiver = receiverFrom(parsed.data.receiver, receiverUser)
    if (!receiver) return fail("A mobile number is needed to send the confirmation code", "NO_PHONE", 400)

    const now = Date.now()
    const openLinks = await db.collection(RECEIPT_LINKS).where("deliveryId", "==", parsed.data.deliveryId).get()
    const token = newToken()
    const linkRef = db.collection(RECEIPT_LINKS).doc()
    const link: ReceiptLink = {
      token,
      deliveryId: parsed.data.deliveryId,
      organizationId: caller.orgId,
      receiver,
      status: "open",
      createdById: caller.uid,
      createdByName: caller.name,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LINK_TTL_MS).toISOString(),
    }

    const batch = db.batch()
    for (const d of openLinks.docs) if (d.data().status === "open") batch.update(d.ref, { status: "revoked" })
    batch.set(linkRef, link)
    batch.update(deliveryRef, {
      forwardedTo: {
        linkId: linkRef.id,
        name: receiver.name,
        userId: receiver.userId,
        phoneMasked: maskPhone(receiver.phone),
        byName: caller.name,
        at: link.createdAt,
      },
    })
    await batch.commit()

    // This environment's own address: a UAT link must open UAT, whose
    // database is the one that holds this delivery.
    const url = `${SITE_URL}/receive/${token}`

    // A team member also finds it in their notifications; a person without an
    // account is sent the link by Procurement, by WhatsApp or however they like.
    if (receiver.userId) {
      await db
        .collection("users")
        .doc(receiver.userId)
        .collection("notifications")
        .add({
          userId: receiver.userId,
          organizationId: caller.orgId,
          type: "receipt_forwarded",
          i18n: {
            title: "pn_receipt_forwarded_title",
            message: "pn_receipt_forwarded",
            params: { name: caller.name, supplier: (delivery.supplierName as string) || "" },
          },
          title: "📦 استلام مُحوَّل إليك",
          message: `حوّل إليك ${caller.name} استلام توريد من ${(delivery.supplierName as string) || "المورد"} — افتح الرابط وعدّ ما وصل ووقّع.`,
          deliveryId: parsed.data.deliveryId,
          link: `/receive/${token}`,
          createdAt: new Date(now).toISOString(),
          read: false,
        })
        .catch((err) => console.warn("receipt forward notification failed:", err?.code || err))
    }

    return NextResponse.json({ success: true, data: { url, expiresAt: link.expiresAt, phoneMasked: maskPhone(receiver.phone) } })
  } catch (error) {
    console.error("Receipt link create error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

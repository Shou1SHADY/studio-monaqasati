import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { SITE_URL } from "@/lib/app-env"
import { RECEIPT_LINKS, callerOf, type ReceiptLink } from "@/lib/receipt-links"
import { normalizePhoneE164, sendDirectMessage } from "@/lib/sms"

// «ذكّر المستلم» (PUR-06): the notice was forwarded and its receiver has not counted it.
// A member is reminded in his own inbox; someone with no account by a message carrying his
// link again. Whoever may forward may remind — once every six hours per link.

const body = z.object({ deliveryId: z.string().min(1).max(128) })
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })
const GAP_MS = 6 * 3_600_000

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
  if (!parsed.success) return fail("Which delivery?", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    const mayForward = ["deliveries.confirm", "po.expedite", "offers.accept", "po.approve"] as const
    if (!caller || !mayForward.some((p) => caller.can(p))) return fail("Not yours to remind", "FORBIDDEN", 403)
    const delivery = (await db.collection("deliveries").doc(parsed.data.deliveryId).get()).data()
    if (!delivery || delivery.contractorOrgId !== caller.orgId) return fail("Delivery not found", "NOT_FOUND", 404)
    if (delivery.status === "confirmed" || delivery.receiverReport) return fail("Already counted", "ALREADY_COUNTED", 409)
    const linkId = (delivery.forwardedTo as { linkId?: string } | undefined)?.linkId
    if (!linkId) return fail("Not forwarded yet", "NOT_FORWARDED", 409)
    const linkRef = db.collection(RECEIPT_LINKS).doc(linkId)
    const link = (await linkRef.get()).data() as (ReceiptLink & { remindedAt?: string }) | undefined
    if (!link || link.status !== "open") return fail("The link is closed — forward it again", "LINK_CLOSED", 409)
    if (link.remindedAt && Date.now() - Date.parse(link.remindedAt) < GAP_MS) return fail("Reminded a short while ago", "TOO_SOON", 429)

    const supplier = (delivery.supplierName as string) || ""
    const url = `${SITE_URL}/receive/${link.token}`
    const at = new Date().toISOString()
    let delivered = false
    if (link.receiver.userId) {
      await db
        .collection("users")
        .doc(link.receiver.userId)
        .collection("notifications")
        .add({
          userId: link.receiver.userId,
          organizationId: caller.orgId,
          type: "receipt_forwarded",
          i18n: { title: "pn_receipt_remind_title", message: "pn_receipt_remind", params: { supplier, name: caller.name } },
          title: "⏰ تذكير: استلام بانتظار عدّك",
          message: `يذكّرك ${caller.name} باستلام توريد ${supplier || "المورد"} — افتح الرابط وعدّ ما وصل وأكّد.`,
          deliveryId: parsed.data.deliveryId,
          link: `/receive/${link.token}`,
          createdAt: at,
          read: false,
        })
      delivered = true
    }
    const phone = normalizePhoneE164(link.receiver.phone)
    if (!link.receiver.userId && phone) {
      delivered = (await sendDirectMessage({ to: phone, body: `مدماك تِك: تذكير — استلام توريد ${supplier || "المورد"} بانتظار عدّك. افتح الرابط وأكّد بالرمز: ${url}` })).sent
    }
    await linkRef.update({ remindedAt: at, remindedByName: caller.name })
    return NextResponse.json({ success: true, data: { delivered } })
  } catch (error) {
    console.error("receipt remind:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

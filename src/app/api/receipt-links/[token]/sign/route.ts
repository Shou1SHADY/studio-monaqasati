import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { verifyOtp } from "@/lib/otp"
import {
  RECEIPT_LINKS,
  buildReport,
  deliveryLines,
  maskPhone,
  resolveReceiptLink,
  signBody,
  type ReceiverReport,
} from "@/lib/receipt-links"

// The receiver signs for what arrived. The code proves the phone; the count,
// the rejects and the signature land on the delivery as `receiverReport`, and
// the person who forwarded it is told it is ready to book. Nothing is booked
// here — stock, the books and the GR number are Procurement's act, on the
// office's receiving form, which opens pre-filled from this report.

const fail = (message: string, code: string, status: number, extra?: Record<string, unknown>) =>
  NextResponse.json({ error: true, message, code, ...extra }, { status })

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const parsed = signBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail("Check the form", "BAD_REQUEST", 400)

    const db = getAdminFirestore()
    const resolved = await resolveReceiptLink(db, token)
    if (!resolved.ok) return fail("This link is invalid, used, or has expired", resolved.code, resolved.status)
    const { linkId, link, delivery } = resolved

    const report = buildReport(parsed.data, await deliveryLines(db, delivery))
    if (!report.ok) return fail("The count is incomplete", report.error.toUpperCase(), 400, { poLineId: report.poLineId })

    const verdict = await verifyOtp(db, parsed.data.challengeId, { purpose: "receipt_sign", subjectId: linkId }, parsed.data.code)
    if (verdict === "wrong") return fail("Wrong code", "WRONG_CODE", 400)
    if (verdict !== "ok") return fail("The code has expired — ask for a new one", "CODE_EXPIRED", 410)

    const signedAt = new Date().toISOString()
    const receiverReport: ReceiverReport = {
      linkId,
      receiverName: parsed.data.receiverName,
      receiverUserId: link.receiver.userId,
      phoneMasked: maskPhone(link.receiver.phone),
      lines: report.lines,
      note: parsed.data.note?.trim() || null,
      signatureData: parsed.data.signatureData ?? null,
      signedAt,
      verifiedBy: "sms_code",
    }

    const linkRef = db.collection(RECEIPT_LINKS).doc(linkId)
    const deliveryRef = db.collection("deliveries").doc(link.deliveryId)
    // One transaction: a link signs once, and only while it is still open.
    const signed = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(linkRef)).data()
      if (!fresh || fresh.status !== "open") return false
      tx.update(linkRef, { status: "signed", signedAt })
      tx.update(deliveryRef, { receiverReport })
      return true
    })
    if (!signed) return fail("This link has already been used", "LINK_SIGNED", 410)

    await db
      .collection("users")
      .doc(link.createdById)
      .collection("notifications")
      .add({
        userId: link.createdById,
        organizationId: link.organizationId,
        type: "receipt_signed",
        i18n: {
          title: "pn_receipt_signed_title",
          message: "pn_receipt_signed",
          params: { name: parsed.data.receiverName, supplier: (delivery.supplierName as string) || "" },
        },
        title: "✅ وقّع المستلم على التوريد",
        message: `وقّع ${parsed.data.receiverName} على استلام توريد ${(delivery.supplierName as string) || "المورد"} — راجِعه وسجّل الاستلام.`,
        deliveryId: link.deliveryId,
        link: `/contractor/goods-received?tab=incoming&delivery=${link.deliveryId}`,
        createdAt: signedAt,
        read: false,
      })
      .catch((err) => console.warn("receipt signed notification failed:", err?.code || err))

    return NextResponse.json({ success: true, data: { signedAt } })
  } catch (error) {
    console.error("Receipt sign error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

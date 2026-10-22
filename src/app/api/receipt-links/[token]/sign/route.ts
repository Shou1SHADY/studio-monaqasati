import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { verifyOtp } from "@/lib/otp"
import { buildReport, deliveryLines, maskPhone, resolveReceiptLink, signBody, type ReceiverReport } from "@/lib/receipt-links"
import { ReceiptRefusal, confirmReceipt } from "@/lib/procurement/receipt-confirm-server"

// «أكّد الاستلام» — the receiver's confirmation IS the receipt (G-09, RCV-03). The code proves the phone (or, a member, his own
// sign-in); the count, the rejects with their reasons and the files then become the goods receipt in ONE server act: its GR number,
// the order's counters, the stock in the store, the books, the event of the unit that received it. Procurement records nothing.

const fail = (message: string, code: string, status: number, extra?: Record<string, unknown>) => NextResponse.json({ error: true, message, code, ...extra }, { status })

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

    // A member the delivery was forwarded to confirms with his own sign-in — no code (PUR-06); anyone else proves the named
    // mobile with the texted code. Either is the signature (question 3).
    let verifiedBy: ReceiverReport["verifiedBy"] = "sms_code"
    const header = req.headers.get("authorization") || ""
    const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
    const uid = idToken ? await getAdminAuth().verifyIdToken(idToken).then((d) => d.uid).catch(() => null) : null
    if (uid && link.receiver.userId && uid === link.receiver.userId) verifiedBy = "login"
    else {
      if (link.arrival) return fail("Sign in to count this shipment", "LOGIN_NEEDED", 401)
      if (!parsed.data.challengeId || !parsed.data.code) return fail("The code is needed", "CODE_NEEDED", 400)
      const verdict = await verifyOtp(db, parsed.data.challengeId, { purpose: "receipt_sign", subjectId: linkId }, parsed.data.code)
      if (verdict === "wrong") return fail("Wrong code", "WRONG_CODE", 400)
      if (verdict === "unavailable") return fail("The code could not be checked — try again", "CODE_UNCHECKED", 503)
      if (verdict !== "ok") return fail("The code has expired — ask for a new one", "CODE_EXPIRED", 410)
    }

    const result = await confirmReceipt(db, {
      deliveryId: link.deliveryId,
      arrivalPoId: link.arrival ? link.poId ?? null : null,
      linkId,
      receiver: { name: parsed.data.receiverName, userId: link.receiver.userId, phoneMasked: maskPhone(link.receiver.phone), via: verifiedBy },
      rows: report.lines,
      note: parsed.data.note,
      files: link.files || [],
      forwardedById: link.createdById,
    })

    return NextResponse.json({
      success: true,
      data: {
        deliveryId: result.deliveryId,
        docNumber: result.docNumber,
        module: result.place.module,
        placeName: result.print.placeName,
        stockLanded: result.stockLanded,
        print: result.print,
      },
    })
  } catch (error) {
    if (error instanceof ReceiptRefusal) {
      const first = error.errors[0]
      return fail(error.code, first ? first.code.toUpperCase() : error.code.toUpperCase(), error.status, first?.poLineId ? { poLineId: first.poLineId } : undefined)
    }
    console.error("Receipt confirm error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

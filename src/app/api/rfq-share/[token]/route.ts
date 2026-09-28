import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveShareToken, isRfqDeadlinePassed } from "@/lib/rfq-share"
import { canSendCodes } from "@/lib/sms"
import { answeredQueries, guestOtpRequired, shareLinkValidUntil, type InquiryDoc } from "@/lib/procurement/guest-supplier"

// Public endpoint: resolves a share token to the RFQ's display data so a
// guest supplier can review it without an account. Tokens are unguessable
// 32-byte hex strings, so no auth is required. Only non-sensitive display
// fields are returned — never internal budgets or contractor contact data.
// Answered queries go to every invitee (§5.1) — the question and the answer,
// never who asked.

const isUat = () => process.env.NEXT_PUBLIC_APP_ENV === "uat" || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "mdmaktech-uat"

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const resolution = await resolveShareToken(token)
    if (!resolution.ok) {
      return errorResponse("This link is invalid or has expired", resolution.code, resolution.status)
    }

    const { rfq, rfqId, link } = resolution

    // Resolve the contractor's public display name for the header card.
    let contractorName = ""
    try {
      const db = getAdminFirestore()
      const contractorSnap = await db.collection("users").doc(rfq.contractorId as string).get()
      const contractor = contractorSnap.data()
      contractorName = (contractor?.companyName as string) || (contractor?.name as string) || ""
    } catch {
      // Display-only — the page falls back to a generic label.
    }

    const deadlinePassed = isRfqDeadlinePassed(rfq)
    const canSubmit = rfq.status === "New" && !deadlinePassed

    let queries: ReturnType<typeof answeredQueries> = []
    try {
      const snap = await getAdminFirestore().collection("rfqs").doc(rfqId).collection("inquiries").limit(200).get()
      queries = answeredQueries(snap.docs.map((d) => d.data() as InquiryDoc))
    } catch (err) {
      console.error("RFQ share queries lookup failed:", err)
    }
    const attachments = Array.isArray(rfq.attachments)
      ? (rfq.attachments as Array<{ name?: unknown; url?: unknown }>)
          .filter((a) => typeof a?.url === "string")
          .map((a) => ({ name: typeof a.name === "string" ? a.name : "PDF", url: a.url as string }))
          .slice(0, 20)
      : []

    return NextResponse.json({
      success: true,
      data: {
        rfq: {
          id: rfqId,
          number: rfq.rfqNumber || null,
          title: rfq.title || "",
          category: rfq.category || null,
          subCategory: rfq.subCategory || null,
          city: rfq.city || null,
          district: rfq.district || null,
          deadline: rfq.deadline || null,
          products: Array.isArray(rfq.products)
            ? rfq.products.map((p: Record<string, unknown>) => ({
                name: p.name || "",
                description: p.description || null,
                subCategory: p.subCategory || null,
                quantity: p.quantity ?? null,
                unitOfMeasure: p.unitOfMeasure || null,
              }))
            : [],
          quantity: rfq.quantity ?? null,
          unitOfMeasure: rfq.unitOfMeasure || null,
          notes: rfq.notes || null,
          pdfUrl: rfq.pdfUrl || null,
          attachments,
          paymentTerms: rfq.paymentTerms || null,
          requiresWarranty: Boolean(rfq.requiresWarranty),
          shipmentMode: rfq.shipmentMode || null,
          pricingMode: rfq.pricingMode || null,
          locationCoords: rfq.locationCoords || null,
          status: rfq.status,
        },
        contractorName,
        linkExpiresAt: shareLinkValidUntil(link, rfq) || link.expiresAt,
        deadlinePassed,
        canSubmit,
        otpRequired: guestOtpRequired(canSendCodes(), isUat()),
        queries,
      },
    })
  } catch (err) {
    console.error("RFQ share lookup error:", err)
    return errorResponse("Failed to load this RFQ", "INTERNAL_ERROR", 500)
  }
}

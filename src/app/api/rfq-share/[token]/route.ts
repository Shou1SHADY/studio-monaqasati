import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveShareToken, isRfqDeadlinePassed } from "@/lib/rfq-share"

// Public endpoint: resolves a share token to the RFQ's display data so a
// guest supplier can review it without an account. Tokens are unguessable
// 32-byte hex strings, so no auth is required. Only non-sensitive display
// fields are returned — never internal budgets or contractor contact data.

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

    return NextResponse.json({
      success: true,
      data: {
        rfq: {
          id: rfqId,
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
          paymentTerms: rfq.paymentTerms || null,
          requiresWarranty: Boolean(rfq.requiresWarranty),
          shipmentMode: rfq.shipmentMode || null,
          locationCoords: rfq.locationCoords || null,
          status: rfq.status,
        },
        contractorName,
        linkExpiresAt: link.expiresAt,
        deadlinePassed,
        canSubmit,
      },
    })
  } catch (err) {
    console.error("RFQ share lookup error:", err)
    return errorResponse("Failed to load this RFQ", "INTERNAL_ERROR", 500)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveGuestOfferToken } from "@/lib/guest-offer"
import { guestOfferAvailability } from "@/utils/guest-offer-workflow"

// Public endpoint: resolves a guest offer token to everything the supplier
// needs to follow their offer through the workflow — current status, what the
// contractor asked for, and which actions are open to them right now. Tokens
// are unguessable 32-byte hex strings, so no auth is required; only the guest's
// own offer data and non-sensitive RFQ display fields are returned.

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const resolution = await resolveGuestOfferToken(token)
    if (!resolution.ok) {
      return errorResponse("This link is invalid or has expired", resolution.code, resolution.status)
    }

    const { offer, offerId, rfq } = resolution
    const db = getAdminFirestore()

    // Delivery notice for this offer, if the guest already sent one.
    let delivery: { status: string; deliveryPersonName: string; deliveryDate: string | null } | null = null
    try {
      const deliverySnap = await db
        .collection("deliveries")
        .where("offerId", "==", offerId)
        .limit(1)
        .get()
      if (!deliverySnap.empty) {
        const d = deliverySnap.docs[0].data()
        delivery = {
          status: (d.status as string) || "pending_confirmation",
          deliveryPersonName: (d.deliveryPersonName as string) || "",
          deliveryDate: (d.deliveryDate as string) || null,
        }
      }
    } catch (err) {
      console.error("Guest offer delivery lookup failed:", err)
    }

    let contractorName = ""
    try {
      if (offer.contractorId) {
        const contractorSnap = await db.collection("users").doc(offer.contractorId as string).get()
        const contractor = contractorSnap.data()
        contractorName = (contractor?.companyName as string) || (contractor?.name as string) || ""
      }
    } catch {
      // Display-only — the page falls back to a generic label.
    }

    const availability = guestOfferAvailability(
      { status: offer.status as string, sampleStatus: offer.sampleStatus as string },
      Boolean(delivery)
    )

    return NextResponse.json({
      success: true,
      data: {
        offer: {
          id: offerId,
          companyName: offer.companyName || offer.supplierName || "",
          contactName: (offer.guestContact as { name?: string } | undefined)?.name || "",
          price: offer.price ?? null,
          status: offer.status || "",
          sampleStatus: offer.sampleStatus || null,
          targetPrice: offer.targetPrice ?? null,
          reductionNote: offer.reductionNote || null,
          decidedAt: offer.decidedAt || null,
          sampleUpdatedAt: offer.sampleUpdatedAt || null,
          deliveryLocation: offer.deliveryLocation || "",
          executionDuration: offer.executionDuration || null,
          executionDurationUnit: offer.executionDurationUnit || null,
          offerPdfUrl: offer.offerPdfUrl || null,
          guestReplyNote: offer.guestReplyNote || null,
          priceHistory: Array.isArray(offer.priceHistory) ? offer.priceHistory : [],
          createdAt: offer.createdAt || null,
        },
        rfq: rfq
          ? {
              title: rfq.title || "",
              city: rfq.city || null,
              deadline: rfq.deadline || null,
              notes: rfq.notes || null,
              pdfUrl: rfq.pdfUrl || null,
              products: Array.isArray(rfq.products)
                ? rfq.products.map((p: Record<string, unknown>) => ({
                    name: p.name || "",
                    quantity: p.quantity ?? null,
                    unitOfMeasure: p.unitOfMeasure || null,
                  }))
                : [],
              quantity: rfq.quantity ?? null,
              unitOfMeasure: rfq.unitOfMeasure || null,
            }
          : null,
        contractorName,
        delivery,
        availability,
      },
    })
  } catch (err) {
    console.error("Guest offer lookup error:", err)
    return errorResponse("Failed to load this offer", "INTERNAL_ERROR", 500)
  }
}

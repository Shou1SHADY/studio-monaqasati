import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { guestVisibleStatus, resolveGuestOfferToken } from "@/lib/guest-offer"
import { guestOfferAvailability } from "@/utils/guest-offer-workflow"
import { answeredQueries, mergeGuestPapers, type GuestPaper, type InquiryDoc } from "@/lib/procurement/guest-supplier"
import { orderUrlOf } from "@/lib/procurement/visitor-order-link"
import { OFFER_STATUS } from "@/utils/guest-offer-workflow"

// Public endpoint: resolves a guest offer token to everything the supplier
// needs to follow their offer through the workflow — current status, what the
// contractor asked for, and which actions are open to them right now. Tokens
// are unguessable (128 random bits), so no auth is required; only the guest's
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

    // The answers every invitee receives (§5.1) — question and answer, never who asked.
    let queries: ReturnType<typeof answeredQueries> = []
    if (offer.rfqId) {
      try {
        const snap = await db.collection("rfqs").doc(offer.rfqId as string).collection("inquiries").limit(200).get()
        queries = answeredQueries(snap.docs.map((d) => d.data() as InquiryDoc))
      } catch (err) {
        console.error("Guest offer queries lookup failed:", err)
      }
    }

    // What the guest may see of an award: nothing until its order is sent.
    const shownStatus = await guestVisibleStatus(db, offer)

    // Awarded with its order sent: the order's own link, where the delivery is reported in 2.0 (VL-01). None → the legacy form.
    let orderUrl: string | null = null
    if (shownStatus === OFFER_STATUS.accepted && typeof offer.poId === "string") {
      orderUrl = await orderUrlOf(db, offer.poId).catch((err) => {
        console.error("Guest offer order link failed:", err)
        return null
      })
    }

    const availability = guestOfferAvailability(
      { status: shownStatus, sampleStatus: offer.sampleStatus as string },
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
          status: shownStatus,
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
          // Their own rates, so a per-material quote is revised per material.
          lines: Array.isArray(offer.lines) ? offer.lines : [],
          createdAt: offer.createdAt || null,
          vatNumber: (offer.guestContact as { vatNumber?: string } | undefined)?.vatNumber || null,
          phoneVerified: Boolean((offer.guestContact as { phoneVerified?: boolean } | undefined)?.phoneVerified),
          papers: mergeGuestPapers(offer.guestPapers as GuestPaper[] | undefined, []).map((p) => ({ kind: p.kind, name: p.name, at: p.at })),
        },
        queries,
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
        orderUrl,
        availability,
      },
    })
  } catch (err) {
    console.error("Guest offer lookup error:", err)
    return errorResponse("Failed to load this offer", "INTERNAL_ERROR", 500)
  }
}

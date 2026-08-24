import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authorizeContractorForOffer, ensureGuestOfferLink } from "@/lib/guest-offer"
import { resolveNotifyChannel } from "@/utils/guest-offer-workflow"

// Contractor-authenticated: returns the private follow-up link for a guest
// offer, along with the channel the RFQ was originally shared on, so the portal
// can offer WhatsApp / email in the right order. Mints the link for offers
// submitted before the follow-up flow existed.

const bodySchema = z.object({
  offerId: z.string().trim().min(1).max(128),
})

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) return errorResponse("A valid offer id is required", "INVALID_INPUT", 400)

    const auth = await authorizeContractorForOffer(req.headers.get("authorization"), parsed.data.offerId)
    if (!auth.ok) return errorResponse(auth.message, auth.code, auth.status)

    const link = await ensureGuestOfferLink(auth.offerId, auth.offer)
    const channel = resolveNotifyChannel(link.channel, {
      hasPhone: Boolean(link.phone),
      hasEmail: Boolean(link.email),
    })

    return NextResponse.json({
      success: true,
      data: {
        url: link.url,
        // The channel the RFQ was shared on, and the one actually usable now.
        sharedChannel: link.channel,
        channel,
        email: link.email,
        phone: link.phone,
      },
    })
  } catch (err) {
    console.error("Guest offer link error:", err)
    return errorResponse("Failed to prepare the supplier link", "INTERNAL_ERROR", 500)
  }
}

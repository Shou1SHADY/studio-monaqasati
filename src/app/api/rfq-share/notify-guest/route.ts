import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  authorizeContractorForOffer,
  ensureGuestOfferLink,
  recordGuestNotification,
} from "@/lib/guest-offer"
import { sendEmail, buildGuestOfferEventEmail } from "@/lib/email"
import { GUEST_OFFER_EVENTS, normalizeGuestChannel } from "@/utils/guest-offer-workflow"

// Contractor-authenticated: pushes an RFQ workflow event (reduction request,
// sample request, award, ...) out to a guest supplier who has no account.
// Email is sent here; WhatsApp can only be opened from the contractor's own
// browser, so for that channel this call just records the event and the portal
// opens wa.me with the prefilled message.

const bodySchema = z.object({
  offerId: z.string().trim().min(1).max(128),
  event: z.enum(GUEST_OFFER_EVENTS as unknown as [string, ...string[]]),
  channel: z.enum(["whatsapp", "email", "link"]),
  note: z.string().trim().max(1000).optional(),
  targetPrice: z.coerce.number().positive().finite().optional(),
})

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) return errorResponse("Invalid notification request", "INVALID_INPUT", 400)
    const { offerId, event, channel, note, targetPrice } = parsed.data

    const auth = await authorizeContractorForOffer(req.headers.get("authorization"), offerId)
    if (!auth.ok) return errorResponse(auth.message, auth.code, auth.status)

    const link = await ensureGuestOfferLink(auth.offerId, auth.offer)
    const resolvedChannel = normalizeGuestChannel(channel)

    let emailSent = false
    if (resolvedChannel === "email") {
      if (!link.email) return errorResponse("This supplier left no email address", "NO_EMAIL", 409)
      const { subject, html } = buildGuestOfferEventEmail({
        event: event as Parameters<typeof buildGuestOfferEventEmail>[0]["event"],
        contractorName: auth.contractorName,
        rfqTitle: (auth.offer.rfqTitle as string) || "",
        offerUrl: link.url,
        targetPrice: targetPrice ?? null,
        note: note ?? null,
      })
      const result = await sendEmail({ to: link.email, subject, html })
      emailSent = result.sent
      if (!emailSent) {
        return errorResponse("The email could not be delivered", result.error || "EMAIL_FAILED", 502)
      }
    }

    await recordGuestNotification(link.linkId, event, resolvedChannel)

    return NextResponse.json({
      success: true,
      data: { channel: resolvedChannel, emailSent, url: link.url },
    })
  } catch (err) {
    console.error("Notify guest supplier error:", err)
    return errorResponse("Failed to notify the supplier", "INTERNAL_ERROR", 500)
  }
}

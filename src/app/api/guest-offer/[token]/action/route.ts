import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminFirestore, getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { resolveGuestOfferToken, notifyContractor } from "@/lib/guest-offer"
import {
  isGuestActionAllowed,
  isGuestOfferAction,
  OFFER_STATUS,
  SAMPLE_STATUS,
} from "@/utils/guest-offer-workflow"

// Public endpoint: a guest supplier (no account) advances the RFQ workflow from
// their private offer link — submitting a revised price after a reduction
// request, confirming a requested sample was sent, or filing a delivery notice
// once their offer is awarded. Each action mirrors exactly what a registered
// supplier would do in the portal, including the contractor's notification.

const MAX_PDF_BYTES = 10 * 1024 * 1024

const revisePriceSchema = z.object({
  price: z.coerce.number().positive().finite(),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
})

const sampleSentSchema = z.object({
  note: z.string().trim().max(1000).optional().or(z.literal("")),
})

const deliveryNoticeSchema = z.object({
  deliveryPersonName: z.string().trim().min(2).max(200),
  deliveryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  handoverRecipientName: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
})

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

function formValues(form: FormData, keys: string[]): Record<string, string> {
  const raw: Record<string, string> = {}
  for (const key of keys) {
    const value = form.get(key)
    if (typeof value === "string") raw[key] = value
  }
  return raw
}

async function uploadGuestPdf(file: File): Promise<string> {
  const bucket = getAdminStorage().bucket(getStorageBucketName())
  const safeName = (file.name || "offer.pdf").replace(/[^\w.\-]+/g, "_").slice(-100)
  const objectPath = `offers/pdfs/guest/${Date.now()}-${safeName}`
  const downloadToken = randomUUID()
  const buffer = Buffer.from(await file.arrayBuffer())
  await bucket.file(objectPath).save(buffer, {
    contentType: "application/pdf",
    metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } },
  })
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const resolution = await resolveGuestOfferToken(token)
    if (!resolution.ok) {
      return errorResponse("This link is invalid or has expired", resolution.code, resolution.status)
    }
    const { offer, offerId, rfq } = resolution

    const form = await req.formData().catch(() => null)
    if (!form) return errorResponse("Invalid form submission", "INVALID_INPUT", 400)

    const action = form.get("action")
    if (!isGuestOfferAction(action)) {
      return errorResponse("Unknown action", "INVALID_ACTION", 400)
    }

    const db = getAdminFirestore()

    // Delivery state gates the "send delivery notice" action.
    const deliverySnap = await db.collection("deliveries").where("offerId", "==", offerId).limit(1).get()
    const hasDeliveryNotice = !deliverySnap.empty

    if (
      !isGuestActionAllowed(
        action,
        { status: offer.status as string, sampleStatus: offer.sampleStatus as string },
        hasDeliveryNotice
      )
    ) {
      return errorResponse("This action is no longer available for this offer", "ACTION_NOT_ALLOWED", 409)
    }

    const nowIso = new Date().toISOString()
    const offerRef = db.collection("offers").doc(offerId)
    const rfqTitle = (offer.rfqTitle as string) || (rfq?.title as string) || ""
    const contractorId = (offer.contractorId as string) || null
    const contractorOrgId = (offer.contractorOrgId as string) || contractorId
    const supplierName = (offer.companyName as string) || (offer.supplierName as string) || "المورد"

    // --- Revised price after a reduction request ---
    if (action === "revise_price") {
      const parsed = revisePriceSchema.safeParse(formValues(form, ["price", "note"]))
      if (!parsed.success) return errorResponse("Please enter a valid price", "INVALID_INPUT", 400)
      const { price, note } = parsed.data

      const previousPrice = String(offer.price ?? "")
      let offerPdfUrl: string | null = null
      const pdf = form.get("pdf")
      if (pdf && pdf instanceof File && pdf.size > 0) {
        if (pdf.type !== "application/pdf") {
          return errorResponse("Attachment must be a PDF file", "INVALID_PDF", 400)
        }
        if (pdf.size > MAX_PDF_BYTES) {
          return errorResponse("PDF must be 10MB or smaller", "PDF_TOO_LARGE", 400)
        }
        offerPdfUrl = await uploadGuestPdf(pdf)
      }

      const update: Record<string, unknown> = {
        price: String(price),
        // Back into the contractor's queue, exactly like a registered
        // supplier's price update.
        status: OFFER_STATUS.pending,
        updatedAt: nowIso,
        revisedAt: nowIso,
        readAt: null,
        guestReplyNote: note || null,
        priceHistory: FieldValue.arrayUnion({
          price: previousPrice,
          replacedAt: nowIso,
          by: "guest",
        }),
      }
      if (offerPdfUrl) update.offerPdfUrl = offerPdfUrl
      await offerRef.update(update)

      await notifyContractor({
        contractorId,
        organizationId: contractorOrgId,
        type: "price_updated",
        title: "💰 قام المورد بتحديث سعر عرضه",
        message: `قام المورد ${supplierName} بتحديث سعر عرضه عبر رابط المشاركة لطلب عروض الأسعار: ${rfqTitle}. السعر الجديد: ${price.toLocaleString("ar-SA")} ر.س${note ? `\nملاحظة المورد: ${note}` : ""}`,
        offerId,
        rfqId: (offer.rfqId as string) || null,
        rfqTitle,
      })

      return NextResponse.json({ success: true, data: { action, price: String(price) } })
    }

    // --- Sample sent ---
    if (action === "sample_sent") {
      const parsed = sampleSentSchema.safeParse(formValues(form, ["note"]))
      if (!parsed.success) return errorResponse("Please review the submitted fields", "INVALID_INPUT", 400)
      const { note } = parsed.data

      await offerRef.update({
        sampleStatus: SAMPLE_STATUS.sent,
        sampleUpdatedAt: nowIso,
        guestReplyNote: note || null,
      })

      await notifyContractor({
        contractorId,
        organizationId: contractorOrgId,
        type: "sample_sent",
        title: "📦 تم إرسال العينة من المورد",
        message: `قام المورد ${supplierName} بإرسال العينة لطلب عروض الأسعار: ${rfqTitle}. يرجى تأكيد الاستلام.${note ? `\nملاحظة المورد: ${note}` : ""}`,
        offerId,
        rfqId: (offer.rfqId as string) || null,
        rfqTitle,
      })

      return NextResponse.json({ success: true, data: { action } })
    }

    // --- Delivery notice on an awarded offer ---
    const parsed = deliveryNoticeSchema.safeParse(
      formValues(form, ["deliveryPersonName", "deliveryDate", "handoverRecipientName", "notes"])
    )
    if (!parsed.success) return errorResponse("Please review the submitted fields", "INVALID_INPUT", 400)
    const { deliveryPersonName, deliveryDate, handoverRecipientName, notes } = parsed.data

    await db.collection("deliveries").add({
      rfqId: (offer.rfqId as string) || null,
      offerId,
      projectId: (offer.projectId as string) || null,
      contractorOrgId,
      contractorId,
      // Guests have no organization — flagged so the contractor UI can tell
      // this notice came in through a share link.
      supplierOrgId: "guest",
      supplierId: "guest",
      supplierName,
      isGuestDelivery: true,
      deliveryPersonName,
      handoverRecipientName: handoverRecipientName || null,
      deliveryDate: new Date(deliveryDate).toISOString(),
      notes: notes || null,
      rfqTitle,
      items: Array.isArray(rfq?.products) ? rfq!.products : [],
      status: "pending_confirmation",
      createdAt: FieldValue.serverTimestamp(),
    })

    await notifyContractor({
      contractorId,
      organizationId: contractorOrgId,
      type: "delivery_notice",
      title: "🚚 إشعار تسليم جديد",
      message: `قام المورد ${supplierName} بإرسال إشعار تسليم عبر رابط المشاركة لطلب عروض الأسعار: ${rfqTitle}`,
      offerId,
      rfqId: (offer.rfqId as string) || null,
      rfqTitle,
    })

    return NextResponse.json({ success: true, data: { action } })
  } catch (err) {
    console.error("Guest offer action error:", err)
    return errorResponse("Failed to complete this action", "INTERNAL_ERROR", 500)
  }
}

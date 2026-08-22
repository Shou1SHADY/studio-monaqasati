import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminFirestore, getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { resolveShareToken, isRfqDeadlinePassed } from "@/lib/rfq-share"

// Public endpoint: a guest supplier (no account) submits a price offer on an
// RFQ through a valid share link. The offer lands in the same `offers`
// collection the contractor already reads, flagged with isGuestOffer +
// guestContact so it can be told apart from registered-supplier offers.

const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_OFFERS_PER_LINK = 100

const fieldsSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  contactName: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z
    .string()
    .trim()
    .min(7)
    .max(20)
    .regex(/^[+\d][\d\s-]+$/, "Invalid phone number"),
  price: z.coerce.number().positive().finite(),
  deliveryLocation: z.string().trim().max(300).optional().or(z.literal("")),
  deliveryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  executionDuration: z.string().trim().max(10).optional().or(z.literal("")),
  executionDurationUnit: z.string().trim().max(20).optional().or(z.literal("")),
  website: z.string().trim().max(300).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
})

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const resolution = await resolveShareToken(token)
    if (!resolution.ok) {
      return errorResponse("This link is invalid or has expired", resolution.code, resolution.status)
    }
    const { link, linkId, rfq, rfqId } = resolution

    if (rfq.status !== "New") {
      return errorResponse("This RFQ is no longer accepting offers", "RFQ_CLOSED", 409)
    }
    if (isRfqDeadlinePassed(rfq)) {
      return errorResponse("The RFQ deadline has passed", "DEADLINE_PASSED", 409)
    }
    if ((Number(link.offersSubmitted) || 0) >= MAX_OFFERS_PER_LINK) {
      return errorResponse("This link has reached its offer limit", "LINK_OFFER_LIMIT", 429)
    }

    // --- Parse + validate multipart form data ---
    const form = await req.formData().catch(() => null)
    if (!form) return errorResponse("Invalid form submission", "INVALID_INPUT", 400)

    const raw: Record<string, string> = {}
    for (const key of [
      "companyName",
      "contactName",
      "email",
      "phone",
      "price",
      "deliveryLocation",
      "deliveryDate",
      "executionDuration",
      "executionDurationUnit",
      "website",
      "message",
    ]) {
      const v = form.get(key)
      if (typeof v === "string") raw[key] = v
    }
    const parsed = fieldsSchema.safeParse(raw)
    if (!parsed.success) {
      return errorResponse("Please review the submitted fields", "INVALID_INPUT", 400)
    }
    const data = parsed.data

    const db = getAdminFirestore()

    // One offer per email per RFQ — a guest resending the form shouldn't
    // flood the contractor with duplicates.
    const dup = await db
      .collection("offers")
      .where("rfqId", "==", rfqId)
      .where("guestContact.email", "==", data.email)
      .limit(1)
      .get()
    if (!dup.empty) {
      return errorResponse("An offer from this email already exists for this RFQ", "DUPLICATE_OFFER", 409)
    }

    // --- Optional PDF attachment (uploaded server-side with the Admin SDK,
    //     since guests have no Firebase Auth session for client Storage) ---
    let offerPdfUrl: string | null = null
    const pdf = form.get("pdf")
    if (pdf && pdf instanceof File && pdf.size > 0) {
      if (pdf.type !== "application/pdf") {
        return errorResponse("Attachment must be a PDF file", "INVALID_PDF", 400)
      }
      if (pdf.size > MAX_PDF_BYTES) {
        return errorResponse("PDF must be 10MB or smaller", "PDF_TOO_LARGE", 400)
      }
      const bucket = getAdminStorage().bucket(getStorageBucketName())
      const safeName = (pdf.name || "offer.pdf").replace(/[^\w.\-]+/g, "_").slice(-100)
      const objectPath = `offers/pdfs/guest/${Date.now()}-${safeName}`
      const downloadToken = randomUUID()
      const buffer = Buffer.from(await pdf.arrayBuffer())
      await bucket.file(objectPath).save(buffer, {
        contentType: "application/pdf",
        metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } },
      })
      offerPdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`
    }

    // --- Create the offer, mirroring the registered-supplier offer shape ---
    const requiredQuantity = Array.isArray(rfq.products) && rfq.products.length > 0
      ? rfq.products.reduce((sum: number, p: Record<string, unknown>) => sum + (Number(p.quantity) || 0), 0)
      : Number(rfq.quantity) || 0

    const nowIso = new Date().toISOString()
    const priceStr = String(data.price)
    const offerData: Record<string, unknown> = {
      supplierId: "guest",
      organizationId: "guest",
      supplierName: data.companyName,
      companyName: data.companyName,
      supplierWebsite: data.website || null,
      submittedByUserId: null,
      submittedByUserName: data.contactName,
      rfqId,
      rfqTitle: rfq.title || "",
      projectId: rfq.projectId || null,
      contractorId: rfq.contractorId || null,
      contractorOrgId: rfq.organizationId || rfq.contractorId || null,
      price: priceStr,
      deliveryLocation: data.deliveryLocation || "",
      deliveryBatches: [
        {
          location: data.deliveryLocation || "",
          deliveryDate: data.deliveryDate || "",
          price: priceStr,
          quantity: String(requiredQuantity || ""),
        },
      ],
      status: "قيد المراجعة",
      isGuestOffer: true,
      guestContact: {
        name: data.contactName,
        email: data.email,
        phone: data.phone,
      },
      guestMessage: data.message || null,
      shareLinkId: linkId,
      createdAt: nowIso,
    }
    if (data.executionDuration) {
      offerData.executionDuration = data.executionDuration
      offerData.executionDurationUnit = data.executionDurationUnit || "أيام"
    }
    if (offerPdfUrl) offerData.offerPdfUrl = offerPdfUrl

    const offerRef = await db.collection("offers").add(offerData)

    // --- Bookkeeping + contractor notification (best effort) ---
    await db
      .collection("rfqShareLinks")
      .doc(linkId)
      .update({ offersSubmitted: FieldValue.increment(1), lastOfferAt: nowIso })
      .catch((err) => console.error("Failed to bump share-link counter:", err))

    await db
      .collection("rfqs")
      .doc(rfqId)
      .update({ offersCount: FieldValue.increment(1) })
      .catch((err) => console.error("Failed to bump offersCount:", err))

    if (rfq.contractorId) {
      await db
        .collection("users")
        .doc(rfq.contractorId as string)
        .collection("notifications")
        .add({
          userId: rfq.contractorId,
          organizationId: rfq.organizationId || rfq.contractorId,
          type: "new_offer",
          title: "عرض سعر جديد عبر رابط المشاركة",
          message: `قدم المورد ${data.companyName} عرضاً بمبلغ ${data.price.toLocaleString("ar-SA")} ر.س عبر رابط المشاركة على طلب عروض الأسعار: ${rfq.title || ""}`,
          offerId: offerRef.id,
          rfqId,
          createdAt: nowIso,
          read: false,
        })
        .catch((err) => console.error("Failed to create guest-offer notification:", err))
    }

    return NextResponse.json({ success: true, data: { offerId: offerRef.id } })
  } catch (err) {
    console.error("RFQ share guest offer error:", err)
    return errorResponse("Failed to submit the offer", "INTERNAL_ERROR", 500)
  }
}

import { SAUDI_VAT_RE } from "@/lib/procurement/rfq-form"
import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { parseOfferTerms } from "@/lib/procurement/offer-terms"
import { faultNames, pricedProducts } from "@/lib/procurement/offer-pricing"
import { buildQuote, leadDaysFrom, leadDaysRefusal, versionFromQuote, type QuoteRfq } from "@/lib/procurement/offer-versions"
import { rfqOfferKey } from "@/lib/procurement/event-keys"
import { rfqKeyPart, sendProcEvent } from "@/lib/procurement/proc-event-server"
import { unitPriceSchema } from "@/lib/procurement/input-limits"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminFirestore, getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { resolveShareToken, isRfqDeadlinePassed } from "@/lib/rfq-share"
import { createGuestOfferLink } from "@/lib/guest-offer"
import { sendEmail, buildGuestOfferReceiptEmail } from "@/lib/email"
import { normalizeGuestChannel } from "@/utils/guest-offer-workflow"
import { offersSealed } from "@/lib/procurement/award"
import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"
import { resolvePolicies } from "@/lib/procurement/policies"
import type { ProcurementPolicies } from "@/lib/procurement/types"
import { verifyOtp } from "@/lib/otp"
import { riyadhDay } from "@/lib/hr/format"
import { guestValidityDefault, saudiMobileE164 } from "@/lib/supplier-free/phone-auth"
import { canSendCodes } from "@/lib/sms"
import { consumeMobileRate } from "@/lib/links/rate"
import { openLinkSession } from "@/lib/links/session"
import {
  GUEST_PAPER_KINDS,
  guestOtpRequired,
  guestOtpSubject,
  guestPaperPath,
  guestPaperRefusal,
  type GuestPaper,
} from "@/lib/procurement/guest-supplier"

// Public endpoint: a guest supplier (no account) submits a price offer on an
// RFQ through a valid share link. The offer lands in the same `offers`
// collection the contractor already reads, flagged with isGuestOffer +
// guestContact so it can be told apart from registered-supplier offers.
// The mobile is proven by a one-time code (`/code`) whenever the platform can
// send one; the guest's papers (CR, VAT certificate) are stored under the link.

const isUat = () => process.env.NEXT_PUBLIC_APP_ENV === "uat" || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "mdmaktech-uat"

const otpSchema = z.object({
  challengeId: z.string().trim().min(1).max(128),
  code: z.string().trim().regex(/^\d{6}$/),
})

const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_OFFERS_PER_LINK = 100

/** Per-material rates, when the RFQ asked to be quoted that way (PRD §4). They
 * arrive as one JSON field because the rest of the form is flat strings; the
 * TOTAL is computed from them below and a posted total is ignored. */
const linesSchema = z
  .array(
    z.object({
      rfqProductIndex: z.coerce.number().int().min(0).max(999),
      unitPrice: unitPriceSchema,
      // The sale unit he priced by («قطعة 6 م»), as its length in request units, and the warranty he offers on the line.
      packLen: z.coerce.number().positive().finite().max(1000).optional(),
      warrantyMonths: z.coerce.number().int().min(0).max(120).optional(),
    })
  )
  .max(200)

/** The materials he says he does not supply (PUR-03): a line is priced or marked here, never blank. */
const skippedSchema = z.array(z.coerce.number().int().min(0).max(999)).max(200)

// Three things are required of a visitor (LNK-01, B-12): the prices, the company name and a Saudi mobile
// (05XXXXXXXX or +9665XXXXXXXX, stored as E.164). The contact name and the e-mail are his to give or not.
const fieldsSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  contactName: z.string().trim().max(200).optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => saudiMobileE164(v) != null, "Invalid Saudi mobile"),
  price: unitPriceSchema,
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
  // R-10: without it Finance cannot accept his invoice — asked, never required.
  vatNumber: z.string().trim().regex(SAUDI_VAT_RE, "Invalid VAT number").optional().or(z.literal("")),
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
      "vatNumber",
      "priceBasis",
      "validUntil",
      "advancePercent",
      "creditDays",
      "challengeId",
      "code",
      "whole",
      "vatRegistered",
    ]) {
      const v = form.get(key)
      if (typeof v === "string") raw[key] = v
    }
    const ratesField = form.get("lines")
    let postedRates: Array<{ rfqProductIndex: number; unitPrice: number; packLen?: number; warrantyMonths?: number }> = []
    if (typeof ratesField === "string" && ratesField.trim()) {
      let decoded: unknown = null
      try {
        decoded = JSON.parse(ratesField)
      } catch {
        return errorResponse("Invalid form submission", "INVALID_INPUT", 400)
      }
      const parsedRates = linesSchema.safeParse(decoded)
      if (!parsedRates.success) return errorResponse("Please review the prices you entered", "INVALID_INPUT", 400)
      postedRates = parsedRates.data
    }
    const skippedField = form.get("skipped")
    let postedSkipped: number[] = []
    if (typeof skippedField === "string" && skippedField.trim()) {
      let decoded: unknown = null
      try {
        decoded = JSON.parse(skippedField)
      } catch {
        return errorResponse("Invalid form submission", "INVALID_INPUT", 400)
      }
      const parsedSkipped = skippedSchema.safeParse(decoded)
      if (!parsedSkipped.success) return errorResponse("Please review the prices you entered", "INVALID_INPUT", 400)
      postedSkipped = parsedSkipped.data
    }

    const parsed = fieldsSchema.safeParse(raw)
    if (!parsed.success) {
      return errorResponse("Please review the submitted fields", "INVALID_INPUT", 400)
    }
    const data = parsed.data
    const phoneE164 = saudiMobileE164(data.phone) as string
    const email = data.email || ""
    const contactName = data.contactName || ""
    const otpNeeded = guestOtpRequired(canSendCodes(), isUat())
    const otp = otpNeeded ? otpSchema.safeParse({ challengeId: raw.challengeId, code: raw.code }) : null
    if (otp && !otp.success) return errorResponse("Verify your mobile number first", "CODE_REQUIRED", 400)

    // Papers are checked before anything is stored or any code is spent.
    const papers: Array<{ kind: (typeof GUEST_PAPER_KINDS)[number]; file: File }> = []
    for (const kind of GUEST_PAPER_KINDS) {
      const f = form.get(`paper_${kind}`)
      if (!(f instanceof File) || f.size === 0) continue
      const refusal = guestPaperRefusal(f)
      if (refusal) return errorResponse("Papers must be PDF, JPG or PNG files of 5MB or less", refusal === "size" ? "PAPER_TOO_LARGE" : "INVALID_PAPER", 400)
      papers.push({ kind, file: f })
    }

    const db = getAdminFirestore()

    const rate = await consumeMobileRate(db, "write", phoneE164)
    if (!rate.ok) {
      const res = errorResponse(rate.code === "RATE_LIMITED" ? "Too many submissions from this number — try again later" : "Offers cannot be received right now — try again later", rate.code, rate.status)
      if (rate.code === "RATE_LIMITED") res.headers.set("Retry-After", String(rate.retryAfterSec))
      return res
    }

    // One offer per mobile per RFQ — the mobile is the one thing every visitor gives, so a resent form
    // never floods the contractor with duplicates.
    const dup = await db
      .collection("offers")
      .where("rfqId", "==", rfqId)
      .where("guestContact.phone", "==", phoneE164)
      .limit(1)
      .get()
    if (!dup.empty) {
      return errorResponse("An offer from this mobile already exists for this RFQ", "DUPLICATE_OFFER", 409)
    }

    if (otp?.success && phoneE164) {
      const verdict = await verifyOtp(db, otp.data.challengeId, { purpose: "guest_offer", subjectId: guestOtpSubject(linkId, phoneE164) }, otp.data.code)
      if (verdict === "wrong") return errorResponse("Wrong code", "WRONG_CODE", 400)
      if (verdict === "unavailable") return errorResponse("The code could not be checked — try again", "CODE_UNCHECKED", 503)
      if (verdict !== "ok") return errorResponse("The code has expired — ask for a new one", "CODE_EXPIRED", 410)
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

    const offerRef = db.collection("offers").doc()
    const guestPapers: GuestPaper[] = []
    if (papers.length) {
      const bucket = getAdminStorage().bucket(getStorageBucketName())
      const stamp = Date.now()
      for (const { kind, file } of papers) {
        const objectPath = guestPaperPath(linkId, offerRef.id, kind, file.name, stamp)
        const downloadToken = randomUUID()
        await bucket.file(objectPath).save(Buffer.from(await file.arrayBuffer()), {
          contentType: file.type,
          metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } },
        })
        guestPapers.push({
          kind,
          name: file.name || kind,
          url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`,
          contentType: file.type,
          size: file.size,
          at: new Date().toISOString(),
        })
      }
    }

    // --- Create the offer, mirroring the registered-supplier offer shape ---
    const requiredQuantity = Array.isArray(rfq.products) && rfq.products.length > 0
      ? rfq.products.reduce((sum: number, p: Record<string, unknown>) => sum + (Number(p.quantity) || 0), 0)
      : Number(rfq.quantity) || 0

    const nowIso = new Date().toISOString()

    // A line-priced RFQ is quoted per material — by the request unit or by a sale unit the line offers — and its total is
    // OURS to compute (`buildQuote`, through offer-calc): an endpoint that believed a posted figure would let a guest name any
    // total it liked beside its rates. «غير مسجّل ضريبياً» and «للطلب كاملاً فقط» are his to say.
    const built = buildQuote(rfq as QuoteRfq, { lines: postedRates, skipped: postedSkipped, total: data.price, whole: raw.whole === "true" }, { registered: raw.vatRegistered !== "false" })
    if (!built.ok) {
      const named = faultNames(pricedProducts(rfq as QuoteRfq), built.refusal.indexes)
      return errorResponse(`${built.refusal.code === "line_prices_incomplete" || built.refusal.code === "line_contradictory" || built.refusal.code === "no_line_priced" ? "Give a price for every material you supply, and mark the rest as not supplied" : "Please review the prices you entered"}${named ? `: ${named}` : ""}`, built.refusal.code.toUpperCase(), 400)
    }
    const quote = built.quote
    const total = quote.total
    const priceStr = String(total)
    const pricedLines = quote.mode === "line" ? quote.lines : null
    const skippedItems = quote.skipped.length ? quote.skipped : null
    const lead = leadDaysFrom(data.executionDuration, data.executionDurationUnit)
    if (leadDaysRefusal(lead)) return errorResponse("The duration is a whole number of days from 1 to 365", "INVALID_DURATION", 400)
    const offerData: Record<string, unknown> = {
      supplierId: "guest",
      organizationId: "guest",
      supplierName: data.companyName,
      companyName: data.companyName,
      supplierWebsite: data.website || null,
      submittedByUserId: null,
      submittedByUserName: contactName || data.companyName,
      rfqId,
      rfqTitle: rfq.title || "",
      projectId: rfq.projectId || null,
      contractorId: rfq.contractorId || null,
      contractorOrgId: rfq.organizationId || rfq.contractorId || null,
      price: priceStr,
      ...(pricedLines ? { lines: pricedLines } : {}),
      ...(skippedItems ? { skippedItems } : {}),
      ...(quote.lump != null ? { lump: quote.lump } : {}),
      whole: quote.whole,
      vatRegistered: quote.vatRegistered,
      vatRate: quote.vatRate,
      ...(lead != null ? { leadDays: lead } : {}),
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
        name: contactName,
        email,
        phone: phoneE164,
        vatNumber: data.vatNumber || null,
        phoneVerified: Boolean(otp?.success),
        ...(otp?.success ? { phoneVerifiedAt: nowIso } : {}),
      },
      ...(guestPapers.length ? { guestPapers } : {}),
      guestMessage: data.message || null,
      shareLinkId: linkId,
      // The channel the contractor shared on — the rest of the workflow pushes
      // updates back to this guest on the same channel.
      guestChannel: normalizeGuestChannel(link.channel),
      createdAt: nowIso,
    }
    // The offer's commercial terms (R-16) — the same parser as the portal's dialog.
    const parsedTerms = parseOfferTerms({ priceBasis: raw.priceBasis, validUntil: raw.validUntil || guestValidityDefault(rfq.deadline as string | null), advancePercent: raw.advancePercent, creditDays: raw.creditDays }, riyadhDay())
    if (parsedTerms.error) return errorResponse("Invalid offer terms", "INVALID_INPUT", 400)
    Object.assign(offerData, parsedTerms.terms)
    if (data.executionDuration) {
      offerData.executionDuration = data.executionDuration
      offerData.executionDurationUnit = data.executionDurationUnit || "أيام"
    }
    if (offerPdfUrl) offerData.offerPdfUrl = offerPdfUrl
    // Born as version 1: every later edit, from any door, is the next one and keeps this (G-15).
    offerData.versions = [versionFromQuote(quote, { at: riyadhDay(), arrive: data.deliveryDate || null, valid: String(offerData.validUntil || ""), note: data.message || "", fileUrl: offerPdfUrl, leadDays: lead, by: "guest", n: 1 })]
    offerData.rev = 1

    await offerRef.set(offerData)

    // --- Private follow-up link: the guest's own page for the rest of the
    //     workflow (revised prices, sample confirmation, delivery notice) ---
    let offerUrl: string | null = null
    try {
      const guestLink = await createGuestOfferLink({
        offerId: offerRef.id,
        rfqId,
        rfqTitle: (rfq.title as string) || "",
        contractorId: (rfq.contractorId as string) || null,
        organizationId: (rfq.organizationId as string) || (rfq.contractorId as string) || null,
        shareLinkId: linkId,
        channel: link.channel,
        email,
        phone: phoneE164,
      })
      offerUrl = guestLink.url
      await offerRef.update({ guestOfferLinkId: guestLink.linkId }).catch(() => {})
    } catch (err) {
      console.error("Failed to create guest offer link:", err)
    }

    // A receipt e-mail doubles as delivery of that link, when he left an address
    // (the page also hands him the link on screen).
    if (offerUrl && email) {
      const { subject, html } = buildGuestOfferReceiptEmail({
        companyName: data.companyName,
        rfqTitle: (rfq.title as string) || "",
        price: total,
        offerUrl,
      })
      await sendEmail({ to: email, subject, html }).catch((err) =>
        console.error("Failed to send guest offer receipt:", err)
      )
    }

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

    await sendProcEvent(db, { id: "rfq_offer", key: rfqOfferKey(rfqKeyPart(rfq, rfqId), offerRef.id, 1), organizationId: (rfq.organizationId as string) || (rfq.contractorId as string) || "", by: "guest", at: nowIso, refs: { rfq: rfqKeyPart(rfq, rfqId), offer: offerRef.id }, payload: { version: 1, channel: "link" } })

    if (rfq.contractorId) {
      // A sealed round names no amount, from a guest as from anyone.
      const orgId = (rfq.organizationId as string) || (rfq.contractorId as string)
      const settings = (await db.collection("procurementSettings").doc(orgId).get().catch(() => null))?.data()
      const sealed = offersSealed(rfq as Parameters<typeof offersSealed>[0], resolvePolicies(settings as Partial<ProcurementPolicies> | undefined), new Date())
      const notice = newOfferNotice({ supplier: data.companyName, rfqTitle: (rfq.title as string) || "", price: total, sealed })
      await db
        .collection("users")
        .doc(rfq.contractorId as string)
        .collection("notifications")
        .doc(newOfferNoticeId(offerRef.id))
        .set({
          userId: rfq.contractorId,
          organizationId: orgId,
          type: "new_offer",
          i18n: notice.i18n,
          title: notice.title,
          message: notice.message,
          offerId: offerRef.id,
          rfqId,
          createdAt: nowIso,
          read: false,
        })
        .catch((err) => console.error("Failed to create guest-offer notification:", err))
    }

    // The verified code buys a short session on this link, so the visitor does not need a second code for what follows.
    let session: { secret: string; expiresAt: string } | null = null
    if (otp?.success) {
      session = await openLinkSession(db, { kind: "rfq", linkId, phone: phoneE164 }).catch((err) => {
        console.error("Failed to open the visitor session:", err)
        return null
      })
    }

    return NextResponse.json({ success: true, data: { offerId: offerRef.id, offerUrl, ...(session ? { session } : {}) } })
  } catch (err) {
    console.error("RFQ share guest offer error:", err)
    return errorResponse("Failed to submit the offer", "INTERNAL_ERROR", 500)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { SAUDI_VAT_RE } from "@/lib/procurement/rfq-form"
import { parseOfferTerms } from "@/lib/procurement/offer-terms"
import { unitPriceSchema } from "@/lib/procurement/input-limits"
import { leadDaysFrom, leadDaysRefusal, type QuoteLineInput } from "@/lib/procurement/offer-versions"
import { getAdminFirestore, getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { resolveShareToken } from "@/lib/rfq-share"
import { createGuestOfferLink } from "@/lib/guest-offer"
import { sendEmail, buildGuestOfferReceiptEmail } from "@/lib/email"
import { normalizeGuestChannel } from "@/utils/guest-offer-workflow"
import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"
import { riyadhDay } from "@/lib/hr/format"
import { GUEST_PAPER_KINDS, guestPaperPath, guestPaperRefusal, type GuestPaper } from "@/lib/procurement/guest-supplier"
import { FieldValue } from "firebase-admin/firestore"
import { offerIdFor, registeredNameOf, writeVisitorQuote, type VisitorQuoteInput } from "@/lib/procurement/visitor-offer-server"
import { validateLinkQuote } from "@/lib/procurement/link-validate"
import { codesPossible, failure, openSession, phoneOf, proveMobile, visitorFailure, writeRate } from "@/lib/procurement/visitor-http"
import { quotingGate } from "@/lib/procurement/offer-versions"

// Public: a visitor (no account) sends his quote through a valid link — and every later send from the same verified mobile is
// the NEXT version of that quote (LNK-09), never a duplicate and never a refusal. Four things are required (LNK-07): the days
// to supply (1 to 365), how long the quote holds (not before the request closes), the company and a Saudi mobile — and a price
// that is positive and reasonable. The mobile is proven by a code, once: the code or the session it bought rides this request.
// The total is OURS to compute; the request is re-read inside the transaction that writes, so a quote cannot land after the
// award or the deadline from a page that was still open (G-07). A mobile that already belongs to a registered supplier keeps
// the registered name (R-04); an edit never renames.

const MAX_PDF_BYTES = 10 * 1024 * 1024

const linesSchema = z
  .array(
    z.object({
      rfqProductIndex: z.coerce.number().int().min(0).max(999),
      unitPrice: unitPriceSchema,
      packLen: z.coerce.number().positive().finite().max(1000).optional(),
      warrantyMonths: z.coerce.number().int().min(0).max(120).optional(),
    })
  )
  .max(200)

const skippedSchema = z.array(z.coerce.number().int().min(0).max(999)).max(200)

const fieldsSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  contactName: z.string().trim().max(200).optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => phoneOf(v) != null, "Invalid Saudi mobile"),
  deliveryLocation: z.string().trim().max(300).optional().or(z.literal("")),
  deliveryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  executionDuration: z.string().trim().max(10).optional().or(z.literal("")),
  executionDurationUnit: z.string().trim().max(20).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  vatNumber: z.string().trim().regex(SAUDI_VAT_RE, "Invalid VAT number").optional().or(z.literal("")),
})

const FORM_KEYS = [
  "companyName",
  "contactName",
  "email",
  "phone",
  "price",
  "deliveryLocation",
  "deliveryDate",
  "executionDuration",
  "executionDurationUnit",
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
] as const

function jsonField<T>(form: FormData, key: string, schema: z.ZodType<T>): { ok: true; value: T | null } | { ok: false } {
  const raw = form.get(key)
  if (typeof raw !== "string" || !raw.trim()) return { ok: true, value: null }
  try {
    const parsed = schema.safeParse(JSON.parse(raw))
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false }
  } catch {
    return { ok: false }
  }
}

async function submit(req: NextRequest, token: string): Promise<NextResponse> {
  try {
    const resolution = await resolveShareToken(token)
    if (!resolution.ok) return failure("This link is invalid or has expired", resolution.code, resolution.status)
    const { link, linkId, rfq, rfqId } = resolution

    const now = new Date()
    const gate = quotingGate(rfq, riyadhDay(now))
    if (gate) return failure(gate === "deadline" ? "The RFQ deadline has passed" : "This RFQ is no longer accepting offers", gate === "deadline" ? "DEADLINE_PASSED" : "RFQ_CLOSED", 409)
    if (!codesPossible()) return failure("Codes cannot be sent right now", "CODE_UNAVAILABLE", 503)

    const form = await req.formData().catch(() => null)
    if (!form) return failure("Invalid form submission", "INVALID_INPUT", 400)
    const raw: Record<string, string> = {}
    for (const key of FORM_KEYS) {
      const v = form.get(key)
      if (typeof v === "string") raw[key] = v
    }
    const rates = jsonField(form, "lines", linesSchema)
    const skipped = jsonField(form, "skipped", skippedSchema)
    if (!rates.ok || !skipped.ok) return failure("Please review the prices you entered", "INVALID_INPUT", 400)
    const parsed = fieldsSchema.safeParse(raw)
    if (!parsed.success) return failure("Please review the submitted fields", "INVALID_INPUT", 400)
    const data = parsed.data
    const phone = phoneOf(data.phone) as string

    // One clear reason, the first (LNK-07): the same function the page runs while he types.
    const products = Array.isArray(rfq.products) ? (rfq.products as Array<Record<string, unknown>>) : []
    const lineMode = (rfq.pricingMode as string) === "line" && products.length > 0
    const checked = validateLinkQuote({
      pricing: lineMode ? "line" : "total",
      lines: (rates.value || []).map((l) => ({ index: l.rfqProductIndex, qty: Number(products[l.rfqProductIndex]?.quantity) || 0, price: l.unitPrice, per: l.packLen ?? null, skipped: (skipped.value || []).includes(l.rfqProductIndex) })),
      total: raw.price,
      days: data.executionDuration,
      valid: raw.validUntil || "",
      close: typeof rfq.deadline === "string" ? rfq.deadline.slice(0, 10) : null,
      company: data.companyName,
      mobile: data.phone,
    })
    const blocking = checked.issues.find((i) => i.code === "days" || i.code === "valid_missing" || i.code === "valid_before_close")
    if (blocking) return failure("Please review the submitted fields", blocking.code === "days" ? "INVALID_DURATION" : blocking.code === "valid_missing" ? "VALID_MISSING" : "VALID_BEFORE_CLOSE", 400)
    const lead = leadDaysFrom(data.executionDuration, data.executionDurationUnit)
    if (leadDaysRefusal(lead)) return failure("The duration is a whole number of days from 1 to 365", "INVALID_DURATION", 400)

    const terms = parseOfferTerms({ priceBasis: raw.priceBasis, validUntil: raw.validUntil, advancePercent: raw.advancePercent, creditDays: raw.creditDays }, riyadhDay(now))
    if (terms.error) return failure("Invalid offer terms", "INVALID_INPUT", 400)

    const papers: Array<{ kind: (typeof GUEST_PAPER_KINDS)[number]; file: File }> = []
    for (const kind of GUEST_PAPER_KINDS) {
      const f = form.get(`paper_${kind}`)
      if (!(f instanceof File) || f.size === 0) continue
      const refusal = guestPaperRefusal(f)
      if (refusal) return failure("Papers must be PDF, JPG or PNG files of 5MB or less", refusal === "size" ? "PAPER_TOO_LARGE" : "INVALID_PAPER", 400)
      papers.push({ kind, file: f })
    }
    const pdf = form.get("pdf")
    if (pdf instanceof File && pdf.size > 0) {
      if (pdf.type !== "application/pdf") return failure("Attachment must be a PDF file", "INVALID_PDF", 400)
      if (pdf.size > MAX_PDF_BYTES) return failure("PDF must be 10MB or smaller", "PDF_TOO_LARGE", 400)
    }

    const db = getAdminFirestore()
    const proof = await proveMobile(db, req, linkId, phone, { challengeId: raw.challengeId, code: raw.code })
    if (!proof.ok) return proof.response
    const blocked = await writeRate(db, phone)
    if (blocked) return blocked

    const { id: offerId, existing } = await offerIdFor(db, rfqId, phone)
    const stamp = Date.now()
    const upload = async (path: string, file: File) => {
      const bucket = getAdminStorage().bucket(getStorageBucketName())
      const downloadToken = randomUUID()
      await bucket.file(path).save(Buffer.from(await file.arrayBuffer()), { contentType: file.type, metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } } })
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`
    }
    let pdfUrl: string | null = null
    if (pdf instanceof File && pdf.size > 0) pdfUrl = await upload(`offers/pdfs/guest/${stamp}-${(pdf.name || "offer.pdf").replace(/[^\w.\-]+/g, "_").slice(-100)}`, pdf)
    const guestPapers: GuestPaper[] = []
    for (const { kind, file } of papers) {
      guestPapers.push({ kind, name: file.name || kind, url: await upload(guestPaperPath(linkId, offerId, kind, file.name, stamp), file), contentType: file.type, size: file.size, at: now.toISOString() })
    }

    const registered = existing ? null : await registeredNameOf(db, phone)
    const lines: QuoteLineInput[] = (rates.value || []).map((l) => ({ rfqProductIndex: l.rfqProductIndex, unitPrice: l.unitPrice, packLen: l.packLen, warrantyMonths: l.warrantyMonths }))
    const input: VisitorQuoteInput = {
      phone,
      verified: true,
      company: registered || data.companyName,
      contactName: data.contactName || "",
      email: data.email || "",
      vatNumber: data.vatNumber || null,
      deliveryLocation: data.deliveryLocation || "",
      deliveryDate: data.deliveryDate || "",
      leadDays: lead,
      executionDuration: data.executionDuration || "",
      executionDurationUnit: data.executionDurationUnit || "أيام",
      validUntil: raw.validUntil,
      note: data.message || "",
      quote: { lines, skipped: skipped.value || [], total: raw.price, whole: raw.whole === "true" },
      vatRegistered: raw.vatRegistered !== "false",
      terms: terms.terms as Record<string, unknown>,
      pdfUrl,
      papers: guestPapers,
      channel: normalizeGuestChannel(link.channel),
    }
    const saved = await writeVisitorQuote(db, { rfqId, linkId, link, offerId, input, now })

    let offerUrl: string | null = null
    if (saved.created) {
      try {
        const guestLink = await createGuestOfferLink({
          offerId: saved.offerId,
          rfqId,
          rfqTitle: (rfq.title as string) || "",
          contractorId: (rfq.contractorId as string) || null,
          organizationId: (rfq.organizationId as string) || (rfq.contractorId as string) || null,
          shareLinkId: linkId,
          channel: link.channel,
          email: input.email,
          phone,
        })
        offerUrl = guestLink.url
        await db.collection("offers").doc(saved.offerId).update({ guestOfferLinkId: guestLink.linkId }).catch(() => {})
      } catch (err) {
        console.error("Failed to create guest offer link:", err)
      }
      if (offerUrl && input.email) {
        const { subject, html } = buildGuestOfferReceiptEmail({ companyName: saved.companyName, rfqTitle: (rfq.title as string) || "", price: saved.total, offerUrl })
        await sendEmail({ to: input.email, subject, html }).catch((err) => console.error("Failed to send guest offer receipt:", err))
      }
      await db.collection("rfqShareLinks").doc(linkId).update({ offersSubmitted: FieldValue.increment(1), lastOfferAt: now.toISOString() }).catch((err) => console.error("Failed to bump share-link counter:", err))
      if (rfq.contractorId) {
        const orgId = (rfq.organizationId as string) || (rfq.contractorId as string)
        const notice = newOfferNotice({ supplier: saved.companyName, rfqTitle: (rfq.title as string) || "", price: saved.total })
        await db
          .collection("users")
          .doc(rfq.contractorId as string)
          .collection("notifications")
          .doc(newOfferNoticeId(saved.offerId))
          .set({ userId: rfq.contractorId, organizationId: orgId, type: "new_offer", i18n: notice.i18n, title: notice.title, message: notice.message, offerId: saved.offerId, rfqId, createdAt: now.toISOString(), read: false })
          .catch((err) => console.error("Failed to create guest-offer notification:", err))
      }
    }

    const session = proof.viaCode ? await openSession(db, linkId, phone) : null
    return NextResponse.json({
      success: true,
      data: { offerId: saved.offerId, offerUrl, n: saved.n, created: saved.created, total: saved.total, gross: saved.gross, validUntil: saved.validUntil, companyName: saved.companyName, ...(session ? { session } : {}) },
    })
  } catch (err) {
    const known = visitorFailure(err)
    if (known) return known
    console.error("RFQ share guest offer error:", err)
    return failure("Failed to submit the offer", "INTERNAL_ERROR", 500)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return submit(req, (await params).token)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return submit(req, (await params).token)
}

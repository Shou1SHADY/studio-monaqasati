import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { FieldValue, type DocumentData, type UpdateData } from "firebase-admin/firestore"
import { getAdminFirestore, getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { guestVisibleStatus, resolveGuestOfferToken, notifyContractor } from "@/lib/guest-offer"
import { riyadhDay } from "@/lib/hr/format"
import { unitPriceSchema } from "@/lib/procurement/input-limits"
import { rfqOfferKey } from "@/lib/procurement/event-keys"
import { bafoOpen, bafoReplyBy, bafoReplyKind, bafoReplyRefusal, type OfferBafo } from "@/lib/procurement/offer-decisions"
import { pricedProducts, revisePrice, type PricedRfq } from "@/lib/procurement/offer-pricing"
import { currentVersionOf, nextVersions, type StoredVersion } from "@/lib/procurement/offer-versions"
import { rfqKeyPart, sendProcEvent } from "@/lib/procurement/proc-event-server"
import { rfqLogEntry, type RfqLogEntry } from "@/lib/procurement/rfq-detail"
import { noticeAudience } from "@/lib/procurement/policy-enforce"
import { NoticeRefusal, createDeliveryNotice } from "@/lib/procurement/notice-server"
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
  price: unitPriceSchema,
  note: z.string().trim().max(1000).optional().or(z.literal("")),
  // A per-material offer is revised per material: {"0": 2929, "1": 175}.
  rates: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined
      try {
        const parsed = JSON.parse(v) as unknown
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error()
        return parsed as Record<number, string | number>
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rates must be an object" })
        return z.NEVER
      }
    }),
  // The materials he does not supply: [1, 3]. Absent = the offer's own previous marks still left blank.
  skipped: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined
      try {
        return z.array(z.coerce.number().int().min(0).max(999)).max(200).parse(JSON.parse(v))
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "skipped must be a list of indexes" })
        return z.NEVER
      }
    }),
})

const sampleSentSchema = z.object({
  note: z.string().trim().max(1000).optional().or(z.literal("")),
})

// G-08: a delivery notice is a day and a note — the driver, the plate and the quantities are the receiver's. The order link
// (`/po/<token>`) is where an awarded supplier reports; this stays for an old award that has none, with the same two fields.
const deliveryNoticeSchema = z.object({
  deliveryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
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
        { status: await guestVisibleStatus(db, offer), sampleStatus: offer.sampleStatus as string },
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
    const offerRfqId = String(offer.rfqId || "_")

    // --- Revised price after a reduction request ---
    if (action === "revise_price") {
      const parsed = revisePriceSchema.safeParse(formValues(form, ["price", "note", "rates", "skipped"]))
      if (!parsed.success) return errorResponse("Please enter a valid price", "INVALID_INPUT", 400)
      const { note } = parsed.data
      // The same rule as the portal: rates and total move together, and a
      // posted total never overrides what the rates add up to.
      const revision = revisePrice(offer as Parameters<typeof revisePrice>[0], pricedProducts(rfq as PricedRfq | null), { total: parsed.data.price, rates: parsed.data.rates, skipped: parsed.data.skipped })
      if (!revision.ok) {
        return errorResponse(revision.code === "INVALID_PRICE" ? "Please enter a valid price" : "Give a price for every material you supply, and mark the rest as not supplied", revision.code, 400)
      }
      const price = revision.total

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

      // The reply to «اطلب سعراً أفضل» (RFQ-11): one round, a lower price or the same, by the day he was given — his own
      // clock, so it answers even after the round closed — and it is the offer's NEXT VERSION; the first stays in the record
      // and the buyer's decisions about it are not touched (G-15).
      const today = riyadhDay()
      let n = 2
      const reply = await db.runTransaction(async (tx) => {
        const oSnap = await tx.get(offerRef)
        const fresh = (oSnap.data() || {}) as Record<string, unknown>
        const rSnap = await tx.get(db.collection("rfqs").doc(offerRfqId))
        const rfqNow = (rSnap.data() || {}) as Record<string, unknown>
        if (!bafoOpen(fresh)) return { refused: "ACTION_NOT_ALLOWED" as const }
        if (String(rfqNow.status) !== "New") return { refused: "RFQ_CLOSED" as const }
        const by = bafoReplyBy(fresh)
        if (by && by < today) return { refused: "REPLY_CLOSED" as const }
        const previous = currentVersionOf(fresh)
        if (bafoReplyRefusal(previous.total, price)) return { refused: "PRICE_HIGHER" as const }
        const version: StoredVersion = {
          n: 1,
          at: today,
          arrive: previous.arrive,
          valid: previous.valid,
          note: note || "",
          fileUrl: offerPdfUrl || previous.fileUrl,
          total: price,
          ...(Array.isArray(revision.fields.lines) ? { lines: revision.fields.lines.length ? (revision.fields.lines as StoredVersion["lines"]) : undefined } : previous.lines ? { lines: previous.lines } : {}),
          ...(typeof previous.vatRate === "number" ? { vatRate: previous.vatRate } : {}),
          by: "guest",
          bafoReply: bafoReplyKind(previous.total, price),
        }
        const versions = nextVersions(fresh, version)
        n = versions.length
        const stored = fresh.bafo as OfferBafo | undefined
        const update: Record<string, unknown> = {
          ...revision.fields,
          // Back into the contractor's queue, exactly like a registered supplier's price update.
          status: OFFER_STATUS.pending,
          versions,
          rev: n,
          bafo: { at: stored?.at || String(fresh.reductionAt || nowIso), byId: stored?.byId || "", byName: stored?.byName || "", replyBy: stored?.replyBy || String(fresh.reductionBy || ""), note: stored?.note ?? null, round: 1, answered: { at: today, n, kind: version.bafoReply, note: note || null } },
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
        tx.update(offerRef, update as UpdateData<DocumentData>)
        tx.update(db.collection("rfqs").doc(offerRfqId), { log: [...((Array.isArray(rfqNow.log) ? rfqNow.log : []) as RfqLogEntry[]), rfqLogEntry({ uid: "guest", name: supplierName }, "offer_versioned", nowIso, { params: { supplier: supplierName, version: n } })] })
        return { refused: null, rfq: rfqNow }
      })
      if (reply.refused) {
        const status = reply.refused === "ACTION_NOT_ALLOWED" || reply.refused === "RFQ_CLOSED" || reply.refused === "REPLY_CLOSED" ? 409 : 400
        return errorResponse(reply.refused === "PRICE_HIGHER" ? "A better price is the same price or a lower one" : "This request can no longer be answered", reply.refused, status)
      }
      if (reply.rfq) {
        const no = rfqKeyPart(reply.rfq, offerRfqId)
        await sendProcEvent(db, { id: "rfq_offer", key: rfqOfferKey(no, offerId, n), organizationId: String(reply.rfq.organizationId || reply.rfq.contractorId || ""), by: "guest", at: nowIso, refs: { rfq: no, offer: offerId }, payload: { version: n, mode: "reduce" } })
      }

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
    const parsed = deliveryNoticeSchema.safeParse(formValues(form, ["deliveryDate", "notes"]))
    if (!parsed.success) return errorResponse("Please review the submitted fields", "INVALID_INPUT", 400)
    const { deliveryDate, notes } = parsed.data
    const day = riyadhDay(new Date())
    if (deliveryDate < day) return errorResponse("The delivery day cannot be in the past", "DATE_PAST", 400)

    // An award that has an order reports on the order, numbered and logged like every other notice.
    if (typeof offer.poId === "string" && offer.poId) {
      try {
        await createDeliveryNotice(db, {
          poId: offer.poId,
          deliveryDate,
          note: notes || null,
          by: { source: "link", uid: `guest:${offerId}`, name: supplierName },
          authorize: (po) => {
            if (po.offerId !== offerId) throw new NoticeRefusal("not_yours")
          },
        })
        return NextResponse.json({ success: true, data: { action } })
      } catch (err) {
        if (err instanceof NoticeRefusal) return errorResponse("This action is no longer available for this offer", "ACTION_NOT_ALLOWED", err.status)
        throw err
      }
    }

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
      deliveryPersonName: null,
      handoverRecipientName: null,
      deliveryDate: new Date(deliveryDate).toISOString(),
      notes: notes || null,
      rfqTitle,
      items: [],
      status: "pending_confirmation",
      createdAt: FieldValue.serverTimestamp(),
    })

    // noticeRouting `both`: the receivers stamped on the order at approval
    // (`noticeCopyTo`) hear of the guest's notice with the buyer — as the
    // supplier portal does (policy-enforce.ts `noticeAudience`).
    let po: { noticeCopyTo?: unknown } | null = null
    if (typeof offer.poId === "string" && offer.poId) {
      const poSnap = await db.collection("purchaseOrders").doc(offer.poId).get().catch(() => null)
      po = poSnap?.exists ? ((poSnap.data() as { noticeCopyTo?: unknown }) ?? null) : null
    }
    await Promise.all(
      noticeAudience(contractorId ? [contractorId] : [], po).map((uid) =>
        notifyContractor({
          contractorId: uid,
          organizationId: contractorOrgId,
          type: "delivery_notice",
          title: "🚚 إشعار تسليم جديد",
          message: `قام المورد ${supplierName} بإرسال إشعار تسليم عبر رابط المشاركة لطلب عروض الأسعار: ${rfqTitle}`,
          offerId,
          rfqId: (offer.rfqId as string) || null,
          rfqTitle,
        })
      )
    )

    return NextResponse.json({ success: true, data: { action } })
  } catch (err) {
    console.error("Guest offer action error:", err)
    return errorResponse("Failed to complete this action", "INTERNAL_ERROR", 500)
  }
}

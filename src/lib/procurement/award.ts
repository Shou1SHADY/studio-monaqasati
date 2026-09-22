// The award's decision, seen from the offers screen (PRD 3.0 §5.1-5, §6.2,
// §6.3): what the accept dialog must ask before an offer becomes an order,
// what it warns about, and what it records on the offer itself. Pure — the
// screen shows it live and the write reads the same answers.
//
// Nothing here changes what an award IS: the offer still goes `مقبول` and the
// RFQ `Awarded` exactly as before; these helpers only decide what travels
// with that write (a reason, an exclusion) and what the order laid over it
// will run into at approval.

import { z } from "zod"
import { AWARD_REASON_CODES, awardNeedsReason, dayOf, isShortCompetition, lowestOffer, offerPrice, poBlocks, todayOf, type OfferLike, type PoBlock } from "./po"
import type { AwardReasonCode, ProcurementPolicies, PurchaseOrder, SupplierFacts } from "./types"

/** The stored literal — the one every reader compares (impl-b §2.1). */
export const OFFER_REJECTED = "مرفوض"

// ---------------------------------------------------------------------------
// Sealed prices until the deadline (§5.1-4, policy `sealOffersUntilDeadline`)
// ---------------------------------------------------------------------------

export interface SealableRfq {
  /** `YYYY-MM-DD` as the RFQ form writes it. */
  deadline?: string | null
  status?: string | null
}

/**
 * Whether this RFQ's prices are still the suppliers' own business.
 *
 * A buyer who watches prices land one by one can tell the next supplier what to
 * beat, which is the whole reason a sealed round exists. While sealed the screen
 * says how many offers arrived and from whom — never an amount.
 *
 * Sealing ends the day AFTER the deadline: on the deadline day itself a supplier
 * may still quote, so the round is not closed yet. Days are compared, not
 * timestamps, because the deadline is stored as a date with no time — inventing
 * a midnight would be the "number that lies" of §6.2.
 *
 * Three things open an RFQ whatever the policy says: no deadline (there is no
 * moment to open at), a deadline already past, and an award already made —
 * hiding the decision after the fact hides the record rather than protecting it.
 */
export function offersSealed(rfq: SealableRfq | null | undefined, policies: ProcurementPolicies, now: Date): boolean {
  if (!policies.sealOffersUntilDeadline) return false
  const day = dayOf(rfq?.deadline)
  if (!day) return false
  if (rfq?.status === "Awarded") return false
  return todayOf(now) <= day
}

/** Offers still in the running: everything not rejected, whatever else it is. */
export function competingOffers<T extends { status?: string | null }>(offers: T[]): T[] {
  return offers.filter((o) => o.status !== OFFER_REJECTED)
}

// ---------------------------------------------------------------------------
// The award reason — mandatory when a lower price was passed over
// ---------------------------------------------------------------------------

export const AWARD_REASON_MIN_TEXT = 8

/** Awarding above the lowest live price needs a reason (the rejected offers
 * are out of the comparison — an excluded price is not a passed-over one). */
export function awardReasonRequired(offer: OfferLike, offers: OfferLike[]): boolean {
  return awardNeedsReason(offer, competingOffers(offers))
}

/** `other` must be written out; a coded reason may carry a note or not. */
export const awardReasonSchema = z
  .object({
    code: z.enum(AWARD_REASON_CODES),
    text: z.string().trim().max(500).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.code === "other" && v.text.length < AWARD_REASON_MIN_TEXT) {
      ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: AWARD_REASON_MIN_TEXT, type: "string", inclusive: true, path: ["text"], message: "award_reason_text_short" })
    }
  })

export type AwardReasonInput = { code: AwardReasonCode; text?: string | null }

/** The reason as the write takes it — null when the form is not valid yet. */
export function parseAwardReason(code: string | null | undefined, text: string | null | undefined): { code: AwardReasonCode; text: string | null } | null {
  const r = awardReasonSchema.safeParse({ code: code || undefined, text: text || "" })
  if (!r.success) return null
  return { code: r.data.code, text: r.data.text || null }
}

/** What is written on the offer beside its `مقبول` — additive, so a legacy
 * award simply has none. */
export interface OfferAwardReason {
  code: AwardReasonCode
  text: string | null
  byId: string
  at: string
}

export function buildAwardReason(reason: { code: AwardReasonCode; text?: string | null }, byId: string, at = new Date().toISOString()): OfferAwardReason {
  return { code: reason.code, text: reason.text?.trim() || null, byId, at }
}

// ---------------------------------------------------------------------------
// The review the dialog shows — prices, warnings, and what the approval will hit
// ---------------------------------------------------------------------------

export interface AwardOfferFacts extends OfferLike {
  totalBatchesPrice?: number | null
  offerPdfUrl?: string | null
  isGuestOffer?: boolean | null
  supplierId?: string | null
  organizationId?: string | null
  supplierOrgId?: string | null
  supplierName?: string | null
  companyName?: string | null
}

export interface AwardReview {
  /** This offer's total, excluding VAT. */
  thisPrice: number | null
  /** The lowest live price on the RFQ — this offer's own when it is the lowest. */
  lowestPrice: number | null
  /** How many offers are still competing (this one included). */
  competing: number
  needsReason: boolean
  /** Above the competition threshold with fewer offers than policy asks for — a note, never a stop. */
  shortCompetition: boolean
  /** No stamped official quote attached — a note, never a stop. */
  noOfficialQuote: boolean
  /** A guest has no platform record: the order will need his details. */
  guest: boolean
  /** What will stop the ORDER's approval (not the award): facts about the supplier. */
  blocks: PoBlock[]
}

/** The offer's total excluding VAT — a multi-shipment offer sums its batches. */
export function awardTotal(offer: Pick<AwardOfferFacts, "price" | "totalBatchesPrice">): number | null {
  if (offer.totalBatchesPrice != null && Number.isFinite(Number(offer.totalBatchesPrice))) return Number(offer.totalBatchesPrice)
  return offerPrice(offer)
}

/** The supplier's org id as an order would carry it; null for a guest. */
export function awardSupplierOrgId(offer: Pick<AwardOfferFacts, "isGuestOffer" | "supplierId" | "organizationId" | "supplierOrgId">): string | null {
  if (offer.isGuestOffer || offer.supplierId === "guest") return null
  const id = offer.supplierOrgId || offer.organizationId || (offer.supplierId !== "mdmak-system" ? offer.supplierId : null)
  return id && id !== "guest" ? id : null
}

export function reviewAward(offer: AwardOfferFacts, offers: OfferLike[], policies: ProcurementPolicies, supplier: SupplierFacts | null, now: Date): AwardReview {
  const live = competingOffers(offers)
  const lowest = lowestOffer(live)
  const total = awardTotal(offer)
  const guest = Boolean(offer.isGuestOffer || offer.supplierId === "guest")
  // Only the supplier facts matter here — the split check needs the org's
  // other orders, which this screen does not load; the approval runs it.
  const shadow = {
    id: "",
    basis: "rfq",
    isGuestSupplier: guest,
    supplierOrgId: awardSupplierOrgId(offer) || "guest",
    supplierName: offer.companyName || offer.supplierName || "",
    lines: [],
    totalExVat: total ?? 0,
    status: "awaiting_approval",
    createdAt: now.toISOString(),
  } as unknown as PurchaseOrder
  return {
    thisPrice: total,
    lowestPrice: lowest ? offerPrice(lowest) : null,
    competing: live.length,
    needsReason: awardReasonRequired(offer, offers),
    shortCompetition: isShortCompetition(total, live.length, policies),
    noOfficialQuote: !offer.offerPdfUrl,
    guest,
    blocks: poBlocks(shadow, { supplier: guest ? null : supplier, otherOrders: [], policies, now }),
  }
}

/** The supplier's platform profile, read the way the approval reads it
 * (`useProcurementWorld`): a missing document is "unknown", which never blocks. */
export function supplierFactsFromProfile(orgId: string, data: { taxNumber?: string | null; isVerified?: boolean | null; legalDocuments?: { cr?: { expiryDate?: string | null } | null } | null } | null | undefined): SupplierFacts {
  if (!data) return { orgId, hasVatNumber: null, verified: null, crExpiry: null }
  return {
    orgId,
    hasVatNumber: Boolean((data.taxNumber || "").toString().trim()),
    verified: Boolean(data.isVerified),
    crExpiry: (data.legalDocuments?.cr?.expiryDate || "").toString().slice(0, 10) || null,
  }
}

// ---------------------------------------------------------------------------
// Rejecting with a reason — the status stays `مرفوض`; the reason rides beside it
// ---------------------------------------------------------------------------

export const EXCLUSION_CODES = ["price", "terms", "incomplete", "not_qualified", "other"] as const
export type ExclusionCode = (typeof EXCLUSION_CODES)[number]

export interface OfferExclusion {
  code: ExclusionCode
  note: string | null
  byId: string
  at: string
}

export const isExclusionCode = (v: unknown): v is ExclusionCode => typeof v === "string" && (EXCLUSION_CODES as readonly string[]).includes(v)

/** The payload stored on the offer as `exclusion` — null when no reason was given
 * (a plain rejection, exactly as before). */
export function buildExclusion(input: { code?: string | null; note?: string | null; byId: string; at?: string }): OfferExclusion | null {
  if (!isExclusionCode(input.code)) return null
  return { code: input.code, note: input.note?.trim() || null, byId: input.byId, at: input.at || new Date().toISOString() }
}

// What the buyer decides about an offer, kept APART from the offer itself (Procurement 2.0 G-15, S3 D3).
//
// An offer is the supplier's document and his edits make new versions of it. The buyer's decisions about it — the
// shortlist ★, the exclusion and why, «اطلب سعراً أفضل», «اطلب تأكيد السعر» — used to ride on it as overloaded `status`
// strings (`مرفوض`, `مطلوب تخفيض`), so a supplier's edit could erase them and his own screens showed him as «lost».
// Now:
//  - the shortlist, the exclusion and their log are a private record, `offerDecisions/{offerId}`, written only by
//    `/api/procurement/offers/decide`;
//  - the two REQUESTS the supplier must see ride on the offer as buyer-only keys: `bafo` and `reval`. The supplier's
//    reply only marks them answered; the offer's `status` is never touched by a buyer decision.
// Offers excluded or cut under the old scheme (`status` `مرفوض`, `مطلوب تخفيض`) still read through the same helpers
// until the migration script moves them. Pure: no I/O.

import { OTHER_REASON_MIN_CHARS } from "./offer-calc"

export const OFFER_DECISIONS = "offerDecisions"

/** The stored literals the old scheme wrote into `status`. */
export const LEGACY_EXCLUDED = "مرفوض"
export const LEGACY_REDUCTION = "مطلوب تخفيض"

export const EXCLUSION_REASONS = ["spec", "warranty", "validity", "other"] as const
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number]

/** Set only by the server itself: a re-award after a cancelled order leaves that supplier out. */
export const SERVER_EXCLUSION_REASONS = ["order_cancelled"] as const

export const isExclusionReason = (v: unknown): v is ExclusionReason => typeof v === "string" && (EXCLUSION_REASONS as readonly string[]).includes(v)

export const DECISION_KINDS = ["shortlist", "unshortlist", "exclude", "restore", "bafo", "reval", "clarify"] as const
export type DecisionKind = (typeof DECISION_KINDS)[number]

export interface DecisionMark {
  at: string
  byId: string
  byName: string
}

export interface DecisionExclusion extends DecisionMark {
  code: ExclusionReason | (typeof SERVER_EXCLUSION_REASONS)[number]
  /** Mandatory for «سبب آخر», optional beside the others. */
  text: string | null
}

export interface DecisionLogEntry extends DecisionMark {
  kind: DecisionKind
  meta?: Record<string, string | number | null>
}

export interface OfferDecision {
  offerId: string
  rfqId: string
  /** The buying organisation — the only one that reads this record. */
  organizationId: string
  shortlist: DecisionMark | null
  exclusion: DecisionExclusion | null
  log: DecisionLogEntry[]
  updatedAt: string
}

export type DecisionMap = Record<string, Pick<OfferDecision, "shortlist" | "exclusion"> | null | undefined>

// ---------------------------------------------------------------------------
// The two requests a supplier sees
// ---------------------------------------------------------------------------

export interface OfferBafo extends DecisionMark {
  /** The day he answers by (`YYYY-MM-DD`) — his own clock, not the passed deadline. */
  replyBy: string
  note: string | null
  /** One round per offer. */
  round: 1
  answered: { at: string; n: number; kind: "lowered" | "kept"; note?: string | null } | null
}

export interface OfferReval extends DecisionMark {
  note: string | null
  answered: { at: string; n: number } | null
}

export interface DecidableOffer {
  status?: string | null
  poId?: string | null
  withdrawnAt?: unknown
  exclusion?: { code?: string | null; note?: string | null; text?: string | null; at?: string | null; byId?: string | null } | null
  bafo?: OfferBafo | null
  reval?: OfferReval | null
  reductionBy?: string | null
  reductionAt?: string | null
  reductionNote?: string | null
  reductionRound?: boolean | null
  decidedAt?: string | null
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// Exclusion
// ---------------------------------------------------------------------------

export type ExclusionRefusal = "reason_required" | "reason_text_short"

/** RFQ-12 / R-16: one of the four reasons; «سبب آخر» needs its own words (4 characters at least). */
export function exclusionRefusal(code: unknown, text: string | null | undefined): ExclusionRefusal | null {
  if (!isExclusionReason(code)) return "reason_required"
  if (code === "other" && (text || "").trim().length < OTHER_REASON_MIN_CHARS) return "reason_text_short"
  return null
}

/** The old reasons mapped onto the new four (S3 §9.2); the old word rides along as the text of «سبب آخر». */
const LEGACY_REASON: Record<string, { code: ExclusionReason; text: string | null }> = {
  spec: { code: "spec", text: null },
  lead: { code: "validity", text: null },
  incomplete: { code: "other", text: "العرض ناقص" },
  documents: { code: "other", text: "بلا وثائق أو رقم ضريبي" },
  price: { code: "other", text: "السعر أعلى من المقبول" },
  terms: { code: "other", text: "شروطه لا تناسب" },
  not_qualified: { code: "other", text: "غير مؤهل" },
  other: { code: "other", text: null },
}

export function legacyExclusionOf(offer: DecidableOffer): DecisionExclusion | null {
  if (offer.status !== LEGACY_EXCLUDED) return null
  const old = offer.exclusion
  const mapped = LEGACY_REASON[String(old?.code || "other")] || LEGACY_REASON.other
  return {
    code: mapped.code,
    text: (old?.note || old?.text || mapped.text || "").trim() || (mapped.code === "other" ? "—" : null),
    at: String(old?.at || offer.decidedAt || ""),
    byId: String(old?.byId || ""),
    byName: "",
  }
}

/** The exclusion that stands: the decision record's, else a legacy `مرفوض` offer's. */
export function exclusionOf(offer: DecidableOffer, decision: Pick<OfferDecision, "exclusion"> | null | undefined): DecisionExclusion | null {
  return decision?.exclusion ?? legacyExclusionOf(offer)
}

export const isExcluded = (offer: DecidableOffer, decision: Pick<OfferDecision, "exclusion"> | null | undefined): boolean => exclusionOf(offer, decision) != null

export const isShortlisted = (decision: Pick<OfferDecision, "shortlist"> | null | undefined): boolean => Boolean(decision?.shortlist)

/** Offers still in the running once the buyer's exclusions are applied — the decision record first, a legacy status second. */
export function liveOffers<T extends DecidableOffer & { id: string }>(offers: T[], decisions: DecisionMap | null | undefined): T[] {
  return offers.filter((o) => !isExcluded(o, decisions?.[o.id]))
}

/** The reason the numbers suggest (RFQ-12): offered, never applied for him. */
export function suggestedExclusion(facts: { warrantyShort: boolean; validityShort: boolean; specMismatch?: boolean }): ExclusionReason | null {
  if (facts.specMismatch) return "spec"
  if (facts.warrantyShort) return "warranty"
  if (facts.validityShort) return "validity"
  return null
}

// ---------------------------------------------------------------------------
// «اطلب سعراً أفضل» — one round per offer
// ---------------------------------------------------------------------------

export const BAFO_NOTE_MAX = 500

export interface BafoView {
  open: boolean
  asked: boolean
  at: string | null
  replyBy: string | null
  note: string | null
  answered: OfferBafo["answered"]
}

/** The request as the offer carries it — the new key first, an old `مطلوب تخفيض` offer second. */
export function bafoOf(offer: DecidableOffer): BafoView {
  const b = offer.bafo
  if (b) return { open: !b.answered, asked: true, at: b.at || null, replyBy: b.replyBy || null, note: b.note || null, answered: b.answered || null }
  if (offer.status === LEGACY_REDUCTION) return { open: true, asked: true, at: offer.reductionAt || offer.decidedAt || null, replyBy: offer.reductionBy || null, note: offer.reductionNote || null, answered: null }
  return { open: false, asked: Boolean(offer.reductionRound), at: offer.reductionAt || offer.decidedAt || null, replyBy: offer.reductionBy || null, note: offer.reductionNote || null, answered: null }
}

export const bafoOpen = (offer: DecidableOffer): boolean => bafoOf(offer).open

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The day a reply must come by: the buyer's own date, else three days from when it was asked. */
export function bafoReplyBy(offer: DecidableOffer): string {
  const v = bafoOf(offer)
  if (v.replyBy && DAY.test(v.replyBy.slice(0, 10))) return v.replyBy.slice(0, 10)
  const at = (v.at || "").slice(0, 10)
  return DAY.test(at) ? addDays(at, 3) : ""
}

export type BafoAskRefusal = "offer_taken" | "offer_excluded" | "offer_withdrawn" | "already_asked" | "rfq_not_open" | "date_invalid"

export function bafoAskRefusal(input: { offer: DecidableOffer; decision?: Pick<OfferDecision, "exclusion"> | null; rfqStatus: string | null | undefined; replyBy: string; today: string }): BafoAskRefusal | null {
  const { offer } = input
  if (offer.poId || offer.status === "مقبول" || offer.status === "تم التسليم") return "offer_taken"
  if (offer.withdrawnAt || offer.status === "مسحوب") return "offer_withdrawn"
  if (isExcluded(offer, input.decision)) return "offer_excluded"
  if (input.rfqStatus !== "New") return "rfq_not_open"
  if (bafoOf(offer).asked) return "already_asked"
  if (!DAY.test(input.replyBy) || input.replyBy < input.today) return "date_invalid"
  return null
}

export type BafoReplyRefusal = "price_higher"

/** The reply is a lower price or the same one — never a higher one (RFQ-11): totals before VAT, to the halala. */
export function bafoReplyRefusal(previousNet: number, nextNet: number): BafoReplyRefusal | null {
  return Math.round(nextNet * 100) > Math.round(previousNet * 100) ? "price_higher" : null
}

export const bafoReplyKind = (previousNet: number, nextNet: number): "lowered" | "kept" => (Math.round(nextNet * 100) < Math.round(previousNet * 100) ? "lowered" : "kept")

// ---------------------------------------------------------------------------
// «اطلب تأكيد السعر»
// ---------------------------------------------------------------------------

export const revalOpen = (offer: DecidableOffer): boolean => Boolean(offer.reval && !offer.reval.answered)

export type RevalRefusal = "offer_taken" | "offer_excluded" | "offer_withdrawn" | "rfq_not_open" | "already_asked"

export function revalAskRefusal(input: { offer: DecidableOffer; decision?: Pick<OfferDecision, "exclusion"> | null; rfqStatus: string | null | undefined }): RevalRefusal | null {
  const { offer } = input
  if (offer.poId || offer.status === "مقبول" || offer.status === "تم التسليم") return "offer_taken"
  if (offer.withdrawnAt || offer.status === "مسحوب") return "offer_withdrawn"
  if (isExcluded(offer, input.decision)) return "offer_excluded"
  if (input.rfqStatus !== "New") return "rfq_not_open"
  if (revalOpen(offer)) return "already_asked"
  return null
}

// ---------------------------------------------------------------------------
// What the supplier's own screens read
// ---------------------------------------------------------------------------

export const UNDER_REVIEW_STATUS = "قيد المراجعة"

/**
 * The status a supplier's screens show for his offer. A buyer's exclusion is NOT told to him (the PRD's table of
 * notices has none): an offer excluded the old way reads «under review» until an award or a close ends it, and an
 * open «better price» request reads as the reduction request the screens already know how to answer.
 */
export function statusForSupplier(offer: DecidableOffer): string {
  const status = offer.status || ""
  if (status === LEGACY_EXCLUDED) return UNDER_REVIEW_STATUS
  if ((status === UNDER_REVIEW_STATUS || status === "" || status === LEGACY_REDUCTION) && bafoOpen(offer)) return LEGACY_REDUCTION
  if (status === LEGACY_REDUCTION) return UNDER_REVIEW_STATUS
  return status
}

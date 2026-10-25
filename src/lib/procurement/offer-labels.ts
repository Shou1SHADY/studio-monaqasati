// The tags an offer carries on the offers list and in its panel (Procurement 2.0 RFQ-05/07, §8 «العرض»): derived from the
// offer, the buyer's decisions about it and the RFQ — never stored. One function so the row, the panel and the comparison
// say the same word (G-11). The words live in `Portal.Procurement.offerLabel`. Pure: no I/O.

import { termsListOf, offerTermsList } from "./terms-freeze"
import { isExcluded, isShortlisted, bafoOf, revalOpen, type DecidableOffer, type OfferDecision } from "./offer-decisions"
import { isExpired } from "./offer-calc"
import { offerRev } from "./offer-versions"

export const OFFER_TAGS = ["awarded", "excluded", "shortlisted", "bafo_asked", "bafo_lowered", "reval_asked", "new_today", "updated", "version", "differs_terms", "whole_only", "unregistered", "expired"] as const
export type OfferTagCode = (typeof OFFER_TAGS)[number]

export interface OfferTag {
  code: OfferTagCode
  /** `version`: the number; `bafo_asked`: the day he answers by. */
  value?: string | number
}

type Rec = Record<string, unknown>

export interface LabelOffer extends DecidableOffer {
  createdAt?: unknown
  versions?: Array<{ n?: number; at?: string; bafoReply?: string; total?: number }> | null
  whole?: boolean | null
  vatRegistered?: boolean | null
  validUntil?: string | null
  advancePercent?: unknown
  creditDays?: unknown
}

const day = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "")

/** «يخالف شروط دفعك»: the RFQ SET its payment terms and the offer states others. An offer that states none does not differ,
 * and neither does one on an RFQ that set none. */
export function termsDiffer(offer: { advancePercent?: unknown; creditDays?: unknown }, rfq: { paymentTermsList?: unknown } | null | undefined): boolean {
  const asked = termsListOf(rfq?.paymentTermsList)
  const stated = offerTermsList(offer)
  if (!asked || !stated) return false
  return asked.length !== stated.length || asked.some((r, i) => r.pct !== stated[i].pct || r.days !== stated[i].days)
}

/** «خفّض 3% بعد طلبك»: how much of the version before his total the answering version took off — nothing when the versions do not say. */
function loweredPercent(offer: LabelOffer, n: number): number | undefined {
  const versions = offer.versions || []
  const now = versions.find((v) => v.n === n)?.total
  const before = versions.find((v) => v.n === n - 1)?.total
  if (!(typeof now === "number" && typeof before === "number" && before > 0 && now < before)) return undefined
  return Math.max(1, Math.round(((before - now) / before) * 100))
}

/** Today's tags for one offer, in the order the row shows them. `today` is `YYYY-MM-DD` in Riyadh. */
export function offerTags(input: { offer: LabelOffer; decision?: Pick<OfferDecision, "shortlist" | "exclusion"> | null; rfq?: { paymentTermsList?: unknown } | null; today: string }): OfferTag[] {
  const { offer, decision, rfq, today } = input
  const tags: OfferTag[] = []
  if (offer.poId || offer.status === "مقبول") tags.push({ code: "awarded" })
  if (isExcluded(offer, decision)) tags.push({ code: "excluded" })
  if (isShortlisted(decision)) tags.push({ code: "shortlisted" })
  const bafo = bafoOf(offer)
  if (bafo.open) tags.push({ code: "bafo_asked", value: bafo.replyBy || "" })
  else if (bafo.answered?.kind === "lowered") tags.push({ code: "bafo_lowered", value: loweredPercent(offer, bafo.answered.n) })
  if (revalOpen(offer)) tags.push({ code: "reval_asked" })
  const n = offerRev(offer as Rec)
  const last = offer.versions && offer.versions.length ? offer.versions[offer.versions.length - 1] : null
  if (n > 1 && day(last?.at) === today) tags.push({ code: "updated" })
  else if (n <= 1 && day(offer.createdAt) === today) tags.push({ code: "new_today" })
  if (termsDiffer(offer, rfq)) tags.push({ code: "differs_terms" })
  if (offer.whole) tags.push({ code: "whole_only" })
  if (offer.vatRegistered === false) tags.push({ code: "unregistered" })
  if (isExpired(offer.validUntil, today)) tags.push({ code: "expired" })
  if (n > 1) tags.push({ code: "version", value: n })
  return tags
}

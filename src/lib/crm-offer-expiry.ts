// «انتهاء الصلاحية بلا رد ينبّهه أيضاً» (Opportunity journey v1.1, OPP-04 #8): the offer Sales sent ran past its
// validity and the client never answered — the person who asked for the price hears it once, so they extend it with
// Sales, ask for a new version, postpone or close. The daily cron (`/api/cron/offer-expiry`) runs this selection; it is
// pure so the rule is tested without Firestore. Stamped on the deal (`expiryNoticeQuoteId`), so a version is told once.

import { isOpportunityOpen, type CrmOpportunity, type CrmQuotation } from "@/lib/crm"
import { currentOffersByDeal } from "@/lib/crm-journey"
import { displayDocNumber } from "@/lib/sales-numbering"

export interface ExpiredOffer {
  opp: CrmOpportunity
  quote: CrmQuotation
  /** Who asked Sales for the price — else who created the deal. */
  recipientId: string
}

/** Riyadh's calendar day — validity is a Saudi date, never the UTC one. */
export const riyadhToday = (now: Date = new Date()) => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)

/**
 * Deals whose CURRENT offer is sent, unanswered and past its validity, not told yet. A version Sales is already
 * revising (`supersededById`) is being answered — no notice; a closed deal needs none.
 */
export function selectExpiredOffers(
  opps: CrmOpportunity[],
  quotes: CrmQuotation[],
  requesters: Map<string, string>,
  today: string
): ExpiredOffer[] {
  const current = currentOffersByDeal(quotes)
  const out: ExpiredOffer[] = []
  for (const opp of opps) {
    if (!isOpportunityOpen(opp)) continue
    const quote = current.get(opp.id)
    if (!quote || quote.status !== "sent" || quote.supersededById || !quote.validUntil) continue
    if (quote.validUntil.slice(0, 10) >= today) continue
    if (opp.expiryNoticeQuoteId === quote.id) continue
    const recipientId = (opp.pricingRequestId && requesters.get(opp.pricingRequestId)) || opp.createdById || null
    if (!recipientId) continue
    out.push({ opp, quote, recipientId })
  }
  return out
}

/** The notice: i18n keys for the reader's language, plus Arabic text for push and the mobile app. */
export function expiryNotice(item: ExpiredOffer, createdAt: string) {
  // Params stay Latin — each reader's screen shows its own prefix (`displayParam`); the Arabic text is for push.
  const params = { number: item.opp.docNumber || "", title: item.opp.title || "", offer: item.quote.quotationNumber }
  const number = params.number ? displayDocNumber(params.number, "ar") : ""
  const offer = displayDocNumber(params.offer, "ar")
  return {
    userId: item.recipientId,
    organizationId: item.opp.organizationId,
    type: "crm_offer_expired",
    i18n: { title: "pn_crm_offer_expired_title", message: "pn_crm_offer_expired", params },
    title: "انتهت صلاحية عرض بلا رد",
    message: `انتهت صلاحية العرض ${offer} على الفرصة ${number} · ${params.title} ولم يرد العميل — مدّدها مع المبيعات، أو اطلب نسخة معدّلة، أو أجّل، أو أغلق.`,
    opportunityId: item.opp.id,
    quotationId: item.quote.id,
    link: `crm/opportunities/${item.opp.id}`,
    read: false,
    createdAt,
  }
}

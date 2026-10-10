// The opportunity's journey once Sales prices it («رحلة الفرصة» v1.1, 7 Oct 2026). CRM owns the deal; Sales owns the
// price. This file reads Sales' requests and quotations FOR a deal — which offer is current, where the pricing
// stands, what figure the deal counts with on the board — and never writes either. Pure: no Firestore.
//
// Not mirrored into the mobile app (crm.ts is): keep Sales-aware logic here so crm.ts stays the shared contract.

import { isOpportunityOpen, opportunityTrack, type CrmOpportunity, type CrmQuotation, type PipelineFigure } from "@/lib/crm"
import { quoteLifecycle, type QuoteLifecycle } from "@/lib/sales-quotes"
import type { QuoteRequest } from "@/lib/sales-transfers"

const dayOf = (iso: string | null | undefined) => (iso || "").slice(0, 10)

/** A quotation reached the client: Sales sent it (accepted / rejected ones were sent first). Quotes the old CRM
 * «submitted price» step wrote carry `version` and were recorded as sent. */
function wasSent(q: CrmQuotation): boolean {
  return q.status === "sent" || q.status === "accepted" || q.status === "rejected"
}

const revisionOf = (q: CrmQuotation) => q.revision ?? q.version ?? 1
const sentDay = (q: CrmQuotation) => q.sentAt || q.date || ""

/** Every offer that reached the client on this deal, newest first — «نسخ العرض» (OPP-04 #6). Superseded ones stay,
 * marked by `supersededById`; drafts and issued-but-unsent ones are Sales' business until they are sent. */
export function offerVersions(quotes: CrmQuotation[], oppId: string): CrmQuotation[] {
  return quotes
    .filter((q) => q.opportunityId === oppId && wasSent(q))
    .sort((a, b) => revisionOf(b) - revisionOf(a) || sentDay(b).localeCompare(sentDay(a)))
}

/**
 * Replaced = a NEWER version reached the client. Sales stamps `supersededById` the moment it opens the revision's
 * draft, but until that draft is sent the client still holds this one — so it stays the deal's offer (its figure,
 * its deadline, its PDF), and only the award waits (`revisionPending`).
 */
export function isReplaced(q: CrmQuotation, versions: CrmQuotation[]): boolean {
  return !!q.supersededById && versions.some((v) => v.id === q.supersededById)
}

/** The offer the deal stands on: the newest sent one no SENT version replaced. */
export function currentOffer(quotes: CrmQuotation[], oppId: string): CrmQuotation | null {
  const versions = offerVersions(quotes, oppId)
  return versions.find((q) => !isReplaced(q, versions)) ?? null
}

/** Sales is preparing the next version of the offer the client holds: the award waits for it (one version is won). */
export const revisionPending = (offer: CrmQuotation | null): boolean => !!offer?.supersededById

/** An offer sent under the old CRM ladder: a number with no Sales document behind it. Still an offer for the rules. */
const legacyOffer = (opp: Pick<CrmOpportunity, "submittedPrice">) => (opp.submittedPrice || 0) > 0

/** True once an offer reached the client — what «negotiation» and the award need (OPP-05). */
export function hasSentOffer(opp: CrmOpportunity, offer: CrmQuotation | null): boolean {
  return offer !== null || legacyOffer(opp)
}

export type PricingState =
  /** Nothing asked of Sales yet. */
  | { kind: "none" }
  /** With Sales: the request is open (being priced, or a draft in progress, or issued and not yet sent). */
  | { kind: "at_sales"; request: QuoteRequest; since: string }
  /** Sales could not price it — back with the reason (OPP-04 #8). */
  | { kind: "declined"; request: QuoteRequest }
  /** An offer reached the client. `expired` = its validity ran out with no answer. */
  | { kind: "offer"; quote: CrmQuotation; lifecycle: QuoteLifecycle; expired: boolean }
  /** The client asked for changes; the revised version is with Sales (OPP-04 #7). */
  | { kind: "revision"; request: QuoteRequest; quote: CrmQuotation }

/** The requests this deal sent, newest first. */
export function dealRequests(requests: QuoteRequest[], oppId: string): QuoteRequest[] {
  return requests.filter((r) => r.opportunityId === oppId).sort((a, b) => (b.requestedAt || "").localeCompare(a.requestedAt || ""))
}

/** Where the pricing of a deal stands, from Sales' own records. */
export function pricingState(opp: CrmOpportunity, requests: QuoteRequest[], quotes: CrmQuotation[], today: string): PricingState {
  const latest = dealRequests(requests, opp.id)[0] ?? null
  const offer = currentOffer(quotes, opp.id)
  if (latest && latest.status === "new") {
    if (latest.kind === "revision" && offer) return { kind: "revision", request: latest, quote: offer }
    return { kind: "at_sales", request: latest, since: latest.requestedAt }
  }
  if (offer && revisionPending(offer) && latest?.kind === "revision") return { kind: "revision", request: latest, quote: offer }
  if (offer) {
    // Read as the client holds it: a revision still in draft does not end its validity.
    const lifecycle = quoteLifecycle({ ...offer, supersededById: null }, today)
    return { kind: "offer", quote: offer, lifecycle, expired: lifecycle === "expired" }
  }
  if (latest?.status === "declined") return { kind: "declined", request: latest }
  // Quoted = issued in Sales, not yet sent to the client: still Sales' to finish.
  if (latest?.status === "quoted") return { kind: "at_sales", request: latest, since: latest.requestedAt }
  return { kind: "none" }
}

/**
 * OPP-08 #3: a tender whose «last day to submit the offer» has passed with no offer sent. It is held out of the open
 * pipeline until someone either moves the date (an addendum) or closes it.
 */
export function deadlinePassed(opp: CrmOpportunity, offerSent: boolean, today: string): boolean {
  if (opportunityTrack(opp) !== "tender" || !isOpportunityOpen(opp) || offerSent) return false
  const deadline = dayOf(opp.expectedCloseDate)
  return deadline !== "" && deadline < today
}

/** What an open deal counts with on the board and in the totals (OPP-04 #9, OPP-08): the offer Sales sent, else the
 * estimate, else nothing — «no estimate», never a zero. */
export function dealFigure(opp: CrmOpportunity, offer: CrmQuotation | null, today: string): PipelineFigure {
  const overdue = deadlinePassed(opp, hasSentOffer(opp, offer), today)
  if (offer) return { amount: offer.amount, kind: "offer", overdue }
  if (legacyOffer(opp)) return { amount: opp.submittedPrice as number, kind: "offer", overdue }
  if ((opp.value || 0) > 0) return { amount: opp.value, kind: "estimate", overdue }
  return { amount: null, kind: "none", overdue }
}

/** Index of the current offer per deal, so a board of many deals reads each in O(1). */
export function currentOffersByDeal(quotes: CrmQuotation[]): Map<string, CrmQuotation> {
  const byDeal = new Map<string, CrmQuotation[]>()
  for (const q of quotes) {
    if (!q.opportunityId || !wasSent(q)) continue
    const list = byDeal.get(q.opportunityId)
    if (list) list.push(q)
    else byDeal.set(q.opportunityId, [q])
  }
  const out = new Map<string, CrmQuotation>()
  for (const [id, list] of byDeal) {
    const versions = offerVersions(list, id)
    const current = versions.find((q) => !isReplaced(q, versions))
    if (current) out.set(id, current)
  }
  return out
}

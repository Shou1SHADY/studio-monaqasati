// Awarding an RFQ line by line (Procurement PRD 3.0 §5.1-5, the prototype's
// comparison matrix). The buyer picks, per material, whose offer wins it; the
// award then prepares ONE purchase order per supplier holding only that
// supplier's picked lines. A line nobody picked goes back to the needs.
//
// Two modes, decided by how the RFQ asked to be priced:
// · "lines" — every offer quoted a rate per material (or the RFQ has one
//   material, whose rate is the total divided by the quantity): any cell can
//   be picked, a split award is normal.
// · "whole" — the RFQ asked for ONE total over several materials: the award
//   goes to one supplier for the whole request, and his order needs a per-line
//   breakdown that adds up to that total (±1 riyal) before it can carry unit
//   prices. An RFQ with no products at all (legacy) is also "whole", without a
//   breakdown — its order stays one lot.
//
// Pure: no I/O. Picks are the screen's state, never stored as such; what is
// stored is the award the write makes from them.

import { competingOffers } from "./award"
import { offerRates, pricedProducts, pricingModeOf, toAmount, type PricedProduct, type PricedRfq, type RatedOffer } from "./offer-pricing"
import { offerPrice } from "./po"

const round2 = (n: number) => Math.round(n * 100) / 100

export type AwardMode = "lines" | "whole"

/** The offer's total excluding VAT — a multi-shipment offer sums its batches. */
export function offerTotal(o: RatedOffer): number | null {
  if (toAmount(o.totalBatchesPrice) > 0) return toAmount(o.totalBatchesPrice)
  return offerPrice({ price: typeof o.price === "number" || typeof o.price === "string" ? o.price : null })
}

/** rfqProductIndex → offer id. */
export type Picks = Record<number, string>

export interface PickableOffer extends RatedOffer {
  id: string
  status?: string | null
}

export function awardMode(rfq: PricedRfq | null | undefined): AwardMode {
  const products = pricedProducts(rfq)
  if (products.length === 0) return "whole"
  if (products.length === 1) return "lines"
  return pricingModeOf(rfq) === "line" ? "lines" : "whole"
}

/** Each competing offer's rate per material — quoted, or divided out of a
 * single-material total. Rejected (excluded) offers are out of the running. */
export function ratesByOffer(rfq: PricedRfq | null | undefined, offers: PickableOffer[]): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>()
  for (const o of competingOffers(offers)) {
    out.set(o.id, new Map(offerRates(rfq, o).map((r) => [r.rfqProductIndex, r.unitPrice])))
  }
  return out
}

export interface BestRate {
  offerId: string
  unitPrice: number
}

/** The lowest competing rate per material; the earlier offer in the list wins a tie. */
export function bestPerLine(rfq: PricedRfq | null | undefined, offers: PickableOffer[]): Record<number, BestRate> {
  const rates = ratesByOffer(rfq, offers)
  const best: Record<number, BestRate> = {}
  for (const p of pricedProducts(rfq)) {
    for (const o of competingOffers(offers)) {
      const r = rates.get(o.id)?.get(p.rfqProductIndex)
      if (r == null) continue
      if (!best[p.rfqProductIndex] || r < best[p.rfqProductIndex].unitPrice) best[p.rfqProductIndex] = { offerId: o.id, unitPrice: r }
    }
  }
  return best
}

/** «اختر الأقل لكل بند». */
export function pickLowest(rfq: PricedRfq | null | undefined, offers: PickableOffer[]): Picks {
  const picks: Picks = {}
  for (const [i, b] of Object.entries(bestPerLine(rfq, offers))) picks[Number(i)] = b.offerId
  return picks
}

/** Clicking a cell picks it; clicking the picked cell again un-picks the line. */
export function togglePick(picks: Picks, rfqProductIndex: number, offerId: string): Picks {
  const next = { ...picks }
  if (next[rfqProductIndex] === offerId) delete next[rfqProductIndex]
  else next[rfqProductIndex] = offerId
  return next
}

/** The whole request to one supplier (total pricing) — or back to nothing. */
export function toggleWhole(rfq: PricedRfq | null | undefined, picks: Picks, offerId: string): Picks {
  const products = pricedProducts(rfq)
  const indexes = products.length ? products.map((p) => p.rfqProductIndex) : [0]
  if (indexes.every((i) => picks[i] === offerId)) return {}
  return Object.fromEntries(indexes.map((i) => [i, offerId]))
}

/** «قبول العرض» on one card: that offer takes every line it quoted (every line,
 * in whole mode). Lines already picked to others keep their pick. */
export function pickOffer(rfq: PricedRfq | null | undefined, offers: PickableOffer[], offerId: string, current: Picks): Picks {
  if (awardMode(rfq) === "whole") return toggleWhole(rfq, {}, offerId)
  const rates = ratesByOffer(rfq, offers).get(offerId)
  const next = { ...current }
  for (const i of rates?.keys() || []) next[i] = offerId
  return next
}

/** Picks that still point at a competing offer with a rate for that line — an
 * offer excluded or revised since the pick was made drops out. */
export function livePicks(rfq: PricedRfq | null | undefined, offers: PickableOffer[], picks: Picks): Picks {
  const mode = awardMode(rfq)
  const live = new Set(competingOffers(offers).map((o) => o.id))
  const rates = ratesByOffer(rfq, offers)
  const out: Picks = {}
  for (const [k, offerId] of Object.entries(picks)) {
    const i = Number(k)
    if (!live.has(offerId)) continue
    if (mode === "lines" && rates.get(offerId)?.get(i) == null) continue
    out[i] = offerId
  }
  return out
}

// ---------------------------------------------------------------------------
// What the picks add up to
// ---------------------------------------------------------------------------

export interface AwardLine extends PricedProduct {
  /** Null in whole mode until the breakdown fills it. */
  unitPrice: number | null
}

export interface AwardGroup {
  offerId: string
  lines: AwardLine[]
  /** Σ rate × quantity in lines mode; the offer's total in whole mode. */
  total: number
}

export interface AwardSummary {
  mode: AwardMode
  /** Lines picked, of how many. */
  picked: number
  of: number
  total: number
  groups: AwardGroup[]
  /** Lines nobody picked — they go back to the needs. */
  unpicked: number[]
  /** Picked lines not on the lowest competing rate — the award needs a reason. */
  offLowest: number[]
}

export function awardSummary(rfq: PricedRfq | null | undefined, offers: PickableOffer[], picks: Picks): AwardSummary {
  const mode = awardMode(rfq)
  const products = pricedProducts(rfq)
  const clean = livePicks(rfq, offers, picks)
  const byId = new Map(offers.map((o) => [o.id, o]))
  const order: string[] = []
  const grouped = new Map<string, AwardLine[]>()
  const rates = ratesByOffer(rfq, offers)

  if (mode === "whole") {
    const first = Object.values(clean)[0]
    const allSame = first != null && (products.length ? products : [{ rfqProductIndex: 0 }]).every((p) => clean[p.rfqProductIndex] === first)
    if (!allSame) return { mode, picked: 0, of: Math.max(products.length, 1), total: 0, groups: [], unpicked: products.map((p) => p.rfqProductIndex), offLowest: [] }
    const total = round2(offerTotal(byId.get(first) as PickableOffer) ?? 0)
    const lowest = competingOffers(offers).reduce<number | null>((m, o) => {
      const p = offerTotal(o)
      return p == null ? m : m == null || p < m ? p : m
    }, null)
    return {
      mode,
      picked: Math.max(products.length, 1),
      of: Math.max(products.length, 1),
      total,
      groups: [{ offerId: first, lines: products.map((p) => ({ ...p, unitPrice: null })), total }],
      unpicked: [],
      offLowest: lowest != null && total > lowest ? products.map((p) => p.rfqProductIndex) : [],
    }
  }

  const best = bestPerLine(rfq, offers)
  const offLowest: number[] = []
  for (const p of products) {
    const offerId = clean[p.rfqProductIndex]
    if (!offerId) continue
    const unitPrice = rates.get(offerId)?.get(p.rfqProductIndex) as number
    if (!grouped.has(offerId)) {
      grouped.set(offerId, [])
      order.push(offerId)
    }
    grouped.get(offerId)?.push({ ...p, unitPrice })
    const b = best[p.rfqProductIndex]
    if (b && unitPrice > b.unitPrice) offLowest.push(p.rfqProductIndex)
  }
  const groups = order.map((offerId) => {
    const lines = grouped.get(offerId) as AwardLine[]
    return { offerId, lines, total: round2(lines.reduce((s, l) => s + (l.unitPrice as number) * l.quantity, 0)) }
  })
  return {
    mode,
    picked: Object.keys(clean).length,
    of: products.length,
    total: round2(groups.reduce((s, g) => s + g.total, 0)),
    groups,
    unpicked: products.filter((p) => !clean[p.rfqProductIndex]).map((p) => p.rfqProductIndex),
    offLowest,
  }
}

/** What the cheapest competing rates would have cost for exactly these lines —
 * the order's "lowest" figure for the exceptions report. */
export function lowestForLines(rfq: PricedRfq | null | undefined, offers: PickableOffer[], lines: Array<Pick<AwardLine, "rfqProductIndex" | "quantity">>): number | null {
  const best = bestPerLine(rfq, offers)
  let total = 0
  for (const l of lines) {
    const b = best[l.rfqProductIndex]
    if (!b) return null
    total += b.unitPrice * l.quantity
  }
  return round2(total)
}

// ---------------------------------------------------------------------------
// Total pricing: the breakdown the supplier gives after the award
// ---------------------------------------------------------------------------

export const BREAKDOWN_TOLERANCE = 1

export interface BreakdownCheck {
  lines: Array<{ rfqProductIndex: number; unitPrice: number }>
  sum: number
  /** Products still without a positive unit price. */
  missing: number[]
  /** Every line priced and the sum within ±1 riyal of the total. */
  ok: boolean
}

export function checkBreakdown(products: PricedProduct[], typed: Record<number, string | number | null | undefined>, total: number): BreakdownCheck {
  const lines: BreakdownCheck["lines"] = []
  const missing: number[] = []
  let sum = 0
  for (const p of products) {
    const rate = round2(toAmount(typed[p.rfqProductIndex]))
    if (!(rate > 0)) {
      missing.push(p.rfqProductIndex)
      continue
    }
    lines.push({ rfqProductIndex: p.rfqProductIndex, unitPrice: rate })
    sum += rate * p.quantity
  }
  sum = round2(sum)
  return { lines, sum, missing, ok: missing.length === 0 && Math.abs(sum - round2(total)) <= BREAKDOWN_TOLERANCE }
}

// ---------------------------------------------------------------------------
// «أفضل سعر» (R-16) and the guest supplier at the award (R-10)
// ---------------------------------------------------------------------------

export interface OrderableOffer extends PickableOffer {
  isGuestOffer?: boolean | null
}

/** Does the offer quote every line? Whole-request pricing is one lot: yes. */
export function coversAllLines(rfq: PricedRfq | null | undefined, offer: PickableOffer): boolean {
  if (awardMode(rfq) === "whole") return true
  const products = pricedProducts(rfq)
  const rates = ratesByOffer(rfq, [offer]).get(offer.id)
  return products.every((p) => rates?.get(p.rfqProductIndex) != null)
}

/**
 * The prototype's `isBestO`: among the live offers that price EVERY line (a
 * partial offer's lower total is not a better price), the lowest total — and
 * only when at least two such offers compete and that supplier can be given an
 * order (`canOrder`: a registered supplier needs a VAT number and a verified
 * record; a guest is judged at the award, not here).
 */
export function bestOfferIds(rfq: PricedRfq | null | undefined, offers: OrderableOffer[], canOrder: (o: OrderableOffer) => boolean): Set<string> {
  const full = competingOffers(offers).filter((o) => o.status !== "مقبول" && coversAllLines(rfq, o) && offerTotal(o) != null)
  if (full.length < 2) return new Set()
  const min = Math.min(...full.map((o) => offerTotal(o) as number))
  return new Set(full.filter((o) => offerTotal(o) === min && canOrder(o)).map((o) => o.id))
}

/** A guest has no supplier record: its order would carry no VAT number and
 * could not be verified. The award waits until he registers — or the buyer
 * accepts, in so many words, to award an unregistered guest. */
export function guestAwardRefusal(picked: OrderableOffer[], acceptedGuest: boolean): "guest_unregistered" | null {
  return picked.some((o) => o.isGuestOffer) && !acceptedGuest ? "guest_unregistered" : null
}

// Pricing an offer line by line (Procurement PRD 3.0 §4 "pricing mode (per
// line/total)", §5.1-4). Pure.
//
// Until now every offer in this product was a single figure. That reads fine on
// the comparison screen and loses the one number the rest of Procurement needs:
// what a MATERIAL cost. Without a unit price, `buildPoLines` writes
// `unitPrice: null` on every line of an order, and everything downstream that
// compares prices has nothing to compare — the price-drift report, the price
// history, "the best offer is 4 % above what we last paid", ordering on an
// agreement, and the estimated value that decides whether a need can be bought
// directly or has to go out to the market.
//
// So the RFQ says HOW it wants to be priced, and in line mode the supplier gives
// a rate per material. The total is then DERIVED — Σ rate × quantity — and
// written to the same `price` field as before, so every existing reader (the
// comparison, the award, the money flow, the guest API, the mobile app) keeps
// working without knowing this exists.
//
// Two things are deliberately NOT allowed:
// · Line mode on a multi-shipment RFQ. There the total is already derived from
//   the batches, and two derivations of one number disagree eventually.
// · Line mode on an RFQ whose products have no quantities. A rate with nothing
//   to multiply by cannot produce a total, and a total that is not the sum of
//   its parts is the "number that lies" of §6.2.

import { calcOffer, canPriceByLine, coverageOf, fromHalalas, lineCalc, pricedProducts, pricingModeOf, ratesReconcile, toAmount, type PackInfo, type PricedProduct, type PricedRfq, type RfqProductLike } from "./offer-calc"
import { aboveLastPaid } from "./prices"

// The arithmetic (pieces, line totals, effective prices, VAT, ties) lives in offer-calc.ts; this file keeps the
// forms' vocabulary — rates as typed, faults, the fields an offer document stores — and calls into it.
export { canPriceByLine, pricedProducts, pricingModeOf, toAmount }
export type { PricedProduct, PricedRfq, RfqProductLike }

const round2 = (n: number) => Math.round(n * 100) / 100

export const PRICING_MODES = ["total", "line"] as const
export type PricingMode = (typeof PRICING_MODES)[number]

export interface OfferLinePrice {
  rfqProductIndex: number
  unitPrice: number
  /** Request units in one piece, when the rate is per piece (CMP-01). Absent for a per-unit rate. */
  packLen?: number
}

export interface OfferPricing {
  /** Only the lines actually priced — what goes on the offer document. */
  lines: OfferLinePrice[]
  /** Σ rate × quantity, rounded — what goes in `price`. */
  total: number
  /** Product indexes with neither a rate nor a «لا أورّده» mark; the form names them. */
  missing: number[]
  /** Product indexes the supplier marked «not supplied» and left unpriced — a partial offer. */
  skipped: number[]
  /** Product indexes both priced and marked «not supplied»: contradictory, never stored. */
  conflicting: number[]
  /** Every product priced or marked not-supplied, none contradictory, at least one priced. */
  complete: boolean
}

/**
 * The rates as typed, against the RFQ's own products.
 *
 * A blank or non-positive rate is missing, not zero: "free" is not a quote, and
 * treating it as zero would quietly make an offer look cheaper than the rest.
 *
 * A supplier who does not supply a material says so (`skipped`): that line is
 * left out of the offer and counts as «not covered», never as zero. A line that
 * is neither priced nor marked stays `missing`, so a forgotten field is still
 * caught; one that is both is `conflicting`.
 */
export function priceOffer(
  products: PricedProduct[],
  rates: Record<number, string | number | null | undefined>,
  skipped: readonly number[] = [],
  packs: Record<number, number | string | null | undefined> = {}
): OfferPricing {
  const flagged = new Set(skipped)
  const lines: OfferLinePrice[] = []
  const missing: number[] = []
  const left: number[] = []
  const conflicting: number[] = []
  let totalH = 0
  for (const p of products) {
    const rate = round2(toAmount(rates[p.rfqProductIndex]))
    const flag = flagged.has(p.rfqProductIndex)
    if (rate > 0 && flag) {
      conflicting.push(p.rfqProductIndex)
      continue
    }
    if (rate <= 0) {
      if (flag) left.push(p.rfqProductIndex)
      else missing.push(p.rfqProductIndex)
      continue
    }
    const calc = lineCalc(p.quantity, rate, packs[p.rfqProductIndex])
    lines.push({ rfqProductIndex: p.rfqProductIndex, unitPrice: rate, ...(calc.pack ? { packLen: calc.pack.packLen } : {}) })
    totalH += calc.totalH
  }
  return { lines, total: fromHalalas(totalH), missing, skipped: left, conflicting, complete: missing.length === 0 && conflicting.length === 0 && lines.length > 0 }
}

export type PricingFaultCode = "LINE_PRICES_INCOMPLETE" | "LINE_CONTRADICTORY" | "NO_LINE_PRICED"

/** Why a line-priced offer cannot go, and which lines — null when it can. */
export function pricingFault(pricing: OfferPricing): { code: PricingFaultCode; indexes: number[] } | null {
  if (pricing.conflicting.length) return { code: "LINE_CONTRADICTORY", indexes: pricing.conflicting }
  if (pricing.missing.length) return { code: "LINE_PRICES_INCOMPLETE", indexes: pricing.missing }
  if (!pricing.lines.length) return { code: "NO_LINE_PRICED", indexes: [] }
  return null
}

/** The materials a fault names, for the message beside the form. */
export const faultNames = (products: PricedProduct[], indexes: readonly number[]): string =>
  indexes.map((i) => products.find((p) => p.rfqProductIndex === i)?.name || `#${i + 1}`).join(" · ")

/** What a line-priced offer adds to the document it already wrote: the rates,
 * the total in the field every reader has always used, and — only when the
 * supplier left lines out — which ones (`skippedItems`). */
export function offerPricingFields(pricing: OfferPricing): { lines: OfferLinePrice[]; price: string; skippedItems?: number[] } {
  const fields = { lines: pricing.lines, price: String(pricing.total) }
  return pricing.skipped.length ? { ...fields, skippedItems: pricing.skipped } : fields
}

/**
 * What a PUBLIC endpoint stores when a guest quotes (the RFQ share route).
 *
 * The caller posts rates and a total. In line mode the total is ours to compute
 * and theirs to ignore: an endpoint that believed a posted figure would let a
 * guest name any total it liked beside its rates. In total mode there are no
 * rates to work from, so the posted figure is the quote, validated as before —
 * and there is no partial offer: a total over several materials is one lot.
 */
export function guestOfferPrice(
  rfq: PricedRfq | null | undefined,
  postedRates: OfferLinePrice[],
  postedTotal: number,
  postedSkipped: readonly number[] = []
):
  | { ok: true; total: number; price: string; lines: OfferLinePrice[] | null; skippedItems?: number[] }
  | { ok: false; code: PricingFaultCode } {
  if (pricingModeOf(rfq) !== "line") return { ok: true, total: postedTotal, price: String(postedTotal), lines: null }
  const rates: Record<number, number> = {}
  const packs: Record<number, number | undefined> = {}
  for (const l of postedRates) {
    rates[l.rfqProductIndex] = l.unitPrice
    packs[l.rfqProductIndex] = l.packLen
  }
  const pricing = priceOffer(pricedProducts(rfq), rates, postedSkipped, packs)
  const fault = pricingFault(pricing)
  if (fault) return { ok: false, code: fault.code }
  return { ok: true, total: pricing.total, price: String(pricing.total), lines: pricing.lines, ...(pricing.skipped.length ? { skippedItems: pricing.skipped } : {}) }
}

export type RatedOffer = {
  price?: unknown
  totalBatchesPrice?: unknown
  lines?: Array<{ rfqProductIndex?: number | null; unitPrice?: number | string | null; packLen?: number | string | null }> | null
  /** Product indexes the supplier said he does not supply — a partial offer. */
  skippedItems?: Array<number | null> | null
  /** مبلغ إجمالي: one figure for the whole RFQ, no line prices. */
  lump?: number | string | null
  vatRegistered?: boolean | null
  vatRate?: number | string | null
}

export interface OfferCoverage {
  covered: number
  of: number
  /** The offer prices some of the RFQ's materials and not all. */
  partial: boolean
  /** Product indexes this offer does not cover — «not covered», never zero. */
  uncovered: number[]
}

/**
 * How much of the RFQ an offer covers.
 *
 * A line-priced offer covers the lines it carries a rate for; a total offer
 * (or an RFQ priced as a total) is one lot and covers everything. The explicit
 * `skippedItems` mark is read too, so an offer whose rates were later dropped
 * (a lump-sum revision) is still known to be partial.
 */
export function offerCoverage(rfq: PricedRfq | null | undefined, offer: RatedOffer): OfferCoverage {
  return coverageOf(rfq, offer)
}

/** «Covers N of M» from the offer alone (its rates and its marks), for a list that has not loaded the RFQ; null when it covers all. */
export function ownCoverage(offer: RatedOffer): { covered: number; of: number } | null {
  const marked = new Set((offer.skippedItems || []).map(Number).filter((i) => Number.isInteger(i) && i >= 0)).size
  const priced = new Set((offer.lines || []).filter((l) => toAmount(l.unitPrice) > 0).map((l) => Number(l.rfqProductIndex))).size
  return marked > 0 && priced > 0 ? { covered: priced, of: priced + marked } : null
}

/** An offer that explicitly leaves lines out — readable without the RFQ. */
export const isPartialOffer = (offer: { skippedItems?: unknown }): boolean => Array.isArray(offer.skippedItems) && offer.skippedItems.length > 0

/**
 * Whether an offer's quoted rates still add up to the total it now stands at.
 *
 * They stop doing so when the price is revised as a total alone: the supplier's
 * "update price" once wrote `price` and left every rate as it was, so a
 * 15,950 offer cut to 14,645 still said 3,190 a ton — and the order built from
 * it put 15,950 in front of Finance. Rates that no longer reconcile describe an
 * offer nobody is making any more; they are neither stored nor compared.
 *
 * Only a COMPLETE set is judged — a partial one is kept lump-sum elsewhere.
 * The tolerance is a halala per line, for rounding.
 */
export function quotedRatesReconcile(products: PricedProduct[], offer: RatedOffer): boolean {
  return ratesReconcile(products, offer)
}

// ---------------------------------------------------------------------------
// Revising a price (a reduction asked for, or the supplier's own change)
// ---------------------------------------------------------------------------

export interface RevisableOffer extends RatedOffer {
  deliveryBatches?: Array<Record<string, unknown> & { price?: unknown }> | null
}

export interface PriceRevisionFields {
  price: string
  /** Replaced rates; `[]` drops rates that can no longer be restated. */
  lines?: OfferLinePrice[]
  /** The lines the revised offer still leaves out; `[]` when it now covers them all. */
  skippedItems?: number[]
  totalBatchesPrice?: number
  deliveryBatches?: Array<Record<string, unknown>>
}

export type PriceRevision = { ok: true; total: number; fields: PriceRevisionFields } | { ok: false; code: PricingFaultCode | "INVALID_PRICE" }

/**
 * Every field a price revision writes, so that no two of them disagree.
 *
 * The flow used to write `price` alone. A per-material offer kept its old rates
 * (and the order built from it asked Finance for the pre-reduction figure), and
 * a multi-shipment offer kept `totalBatchesPrice`, which every reader prefers
 * over `price` — so its reduction was ignored outright.
 *
 * - Priced per material, with the RFQ's products at hand: new rates, the total
 *   their sum — exactly as when the offer was first made. All or none.
 * - Priced per material without the products (they could not be read): the new
 *   total stands and the rates are dropped, so the offer is honestly lump-sum
 *   rather than carrying rates for a price nobody is quoting.
 * - Shipments: each batch scaled to the new total, the last absorbing rounding,
 *   so the schedule still adds up; `totalBatchesPrice` follows.
 */
export function revisePrice(
  offer: RevisableOffer,
  products: PricedProduct[] | null,
  input: { total?: string | number | null; rates?: Record<number, string | number | null | undefined>; skipped?: readonly number[] }
): PriceRevision {
  const quoted = (offer.lines || []).length > 0
  const fields: PriceRevisionFields = { price: "" }
  let total: number
  if (quoted && products && products.length) {
    const rates = input.rates || {}
    // A form that does not know about «not supplied» keeps a partial offer partial: what he left out before and
    // still leaves blank stays out; a rate typed on it brings it in.
    const before = new Set((offer.lines || []).map((l) => Number(l.rfqProductIndex)))
    const wasOut = new Set((offer.skippedItems || []).map(Number))
    const skipped = input.skipped ?? products.filter((p) => (wasOut.has(p.rfqProductIndex) || !before.has(p.rfqProductIndex)) && !(toAmount(rates[p.rfqProductIndex]) > 0)).map((p) => p.rfqProductIndex)
    const packs: Record<number, number | string | null | undefined> = {}
    for (const l of offer.lines || []) packs[Number(l.rfqProductIndex)] = l.packLen
    const pricing = priceOffer(products, rates, skipped, packs)
    const fault = pricingFault(pricing)
    if (fault) return { ok: false, code: fault.code }
    total = pricing.total
    fields.lines = pricing.lines
    if (pricing.skipped.length || (offer.skippedItems || []).length) fields.skippedItems = pricing.skipped
  } else {
    total = round2(toAmount(input.total))
    if (total <= 0) return { ok: false, code: "INVALID_PRICE" }
    if (quoted) fields.lines = []
  }
  fields.price = String(total)

  const batches = offer.deliveryBatches || []
  if (batches.length) {
    const before = batches.reduce((s, b) => s + toAmount(b.price), 0)
    let assigned = 0
    fields.deliveryBatches = batches.map((b, i) => {
      const last = i === batches.length - 1
      const share = last ? round2(total - assigned) : round2(before > 0 ? (toAmount(b.price) * total) / before : total / batches.length)
      assigned = round2(assigned + share)
      return { ...b, price: String(share) }
    })
  }
  if (offer.totalBatchesPrice != null && String(offer.totalBatchesPrice) !== "") fields.totalBatchesPrice = total
  return { ok: true, total, fields }
}

// ---------------------------------------------------------------------------
// The rates an offer implies — for comparing, not for storing
// ---------------------------------------------------------------------------

export interface OfferRate extends PricedProduct {
  /** Per request unit. For a per-piece line it is the EFFECTIVE price (paid ÷ requested), never the price per piece. */
  unitPrice: number
  /** True when the rate was quoted; false when it was divided out of a total. */
  quoted: boolean
  /** Per-piece lines only: what the line costs, ex-VAT — rate × quantity is not the total there. */
  lineTotal?: number
  pack?: PackInfo
}

/**
 * What each material costs under this offer.
 *
 * Quoted rates when the supplier gave them. Otherwise, for an RFQ with a SINGLE
 * material, the total divided by its quantity — the only rate consistent with
 * that quote, and exact arithmetic rather than an estimate.
 *
 * That divided rate is deliberately good enough to COMPARE and not good enough
 * to STORE: `poValue` sums quantity × unitPrice, so an uneven division (100 over
 * 3) would leave an order whose value differs from the price actually accepted
 * by a halala. A warning does not have to reconcile with the ledger; an order
 * does. So `buildPoLines` still keeps a lump sum lump.
 */
export function offerRates(rfq: PricedRfq | null | undefined, offer: RatedOffer): OfferRate[] {
  const products = pricedProducts(rfq)
  const calc = calcOffer(rfq, offer)
  return calc.lines.map((l) => {
    const p = products[l.rfqProductIndex]
    return {
      ...p,
      unitPrice: l.pack || !l.quoted ? fromHalalas(l.effH) : fromHalalas(l.rateH),
      quoted: l.quoted,
      ...(l.pack ? { lineTotal: fromHalalas(l.totalH), pack: l.pack } : {}),
    }
  })
}

export interface RateComparison extends OfferRate {
  /** What we last committed to for this material. */
  lastPaid: number
  lastSupplier: string
  /** How far above that this offer sits, in percent. */
  percent: number
}

/**
 * The materials this offer prices above what we last paid for them, worst first.
 *
 * Only what is worth saying out loud: a rise inside the threshold is noise, and
 * a material we have never bought has nothing to compare with. Not a block —
 * steel and copper move, and §9 calls this a thing that "deserves to be seen".
 */
export function ratesAboveLastPaid(
  rates: OfferRate[],
  lastPaidOf: (name: string, unit: string) => { price: number; supplierName?: string | null } | null
): RateComparison[] {
  const out: RateComparison[] = []
  for (const rate of rates) {
    const last = lastPaidOf(rate.name, rate.unit)
    if (!last) continue
    // One threshold and one piece of arithmetic, both `aboveLastPaid`'s: null
    // means either nothing to compare with or a rise not worth mentioning.
    const percent = aboveLastPaid(rate.unitPrice, last.price)
    if (percent == null) continue
    out.push({ ...rate, lastPaid: last.price, lastSupplier: (last.supplierName || "").trim(), percent })
  }
  return out.sort((a, b) => b.percent - a.percent)
}

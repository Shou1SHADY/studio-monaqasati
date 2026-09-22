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

const round2 = (n: number) => Math.round(n * 100) / 100

/** Quantities and prices reach us as typed strings — "1,200", " 40 ", "٤٠". */
export function toAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const cleaned = String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,\s]/g, "")
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

export const PRICING_MODES = ["total", "line"] as const
export type PricingMode = (typeof PRICING_MODES)[number]

export interface PricedRfq {
  pricingMode?: string | null
  shipmentMode?: string | null
  products?: RfqProductLike[] | null
}

export interface RfqProductLike {
  name?: string | null
  quantity?: number | string | null
  unitOfMeasure?: string | null
  unit?: string | null
}

/** An RFQ published before this existed, or one that asked for a total, is a
 * total. Anything unrecognised is a total too — never a mode nobody chose. */
export function pricingModeOf(rfq: PricedRfq | null | undefined): PricingMode {
  return rfq?.pricingMode === "line" && canPriceByLine(rfq) ? "line" : "total"
}

/**
 * Whether this RFQ COULD be priced per line — what the RFQ form offers and what
 * `pricingModeOf` insists on before honouring the stored mode, so an RFQ whose
 * products were later emptied falls back to a total instead of asking for rates
 * that multiply by nothing.
 */
export function canPriceByLine(rfq: PricedRfq | null | undefined): boolean {
  if (!rfq) return false
  if (rfq.shipmentMode === "multiple") return false
  const products = (rfq.products || []).filter((p) => p && (p.name || "").trim())
  if (!products.length) return false
  return products.every((p) => toAmount(p.quantity) > 0)
}

/** The products a line-priced offer must cover, in the order the RFQ lists them
 * — the index IS the identity (`rfqProductIndex`), so the list is never re-sorted. */
export interface PricedProduct {
  rfqProductIndex: number
  name: string
  unit: string
  quantity: number
}

export function pricedProducts(rfq: PricedRfq | null | undefined): PricedProduct[] {
  return (rfq?.products || []).map((p, i) => ({
    rfqProductIndex: i,
    name: (p.name || "").trim(),
    unit: (p.unitOfMeasure || p.unit || "").trim(),
    quantity: toAmount(p.quantity),
  }))
}

export interface OfferLinePrice {
  rfqProductIndex: number
  unitPrice: number
}

export interface OfferPricing {
  /** Only the lines actually priced — what goes on the offer document. */
  lines: OfferLinePrice[]
  /** Σ rate × quantity, rounded — what goes in `price`. */
  total: number
  /** Product indexes still without a rate; the form names them. */
  missing: number[]
  /** Every product priced. `buildPoLines` needs all of them or it keeps none. */
  complete: boolean
}

/**
 * The rates as typed, against the RFQ's own products.
 *
 * A blank or non-positive rate is missing, not zero: "free" is not a quote, and
 * treating it as zero would quietly make an offer look cheaper than the rest.
 */
export function priceOffer(products: PricedProduct[], rates: Record<number, string | number | null | undefined>): OfferPricing {
  const lines: OfferLinePrice[] = []
  const missing: number[] = []
  let total = 0
  for (const p of products) {
    const rate = round2(toAmount(rates[p.rfqProductIndex]))
    if (rate <= 0) {
      missing.push(p.rfqProductIndex)
      continue
    }
    lines.push({ rfqProductIndex: p.rfqProductIndex, unitPrice: rate })
    total += rate * p.quantity
  }
  return { lines, total: round2(total), missing, complete: missing.length === 0 && lines.length > 0 }
}

/** What a line-priced offer adds to the document it already wrote: the rates,
 * and the total in the field every reader has always used. */
export function offerPricingFields(pricing: OfferPricing): { lines: OfferLinePrice[]; price: string } {
  return { lines: pricing.lines, price: String(pricing.total) }
}

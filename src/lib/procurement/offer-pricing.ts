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

import { aboveLastPaid } from "./prices"

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

/**
 * What a PUBLIC endpoint stores when a guest quotes (the RFQ share route).
 *
 * The caller posts rates and a total. In line mode the total is ours to compute
 * and theirs to ignore: an endpoint that believed a posted figure would let a
 * guest name any total it liked beside its rates. In total mode there are no
 * rates to work from, so the posted figure is the quote, validated as before.
 */
export function guestOfferPrice(
  rfq: PricedRfq | null | undefined,
  postedRates: OfferLinePrice[],
  postedTotal: number
): { ok: true; total: number; price: string; lines: OfferLinePrice[] | null } | { ok: false; code: "LINE_PRICES_INCOMPLETE" } {
  if (pricingModeOf(rfq) !== "line") return { ok: true, total: postedTotal, price: String(postedTotal), lines: null }
  const rates: Record<number, number> = {}
  for (const l of postedRates) rates[l.rfqProductIndex] = l.unitPrice
  const pricing = priceOffer(pricedProducts(rfq), rates)
  if (!pricing.complete) return { ok: false, code: "LINE_PRICES_INCOMPLETE" }
  return { ok: true, total: pricing.total, price: String(pricing.total), lines: pricing.lines }
}

type RatedOffer = { price?: unknown; totalBatchesPrice?: unknown; lines?: Array<{ rfqProductIndex?: number | null; unitPrice?: number | string | null }> | null }

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
  if (!products.length) return true
  const quoted = new Map<number, number>()
  for (const l of offer.lines || []) {
    const i = Number(l.rfqProductIndex)
    const rate = toAmount(l.unitPrice)
    if (Number.isInteger(i) && i >= 0 && rate > 0) quoted.set(i, rate)
  }
  if (!products.every((p) => quoted.has(p.rfqProductIndex))) return true
  const total = toAmount(offer.totalBatchesPrice) > 0 ? toAmount(offer.totalBatchesPrice) : toAmount(offer.price)
  if (total <= 0) return true
  const sum = products.reduce((s, p) => s + (quoted.get(p.rfqProductIndex) as number) * p.quantity, 0)
  return Math.abs(round2(sum) - round2(total)) <= 0.01 * products.length + 1e-9
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
  totalBatchesPrice?: number
  deliveryBatches?: Array<Record<string, unknown>>
}

export type PriceRevision = { ok: true; total: number; fields: PriceRevisionFields } | { ok: false; code: "LINE_PRICES_INCOMPLETE" | "INVALID_PRICE" }

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
  input: { total?: string | number | null; rates?: Record<number, string | number | null | undefined> }
): PriceRevision {
  const quoted = (offer.lines || []).length > 0
  const fields: PriceRevisionFields = { price: "" }
  let total: number
  if (quoted && products && products.length) {
    const pricing = priceOffer(products, input.rates || {})
    if (!pricing.complete) return { ok: false, code: "LINE_PRICES_INCOMPLETE" }
    total = pricing.total
    fields.lines = pricing.lines
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
  unitPrice: number
  /** True when the rate was quoted; false when it was divided out of a total. */
  quoted: boolean
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
  const quoted = new Map<number, number>()
  // Stale rates (a total revised without them) are set aside: the total is the
  // offer, and for a single material it still yields the one true rate below.
  if (quotedRatesReconcile(products, offer)) {
    for (const l of offer.lines || []) {
      const i = Number(l.rfqProductIndex)
      const rate = round2(toAmount(l.unitPrice))
      if (Number.isInteger(i) && i >= 0 && rate > 0) quoted.set(i, rate)
    }
  }
  if (quoted.size) {
    return products.filter((p) => quoted.has(p.rfqProductIndex)).map((p) => ({ ...p, unitPrice: quoted.get(p.rfqProductIndex) as number, quoted: true }))
  }
  const total = toAmount(offer.totalBatchesPrice) > 0 ? toAmount(offer.totalBatchesPrice) : toAmount(offer.price)
  const only = products.length === 1 ? products[0] : null
  if (!only || only.quantity <= 0 || total <= 0) return []
  return [{ ...only, unitPrice: round2(total / only.quantity), quoted: false }]
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

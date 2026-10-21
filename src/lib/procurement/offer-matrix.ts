// Offers side by side (customer review, 27 Sep 2026): clicking an RFQ lists
// every offer received with its prices next to the others, without opening
// each quote. Rows are the RFQ's materials, one column per offer; a cell is
// the offer's rate for that material and its line total — or empty when the
// offer quoted only a total, because splitting a total across lines would
// invent prices (§6.2). The bottom row is each offer's total. The lowest live
// rate in a row and the lowest live total are marked; a rejected offer stays
// visible but is out of the running. Sealed offers show no figure at all.
// A partial offer (it prices some of the materials) is never the lowest total: a
// smaller sum over fewer lines is not a better price, so only its rows compete.
// Pure: no I/O.

import { competingOffers } from "./award"
import { offerCoverage, offerRates, pricedProducts, type PricedRfq, type RatedOffer } from "./offer-pricing"
import { offerPrice } from "./po"

const round2 = (n: number) => Math.round(n * 100) / 100

export interface MatrixOffer extends RatedOffer {
  id: string
  status?: string | null
  price?: string | number | null
}

export interface MatrixColumn {
  offerId: string
  /** The offer's total, or null when it carries none. */
  total: number | null
  rejected: boolean
  lowestTotal: boolean
  /** Set when the offer prices only some of the materials — «covers N of M». */
  partial: { covered: number; of: number } | null
}

export interface MatrixCell {
  offerId: string
  unitPrice: number | null
  lineTotal: number | null
  /** The rate was quoted line by line (not derived from a one-material total). */
  quoted: boolean
  lowest: boolean
  /** A partial offer that leaves this material out — «not covered», which is not the same as «total only». */
  notCovered: boolean
}

export interface MatrixRow {
  rfqProductIndex: number
  name: string
  unit: string
  quantity: number
  cells: MatrixCell[]
}

export interface OfferMatrix {
  columns: MatrixColumn[]
  rows: MatrixRow[]
  /** At least one offer priced a material — worth drawing the material rows. */
  hasRates: boolean
}

export function offerMatrix(rfq: PricedRfq | null | undefined, offers: MatrixOffer[]): OfferMatrix {
  const live = new Set(competingOffers(offers).map((o) => o.id))
  const totals = offers.map((o) => offerPrice(o))
  const coverage = offers.map((o) => offerCoverage(rfq, o))
  const whole = (i: number) => !coverage[i].partial
  const liveTotals = offers.map((o, i) => (live.has(o.id) && whole(i) ? totals[i] : null)).filter((n): n is number => n != null)
  const minTotal = liveTotals.length ? Math.min(...liveTotals) : null
  const columns: MatrixColumn[] = offers.map((o, i) => ({
    offerId: o.id,
    total: totals[i],
    rejected: !live.has(o.id),
    lowestTotal: liveTotals.length > 1 && live.has(o.id) && whole(i) && totals[i] === minTotal,
    partial: coverage[i].partial ? { covered: coverage[i].covered, of: coverage[i].of } : null,
  }))

  const rates = offers.map((o) => new Map(offerRates(rfq, o).map((r) => [r.rfqProductIndex, r])))
  let hasRates = false
  const rows: MatrixRow[] = pricedProducts(rfq).map((p) => {
    const raw = offers.map((o, i) => {
      const r = rates[i].get(p.rfqProductIndex)
      if (r) hasRates = true
      return {
        offerId: o.id,
        unitPrice: r ? r.unitPrice : null,
        lineTotal: r && p.quantity > 0 ? round2(r.unitPrice * p.quantity) : null,
        quoted: Boolean(r?.quoted),
        notCovered: !r && coverage[i].uncovered.includes(p.rfqProductIndex),
      }
    })
    const liveRates = raw.filter((c) => live.has(c.offerId) && c.unitPrice != null).map((c) => c.unitPrice as number)
    const min = liveRates.length ? Math.min(...liveRates) : null
    return {
      rfqProductIndex: p.rfqProductIndex,
      name: p.name,
      unit: p.unit,
      quantity: p.quantity,
      cells: raw.map((c) => ({ ...c, lowest: min != null && live.has(c.offerId) && c.unitPrice === min && liveRates.length > 1 })),
    }
  })
  return { columns, rows, hasRates }
}

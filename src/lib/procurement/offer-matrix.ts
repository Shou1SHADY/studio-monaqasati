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
//
// Procurement 2.0: the numbers come from offer-calc.ts (pieces, effective price, VAT-free ranking, the 0.5 % tie
// band), so every offer inside the band of the lowest is marked «lowest», not just the first. Pure: no I/O.

import { competingOffers } from "./award"
import { evaluateOffers, fromHalalas, lineOf, type EvalOptions, type PackInfo } from "./offer-calc"
import { pricedProducts, type PricedRfq, type RatedOffer } from "./offer-pricing"

export interface MatrixOffer extends RatedOffer {
  id: string
  status?: string | null
  price?: string | number | null
}

export interface MatrixColumn {
  offerId: string
  /** The offer's total (ex-VAT), or null when it carries none. */
  total: number | null
  rejected: boolean
  lowestTotal: boolean
  /** Set when the offer prices only some of the materials — «covers N of M». */
  partial: { covered: number; of: number } | null
}

export interface MatrixCell {
  offerId: string
  /** Per request unit; for a per-piece line the effective price (paid ÷ requested). */
  unitPrice: number | null
  lineTotal: number | null
  /** The rate was quoted line by line (not derived from a one-material total). */
  quoted: boolean
  lowest: boolean
  /** A partial offer that leaves this material out — «not covered», which is not the same as «total only». */
  notCovered: boolean
  /** Priced by the piece: pieces, what you receive, the surplus. */
  pack?: PackInfo
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

export function offerMatrix(rfq: PricedRfq | null | undefined, offers: MatrixOffer[], opts?: EvalOptions): OfferMatrix {
  const live = new Set(competingOffers(offers).map((o) => o.id))
  const ev = evaluateOffers(rfq, offers.map((o) => ({ ...o, excluded: !live.has(o.id) })), opts)
  const liveWhole = ev.offers.filter((o) => o.live && o.complete && o.netH != null)

  const columns: MatrixColumn[] = ev.offers.map((o) => ({
    offerId: o.id,
    total: o.netH == null ? null : fromHalalas(o.netH),
    rejected: !o.live,
    lowestTotal: liveWhole.length > 1 && o.live && o.complete && o.isLowestComplete,
    partial: o.partial ? { covered: o.covered, of: o.of } : null,
  }))

  let hasRates = false
  const rows: MatrixRow[] = pricedProducts(rfq).map((p) => {
    const line = ev.lines.find((l) => l.rfqProductIndex === p.rfqProductIndex)
    const priced = ev.offers.filter((o) => o.live && lineOf(o, p.rfqProductIndex)).length
    return {
      rfqProductIndex: p.rfqProductIndex,
      name: p.name,
      unit: p.unit,
      quantity: p.quantity,
      cells: ev.offers.map((o) => {
        const l = lineOf(o, p.rfqProductIndex)
        if (l) hasRates = true
        return {
          offerId: o.id,
          unitPrice: l ? fromHalalas(l.effH) : null,
          lineTotal: l && p.quantity > 0 ? fromHalalas(l.totalH) : null,
          quoted: Boolean(l?.quoted),
          lowest: Boolean(l && o.live && priced > 1 && line?.lowestIds.includes(o.id)),
          notCovered: !l && o.uncovered.includes(p.rfqProductIndex),
          ...(l?.pack ? { pack: l.pack } : {}),
        }
      }),
    }
  })
  return { columns, rows, hasRates }
}

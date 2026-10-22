// What the visitor's page shows while he prices: the same maths as the comparison and the order (offer-calc), never a
// second copy of it. A line is priced per request unit or per piece; a piece line is ⌈qty ÷ length⌉ whole pieces.

import { fromHalalas, lineCalc, toAmount, type LineCalc } from "./offer-calc"

export { lineCalc, toAmount, type LineCalc }

export interface LineTotal {
  /** Whole pieces to buy, when priced by the piece. */
  pcs: number | null
  /** What the pieces add up to in request units — 120 for «20 قطعة 6 م». */
  received: number | null
  /** Pieces beyond the quantity asked, in request units. */
  extra: number
  /** The line's cost ex-VAT, riyals. */
  total: number
  /** total ÷ the quantity asked: the number the comparison ranks. */
  effective: number
  per: number | null
}

/** One line as the visitor typed it. A blank, zero or unreadable rate prices nothing. */
export function lineTotal(qty: number, price: unknown, per?: number | null): LineTotal | null {
  if (!(toAmount(price) > 0) || !(qty > 0)) return null
  const calc = lineCalc(qty, price, per ?? undefined)
  return {
    pcs: calc.pack?.pcs ?? null,
    received: calc.pack?.received ?? null,
    extra: calc.pack?.extra ?? 0,
    total: fromHalalas(calc.totalH),
    effective: fromHalalas(calc.effH),
    per: calc.pack?.packLen ?? null,
  }
}

export interface PriceLine {
  qty: number
  price: unknown
  per?: number | null
  skipped?: boolean
}

/** The offer's total ex-VAT: the sum of the lines he prices, to the halala. */
export function linesNet(lines: readonly PriceLine[]): number {
  let totalH = 0
  for (const l of lines) {
    if (l.skipped) continue
    const x = lineTotal(l.qty, l.price, l.per)
    if (x) totalH += Math.round(x.total * 100)
  }
  return totalH / 100
}

export const VISITOR_VAT = 0.15

/** The total with VAT, or the net when he is not registered. */
export const grossOf = (net: number, vatRegistered: boolean): number => Math.round(net * (vatRegistered ? 1 + VISITOR_VAT : 1) * 100) / 100

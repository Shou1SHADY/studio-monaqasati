// The geometry of the price-history chart (SUP-05, prototype `phChart`): a line per supplier through the prices we committed
// to, a FILLED dot for an order, a HOLLOW dot for an offer that did not become one, a SQUARE for an agreement. Pure — the view
// draws what this returns, so the picture can be tested without a browser.

import type { PricePoint } from "./prices"

export const CHART_MONTHS = 6
/** The supplier colours the view maps to its tokens, in order of first appearance. */
export const CHART_COLORS = 6

export type DotShape = "filled" | "hollow" | "square"

export interface ChartDot {
  id: string
  x: number
  y: number
  shape: DotShape
  /** Index into the supplier list (and so into the colour tokens). */
  supplier: number
  point: PricePoint
}

export interface ChartLine {
  supplier: number
  path: string
}

export interface PriceChart {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
  suppliers: Array<{ key: string; name: string }>
  lines: ChartLine[]
  dots: ChartDot[]
  yTicks: Array<{ y: number; value: number }>
  /** First days of the months inside the window, with their position. */
  xTicks: Array<{ x: number; month: string }>
  /** The window actually drawn: from the first of the month `months - 1` back, to today. */
  from: string
  to: string
  /** Points older than the window — still in the table, not on the chart. */
  hidden: number
}

const DAY = 86_400_000
const t = (day: string) => Date.parse(`${day}T00:00:00Z`)

function monthStart(today: string, back: number): string {
  const d = new Date(t(today))
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - back)
  return d.toISOString().slice(0, 10)
}

/** 1, 2, 2.5, 5 × a power of ten: axis lines on round numbers, never 2,658.5. */
export function niceTicks(lo: number, hi: number, want = 3): number[] {
  const raw = (hi - lo) / want
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = ([1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) as number) || 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

export function priceChart(points: PricePoint[], opts: { today: string; months?: number; width?: number; height?: number }): PriceChart {
  const months = opts.months ?? CHART_MONTHS
  const width = opts.width ?? 640
  const height = opts.height ?? 230
  const left = 52
  const right = 14
  const top = 14
  const bottom = 30
  const from = monthStart(opts.today, months - 1)
  const to = opts.today
  const span = Math.max(1, (t(to) - t(from)) / DAY)
  const x = (day: string) => left + (Math.max(0, Math.min(span, (t(day) - t(from)) / DAY)) / span) * (width - left - right)

  const visible = points.filter((p) => p.day >= from && p.day <= to)
  const suppliers: Array<{ key: string; name: string }> = []
  for (const p of visible) if (!suppliers.some((s) => s.key === p.supplierKey)) suppliers.push({ key: p.supplierKey, name: p.supplier })
  const indexOf = (key: string) => suppliers.findIndex((s) => s.key === key)

  const prices = visible.map((p) => p.price)
  const min = prices.length ? Math.min(...prices) : 0
  const max = prices.length ? Math.max(...prices) : 1
  const pad = (max - min) * 0.15 || max * 0.02 || 1
  const lo = min - pad
  const hi = max + pad
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * (height - top - bottom)

  const lines: ChartLine[] = suppliers
    .map((s, i) => {
      const own = visible.filter((p) => p.awarded && p.supplierKey === s.key)
      return { supplier: i, path: own.length > 1 ? own.map((p, k) => `${k ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p.price).toFixed(1)}`).join(" ") : "" }
    })
    .filter((l) => l.path)

  const dots: ChartDot[] = visible.map((p) => ({ id: p.id, x: x(p.day), y: y(p.price), shape: !p.awarded ? "hollow" : p.source === "agreement" ? "square" : "filled", supplier: indexOf(p.supplierKey), point: p }))

  const xTicks = Array.from({ length: months }, (_, i) => monthStart(opts.today, months - 1 - i)).map((day) => ({ x: x(day), month: day.slice(0, 7) }))

  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    suppliers,
    lines,
    dots,
    yTicks: visible.length ? niceTicks(lo, hi).map((v) => ({ y: y(v), value: v })) : [],
    xTicks,
    from,
    to,
    hidden: points.length - visible.length,
  }
}

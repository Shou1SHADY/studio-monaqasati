/**
 * Procurement 2.0, SUP-05 / SUP-06 / WF-24 / R-28 / R-33 — price history by material: last · low and high · average · change,
 * a series built from the orders, the offers and the agreements themselves (an offer that did not become an order is a hollow
 * dot), the change against the previous purchase, and what an agreement has consumed of its cap. The fixture is the
 * prototype's rebar 16 mm series: 7 purchases, average 2,811.43, change −1.1 % from 2,810 to 2,780.
 */

import { CHART_MONTHS, niceTicks, priceChart } from "@/lib/procurement/price-chart"
import {
  agreementConsumption,
  diffVsPrevious,
  historyRowsForApproval,
  materialKey,
  priceSeries,
  priceStats,
  specKeyOf,
  type CappedAgreementLine,
  type PriceAgreement,
  type PriceHistoryEntry,
  type PriceOfferLike,
  type PriceRfqLike,
} from "@/lib/procurement/prices"
import { cleanAgreementLines } from "@/lib/procurement/agreement-writes"
import type { PurchaseOrder } from "@/lib/procurement/types"

const TODAY = "2026-10-21"
const at = (offset: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)

const NAME = "حديد تسليح 16 مم · G60"
const UNIT = "طن"
const KEY = materialKey(NAME, UNIT)

type Raw = [number, string, number, number, "po" | "off", string]
const R16: Raw[] = [
  [-170, "s11", 2690, 0, "off", "RFQ-2025/061"],
  [-150, "s1", 2720, 18, "po", "PO-2025/171"],
  [-120, "s1", 2750, 12, "po", "PO-2025/194"],
  [-95, "s4", 2705, 0, "off", "RFQ-2025/079"],
  [-70, "s1", 2810, 15, "po", "PO-2025/207"],
  [-45, "s1", 2840, 10, "po", "PO-2025/219"],
  [-39, "s11", 2860, 0, "off", "RFQ-2026/001"],
  [-31, "s1", 2900, 10, "po", "PO-2026/001"],
  [-14, "s1", 2880, 10, "po", "PO-2026/009"],
  [-4, "s4", 2780, 12, "po", "PO-2026/005"],
]
const SUPPLIER = (id: string) => `مورد ${id}`

const history: PriceHistoryEntry[] = R16.filter((r) => r[4] === "po").map(([off, sup, price, , , ref]) => ({
  id: `${ref}__l1`,
  organizationId: "acme",
  materialKey: KEY,
  name: NAME,
  unit: UNIT,
  supplierOrgId: sup,
  supplierName: SUPPLIER(sup),
  price,
  day: at(off),
  kind: "po",
  poId: ref,
  poNumber: ref,
}))
const rfqs: PriceRfqLike[] = [{ id: "rfq1", title: "حديد", rfqNumber: "RFQ-2026/001", products: [{ name: NAME, unitOfMeasure: UNIT }] }]
const offers: PriceOfferLike[] = R16.filter((r) => r[4] === "off").map(([off, sup, price, , , ref]) => ({ id: `off-${ref}`, rfqId: "rfq1", status: "جديد", organizationId: sup, supplierName: SUPPLIER(sup), createdAt: `${at(off)}T08:00:00Z`, lines: [{ rfqProductIndex: 0, unitPrice: price }] }))

describe("the series: orders, offers and agreements, oldest first", () => {
  it("has a point for every committed price and every offer that did not win — 7 + 3 — each marked by its source", () => {
    const pts = priceSeries(KEY, { history, offers, rfqs })
    expect(pts).toHaveLength(10)
    expect(pts.map((p) => p.day)).toEqual([...pts.map((p) => p.day)].sort())
    expect(pts.filter((p) => p.source === "po" && p.awarded)).toHaveLength(7)
    expect(pts.filter((p) => p.source === "offer" && !p.awarded)).toHaveLength(3)
    expect(pts[0]).toMatchObject({ source: "offer", price: 2690, awarded: false, supplier: SUPPLIER("s11") })
  })

  it("an offer that became an order is the order's point, not a second one; a withdrawn offer, a lump-sum quote and a piece rate are not evidence", () => {
    const extra: PriceOfferLike[] = [
      { ...offers[0], id: "won", status: "مقبول" },
      { ...offers[0], id: "withdrawn", status: "مسحوب" },
      { ...offers[0], id: "lump", lump: 12000 },
      { ...offers[0], id: "piece", lines: [{ rfqProductIndex: 0, unitPrice: 30, packLen: 6 }] },
    ]
    expect(priceSeries(KEY, { history, offers: extra, rfqs }).filter((p) => p.source === "offer")).toHaveLength(0)
  })

  it("only the rows of a purchase: an invoice-variance row is not a price we committed to", () => {
    const withVariance: PriceHistoryEntry[] = [...history, { ...history[0], id: "v1", kind: "variance", price: 9999 }]
    expect(priceSeries(KEY, { history: withVariance }).map((p) => p.price)).not.toContain(9999)
  })

  it("a lump-sum order never enters the history — it has no unit price to record", () => {
    const po = { id: "po9", docNumber: "PO-2026/099", supplierOrgId: "s1", supplierName: "x", organizationId: "acme", lines: [{ id: "l1", name: NAME, unit: UNIT, quantity: 5, unitPrice: null, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] } as unknown as PurchaseOrder
    expect(historyRowsForApproval(po, `${TODAY}T08:00:00Z`)).toEqual([])
  })

  it("R-28: the series of a SPECIFICATION is the specification's — a 20 cm block's prices are no evidence for a 15 cm one", () => {
    const block = (size: string, price: number, id: string) => {
      const m = { nodeId: "block", specs: [{ name: { ar: "السماكة" }, value: { ar: size } }] }
      const { specKey } = specKeyOf({ material: m, unitOfMeasure: "حبة" })
      return { id, organizationId: "acme", materialKey: materialKey("بلوك", "حبة"), specKey, materialId: "block", name: "بلوك", unit: "حبة", supplierOrgId: "s3", supplierName: "x", price, day: at(-5), kind: "po" as const, poId: id, poNumber: id }
    }
    const rows = [block("20 سم", 4.5, "a"), block("15 سم", 3.9, "b")]
    const key20 = rows[0].specKey as string
    expect(priceSeries(key20, { history: rows }).map((p) => p.price)).toEqual([4.5])
    expect(priceSeries(materialKey("بلوك", "حبة"), { history: rows }).map((p) => p.price).sort()).toEqual([3.9, 4.5])
  })

  it("an agreement is a square on the day it starts, at its agreed price, awarded by definition (R-33: an order on it records the same price)", () => {
    const agreement: PriceAgreement = { id: "a2", organizationId: "acme", docNumber: "AG-2026/02", supplierOrgId: "s1", supplierName: SUPPLIER("s1"), from: at(-30), until: at(60), lines: [{ name: NAME, unit: UNIT, price: 2850 }], preparedById: "u", preparedByName: "u", createdAt: at(-30) }
    const pts = priceSeries(KEY, { history, offers, rfqs, agreements: [agreement] })
    const sq = pts.find((p) => p.source === "agreement")
    expect(sq).toMatchObject({ price: 2850, awarded: true, agreementNo: "AG-2026/02", day: at(-30) })
  })
})

describe("the tiles: last · low and high · average · change", () => {
  const pts = priceSeries(KEY, { history, offers, rfqs })

  it("7 purchases, average 2,811.43, low 2,720, high 2,900, last 2,780 from the supplier of the day", () => {
    const s = priceStats(pts)
    expect(s.purchases).toBe(7)
    expect(s.average).toBe(2811.43)
    expect(s.min).toBe(2720)
    expect(s.max).toBe(2900)
    expect(s.last).toMatchObject({ price: 2780, supplier: SUPPLIER("s4"), day: at(-4) })
  })

  it("the change is −1.1 % from 2,810 to 2,780 — offers are never the baseline", () => {
    const s = priceStats(pts)
    expect(s.baseline).toMatchObject({ price: 2810, day: at(-70) })
    expect(s.changePercent).toBe(-1.1)
  })

  it("a material bought once has no change; none has no tiles", () => {
    expect(priceStats(pts.filter((p) => p.price === 2780)).changePercent).toBeNull()
    expect(priceStats([])).toMatchObject({ purchases: 0, last: null, average: null, changePercent: null })
  })

  it("each purchase carries its difference from the previous purchase; an offer carries none", () => {
    const d = diffVsPrevious(pts)
    const lastBuy = pts.filter((p) => p.awarded).at(-1) as (typeof pts)[number]
    expect(d.get(lastBuy.id)).toBe(-3.5)
    expect(pts.filter((p) => !p.awarded).every((p) => d.get(p.id) === null)).toBe(true)
    expect(d.get(pts.find((p) => p.awarded)!.id)).toBeNull()
  })
})

describe("the chart: filled for an order, hollow for an offer not awarded, square for an agreement", () => {
  const agreement: PriceAgreement = { id: "a2", organizationId: "acme", docNumber: "AG-2026/02", supplierOrgId: "s1", supplierName: SUPPLIER("s1"), from: at(-30), until: at(60), lines: [{ name: NAME, unit: UNIT, price: 2850 }], preparedById: "u", preparedByName: "u", createdAt: at(-30) }
  const pts = priceSeries(KEY, { history, offers, rfqs, agreements: [agreement] })
  const chart = priceChart(pts, { today: TODAY })

  it("draws the last six months: older points stay in the table, not on the chart", () => {
    expect(chart.from).toBe("2026-05-01")
    expect(CHART_MONTHS).toBe(6)
    expect(chart.xTicks.map((t) => t.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])
    expect(chart.hidden).toBe(0)
    const old = priceChart([...pts, { ...pts[0], id: "ancient", day: "2025-01-01" }], { today: TODAY })
    expect(old.hidden).toBe(1)
  })

  it("shapes: an order is filled, an offer not awarded is hollow, an agreement is a square", () => {
    const shape = (id: string) => chart.dots.find((d) => d.id === id)?.shape
    expect(shape(pts.find((p) => p.source === "po")!.id)).toBe("filled")
    expect(shape(pts.find((p) => p.source === "offer")!.id)).toBe("hollow")
    expect(shape(pts.find((p) => p.source === "agreement")!.id)).toBe("square")
    expect(chart.dots.filter((d) => d.shape === "hollow")).toHaveLength(3)
  })

  it("one line per supplier through his committed prices only, never through an offer", () => {
    expect(chart.suppliers.map((s) => s.name)).toEqual(expect.arrayContaining([SUPPLIER("s1"), SUPPLIER("s4"), SUPPLIER("s11")]))
    const s11 = chart.suppliers.findIndex((s) => s.key === "s11")
    expect(chart.lines.some((l) => l.supplier === s11)).toBe(false)
    expect(chart.lines.some((l) => l.supplier === chart.suppliers.findIndex((s) => s.key === "s1"))).toBe(true)
  })

  it("later is further along the axis, dearer is higher up, and the axis lines are round numbers", () => {
    const [a, b] = chart.dots.filter((d) => d.point.supplierKey === "s1" && d.shape === "filled").slice(-2)
    expect(b.x).toBeGreaterThan(a.x)
    const cheap = chart.dots.find((d) => d.point.price === 2720)
    const dear = chart.dots.find((d) => d.point.price === 2900)
    expect(dear!.y).toBeLessThan(cheap!.y)
    expect(chart.yTicks.every((t) => Number.isInteger(t.value * 2))).toBe(true)
    expect(niceTicks(2650, 2950)).toEqual([2700, 2800, 2900])
  })
})

describe("SUP-06: an agreement's cap and what is consumed", () => {
  const agreement: PriceAgreement = {
    id: "a1",
    organizationId: "acme",
    docNumber: "AG-2026/01",
    supplierOrgId: "s7",
    supplierName: "خرسانة",
    from: at(-60),
    until: at(120),
    lines: [{ name: "خرسانة جاهزة C30", unit: "م³", price: 268, cap: 600 } as CappedAgreementLine, { name: "ضخ", unit: "ساعة", price: 90 }],
    preparedById: "u",
    preparedByName: "u",
    createdAt: at(-60),
  }
  const order = (id: string, qty: number, over: Record<string, unknown> = {}) =>
    ({ id, agreementId: "a1", status: "approved", lines: [{ id: "l1", name: "خرسانة جاهزة C30", unit: "م³", quantity: qty, unitPrice: 268, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], ...over }) as unknown as PurchaseOrder

  it("240 of 600 consumed by the orders that name it; the rest is what is left", () => {
    const [line] = agreementConsumption(agreement, [order("o1", 180), order("o2", 60)])
    expect(line).toMatchObject({ cap: 600, consumed: 240, left: 360, usedPercent: 40 })
  })

  it("a cancelled order consumes nothing; a cancelled remainder is not consumed", () => {
    const [line] = agreementConsumption(agreement, [order("o1", 100, { status: "cancelled" }), order("o2", 100, { lines: [{ id: "l1", name: "خرسانة جاهزة C30", unit: "م³", quantity: 100, unitPrice: 268, accepted: 0, rejected: 0, held: 0, cancelled: 40 }] })])
    expect(line.consumed).toBe(60)
  })

  it("a line with no cap states none — and is never given an invented one", () => {
    const [, pump] = agreementConsumption(agreement, [order("o1", 10)])
    expect(pump).toMatchObject({ cap: null, left: null, usedPercent: null, consumed: 0 })
  })

  it("an order past the cap reads over 100 % and leaves nothing — it is shown, not hidden", () => {
    const [line] = agreementConsumption(agreement, [order("o1", 700)])
    expect(line).toMatchObject({ consumed: 700, left: 0, usedPercent: 116.7 })
  })

  it("orders on other agreements do not count", () => {
    expect(agreementConsumption(agreement, [order("o1", 50, { agreementId: "a9" })])[0].consumed).toBe(0)
  })
})

describe("SUP-06: the cap is kept when an agreement is signed", () => {
  it("a stated cap is stored on its line; no cap, a zero or a word store none", () => {
    const lines = cleanAgreementLines([
      { name: "خرسانة", unit: "م³", price: "268", cap: "600" },
      { name: "ضخ", unit: "ساعة", price: 90, cap: "" },
      { name: "حديد", unit: "طن", price: 2850, cap: "0" },
      { name: "أسمنت", unit: "كيس", price: 16, cap: "كثير" },
      { name: "رمل", unit: "م³", price: 40, cap: "1,200" },
    ])
    expect(lines.map((l) => (l as { cap?: number }).cap)).toEqual([600, undefined, undefined, undefined, 1200])
  })
})

describe("NFR-03: fifty offers and hundreds of purchases on one material stay instant", () => {
  const many: PriceHistoryEntry[] = Array.from({ length: 300 }, (_, i) => ({ id: `h${i}__l1`, organizationId: "acme", materialKey: KEY, name: NAME, unit: UNIT, supplierOrgId: `s${i % 9}`, supplierName: `مورد ${i % 9}`, price: 2600 + (i % 40) * 10, day: at(-(i % 170)), kind: "po", poId: `h${i}`, poNumber: `PO-2026/${i}` }))
  const fifty: PriceOfferLike[] = Array.from({ length: 50 }, (_, i) => ({ id: `off${i}`, rfqId: "rfq1", status: "جديد", organizationId: `q${i}`, supplierName: `عارض ${i}`, createdAt: `${at(-(i * 3 + 1))}T08:00:00Z`, lines: [{ rfqProductIndex: 0, unitPrice: 2700 + i }] }))

  it("builds the series, the tiles, the differences and the chart in well under a second", () => {
    const t0 = performance.now()
    const pts = priceSeries(KEY, { history: many, offers: fifty, rfqs })
    const stats = priceStats(pts)
    const diffs = diffVsPrevious(pts)
    const chart = priceChart(pts, { today: TODAY })
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(pts).toHaveLength(350)
    expect(stats.purchases).toBe(300)
    expect(diffs.size).toBe(350)
    expect(chart.dots.length).toBeGreaterThan(0)
    expect(chart.suppliers.length).toBe(9 + 50 - chart.suppliers.filter((s) => s.key.startsWith("q") && !chart.dots.some((d) => d.point.supplierKey === s.key)).length)
  })
})

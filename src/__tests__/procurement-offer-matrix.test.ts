/**
 * Offers side by side (customer review, 27 Sep 2026): one row per material,
 * one column per offer, rates and line totals where the offer priced them,
 * each offer's total, and the lowest live figure marked. A total is never
 * split across lines, and a rejected offer is visible but out of the running.
 */

import { offerMatrix, type MatrixOffer } from "@/lib/procurement/offer-matrix"

const rfq = {
  pricingMode: "line",
  products: [
    { name: "Rebar 16mm", quantity: 10, unitOfMeasure: "ton" },
    { name: "Cement", quantity: 200, unitOfMeasure: "bag" },
  ],
}

const offers: MatrixOffer[] = [
  { id: "a", status: "قيد المراجعة", price: 34_000, lines: [{ rfqProductIndex: 0, unitPrice: 3_000 }, { rfqProductIndex: 1, unitPrice: 20 }] },
  { id: "b", status: "قيد المراجعة", price: 33_600, lines: [{ rfqProductIndex: 0, unitPrice: 2_900 }, { rfqProductIndex: 1, unitPrice: 23 }] },
  { id: "c", status: "مرفوض", price: 30_000, lines: [{ rfqProductIndex: 0, unitPrice: 2_600 }, { rfqProductIndex: 1, unitPrice: 20 }] },
  { id: "d", status: "قيد المراجعة", price: 35_000 },
]

describe("offers side by side", () => {
  const m = offerMatrix(rfq, offers)

  it("a row per material, a cell per offer with its rate and line total", () => {
    expect(m.rows.map((r) => r.name)).toEqual(["Rebar 16mm", "Cement"])
    expect(m.rows[0].cells.find((c) => c.offerId === "a")).toMatchObject({ unitPrice: 3_000, lineTotal: 30_000, quoted: true })
    expect(m.hasRates).toBe(true)
  })

  it("an offer that quoted only a total gets no invented rates", () => {
    expect(m.rows.every((r) => r.cells.find((c) => c.offerId === "d")?.unitPrice === null)).toBe(true)
    expect(m.columns.find((c) => c.offerId === "d")?.total).toBe(35_000)
  })

  it("the lowest live rate and total are marked; a rejected offer never wins", () => {
    expect(m.rows[0].cells.filter((c) => c.lowest).map((c) => c.offerId)).toEqual(["b"])
    expect(m.rows[1].cells.filter((c) => c.lowest).map((c) => c.offerId)).toEqual(["a"])
    expect(m.columns.filter((c) => c.lowestTotal).map((c) => c.offerId)).toEqual(["b"])
    expect(m.columns.find((c) => c.offerId === "c")).toMatchObject({ rejected: true, lowestTotal: false })
  })

  it("a single offer marks nothing as lowest; one material and a total yields its rate", () => {
    const one = offerMatrix({ products: [{ name: "Tiles", quantity: 100, unitOfMeasure: "m²" }] }, [{ id: "x", status: "قيد المراجعة", price: 11_800 }])
    expect(one.columns[0].lowestTotal).toBe(false)
    expect(one.rows[0].cells[0]).toMatchObject({ unitPrice: 118, lineTotal: 11_800, quoted: false, lowest: false })
  })
})

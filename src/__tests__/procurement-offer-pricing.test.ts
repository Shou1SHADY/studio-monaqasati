/**
 * Procurement PRD 3.0 §4 — an offer priced per line.
 *
 * Every offer in this product was a single figure, so `buildPoLines` wrote
 * `unitPrice: null` on every order line and nothing downstream had a price to
 * compare: no drift, no history, no "above what we last paid", no estimated
 * value to route a need on. These are the rules that turn typed rates into the
 * one total every existing reader already uses.
 */

import {
  PRICING_MODES,
  canPriceByLine,
  offerPricingFields,
  priceOffer,
  pricedProducts,
  pricingModeOf,
  toAmount,
} from "@/lib/procurement/offer-pricing"
import { buildPoLines } from "@/lib/procurement/writes"

const rfq = (over: Record<string, unknown> = {}) => ({
  pricingMode: "line",
  products: [
    { name: "حديد 12مم", quantity: "10", unitOfMeasure: "طن" },
    { name: "أسمنت", quantity: 100, unitOfMeasure: "كيس" },
  ],
  ...over,
})

describe("reading a number somebody typed", () => {
  it("takes it with separators, spaces and Arabic-Indic digits", () => {
    expect(toAmount("2,780.50")).toBe(2780.5)
    expect(toAmount(" 40 ")).toBe(40)
    expect(toAmount("٤٠")).toBe(40)
    expect(toAmount(15)).toBe(15)
  })

  it("reads nonsense as nothing rather than NaN", () => {
    expect(toAmount("abc")).toBe(0)
    expect(toAmount("")).toBe(0)
    expect(toAmount(null)).toBe(0)
    expect(toAmount(undefined)).toBe(0)
    expect(toAmount(Number.NaN)).toBe(0)
    expect(toAmount(Infinity)).toBe(0)
  })
})

describe("which RFQs may be priced per line", () => {
  it("may, when every product has a name and a quantity", () => {
    expect(canPriceByLine(rfq())).toBe(true)
  })

  it("may not, on a multi-shipment RFQ", () => {
    // There the total is already derived from the batches; two derivations of
    // one number disagree eventually.
    expect(canPriceByLine(rfq({ shipmentMode: "multiple" }))).toBe(false)
  })

  it("may not, when a product has no quantity to multiply by", () => {
    expect(canPriceByLine(rfq({ products: [{ name: "حديد", quantity: "", unitOfMeasure: "طن" }] }))).toBe(false)
    expect(canPriceByLine(rfq({ products: [{ name: "حديد", quantity: 0, unitOfMeasure: "طن" }] }))).toBe(false)
  })

  it("may not, with no products at all", () => {
    expect(canPriceByLine(rfq({ products: [] }))).toBe(false)
    expect(canPriceByLine(rfq({ products: null }))).toBe(false)
    expect(canPriceByLine(null)).toBe(false)
  })
})

describe("the mode an offer is asked for", () => {
  it("is a total unless the RFQ asked for lines", () => {
    expect(pricingModeOf(rfq({ pricingMode: "total" }))).toBe("total")
    expect(pricingModeOf(rfq({ pricingMode: undefined }))).toBe("total")
    expect(pricingModeOf(rfq({ pricingMode: "per_item" }))).toBe("total")
    expect(pricingModeOf(null)).toBe("total")
    expect(PRICING_MODES).toEqual(["total", "line"])
  })

  it("is lines when it asked and still can", () => {
    expect(pricingModeOf(rfq())).toBe("line")
  })

  it("falls back to a total when the RFQ can no longer support lines", () => {
    // An RFQ edited down to no quantities would otherwise ask for rates that
    // multiply by nothing.
    expect(pricingModeOf(rfq({ products: [{ name: "حديد", quantity: 0 }] }))).toBe("total")
    expect(pricingModeOf(rfq({ shipmentMode: "multiple" }))).toBe("total")
  })
})

describe("the products a line-priced offer covers", () => {
  it("keeps the RFQ's own order, because the index is the identity", () => {
    expect(pricedProducts(rfq())).toEqual([
      { rfqProductIndex: 0, name: "حديد 12مم", unit: "طن", quantity: 10 },
      { rfqProductIndex: 1, name: "أسمنت", unit: "كيس", quantity: 100 },
    ])
  })

  it("reads the older `unit` spelling as well", () => {
    expect(pricedProducts(rfq({ products: [{ name: "x", quantity: 2, unit: "م" }] }))[0].unit).toBe("م")
  })
})

describe("the rates as typed", () => {
  const products = pricedProducts(rfq())

  it("sums rate × quantity into the total", () => {
    const p = priceOffer(products, { 0: "2780", 1: "15.2" })
    expect(p.lines).toEqual([
      { rfqProductIndex: 0, unitPrice: 2780 },
      { rfqProductIndex: 1, unitPrice: 15.2 },
    ])
    expect(p.total).toBe(29320)
    expect(p.complete).toBe(true)
    expect(p.missing).toEqual([])
  })

  it("rounds the RATE to halalas first, so the total is the sum of the stored lines", () => {
    // 0.335 is stored as 0.34, so the total is 3 x 0.34 = 1.02, not 1.005.
    // Rounding only the total would leave an order whose figure does not equal
    // the sum of its own lines — the number that lies (SS6.2).
    const p = priceOffer(pricedProducts(rfq({ products: [{ name: "x", quantity: 3, unitOfMeasure: "u" }] })), { 0: "0.335" })
    expect(p.lines[0].unitPrice).toBe(0.34)
    expect(p.total).toBe(1.02)
  })

  it("always totals exactly the sum of what it stored", () => {
    const many = rfq({ products: [
      { name: "a", quantity: "7", unitOfMeasure: "u" },
      { name: "b", quantity: "1.5", unitOfMeasure: "u" },
      { name: "c", quantity: "120", unitOfMeasure: "u" },
    ] })
    const list = pricedProducts(many)
    const p = priceOffer(list, { 0: "3.333", 1: "19.999", 2: "0.005" })
    const summed = p.lines.reduce((sum, l) => sum + l.unitPrice * (list[l.rfqProductIndex]?.quantity ?? 0), 0)
    expect(p.total).toBe(Math.round(summed * 100) / 100)
  })

  it("names what is still unpriced, and refuses to call it complete", () => {
    const p = priceOffer(products, { 0: "2780" })
    expect(p.missing).toEqual([1])
    expect(p.complete).toBe(false)
    // The rate that WAS given is still kept, so the form does not lose it.
    expect(p.lines).toEqual([{ rfqProductIndex: 0, unitPrice: 2780 }])
  })

  it("treats a zero or negative rate as missing, never as free", () => {
    // Zeroing a line would quietly make the whole offer look cheaper.
    expect(priceOffer(products, { 0: "0", 1: "15.2" }).missing).toEqual([0])
    expect(priceOffer(products, { 0: "-5", 1: "15.2" }).missing).toEqual([0])
    expect(priceOffer(products, { 0: "", 1: "15.2" }).missing).toEqual([0])
  })

  it("is not complete when nothing was priced at all", () => {
    const p = priceOffer(products, {})
    expect(p).toMatchObject({ lines: [], total: 0, complete: false })
    expect(p.missing).toEqual([0, 1])
  })

  it("writes the total into the field every reader already uses", () => {
    expect(offerPricingFields(priceOffer(products, { 0: "2780", 1: "15.2" }))).toEqual({
      lines: [
        { rfqProductIndex: 0, unitPrice: 2780 },
        { rfqProductIndex: 1, unitPrice: 15.2 },
      ],
      price: "29320",
    })
  })
})

describe("what the order then gets — the point of the whole thing", () => {
  const products = pricedProducts(rfq())

  it("carries a real unit price onto every order line", () => {
    const priced = priceOffer(products, { 0: "2780", 1: "15.2" })
    const lines = buildPoLines(rfq(), { ...offerPricingFields(priced) })
    expect(lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice }))).toEqual([
      { name: "حديد 12مم", quantity: 10, unitPrice: 2780 },
      { name: "أسمنت", quantity: 100, unitPrice: 15.2 },
    ])
  })

  it("keeps a lump-sum order lump-sum when only some lines were priced", () => {
    // `buildPoLines` is all-or-nothing on purpose: half a breakdown is not one.
    const half = priceOffer(products, { 0: "2780" })
    const lines = buildPoLines(rfq(), { ...offerPricingFields(half) })
    expect(lines.map((l) => l.unitPrice)).toEqual([null, null])
  })

  it("leaves a total-priced offer exactly as it was", () => {
    const lines = buildPoLines(rfq({ pricingMode: "total" }), { price: "29,320" })
    expect(lines.map((l) => l.unitPrice)).toEqual([null, null])
  })
})

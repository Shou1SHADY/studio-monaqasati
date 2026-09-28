/**
 * The computed route of an incoming need: stock first, then a live agreement,
 * then a direct purchase under the ceiling at the last price paid, else an RFQ.
 */

import { needRoute, type NeedRouteInput } from "@/lib/procurement/route"
import { materialKey, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"

const today = "2026-09-28"

const agreement = (over: Partial<PriceAgreement> = {}): PriceAgreement => ({
  id: "a1",
  organizationId: "org",
  docNumber: "AG-2026/001",
  supplierOrgId: "s1",
  supplierName: "Supplier",
  from: "2026-01-01",
  until: "2026-12-31",
  lines: [{ name: "Cement 50kg", unit: "bag", price: 18 }],
  preparedById: "u",
  preparedByName: "U",
  createdAt: "2026-01-01",
  ...over,
})

const paid = (price: number): PriceHistoryEntry => ({
  id: "h1",
  organizationId: "org",
  materialKey: materialKey("Rebar 12mm", "ton"),
  name: "Rebar 12mm",
  unit: "ton",
  supplierOrgId: "s2",
  supplierName: "Steel",
  price,
  day: "2026-08-01",
  kind: "po",
  poId: "po1",
  poNumber: "PO-2026/001",
})

const need = (over: Partial<NeedRouteInput> = {}): NeedRouteInput => ({
  name: "Rebar 12mm",
  unit: "ton",
  quantity: 2,
  onHand: null,
  agreements: [],
  history: [],
  directCap: 5000,
  today,
  ...over,
})

describe("needRoute", () => {
  it("reserves stock when enough is on hand", () => {
    expect(needRoute(need({ onHand: 5 }))).toBe("stock")
    expect(needRoute(need({ onHand: 1 }))).toBe("rfq")
  })

  it("orders on a live agreement that covers the material", () => {
    expect(needRoute(need({ name: "Cement 50kg", unit: "bag", agreements: [agreement()] }))).toBe("agreement")
    expect(needRoute(need({ name: "Cement 50kg", unit: "bag", agreements: [agreement({ until: "2026-09-01" })] }))).toBe("rfq")
  })

  it("buys direct only when the estimate at the last price stays under the ceiling", () => {
    expect(needRoute(need({ history: [paid(2400)] }))).toBe("direct")
    expect(needRoute(need({ history: [paid(2400)], quantity: 3 }))).toBe("rfq")
  })

  it("sends a material never paid for to competition", () => {
    expect(needRoute(need())).toBe("rfq")
  })
})

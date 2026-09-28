/**
 * The computed route of an incoming need: stock first, then ONE live agreement
 * covering every line, then a direct purchase under the ceiling at the last
 * prices paid, else an RFQ.
 */

import { needRoute, type NeedRouteInput, type RouteLine } from "@/lib/procurement/route"
import { materialKey, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"

const today = "2026-09-28"

const agreement = (over: Partial<PriceAgreement> = {}): PriceAgreement => ({
  id: "a1",
  organizationId: "org",
  docNumber: "AG-2026/001",
  supplierOrgId: "s1",
  supplierName: "Cement Co",
  from: "2026-01-01",
  until: "2026-12-31",
  lines: [
    { name: "Cement 50kg", unit: "bag", price: 18 },
    { name: "Sand", unit: "m3", price: 40 },
  ],
  preparedById: "u",
  preparedByName: "U",
  createdAt: "2026-01-01",
  ...over,
})

const paid = (name: string, unit: string, price: number, supplier = "s2"): PriceHistoryEntry => ({
  id: `h-${name}`,
  organizationId: "org",
  materialKey: materialKey(name, unit),
  name,
  unit,
  supplierOrgId: supplier,
  supplierName: "Steel",
  price,
  day: "2026-08-01",
  kind: "po",
  poId: "po1",
  poNumber: "PO-2026/001",
})

const line = (over: Partial<RouteLine> = {}): RouteLine => ({ name: "Rebar 12mm", unit: "ton", quantity: 2, onHand: null, ...over })

const need = (over: Partial<NeedRouteInput> = {}): NeedRouteInput => ({
  lines: [line()],
  agreements: [],
  history: [],
  directCap: 5000,
  today,
  ...over,
})

describe("needRoute", () => {
  it("reserves stock only when every line is on hand", () => {
    expect(needRoute(need({ lines: [line({ onHand: 5 })] })).route).toBe("stock")
    expect(needRoute(need({ lines: [line({ onHand: 5 }), line({ name: "Mesh", onHand: 0 })] })).route).toBe("rfq")
  })

  it("orders on the one live agreement that covers every line", () => {
    const r = needRoute(need({ lines: [line({ name: "Cement 50kg", unit: "bag" }), line({ name: "Sand", unit: "m3" })], agreements: [agreement()] }))
    expect(r.route).toBe("agreement")
    expect(r.agreement?.id).toBe("a1")
  })

  it("does not split a need across agreements, nor use an ended one", () => {
    expect(needRoute(need({ lines: [line({ name: "Cement 50kg", unit: "bag" }), line({ name: "Gravel", unit: "m3" })], agreements: [agreement()] })).route).toBe("rfq")
    expect(needRoute(need({ lines: [line({ name: "Cement 50kg", unit: "bag" })], agreements: [agreement({ until: "2026-09-01" })] })).route).toBe("rfq")
  })

  it("buys direct only when every line has a last price and the estimate stays under the ceiling", () => {
    const r = needRoute(need({ history: [paid("Rebar 12mm", "ton", 2400)] }))
    expect(r.route).toBe("direct")
    expect(r.estimate).toBe(4800)
    expect(r.lastSupplier?.orgId).toBe("s2")
    expect(needRoute(need({ lines: [line({ quantity: 3 })], history: [paid("Rebar 12mm", "ton", 2400)] })).route).toBe("rfq")
    expect(needRoute(need({ lines: [line(), line({ name: "Mesh", unit: "sheet" })], history: [paid("Rebar 12mm", "ton", 100)] })).route).toBe("rfq")
  })

  it("sends a material never paid for to competition", () => {
    expect(needRoute(need()).route).toBe("rfq")
  })
})

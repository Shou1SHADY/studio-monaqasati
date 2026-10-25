/**
 * ED-21 (PRD ED-06: «عام — كل المختصين في الفئة والمدينة»): ONE rule for who a public RFQ reaches by city — the editor's
 * count (`reachBySub`/`publicReach`), the publish server's re-check (`reachInCities`, in procurement-v2-publish.test.ts),
 * and the supplier's lists and quote checks (`publicFieldReaches` via `requestReaches`). It never shrinks reach on
 * missing data.
 */

import { cityCovers, publicFieldReaches, rfqCities, supplierCities } from "@/lib/materials/reach"
import { extendPool, publicReach, reachBySub, type ReachSupplier } from "@/lib/procurement/rfq-extras"
import { requestReaches } from "@/lib/supplier-free/quote-rules"

const sup = (orgId: string, over: Partial<ReachSupplier> = {}): ReachSupplier & { name: string } => ({ orgId, name: orgId, categories: [], subIds: ["block"], ...over })

describe("the city rule", () => {
  it("a supplier's cities: his coverage list (a company's own over its owner's), else his own city, else none", () => {
    expect(supplierCities({ coverageCities: ["جدة"], city: "الرياض" })).toEqual(["جدة"])
    expect(supplierCities({ city: "الرياض" })).toEqual(["الرياض"])
    expect(supplierCities({ coverageCities: ["الدمام"] }, { coverageCities: ["الرياض"] })).toEqual(["الرياض"])
    expect(supplierCities({}, { city: "أبها" })).toEqual(["أبها"])
    expect(supplierCities(null)).toEqual([])
  })

  it("an RFQ's cities: every place's, else its one city, else none (nationwide)", () => {
    expect(rfqCities({ cities: ["الرياض", "جدة"], city: "الرياض" })).toEqual(["الرياض", "جدة"])
    expect(rfqCities({ city: "الرياض" })).toEqual(["الرياض"])
    expect(rfqCities({})).toEqual([])
  })

  it("city match; no city data on him or on the RFQ is reached; several sites = any of them", () => {
    expect(cityCovers(["الرياض"], ["الرياض"])).toBe(true)
    expect(cityCovers(["جدة"], ["الرياض"])).toBe(false)
    expect(cityCovers([], ["الرياض"])).toBe(true)
    expect(cityCovers(["جدة"], [])).toBe(true)
    expect(cityCovers(["جدة"], ["الرياض", "جدة"])).toBe(true)
    // Letter forms do not split a city.
    expect(cityCovers(["أبها"], ["ابها"])).toBe(true)
  })

  it("the field AND the city", () => {
    const field = { subIds: ["block"], specs: [], cities: ["الرياض"] }
    expect(publicFieldReaches(field, { subCategoryIds: ["block"], city: "الرياض" })).toBe(true)
    expect(publicFieldReaches(field, { subCategoryIds: ["block"], city: "جدة" })).toBe(false)
    expect(publicFieldReaches(field, { subCategoryIds: ["rebar"], city: "الرياض" })).toBe(false)
    expect(publicFieldReaches({ ...field, cities: [] }, { subCategoryIds: ["block"], city: "جدة" })).toBe(true)
  })
})

describe("the editor's count", () => {
  const platform = [
    sup("ryd", { coverageCities: ["الرياض"] }),
    sup("jed", { coverageCities: ["جدة"] }),
    sup("own", { city: "جدة" }),
    sup("none"),
    sup("rare", { subIds: ["stone"], coverageCities: ["جدة"] }),
  ]

  it("counts within the delivery cities, keeps those with no city data, and says how many are elsewhere", () => {
    const r = reachBySub(platform, ["block", "stone"], ["الرياض"])
    expect(r.distinct.map((s) => s.orgId)).toEqual(["ryd", "none"])
    expect(r.perSub).toEqual([
      { subId: "block", count: 2, elsewhere: 2 },
      { subId: "stone", count: 0, elsewhere: 1 },
    ])
    expect(r.elsewhereDistinct).toBe(3)
  })

  it("several sites: a supplier in any of them is counted", () => {
    expect(publicReach(platform, [], {}, ["block"], ["الرياض", "جدة"]).map((s) => s.orgId)).toEqual(["ryd", "jed", "own", "none"])
  })

  it("no city on the RFQ: nationwide, as before", () => {
    expect(reachBySub(platform, ["block"]).distinct).toHaveLength(4)
    expect(reachBySub(platform, ["block"]).elsewhereDistinct).toBe(0)
  })

  it("the direct pool is untouched by the city", () => {
    expect(extendPool([], platform, [], [], {}, ["block"]).map((p) => p.orgId).sort()).toEqual(["jed", "none", "own", "ryd"])
  })
})

describe("the supplier's side (lists and the quote check)", () => {
  const rfq = { visibility: "public", subCategoryIds: ["block"], city: "الرياض" }

  it("a public RFQ in another city does not reach him; one in his city or naming no city does", () => {
    expect(requestReaches(rfq, "s1", { specs: [], subIds: ["block"], cities: ["جدة"] })).toBe(false)
    expect(requestReaches(rfq, "s1", { specs: [], subIds: ["block"], cities: ["الرياض"] })).toBe(true)
    expect(requestReaches({ ...rfq, city: "" }, "s1", { specs: [], subIds: ["block"], cities: ["جدة"] })).toBe(true)
  })

  it("a supplier with no city data at all is still reached", () => {
    expect(requestReaches(rfq, "s1", { specs: [], subIds: ["block"], cities: [] })).toBe(true)
  })

  it("private and direct are untouched: named → reached whatever the city; not named → not", () => {
    const priv = { ...rfq, visibility: "private", allowedSupplierOrgIds: ["s1"] }
    expect(requestReaches(priv, "s1", { specs: [], subIds: [], cities: ["جدة"] })).toBe(true)
    expect(requestReaches(priv, "s2", { specs: [], subIds: ["block"], cities: ["الرياض"] })).toBe(false)
  })
})

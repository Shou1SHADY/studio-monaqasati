/**
 * «يحتاج طلباً» (NEED-02): the most urgent row is the item whose activity
 * window has already passed with nothing done; and a request whose only line of
 * the material is a change already refused is not "an open request".
 */

import { materialKeyOf, storeIdOf, type PmStoreLine, type StoreItem } from "@/lib/pm/store"
import { needsWithin, type PmMaterialRequest, type ReqLine } from "@/lib/pm/supply"

const cement = materialKeyOf("Cement", "bag")
const item = (over: Partial<StoreItem> = {}): StoreItem => ({ id: "i1", code: "04-02-01", description: "Plaster", unit: "m2", quantity: 1000, executed: 0, ...over })
const store = (over: Partial<PmStoreLine> = {}): PmStoreLine => ({ id: storeIdOf(cement), key: cement, name: "Cement", unit: "bag", rates: { i1: { r: 0.2, w: 5, ex0: 0, src: "rate" } }, moves: [], ...over })
const line = (over: Partial<ReqLine> = {}): ReqLine => ({ itemId: "i1", code: "04-02-01", key: cement, name: "Cement", unit: "bag", qty: 210, receipts: [], ...over })
const req = (over: Partial<PmMaterialRequest> = {}): PmMaterialRequest => ({ id: "01", pm: true, seq: 1, title: "Cement", lines: [line()], status: "pending", requestedByUserId: "se1", ...over })
const today = "2026-09-30"
const base = { stores: [store()], items: [item()], requests: [] as PmMaterialRequest[], startOn: "2026-08-01", today }

describe("needs within 30 days", () => {
  it("an item not started whose activity window already ended needs all of it now", () => {
    const n = needsWithin({ ...base, activities: [{ from: "2026-08-20", to: "2026-09-15", itemIds: ["i1"] }] })
    expect(n.gaps).toEqual([expect.objectContaining({ itemId: "i1", key: cement, need: 210, gap: 210 })])
  })

  it("an item the programme still plans later is not overdue as a whole — its need follows that stretch", () => {
    const n = needsWithin({ ...base, activities: [{ from: "2026-08-01", to: "2026-09-01", itemIds: ["i1"] }, { from: "2026-12-01", to: "2026-12-20", itemIds: ["i1"] }] })
    expect(n.gaps).toEqual([])
  })

  it("a pending request whose only line of the material is a refused change does not cover the gap", () => {
    const activities = [{ from: "2026-09-25", to: "2026-10-10", itemIds: ["i1"] }]
    const refused = req({ lines: [line({ chg: { st: "no" } })] })
    expect(needsWithin({ ...base, activities, requests: [refused] }).gaps).toHaveLength(1)
    // A live line of it — approved, or a change still to decide — is an open request.
    expect(needsWithin({ ...base, activities, requests: [req()] }).gaps).toHaveLength(0)
    expect(needsWithin({ ...base, activities, requests: [req({ lines: [line({ chg: { st: "wait" } })] })] }).gaps).toHaveLength(0)
  })
})

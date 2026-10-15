/**
 * Supplier 1.0 — goods the contractor holds after receiving them (certificate, test, consultant) are not the supplier's
 * to deliver: they never make the order late (QA pack G-02: ordered = accepted + cancelled + left).
 */

import { createDealLogic } from "@/lib/supplier-free/deal-logic"
import type { Deal } from "@/lib/supplier-free/types"

const L = createDealLogic("2026-10-20")

const deal = (held: number): Deal =>
  ({
    id: "r1",
    items: [{ id: "i1", name: "Block", unit: "pc", qty: 100, spec: "" }],
    offer: { status: "won", v: [{ at: "2026-10-01", prices: { i1: 2 }, arrive: "", valid: "", note: "", file: null, total: 0 }] },
    po: { no: "2026/001", at: "2026-10-05", lines: [{ it: "i1", qty: 100, price: 2, got: 60, rej: 0, can: 0, held }], need: "", acc: { at: "2026-10-06", date: "2026-10-12" }, site: "", rcv: "", terms: [{ pct: 100, days: 30 }], lump: null },
    ship: [],
    invs: [],
    pays: [],
    closed: null,
  }) as unknown as Deal

describe("goods on hold", () => {
  it("40 left past the promised date is late", () => {
    expect(L.isLate(deal(0))).toBe(true)
  })
  it("the same 40 on the contractor's hold are not the supplier's to deliver: not late", () => {
    expect(L.isLate(deal(40))).toBe(false)
  })
  it("only the held part is excused", () => {
    expect(L.isLate(deal(10))).toBe(true)
  })
})

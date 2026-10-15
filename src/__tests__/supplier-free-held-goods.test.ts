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

// ---- Decision 3: what the contractor decided about a rejected quantity -------------------------------------------

const withRej = (over: Record<string, unknown>): Deal => {
  const d = deal(0)
  d.po!.lines = [{ it: "i1", qty: 100, price: 2, got: 60, rej: 40, can: 0, ...over }] as never
  return d
}

describe("a rejected quantity the contractor decided about", () => {
  it("undecided: it comes back as left and is late past the promised date", () => {
    expect(L.isLate(withRej({}))).toBe(true)
  })
  it("replace with a later date: not late before that date, late after it", () => {
    expect(L.isLate(withRej({ dec: "replace", repl: "2026-10-25" }))).toBe(false)
    expect(L.isLate(withRej({ dec: "replace", repl: "2026-10-18" }))).toBe(true)
  })
  it("replace without a date keeps the promised date", () => {
    expect(L.isLate(withRej({ dec: "replace", repl: null }))).toBe(true)
  })
  it("kept at a discount, waiting for the contractor's release: not the supplier's to deliver", () => {
    expect(L.isLate(withRej({ dec: "discount", dst: "wait" }))).toBe(false)
  })
  it("deducted (cancelled): nothing left, nothing late", () => {
    expect(L.isLate(withRej({ dec: "reduce", can: 40 }))).toBe(false)
  })
  it("only the rejected part is excused — other left quantity stays late", () => {
    expect(L.isLate(withRej({ qty: 120, dec: "replace", repl: "2026-10-25" }))).toBe(true)
  })
})

// ---- A quantity kept at a discount becomes billable once released --------------------------------------------------

import { discountReceipts } from "@/lib/supplier-free/discount-receipts"
import type { PurchaseOrder } from "@/lib/procurement/types"

describe("a released discount", () => {
  const po = (state: string | null) =>
    ({
      lines: [{ id: "l1", rejected: 40, rejectDecision: "discount", rejectDiscountPrice: 1.5, rejectDiscountState: state }],
      log: [{ at: "2026-10-12T22:00:00.000Z", action: "reject_discount_released", params: { lineId: "l1" } }],
    }) as unknown as PurchaseOrder

  it("waiting for the release: nothing to bill yet", () => {
    expect(discountReceipts(po("wait"))).toEqual([])
  })
  it("released: one receipt at the discounted price, dated the Riyadh day it was released", () => {
    expect(discountReceipts(po("released"))).toEqual([{ id: "DISC-l1", day: "2026-10-13", lineId: "l1", qty: 40, price: 1.5, net: 60 }])
  })
  it("the receipt's value is the discounted one, not the order price", () => {
    const d = deal(0)
    const rc = { st: "ok", grn: "DISC-l1", no: "", date: "2026-10-13", okAt: "2026-10-13", t: "", by: "", items: { i1: 40 }, got: { i1: 40 }, net: 60 } as never
    expect(L.receiptNet(d, rc)).toBe(60)
  })
})

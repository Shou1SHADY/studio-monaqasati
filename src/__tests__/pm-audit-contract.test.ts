/**
 * PM 1.0 — contract-side refusals the audit of 2 Oct 2026 found missing:
 *  - a time claim could be recorded "approved" with 0 days granted (CLM-02):
 *    it read approved while the programme never moved;
 *  - a variation's executed share could be lowered below what a certificate
 *    had already billed (INV-03): earned 60,000 against 120,000 billed.
 */
import { respondBlocks } from "@/lib/pm/claim"
import { stepBlocks } from "@/lib/pm/variation"

describe("the response to a claim (CLM-02)", () => {
  const sub = { archived: false, status: "sub" as const, amount: null }
  it("an approved or partly approved time claim grants at least a day", () => {
    expect(respondBlocks({ ...sub, kind: "time", response: "appr", days: 0 })).toEqual(["days_required"])
    expect(respondBlocks({ ...sub, kind: "time", response: "part", days: 0 })).toEqual(["days_required"])
    expect(respondBlocks({ ...sub, kind: "time", response: "appr", days: 12 })).toEqual([])
  })
  it("a rejection needs none; a cost claim is about its amount", () => {
    expect(respondBlocks({ ...sub, kind: "time", response: "rej", days: null })).toEqual([])
    expect(respondBlocks({ ...sub, kind: "cost", response: "appr", days: null, amount: 5_000 })).toEqual([])
  })
})

describe("a variation's executed share (INV-03)", () => {
  const progress = { archived: false, status: "appr" as const, step: "progress" as const }
  it("never drops below what a certificate billed", () => {
    expect(stepBlocks({ ...progress, executedPct: 0.3, billedPct: 0.6 })).toEqual(["below_billed"])
    expect(stepBlocks({ ...progress, executedPct: 0.6, billedPct: 0.6 })).toEqual([])
    expect(stepBlocks({ ...progress, executedPct: 0.8, billedPct: 0.6 })).toEqual([])
  })
  it("moves freely while nothing is billed", () => {
    expect(stepBlocks({ ...progress, executedPct: 0.1 })).toEqual([])
    expect(stepBlocks({ ...progress, executedPct: 0.1, billedPct: null })).toEqual([])
  })
})

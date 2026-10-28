/** A supplier's paid trial: the plan reads «full» until the end, then «free» by itself — nothing is locked or lost. */
import { planOf, planTrialOf } from "@/lib/supplier-plan"

const NOW = new Date("2026-11-10T09:00:00.000Z")

describe("the plan a supplier company is on", () => {
  it("a subscription with no end is full for good; no document, or «free», is free", () => {
    expect(planOf({ supplierPlan: "full" }, NOW)).toBe("full")
    expect(planOf(null, NOW)).toBe("free")
    expect(planOf({ supplierPlan: "free" }, NOW)).toBe("free")
    expect(planOf({ supplierPlan: "paid" }, NOW)).toBe("free")
  })

  it("a paid trial is full until its end, and free from that instant", () => {
    const doc = { supplierPlan: "full", planTrialEndsAt: "2026-11-17T09:00:00.000Z" }
    expect(planOf(doc, NOW)).toBe("full")
    expect(planOf(doc, new Date("2026-11-17T08:59:59.000Z"))).toBe("full")
    expect(planOf(doc, new Date("2026-11-17T09:00:00.000Z"))).toBe("free")
    expect(planOf(doc, new Date("2027-01-01"))).toBe("free")
  })

  it("an unreadable end is no end", () => {
    expect(planOf({ supplierPlan: "full", planTrialEndsAt: "soon" }, NOW)).toBe("full")
    expect(planOf({ supplierPlan: "full", planTrialEndsAt: 5 }, NOW)).toBe("full")
  })

  it("reports the trial: running with days left, ended, or none", () => {
    const doc = { supplierPlan: "full", planTrialEndsAt: "2026-11-17T09:00:00.000Z" }
    expect(planTrialOf(doc, NOW)).toEqual({ phase: "running", endsAt: "2026-11-17T09:00:00.000Z", daysLeft: 7 })
    expect(planTrialOf(doc, new Date("2026-11-18"))).toMatchObject({ phase: "ended", daysLeft: 0 })
    expect(planTrialOf({ supplierPlan: "full" }, NOW).phase).toBe("none")
    expect(planTrialOf({ supplierPlan: "free", planTrialEndsAt: "2026-11-17T09:00:00.000Z" }, NOW).phase).toBe("none")
    expect(planTrialOf(null, NOW).phase).toBe("none")
  })
})

/**
 * Procurement 2.0 PRD §14 — the policies: the defaults table, the sanitising of what is stored, the split of the reply window
 * into Inventory's and the workshop's, and who owns each.
 */

import { DEFAULT_RESOLVED_POLICIES, POLICY_OWNER, resolvePolicies } from "@/lib/procurement/policies"
import { DEFAULT_POLICIES } from "@/lib/procurement/types"
import { replyLapsed, replyWindowHours } from "@/lib/procurement/policy-enforce"
import { lastOrderDayOf } from "@/lib/procurement/need-desk"
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../../scripts/migrate-proc-policies.js") as { planDoc: (data: Record<string, unknown>, flags: Record<string, boolean>) => { notes: string[]; set: Record<string, unknown>; unset: string[] } }

describe("the defaults are §14's", () => {
  it("every value of the table", () => {
    expect(DEFAULT_POLICIES).toMatchObject({
      rfqDefaultDays: 3,
      rfqWindowDays: 3,
      awardCycleDays: 2,
      supplyLeadDays: 10,
      supplierAcceptanceDays: 1,
      escalateAfterDays: 2,
      tieBandPct: 0.5,
      competitionThreshold: 20_000,
      minOffers: 3,
      directPurchaseCap: 5_000,
      splitWindowDays: 30,
      managerApprovalLimit: 150_000,
      advanceUnknownSupplierOwner: true,
      inventoryReplyDays: 1,
      workshopReplyDays: 1,
      overReceiptTolerancePercent: 5,
      forwardWindowDays: 1,
      sendOnApproval: true,
    })
    expect(DEFAULT_RESOLVED_POLICIES).toMatchObject({ ...DEFAULT_POLICIES, replyWindowDays: 1, ownerStepsBack: false })
  })

  it("a company with no document, or an empty one, gets them all", () => {
    expect(resolvePolicies(null)).toEqual(DEFAULT_RESOLVED_POLICIES)
    expect(resolvePolicies({})).toEqual(DEFAULT_RESOLVED_POLICIES)
  })

  it("a stored value is used; a blank, a negative or text falls back; whole-day policies are whole", () => {
    const p = resolvePolicies({ rfqDefaultDays: 5, supplyLeadDays: "14" as unknown as number, tieBandPct: 1.5, escalateAfterDays: 0, supplierAcceptanceDays: -1, workshopReplyDays: 2.6 })
    expect(p).toMatchObject({ rfqDefaultDays: 5, supplyLeadDays: 14, tieBandPct: 1.5, escalateAfterDays: 2, supplierAcceptanceDays: 1, workshopReplyDays: 3 })
    expect(resolvePolicies({ tieBandPct: 150 }).tieBandPct).toBe(0.5)
    expect(resolvePolicies({ advanceUnknownSupplierOwner: false }).advanceUnknownSupplierOwner).toBe(false)
  })
})

describe("the reply window, split in two", () => {
  it("a company that only has the old number keeps it for both; the new fields win once they are stored", () => {
    expect(resolvePolicies({ replyWindowDays: 3 })).toMatchObject({ inventoryReplyDays: 3, workshopReplyDays: 3, replyWindowDays: 3 })
    expect(resolvePolicies({ replyWindowDays: 3, workshopReplyDays: 1 })).toMatchObject({ inventoryReplyDays: 3, workshopReplyDays: 1 })
    expect(resolvePolicies({ replyWindowDays: 3, inventoryReplyDays: 2, workshopReplyDays: 4 })).toMatchObject({ inventoryReplyDays: 2, workshopReplyDays: 4, replyWindowDays: 2 })
  })

  it("Inventory and the workshop lapse each by their own window", () => {
    const p = { inventoryReplyDays: 1, workshopReplyDays: 3 }
    const since = Date.parse("2026-09-20T08:00:00Z")
    const now = new Date("2026-09-22T09:00:00Z")
    expect(replyWindowHours(p, "inventory")).toBe(24)
    expect(replyWindowHours(p, "workshop")).toBe(72)
    expect(replyLapsed(since, now, p)).toBe(true)
    expect(replyLapsed(since, now, p, "workshop")).toBe(false)
  })
})

describe("who owns each policy (the chip)", () => {
  it("the base's clocks and limits are Settings & governance's; Finance owns the manager's limit; Inventory and Manufacturing their windows", () => {
    expect(POLICY_OWNER).toMatchObject({
      rfqDefaultDays: "gov",
      supplyLeadDays: "gov",
      escalateAfterDays: "gov",
      tieBandPct: "gov",
      advanceUnknownSupplierOwner: "gov",
      managerApprovalLimit: "fin",
      inventoryReplyDays: "inv",
      overReceiptTolerancePercent: "inv",
      workshopReplyDays: "mfg",
    })
  })
})

describe("the last day to order reads three policies", () => {
  it("need date − lead time − RFQ cycle − award and approval", () => {
    expect(lastOrderDayOf("2026-11-06", resolvePolicies({}))).toBe("2026-10-22")
    expect(lastOrderDayOf("2026-11-06", resolvePolicies({ supplyLeadDays: 5, rfqWindowDays: 1, awardCycleDays: 1 }))).toBe("2026-10-30")
  })
})

describe("scripts/migrate-proc-policies.js", () => {
  const none = { splitReply: false, acceptanceDefault: false, dropSeal: false }

  it("reports and changes nothing without a flag", () => {
    const plan = migration.planDoc({ sealOffersUntilDeadline: true, replyWindowDays: 2, supplierAcceptanceDays: 2, managerApprovalLimit: 90000 }, none)
    expect(plan.notes).toHaveLength(3)
    expect(plan.set).toEqual({})
    expect(plan.unset).toEqual([])
  })

  it("each flag does its own thing and no other", () => {
    const data = { sealOffersUntilDeadline: true, replyWindowDays: 2, supplierAcceptanceDays: 2 }
    expect(migration.planDoc(data, { ...none, splitReply: true })).toMatchObject({ set: { inventoryReplyDays: 2, workshopReplyDays: 2 }, unset: [] })
    expect(migration.planDoc(data, { ...none, acceptanceDefault: true })).toMatchObject({ set: {}, unset: ["supplierAcceptanceDays"] })
    expect(migration.planDoc(data, { ...none, dropSeal: true })).toMatchObject({ set: {}, unset: ["sealOffersUntilDeadline"] })
  })

  it("leaves an explicit value alone, and is idempotent", () => {
    expect(migration.planDoc({ supplierAcceptanceDays: 3 }, { splitReply: true, acceptanceDefault: true, dropSeal: true })).toEqual({ notes: [], set: {}, unset: [] })
    expect(migration.planDoc({ replyWindowDays: 2, inventoryReplyDays: 2, workshopReplyDays: 1 }, { ...none, splitReply: true }).set).toEqual({})
  })
})

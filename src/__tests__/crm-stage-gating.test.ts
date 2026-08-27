/**
 * The one rule for moving a deal between pipeline stages, shared by the
 * board and the detail page: one step forward once the gates are cleared,
 * any step back, never straight to won or lost.
 */
import {
  canMoveToStage,
  stageMoveBlock,
  WON_REASONS,
  type CrmOpportunity,
} from "@/lib/crm"
import { PERMISSION_IDS } from "@/lib/permissions"

function deal(overrides: Partial<CrmOpportunity> = {}): CrmOpportunity {
  return {
    id: "d1",
    contactId: "c1",
    title: "Villa compound",
    stage: "new",
    track: "quotation",
    state: "open",
    value: 0,
    completedGates: [],
    organizationId: "org",
    ...overrides,
  }
}

describe("stageMoveBlock", () => {
  it("refuses a forward move while the current stage's gates are open", () => {
    // Quotation track, stage `new`: needs scope_captured (manual) + estimate (auto).
    expect(stageMoveBlock(deal(), "qualified")).toBe("gates")
    expect(canMoveToStage(deal(), "qualified")).toBe(false)
  })

  it("allows one step forward once every gate is satisfied", () => {
    const ready = deal({ value: 150000, completedGates: ["scope_captured"] })
    expect(stageMoveBlock(ready, "qualified")).toBeNull()
    expect(canMoveToStage(ready, "qualified")).toBe(true)
  })

  it("never allows skipping a stage, even with gates cleared", () => {
    const ready = deal({ value: 150000, completedGates: ["scope_captured"] })
    expect(stageMoveBlock(ready, "proposal")).toBe("skip")
    expect(stageMoveBlock(ready, "negotiation")).toBe("skip")
  })

  it("always allows moving backwards", () => {
    const late = deal({ stage: "negotiation" })
    expect(stageMoveBlock(late, "new")).toBeNull()
    expect(stageMoveBlock(late, "proposal")).toBeNull()
  })

  it("never reaches won or lost through a generic move", () => {
    // Even from the last open stage with everything ticked.
    const final = deal({
      stage: "negotiation",
      value: 100,
      approvedCost: 80,
      submittedPrice: 100,
      approvalStatus: "approved",
      completedGates: ["scope_captured", "discount_answered"],
    })
    expect(stageMoveBlock(final, "won")).toBe("terminal")
    expect(stageMoveBlock(final, "lost")).toBe("terminal")
    expect(canMoveToStage(final, "won")).toBe(false)
  })

  it("refuses to move a deal that is not open", () => {
    expect(stageMoveBlock(deal({ state: "won", stage: "won" }), "new")).toBe("closed")
    expect(stageMoveBlock(deal({ state: "on_hold", stage: "proposal" }), "new")).toBe("closed")
    expect(stageMoveBlock(deal({ state: "handed_over", stage: "won", projectId: "p1" }), "new")).toBe("closed")
  })

  it("reports a no-op when the target is the current stage", () => {
    expect(stageMoveBlock(deal({ stage: "proposal" }), "proposal")).toBe("same")
  })
})

describe("closing a deal", () => {
  it("offers a fixed list of win reasons ending with 'other'", () => {
    expect(WON_REASONS[WON_REASONS.length - 1]).toBe("other")
    expect(new Set(WON_REASONS).size).toBe(WON_REASONS.length)
  })

  it("keeps the CRM to two permissions: manage and close", () => {
    const crm = PERMISSION_IDS.filter((p) => p.startsWith("crm."))
    expect(crm).toEqual(["crm.manage", "crm.close"])
  })
})

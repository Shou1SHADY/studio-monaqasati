/**
 * PM 1.0 slice 2 — the handover file, the lifecycle, the contract terms and the
 * advance event (PRD §7, §8, §9 HO/TRM/AMD, §11, §13).
 */

import { advanceEvent, eventDocId } from "@/lib/pm/events"
import { acceptBlocks, handoverAge, handoverFlags, reassignBlocks, returnBlocks, type PmHandover } from "@/lib/pm/handover"
import { canMove, lifecycleOf, plannedEnd, startBlocks } from "@/lib/pm/lifecycle"
import { defaultTerms, hasClientSide, termChanges, termProblems, termsEditable, termsInForce } from "@/lib/pm/terms"
import { displayDocNumber } from "@/lib/sales-numbering"

const ho = (over: Partial<PmHandover> = {}): PmHandover => ({
  id: "h1",
  organizationId: "org",
  status: "wait",
  to: "pm1",
  toName: "Abdullah",
  opportunityId: "o1",
  contactId: "c1",
  title: "Al-Yasmin Compound",
  clientName: "Al-Yasmin Development",
  clientType: "private",
  kind: "bld",
  location: "Riyadh",
  contractNumber: "C-2026/007",
  value: 22_400_000,
  durationDays: 540,
  signedOn: "2026-09-16",
  startOn: "2026-11-20",
  advance: 0.1,
  retention: 0.05,
  note: null,
  requestedBy: "crm1",
  requestedByName: "Sara",
  createdAt: "2026-09-21T08:00:00Z",
  ...over,
})

describe("the handover file (HO-01…05)", () => {
  it("a complete, waiting file can be accepted", () => {
    expect(acceptBlocks(ho())).toEqual([])
  })
  it("no value, no duration or no signature blocks acceptance — an invented number would follow it everywhere", () => {
    expect(acceptBlocks(ho({ value: 0, durationDays: 0, signedOn: null }))).toEqual(["no_value", "no_duration", "not_signed"])
    expect(acceptBlocks(ho({ status: "acc" }))).toEqual(["not_waiting"])
  })
  it("flags a contract starting within three weeks, an incomplete file, and red after a week waiting", () => {
    expect(handoverFlags(ho(), "2026-09-25")).toEqual({ rush: false, incomplete: false, severity: "amber" })
    expect(handoverFlags(ho({ startOn: "2026-10-10" }), "2026-09-25").rush).toBe(true)
    expect(handoverFlags(ho({ value: 0 }), "2026-09-25").incomplete).toBe(true)
    expect(handoverFlags(ho(), "2026-09-29").severity).toBe("red")
    expect(handoverAge(ho(), "2026-09-25")).toBe(4)
  })
  it("reassigning needs another manager, and 'other' needs its reason stated", () => {
    expect(reassignBlocks(ho(), "pm1", "load", null)).toEqual(["same_manager"])
    expect(reassignBlocks(ho(), "pm2", "other", "  ")).toEqual(["reason_text"])
    expect(reassignBlocks(ho(), "pm2", "other", "Owner asked")).toEqual([])
  })
  it("a return names at least one missing item", () => {
    expect(returnBlocks([])).toEqual(["nothing_missing"])
    expect(returnBlocks(["boq", "dwg"])).toEqual([])
  })
})

describe("the lifecycle (§7)", () => {
  it("moves only along plan → live ⇄ hold → done → closed", () => {
    expect(canMove("plan", "live")).toBe(true)
    expect(canMove("live", "hold")).toBe(true)
    expect(canMove("hold", "live")).toBe(true)
    expect(canMove("plan", "done")).toBe(false)
    expect(canMove("closed", "live")).toBe(false)
  })
  it("reads a pre-PM-1.0 project from its kanban status, never rewriting it", () => {
    expect(lifecycleOf({ status: "working" })).toBe("live")
    expect(lifecycleOf({ status: "approved_waiting_start" })).toBe("plan")
    expect(lifecycleOf({ status: "active" })).toBe("live")
    expect(lifecycleOf({ status: "canceled" })).toBe("closed")
    expect(lifecycleOf({ status: "working", pm: { lifecycle: "hold" } })).toBe("hold")
  })
  it("Start needs a plan project, a manager, a BOQ and valid terms", () => {
    expect(startBlocks({ lifecycle: "plan", hasManager: true, boqItems: 3, termProblems: 0 })).toEqual([])
    expect(startBlocks({ lifecycle: "live", hasManager: false, boqItems: 0, termProblems: 1 })).toEqual(["not_plan", "no_manager", "no_boq", "terms_invalid"])
  })
  it("the planned end counts the approved extension", () => {
    expect(plannedEnd("2026-10-11", 540)).toBe("2028-04-03")
    expect(plannedEnd("2026-10-11", 540, 30)).toBe("2028-05-03")
  })
})

describe("the contract terms (§13, TRM, AMD)", () => {
  it("defaults follow §13 and take the handover's advance and retention", () => {
    const t = defaultTerms({ advance: 0.1, retention: 0.05 })
    expect(t).toMatchObject({ payer: "owner", basis: "rem", advance: 0.1, retention: 0.05, retentionCap: 0.05, retentionRelease: "half", paymentDays: 30, consultantDays: 14, claimNoticeDays: 28, defectsDays: 365 })
    expect(t.damages).toEqual({ on: false, weeklyRate: 0.005, cap: 0.1 })
    expect(defaultTerms({ selfDevelopment: true }).payer).toBe("none")
  })
  it("rejects out-of-range values, but lets the retention rate exceed its cap", () => {
    const t = defaultTerms()
    expect(termProblems({ ...t, retention: 0.1, retentionCap: 0.05 })).toEqual([])
    expect(termProblems({ ...t, advance: 1.2, paymentDays: -1, damages: { on: true, weeklyRate: 0, cap: 0.1 } })).toEqual(["advance_range", "days_range", "damages_range"])
  })
  it("'nobody pays' has no client side", () => {
    expect(hasClientSide({ payer: "none" })).toBe(false)
    expect(hasClientSide({ payer: "main" })).toBe(true)
  })
  it("terms are edited directly only before start", () => {
    expect(termsEditable("plan")).toBe(true)
    expect(termsEditable("live")).toBe(false)
  })
  it("the contract in force is the original plus signed addenda in signing order; drafts and withdrawn change nothing", () => {
    const original = defaultTerms({ advance: 0.1, retention: 0.05 })
    const a1 = termChanges(original, { ...original, paymentDays: 45 })
    const a2 = termChanges({ ...original, paymentDays: 45 }, { ...original, paymentDays: 60, retentionCap: 0.04 })
    expect(a1).toEqual([{ key: "paymentDays", from: 30, to: 45 }])
    const inForce = termsInForce(original, [
      { status: "signed", signedSeq: 2, changes: a2 },
      { status: "signed", signedSeq: 1, changes: a1 },
      { status: "draft", changes: termChanges(original, { ...original, advance: 0.2 }) },
      { status: "void", changes: termChanges(original, { ...original, basis: "lump" }) },
    ])
    expect(inForce.paymentDays).toBe(60)
    expect(inForce.retentionCap).toBe(0.04)
    expect(inForce.advance).toBe(0.1)
    expect(inForce.basis).toBe("rem")
    expect(original.paymentDays).toBe(30)
  })
})

describe("the advance event (§11)", () => {
  const base = { organizationId: "org", projectId: "p1", projectNo: "PJ-2026/014", contractValue: 22_400_000, by: "pm1", at: "2026-09-25T10:00:00Z" }
  it("is sent once, under prj:ADV:<project>, for the advance itself", () => {
    const e = advanceEvent({ ...base, terms: { advance: 0.1, payer: "owner", advanceRecovery: "pro" } })
    expect(e).toMatchObject({ key: "prj:ADV:PJ-2026/014", kind: "ADV", amount: 2_240_000 })
    expect(eventDocId(e!.key)).toBe("prj:ADV:PJ-2026_014")
  })
  it("is not sent without an advance, or when nobody pays", () => {
    expect(advanceEvent({ ...base, terms: { advance: 0, payer: "owner", advanceRecovery: "pro" } })).toBeNull()
    expect(advanceEvent({ ...base, terms: { advance: 0.1, payer: "none", advanceRecovery: "pro" } })).toBeNull()
  })
})

describe("the project number", () => {
  it("PJ-2026/014 reads م-2026/014 in Arabic", () => {
    expect(displayDocNumber("PJ-2026/014", "ar")).toBe("م-2026/014")
    expect(displayDocNumber("PJ-2026/014", "en")).toBe("PJ-2026/014")
  })
})

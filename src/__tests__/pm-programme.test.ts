/**
 * The programme: revisions issued only by claims granted with days, planned
 * against actual by the approved measurement, and activities whose % comes from
 * their items and whose critical path comes from their links.
 */

import {
  activityBlocks,
  activityPlanned,
  activityProgress,
  activityState,
  criticalPath,
  effectiveDuration,
  programmeRevisions,
  progressCurve,
} from "@/lib/pm/programme"

describe("programme revisions", () => {
  const claims = [
    { seq: 1, status: "appr" as const, revision: 1, response: { on: "2026-08-01", by: "u", days: 30, amount: 0 } },
    { seq: 2, status: "rej" as const, revision: null, response: { on: "2026-08-15", by: "u", days: 0, amount: 0 } },
    { seq: 3, status: "part" as const, revision: 2, response: { on: "2026-09-10", by: "u", days: 14, amount: 0 } },
  ]
  it("starts from the contract and adds one revision per grant with days", () => {
    const revs = programmeRevisions({ durationDays: 365, startOn: "2026-01-01", claims })
    expect(revs.map((r) => [r.rev, r.days, r.endOn, r.claimSeq])).toEqual([
      [0, 365, "2027-01-01", null],
      [1, 395, "2027-01-31", 1],
      [2, 409, "2027-02-14", 3],
    ])
    expect(effectiveDuration(365, claims)).toBe(409)
  })
  it("has no end before the project starts", () => {
    expect(programmeRevisions({ durationDays: 365, startOn: null, claims: [] })[0].endOn).toBeNull()
  })
})

describe("planned against actual", () => {
  it("cumulates approved sheets by value and draws planned linearly to the end", () => {
    const pts = progressCurve({
      startOn: "2026-01-01",
      effectiveDays: 100,
      contractValue: 10000,
      sheets: [
        { status: "ok", day: "2026-01-21", lines: [{ itemId: "a", qty: 10, approved: 10 }] },
        { status: "wait", day: "2026-01-25", lines: [{ itemId: "a", qty: 50 }] },
        { status: "ok", day: "2026-02-10", lines: [{ itemId: "a", qty: 20, approved: 15 }] },
      ],
      rateOf: () => 100,
      today: "2026-02-20",
    })
    expect(pts).toEqual([
      { day: "2026-01-01", planned: 0, actual: 0 },
      { day: "2026-01-21", planned: 20, actual: 10 },
      { day: "2026-02-10", planned: 40, actual: 25 },
      { day: "2026-02-20", planned: 50, actual: 25 },
      { day: "2026-04-11", planned: 100, actual: null },
    ])
  })
})

describe("activities", () => {
  const items = [
    { id: "i1", quantity: 10, rate: 100, executed: 10 },
    { id: "i2", quantity: 10, rate: 300, executed: 0 },
  ]
  it("reads its % from its items, weighted by value", () => {
    expect(activityProgress({ itemIds: ["i1", "i2"] }, items)).toBe(25)
    expect(activityProgress({ itemIds: [] }, items)).toBeNull()
  })
  it("is behind 12 points off its own plan, idle when its start passed with nothing done", () => {
    const a = { from: "2026-01-01", to: "2026-01-11" }
    expect(activityPlanned(a, "2026-01-06")).toBe(50)
    expect(activityState(a, 30, "2026-01-06")).toBe("late")
    expect(activityState(a, 45, "2026-01-06")).toBe("run")
    expect(activityState({ from: "2026-01-05", to: "2026-03-01" }, 0, "2026-01-06")).toBe("idle")
    expect(activityState(a, 0, "2025-12-30")).toBe("soon")
    expect(activityState(a, 100, "2026-01-06")).toBe("done")
  })
  it("derives the critical path: the chain that finishes last", () => {
    const acts = [
      { id: "01", to: "2026-02-01", pred: null },
      { id: "02", to: "2026-03-01", pred: "01" },
      { id: "03", to: "2026-05-01", pred: "02" },
      { id: "04", to: "2026-04-01", pred: "01" },
    ]
    expect(Array.from(criticalPath(acts)).sort()).toEqual(["01", "02", "03"])
  })
  it("refuses a nameless one, backwards dates, and a link that loops", () => {
    const acts = [
      { id: "01", pred: null },
      { id: "02", pred: "01" },
    ]
    expect(activityBlocks({ name: "", from: "2026-01-02", to: "2026-01-01", pred: null }, acts)).toEqual(["no_name", "dates"])
    expect(activityBlocks({ id: "01", name: "x", from: "2026-01-01", to: "2026-01-02", pred: "02" }, acts)).toEqual(["pred_cycle"])
    expect(activityBlocks({ id: "01", name: "x", from: "2026-01-01", to: "2026-01-02", pred: "01" }, acts)).toEqual(["pred_self"])
  })
})

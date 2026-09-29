/**
 * The Pulse's derived views: the head's figures, the money trail, what waits on
 * other modules, the divisions against their plan, and the project log.
 */

import {
  boqNote,
  crmWaitRows,
  financeWaitRows,
  itemPlanFromActivities,
  moneyTrail,
  penaltyNote,
  poWaitRows,
  progressNote,
  progressTone,
  projectDays,
  projectLog,
  requestWaitRows,
  sectionDeviations,
  sectionsBehind,
  showMoneyTrail,
  waitingView,
  type LogFacts,
} from "@/lib/pm/pulse"

describe("sections behind", () => {
  const items = [
    { division: "Concrete", quantity: 100, rate: 100, executed: 30 },
    { division: "Concrete", quantity: 100, rate: 100, executed: 50 },
    { division: "Finishes", quantity: 10, rate: 1000, executed: 1 },
    { division: "Earthworks", quantity: 10, rate: 100, executed: 10 },
    { division: "Unpriced", quantity: 10, rate: 0, executed: 0 },
  ]
  it("ranks the divisions behind the planned line, worst first", () => {
    expect(sectionsBehind(items, 50)).toEqual([
      { division: "Finishes", progress: 10, deviation: -40, value: 10000 },
      { division: "Concrete", progress: 40, deviation: -10, value: 20000 },
    ])
  })
  it("says nothing before anything is planned", () => {
    expect(sectionsBehind(items, null)).toEqual([])
    expect(sectionsBehind(items, 0)).toEqual([])
  })
  it("the Pulse panel keeps divisions ahead too, four at most", () => {
    expect(sectionDeviations(items, 50).map((r) => [r.division, r.deviation])).toEqual([
      ["Finishes", -40],
      ["Concrete", -10],
      ["Earthworks", 50],
    ])
  })
  it("a division's plan comes from the activities that schedule its items", () => {
    const plan = itemPlanFromActivities([{ from: "2026-01-01", to: "2026-01-11", itemIds: ["f"] }], "2026-01-06")
    expect(plan.get("f")).toBe(50)
    const rows = sectionDeviations([{ id: "f", division: "Finishes", quantity: 10, rate: 1000, executed: 5 }, { id: "c", division: "Concrete", quantity: 10, rate: 100, executed: 1 }], 20, plan)
    expect(rows).toEqual([
      { division: "Concrete", progress: 10, deviation: -10, value: 1000, planned: 20 },
      { division: "Finishes", progress: 50, deviation: 0, value: 10000, planned: 50 },
    ])
  })
})

describe("the head", () => {
  it("counts the days from the start against the duration in force", () => {
    expect(projectDays("2026-09-01T08:00:00Z", 120, "2026-09-28")).toEqual({ el: 27, tot: 120 })
    expect(projectDays(null, 120, "2026-09-28")).toBeNull()
    expect(projectDays("2026-10-01", 120, "2026-09-28")).toEqual({ el: 0, tot: 120 })
  })
  it("says why progress has no plan, in the prototype's order", () => {
    expect(progressNote({ itemCount: 5, unpricedCount: 0, planned: 40, progress: 30.4 })).toEqual({ kind: "plan", planned: 40, dv: -10 })
    expect(progressNote({ itemCount: 0, unpricedCount: 0, planned: null, progress: null })).toEqual({ kind: "no_boq" })
    expect(progressNote({ itemCount: 3, unpricedCount: 3, planned: null, progress: null })).toEqual({ kind: "all_unpriced" })
    expect(progressNote({ itemCount: 3, unpricedCount: 1, planned: null, progress: 0 })).toEqual({ kind: "no_plan" })
  })
  it("colours the tile: behind more than 4 points red, ahead more than 2 green", () => {
    expect(progressTone({ kind: "plan", planned: 40, dv: -5 })).toBe("bad")
    expect(progressTone({ kind: "plan", planned: 40, dv: 3 })).toBe("good")
    expect(progressTone({ kind: "plan", planned: 40, dv: -2 })).toBe("neutral")
  })
  it("notes a project with no BOQ or with every item unpriced", () => {
    expect(boqNote(0, 0)).toBe("no_boq")
    expect(boqNote(4, 4)).toBe("all_unpriced")
    expect(boqNote(4, 1)).toBeNull()
  })
})

describe("the money trail", () => {
  const base = {
    contractBase: 1_000_000,
    items: [
      { quantity: 100, rate: 1000, executed: 50, billed: 30 },
      { quantity: 10, rate: 0, executed: 5, billed: 0 },
    ],
    variations: [
      { status: "appr", value: 100_000, cost: 80_000, executedPct: 0.5 },
      { status: "wait", value: 40_000, cost: 30_000, executedPct: 0.25 },
    ],
    cutPool: 2000,
    certificates: [
      { status: "paid", net: 20_000 },
      { status: "part", net: 10_000, collected: 0.5 },
      { status: "void", net: 99_999 },
    ],
    cost: { budget: 800_000, committed: 300_000, actual: 40_000, paid: 25_000 },
  }
  it("adds approved variations to the contract and to what was executed", () => {
    const m = moneyTrail(base)
    expect(m.contract).toBe(1_100_000)
    expect(m.voApproved).toBe(100_000)
    expect(m.executed).toBe(100_000)
    expect(m.billed).toBe(28_000)
    expect(m.gap).toBe(72_000)
    expect(m.collected).toBe(25_000)
    expect(m.outstanding).toBe(3000)
    expect(m.due).toBe(15_000)
    expect(m.margin).toBe(60_000)
  })
  it("counts work done under an unapproved variation apart", () => {
    expect(moneyTrail(base).voRisk).toBe(10_000)
  })
  it("uses the priced BOQ when the contract value is not set", () => {
    expect(moneyTrail({ ...base, contractBase: 0, variations: [] }).contract).toBe(100_000)
  })
  it("shows only to money, on a priced contract that bills or tracks cost", () => {
    const f = { money: true, contract: 1, itemCount: 2, unpricedCount: 1, ipcOn: true, costOn: false }
    expect(showMoneyTrail(f)).toBe(true)
    expect(showMoneyTrail({ ...f, money: false })).toBe(false)
    expect(showMoneyTrail({ ...f, unpricedCount: 2 })).toBe(false)
    expect(showMoneyTrail({ ...f, ipcOn: false })).toBe(false)
  })
  it("projects the penalty at today's slippage, red at the cap", () => {
    const n = penaltyNote({ damages: { on: true, weeklyRate: 0.005, cap: 0.1 }, contract: 1_000_000, delay: { planned: 50, delayDays: 30, damages: 20_000 }, progress: 40, margin: 10_000 })
    expect(n).toEqual({ amount: 20_000, atCap: false, behind: 10, delayDays: 30, weeks: 4, ratePct: 0.5, capPct: 10, overMargin: true })
    expect(penaltyNote({ damages: { on: true, weeklyRate: 0.005, cap: 0.1 }, contract: 1_000_000, delay: { planned: 50, delayDays: 30, damages: 100_000 }, progress: 40, margin: 0 })?.atCap).toBe(true)
    expect(penaltyNote({ damages: { on: false, weeklyRate: 0, cap: 0 }, contract: 1, delay: { planned: 50, delayDays: 30, damages: 0 }, progress: 40, margin: 0 })).toBeNull()
  })
})

describe("waiting on other modules", () => {
  const today = "2026-09-28"
  it("an order is late when its promised date has passed", () => {
    const [a, b] = poWaitRows(
      [
        { id: "1", docNumber: "PO-1", supplierName: "S", projectId: "p", promisedDate: "2026-09-20", createdAt: "2026-09-01", lines: [] },
        { id: "2", docNumber: "PO-2", supplierName: "S", projectId: "p", promisedDate: "2026-10-20", createdAt: "2026-09-01", lines: [] },
      ],
      today
    )
    expect(a.late).toBe(true)
    expect(b.late).toBe(false)
    expect(a.href).toBe("/contractor/rfqs/orders?po=1")
  })
  it("an approved request Procurement has not ordered waits on it", () => {
    const rows = requestWaitRows(
      [
        { id: "a", title: "Rebar", status: "approved", approvedOn: "2026-09-20", lines: [{}] },
        { id: "b", title: "Sand", status: "approved", poId: "x", lines: [{}] },
        { id: "c", title: "Cement", status: "pending", lines: [{}] },
      ],
      "p",
      today
    )
    expect(rows.map((r) => [r.id, r.age, r.late])).toEqual([["req:a", 8, true]])
  })
  it("Finance: a certified certificate not yet posted, and retention not released", () => {
    const rows = financeWaitRows({
      events: [
        { key: "prj:IPC:PJ-2026/001:01", kind: "IPC", projectId: "p", amount: 5000, params: { certificate: 1, net: 5750 }, at: "2026-09-27" },
        { key: "prj:IPC:PJ-2026/001:02", kind: "IPC", projectId: "p", amount: 5000, params: { certificate: 2 }, at: "2026-09-10" },
        { key: "prj:HND:PJ-2026/001:final", kind: "HND", projectId: "p", amount: 9000, params: { stage: "final" }, at: "2026-09-10" },
        { key: "prj:HND:PJ-2026/002:prov", kind: "HND", projectId: "q", amount: 4000, params: { stage: "prov" }, at: "2026-09-10" },
      ],
      posted: new Set(["prj:IPC:PJ-2026_001:02"]),
      released: new Set(["p"]),
      today,
    })
    expect(rows.map((r) => [r.kind, r.amount, r.late])).toEqual([
      ["cert_invoice", 5750, false],
      ["retention", 4000, true],
    ])
  })
  it("CRM owes the returned files", () => {
    expect(crmWaitRows([{ id: "h", title: "Villa", returned: { missing: [1, 2], at: "2026-09-20" } }], today)[0]).toMatchObject({ module: "crm", sub: { params: { count: 2 } }, age: 8 })
  })
  it("lists only the late, four at most, the rest behind 'show all'", () => {
    const row = (id: string, late: boolean, age: number) => ({ id, module: "proc" as const, kind: "po" as const, params: {}, sub: { kind: "po_lines", params: {} }, age, late, projectId: "p" })
    const rows = [row("a", true, 5), row("b", false, 1), row("c", true, 9)]
    const v = waitingView(rows, false)
    expect(v.shown.map((r) => r.id)).toEqual(["c", "a"])
    expect(v.more).toBe(true)
    expect(waitingView(rows, true).shown).toHaveLength(3)
    expect(waitingView([row("a", false, 1)], false)).toMatchObject({ shown: [], late: 0, more: true })
  })
})

describe("the project log", () => {
  const facts: LogFacts = {
    startedAt: "2026-06-01T08:00:00.000Z",
    location: "Riyadh",
    durationDays: 300,
    acceptances: null,
    sheets: [{ seq: 1, status: "ok", day: "2026-07-01" }, { seq: 2, status: "wait", day: "2026-09-01" }],
    variations: [{ seq: 1, title: "Extra slab", status: "appr", day: "2026-08-01", value: 50000, decision: { on: "2026-08-10" } }],
    claims: [{ seq: 1, status: "sub", eventOn: "2026-07-20", noticeOn: "2026-07-22", submittedOn: "2026-08-01" }],
    addenda: [],
    certificates: [{ seq: 1, status: "appr", prepOn: "2026-08-15", certOn: "2026-08-25", certified: 180000, net: 190000, dueOn: "2026-09-01" }],
    ncrs: [{ seq: 1, status: "open", day: "2026-09-10" }],
    obstacles: [{ type: "rfi", seq: 3, title: "Beam detail", impact: "stops B2", openOn: "2026-09-05" }],
    money: true,
    today: "2026-09-28",
  }
  it("lists the five latest dated facts, newest first", () => {
    expect(projectLog(facts).map((e) => e.kind)).toEqual(["ncr", "obstacle", "cert", "vo", "claim_submitted"])
  })
  it("carries the prototype's sub-lines", () => {
    const log = projectLog(facts, 10)
    expect(log.find((e) => e.kind === "started")?.sub).toEqual({ kind: "duration", params: { days: 300 } })
    expect(log.find((e) => e.kind === "obstacle")?.sub).toEqual({ kind: "obs_open", params: { days: 23, impact: "stops B2" } })
    expect(log.find((e) => e.kind === "cert")).toMatchObject({ tone: "bad", sub: { kind: "cert_net", params: { net: 190000, status: "appr" } } })
    expect(log.find((e) => e.kind === "vo")).toMatchObject({ day: "2026-08-10", sub: { kind: "vo_status", params: { status: "appr" } } })
  })
  it("logs an item far over its budget", () => {
    const log = projectLog({ ...facts, overBudget: [{ code: "B-12", over: 30000, unitActual: 120, unitBudget: 100 }, { code: "B-13", over: 1000, unitActual: 1, unitBudget: 1 }] }, 20)
    expect(log.filter((e) => e.kind === "over_budget").map((e) => [e.params.code, e.sub?.params.pct])).toEqual([["B-12", 20]])
  })
  it("hides certificates and values from a member without money", () => {
    const log = projectLog({ ...facts, money: false, overBudget: [{ code: "B-12", over: 30000, unitActual: 120, unitBudget: 100 }] }, 20)
    expect(log.some((e) => e.kind === "cert" || e.kind === "over_budget")).toBe(false)
    expect(log.find((e) => e.kind === "vo")?.params.value).toBe(0)
  })
})

describe("money trail — variation work", () => {
  it("counts approved variation work as executed, and its billed share as billed (the prototype's pEarned / pBilled)", () => {
    const trail = moneyTrail({
      contractBase: 1_000_000,
      items: [{ quantity: 100, rate: 1000, executed: 50, billed: 50 }],
      variations: [{ status: "appr", value: 85_000, cost: 60_000, executedPct: 0.4, billedPct: 0.1 }],
      cutPool: 0,
      certificates: [],
      cost: { budget: null, committed: 0, actual: 0, paid: 0 },
    })
    expect(trail.executed).toBe(84_000)
    expect(trail.billed).toBe(58_500)
    expect(trail.gap).toBe(25_500)
  })
})

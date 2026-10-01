/**
 * PM 1.0 — Execution parity with the prototype (E-02…E-22): the inline
 * measurement summary and the lump-sum write refusal, inspection due/overdue
 * and the items still needing a pass, punch step dates and the fix note, NCR
 * description/costs, sample turnaround, the ITP count, the look-ahead
 * constraints and PPC, plant cost on possession, and the sub-tab counts.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { cleanAttachments } from "@/lib/pm/attachments"
import { execCounts } from "@/lib/pm/exec-counts"
import { todayDay } from "@/lib/pm/format"
import { itemsNeedingPass, overdueDays, resultBlocks, resultDay } from "@/lib/pm/inspection"
import { itpBlocks, itpDone, itpGap } from "@/lib/pm/itp"
import { aboveContract, lastApprovedDay, measureSummary, openItems, recordedValue, sheetWriteBlocks, type MeasuredItem } from "@/lib/pm/measurement"
import { writeSheet } from "@/lib/pm/measurement-writes"
import { ncrBlocks, ncrCost, ncrStepBlocks } from "@/lib/pm/ncr"
import { acceptNcr, raiseNcr, submitNcrPlan } from "@/lib/pm/ncr-writes"
import { backBlocks, dayCost, handoverBlocks, idleSince, licenceState, overdueDays as plantOverdue, plantCost, utilisation, type PmPlant } from "@/lib/pm/plant"
import { punchBlocks, punchStepBlocks } from "@/lib/pm/punch"
import { averageTurnaround, canResubmit, replyBlocks, turnaround } from "@/lib/pm/sample"
import { defaultTerms } from "@/lib/pm/terms"
import { activityConstraints, closeWeekBlocks, currentWeek, lookahead, missReasonsTop, ppc, ppcAverage, weekStart, type LookFacts, type PmWeek, type WeekTask } from "@/lib/pm/weekly-plan"
import { closeWeek, commitWeek } from "@/lib/pm/weekly-plan-writes"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const seA = { uid: "se1", name: "Omar" }
const item = (id: string, quantity: number, rate: number, executed = 0, gate?: MeasuredItem["gate"]): MeasuredItem => ({ id, quantity, rate, executed, gate })

beforeEach(() => resetFakeDb())

describe("measurement (E-02…E-08)", () => {
  it("hides completed items and counts them", () => {
    const r = openItems([item("a", 10, 1, 10), item("b", 10, 1, 4)])
    expect(r.open.map((i) => i.id)).toEqual(["b"])
    expect(r.done).toBe(1)
  })

  it("the live summary: value as entered, unpriced, over-remaining on a lump sum, no passed inspection", () => {
    const items = [item("a", 100, 10, 95), item("b", 50, 0), item("c", 10, 5, 0, { pmInspect: true, pmWir: "fail" })]
    const s = measureSummary("lump", [{ itemId: "a", qty: 8 }, { itemId: "b", qty: 3 }, { itemId: "c", qty: 2 }], items)
    expect(s).toEqual({ count: 3, value: 90, unpriced: 1, over: 1, noPass: 1 })
    expect(measureSummary("rem", [{ itemId: "a", qty: 8 }], items).over).toBe(0)
    expect(aboveContract("rem", items[0], 8)).toBe(3)
    expect(aboveContract("lump", items[0], 8)).toBe(0)
  })

  it("a lump-sum sheet over the remaining is refused at writing; re-measurement is not", () => {
    const items = [item("a", 100, 10, 95)]
    expect(sheetWriteBlocks({ archived: false, basis: "lump", lines: [{ itemId: "a", qty: 8 }], items })).toEqual(["over_remaining"])
    expect(sheetWriteBlocks({ archived: false, basis: "rem", lines: [{ itemId: "a", qty: 8 }], items })).toEqual([])
  })

  it("the write stores the period note and the documents, and refuses over-remaining on a lump sum", async () => {
    const terms = { ...defaultTerms(), basis: "lump" as const }
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { lifecycle: "live", terms, original: terms } })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "100", unitPrice: "10", executedQuantity: 95 })
    await expect(writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 8 }] })).rejects.toMatchObject({ blocks: ["over_remaining"] })
    await writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 5 }], note: "Fortnightly — villa 1", files: [{ url: "https://x/a.pdf", name: "a.pdf" }, { url: "", name: "bad" }] })
    expect(readDoc("projects/p1/pmSheets/01")).toMatchObject({ note: "Fortnightly — villa 1", files: [{ url: "https://x/a.pdf", name: "a.pdf" }] })
  })

  it("a sheet's value: approved quantities once approved; the last approved day", () => {
    const rate = () => 10
    expect(recordedValue({ status: "ok", lines: [{ itemId: "a", qty: 8, approved: 5 }] }, rate)).toBe(50)
    expect(recordedValue({ status: "wait", lines: [{ itemId: "a", qty: 8 }] }, rate)).toBe(80)
    expect(lastApprovedDay([{ status: "ok", day: "2026-09-01" }, { status: "wait", day: "2026-09-20" }, { status: "ok", day: "2026-09-10" }])).toBe("2026-09-10")
  })

  it("attachments keep only well-formed entries", () => {
    expect(cleanAttachments([{ url: "u", name: "n" }, { name: "x" }, null as unknown as { url: string }])).toEqual([{ url: "u", name: "n" }])
  })
})

describe("inspections (E-09, E-10)", () => {
  it("due and overdue, result day, and what still needs a pass", () => {
    expect(overdueDays({ on: "2026-09-20", result: null }, "2026-09-25")).toBe(5)
    expect(overdueDays({ on: "2026-09-26", result: null }, "2026-09-25")).toBe(0)
    expect(overdueDays({ on: "2026-09-20", result: "pass" }, "2026-09-25")).toBe(0)
    expect(resultDay({ on: "2026-09-20", rOn: "2026-09-21", rAt: "2026-09-22T10:00:00Z" })).toBe("2026-09-21")
    expect(resultDay({ on: "2026-09-20", rAt: "2026-09-22T10:00:00Z" })).toBe("2026-09-22")
    const need = itemsNeedingPass([
      { id: "a", quantity: 10, executed: 2, gate: { pmInspect: true, pmWir: "fail" } },
      { id: "b", quantity: 10, executed: 2, gate: { pmInspect: true, pmWir: "pass" } },
      { id: "c", quantity: 10, executed: 10, gate: { pmInspect: true } },
      { id: "d", quantity: 10, executed: 0 },
    ])
    expect(need.map((i) => i.id)).toEqual(["a"])
  })

  it("a failure or pass with comments needs the inspector's note; the result day is not in the future", () => {
    expect(resultBlocks({ archived: false, status: "open", result: "fail", note: " " })).toEqual(["no_note"])
    expect(resultBlocks({ archived: false, status: "open", result: "pass", note: "" })).toEqual([])
    expect(resultBlocks({ archived: false, status: "open", result: "pass", on: "2099-01-01", today: "2026-09-28" })).toEqual(["bad_date"])
  })
})

describe("punch (E-11)", () => {
  it("dates and the fix note, and who confirmed", () => {
    expect(punchBlocks({ archived: false, what: "x", location: "y", source: "cons", day: "2099-01-01", today: "2026-09-28" })).toEqual(["bad_date"])
    expect(punchStepBlocks({ archived: false, status: "open", step: "fix", note: " " })).toEqual(["no_fix_note"])
    expect(punchStepBlocks({ archived: false, status: "open", step: "fix", note: "Re-plastered", day: "2026-09-01", today: "2026-09-28", after: "2026-09-05" })).toEqual(["bad_date"])
    expect(punchStepBlocks({ archived: false, status: "fix", step: "confirm", party: "oth", partyText: "" })).toEqual(["party_text"])
    expect(punchStepBlocks({ archived: false, status: "fix", step: "confirm" })).toEqual([])
  })
})

describe("NCR (E-13, E-14)", () => {
  it("the description is required from the screen; the latest cost stands", () => {
    expect(ncrBlocks({ archived: false, root: "r", cost: 0, what: "" })).toEqual(["no_what"])
    expect(ncrBlocks({ archived: false, root: "r", cost: 0 })).toEqual([])
    expect(ncrCost({ cost: 100, plan: { on: "d", by: "u", text: "t", cost: 150 }, accepted: { on: "d", by: "u", cost: 180 } })).toBe(180)
    expect(ncrCost({ cost: 100, plan: { on: "d", by: "u", text: "t" }, accepted: null })).toBe(100)
    expect(ncrStepBlocks({ archived: false, status: "plan", step: "accept", day: "2026-09-01", today: "2026-09-28", after: "2026-09-10" })).toEqual(["bad_date"])
  })

  it("raised with what and when, closed on the consultant's day with the actual cost", async () => {
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { lifecycle: "live" } })
    seed("projects/p1/boqItems/i1", { itemNo: "04-02-01" })
    const today = todayDay()
    const seq = await raiseNcr(db, site, "p1", seA, { itemId: "i1", severity: "a", root: "Excess sand", cost: 1000, what: "Plaster too thin", day: today })
    await submitNcrPlan(db, site, "p1", seA, seq, "Redo with approved mix", { cost: 1500 })
    await acceptNcr(db, site, "p1", seA, seq, { on: today, cost: 1800 })
    expect(readDoc("projects/p1/pmNcrs/01")).toMatchObject({ what: "Plaster too thin", day: today, status: "done", plan: { cost: 1500 }, accepted: { on: today, cost: 1800 } })
  })
})

describe("samples (E-15, E-16)", () => {
  it("turnaround, average, and resubmission of the latest rejected revision only", () => {
    expect(turnaround({ day: "2026-09-01", status: "appA", reply: { on: "2026-09-08", by: "u" } }, "2026-09-28")).toEqual({ days: 7, open: false })
    expect(turnaround({ day: "2026-09-20", status: "sub", reply: null }, "2026-09-28")).toEqual({ days: 8, open: true })
    expect(averageTurnaround([{ day: "2026-09-01", status: "appA", reply: { on: "2026-09-08", by: "u" } }, { day: "2026-09-01", status: "rej", reply: { on: "2026-09-12", by: "u" } }], "2026-09-28")).toBe(9)
    const a = { status: "rej" as const, itemId: "i1", rev: 1 }
    expect(canResubmit(a, [a])).toBe(true)
    expect(canResubmit(a, [a, { itemId: "i1", rev: 2 }])).toBe(false)
    expect(replyBlocks({ archived: false, status: "sub", reply: "appB", note: "" })).toEqual(["no_note"])
  })
})

describe("ITP (E-12)", () => {
  it("done is counted from passed inspections on the item", () => {
    const done = itpDone("i1", [{ itemId: "i1", status: "pass" }, { itemId: "i1", status: "cond" }, { itemId: "i1", status: "fail" }, { itemId: "i2", status: "pass" }])
    expect(done).toBe(2)
    expect(itpGap(5, done)).toBe(3)
    expect(itpBlocks({ archived: false, itemId: "i1", stage: "s", test: "t", freq: "f", need: 0, party: "consultant" })).toEqual(["bad_need"])
  })
})

describe("look-ahead and the weekly plan (E-21)", () => {
  const base = (): LookFacts => ({
    items: [
      { id: "i1", code: "03-01", quantity: 100, rate: 10, executed: 0, gate: { pmInspect: true, pmWir: "fail" }, pmSample: true, pmSub: "rej" },
      { id: "i2", code: "03-02", quantity: 100, rate: 10, executed: 90 },
    ],
    activities: [
      { id: "a1", seq: 1, name: "Frame", from: "2026-09-01", to: "2026-09-20", itemIds: ["i2"], pred: null, by: "u", at: "" },
      { id: "a2", seq: 2, name: "Slab", from: "2026-10-01", to: "2026-10-10", itemIds: ["i1"], pred: "a1", by: "u", at: "", permit: true },
      { id: "a3", seq: 3, name: "Late", from: "2026-12-01", to: "2026-12-10", itemIds: ["i2"], pred: null, by: "u", at: "" },
    ],
    obstacles: [{ title: "RFI-01", party: "consultant", itemIds: ["i1"], closeOn: null }],
    livePermits: 0,
    staleDrawings: 1,
    on: { docs: true, subm: true, wir: true, rfi: true, hse: true },
  })

  it("computes every constraint from the project's data", () => {
    const f = base()
    const cs = activityConstraints(f.activities[1], f)
    expect(cs.map((c) => [c.k, c.ok])).toEqual([
      ["dwg", false],
      ["subm", false],
      ["pred", false],
      ["insp", false],
      ["rfi", false],
      ["pmt", false],
    ])
    expect(cs.find((c) => c.k === "pred")?.detail).toEqual({ kind: "pred", name: "Frame", pc: 90 })
  })

  it("the window is three weeks, incomplete activities, soonest first", () => {
    const rows = lookahead(base(), "2026-09-28")
    expect(rows.map((r) => r.a.id)).toEqual(["a2"])
    expect(rows[0].startsIn).toBe(3)
  })

  it("PPC, the average over closed weeks and the reasons Pareto; a missed task needs a reason", () => {
    const task = (t: Partial<WeekTask>): WeekTask => ({ activityId: "a", name: "x", qty: 1, ready: true, done: false, ...t })
    const week = (status: string, tasks: WeekTask[]) => ({ status, tasks }) as Pick<PmWeek, "status" | "tasks">
    const w1 = week("done", [task({ done: true }), task({ why: "mat" })])
    const w2 = week("done", [task({ why: "mat" }), task({ why: "weather" })])
    expect(ppc(w1)).toBe(50)
    expect(ppcAverage([w1, w2, week("open", [task({})])])).toBe(25)
    expect(missReasonsTop([w1, w2])[0]).toEqual({ k: "mat", n: 2 })
    expect(closeWeekBlocks({ archived: false, status: "open", results: [{ done: false, why: "other", whyText: " " }] })).toEqual(["no_reason"])
    expect(weekStart("2026-09-30")).toBe("2026-09-27")
    expect(currentWeek([{ week: "2026-09-13" }, { week: "2026-09-20" }], "2026-09-25")?.week).toBe("2026-09-20")
  })

  it("commits once a week and closes with PPC", async () => {
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { lifecycle: "live" } })
    const week = await commitWeek(db, site, "p1", seA, [{ activityId: "a1", name: "Frame", qty: 10, ready: true }, { activityId: "a2", name: "Slab", qty: 5, ready: false, open: ["rfi"] }])
    await expect(commitWeek(db, site, "p1", seA, [{ activityId: "a1", name: "Frame", qty: 1, ready: true }])).rejects.toMatchObject({ blocks: ["exists"] })
    await expect(closeWeek(db, site, "p1", seA, week, [{ done: true }, { done: false }])).rejects.toMatchObject({ blocks: ["no_reason"] })
    const pc = await closeWeek(db, site, "p1", seA, week, [{ done: true }, { done: false, why: "insp" }])
    expect(pc).toBe(50)
    expect(readDoc(`projects/p1/pmWeeks/${week}`)).toMatchObject({ status: "done", tasks: [{ done: true }, { done: false, why: "insp" }] })
  })
})

describe("plant on site (E-22)", () => {
  const p = (days: PmPlant["days"], extra: Partial<PmPlant> = {}): Pick<PmPlant, "dayRate" | "category" | "days" | "qty" | "to" | "status"> => ({ dayRate: 900, category: "heavy", qty: 1, days, to: "2026-09-30", status: "use", ...extra })

  it("any work makes a full day; idle is two-thirds unless it worked within ±3 days; breakdown costs nothing; tools are not rated", () => {
    const x = p({ "2026-09-01": "work", "2026-09-03": "idle", "2026-09-10": "idle", "2026-09-11": "down", "2026-09-12": "move" })
    expect(dayCost(x, "2026-09-03")).toBe(900)
    expect(dayCost(x, "2026-09-10")).toBe(600)
    expect(dayCost(x, "2026-09-11")).toBe(0)
    expect(dayCost(x, "2026-09-12")).toBe(900)
    expect(plantCost(x)).toBe(3300)
    expect(plantCost(p({ "2026-09-01": "work" }, { category: "tool" }))).toBe(0)
    expect(idleSince(x)).toBe(2) // two idle days; the breakdown and the transit day are not idle days
    expect(utilisation(x)).toBe(20)
    expect(plantOverdue(x, "2026-10-03")).toBe(3)
  })

  it("the licence gate and the meter that never runs backwards", () => {
    expect(licenceState({ category: "lift", licenceTo: "2026-09-01" }, "2026-09-28")).toBe("expired")
    expect(licenceState({ category: "lift", licenceTo: "2026-10-10" }, "2026-09-28")).toBe("warn")
    expect(licenceState({ category: "light", licenceTo: "2026-09-01" }, "2026-09-28")).toBe("none")
    expect(
      handoverBlocks({ archived: false, name: "Crane", qty: 1, from: "2026-09-20", to: "2026-10-20", category: "lift", meter: null, licenceTo: "2026-09-01", hercNo: "HE-1", condition: "bad", remark: "", today: "2026-09-28" })
    ).toEqual(["no_meter", "licence_expired", "no_remark"])
    const plant = { status: "req" as const, offOk: { on: "2026-09-27", by: "u" }, category: "heavy" as const, handover: { on: "2026-09-01", meter: 5000, condition: "ok" as const, by: "u" } }
    expect(backBlocks({ archived: false, plant, meter: 4900, condition: "ok" })).toEqual(["meter_back"])
    expect(backBlocks({ archived: false, plant: { ...plant, offOk: null }, meter: 5100, condition: "ok" })).toEqual(["not_confirmed"])
  })
})

describe("the Execution sub-tab counts (E-00a)", () => {
  it("counts what needs someone, red when an inspection failed", () => {
    const c = execCounts({
      sheets: [{ status: "wait" }, { status: "ok" }],
      inspections: [{ status: "open" }, { status: "fail" }, { status: "pass" }],
      punch: [{ status: "fix" }, { status: "done" }],
      ncrs: [{ status: "plan" }],
      obstacles: [{ closeOn: null }, { closeOn: "2026-09-01" }],
      subCertificates: [{ status: "int" }],
      lookaheadBlocked: null,
    })
    expect(c).toEqual({ pmMeasure: { count: 1, tone: "warn" }, pmQa: { count: 3, tone: "bad" }, pmSite: { count: 1, tone: "warn" }, pmSubs: { count: 1, tone: "warn" } })
    expect(execCounts({ sheets: [], inspections: [], punch: [], ncrs: [], obstacles: [{ closeOn: null }], subCertificates: [], lookaheadBlocked: 3 }).pmSite).toEqual({ count: 3, tone: "warn" })
  })
})

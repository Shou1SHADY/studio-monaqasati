/**
 * PM 1.1 — site, quality and programme corrections (CHANGES-PM-1.0-to-1.1 §2,
 * qa_fixes.js FX-10 · 23 · 25 · 26 · 27 · 28 · 29 · 30 · 31 · 50 · 67…70,
 * WF-28 · WF-31 · WF-32). Each case is the qa step ported to our helpers and writes.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import fs from "fs"
import path from "path"
import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmAllowed, pmCeiling, type PmContext } from "@/lib/pm/access"
import { finalBlocks } from "@/lib/pm/acceptance"
import { closeBlocks, closeoutRows } from "@/lib/pm/closeout"
import { keepOwnRefs, lateLettersSeverity, refLabel, replyStatus, shownLetterStatus } from "@/lib/pm/correspondence"
import { todayDay } from "@/lib/pm/format"
import { closeHold, holdBlocks, holdProject, resumeProject, type HoldEntry } from "@/lib/pm/hold-writes"
import { gateOf, gateWrites, measurable, type PmInspection } from "@/lib/pm/inspection"
import { recordResult, requestInspection } from "@/lib/pm/inspection-writes"
import { canMove } from "@/lib/pm/lifecycle"
import { sheetBlocks } from "@/lib/pm/measurement"
import { activityBlocks, activityDays, addDays } from "@/lib/pm/programme"
import { addActivity, PmActivityError, updateActivity } from "@/lib/pm/programme-writes"
import { raisePunch, recordConfirmation, recordFix } from "@/lib/pm/punch-writes"
import { closePermitBlocks, livePermits, obstacleBlocks, permitBlocks, permitState, permitValidOn, replyStats, type PmObstacle } from "@/lib/pm/site"
import { fileDailyReport, PmSiteError } from "@/lib/pm/site-writes"
import { defaultTerms } from "@/lib/pm/terms"
import { activityConstraints, type LookActivity, type LookFacts } from "@/lib/pm/weekly-plan"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const seA = { uid: "se1", name: "Omar" }
const pmA = { uid: "pm1", name: "Abdullah" }
const today = todayDay()
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8")

function seedProject(extra: Record<string, unknown> = {}, pmExtra: Record<string, unknown> = {}) {
  const terms = defaultTerms()
  seed("projects/p1", { organizationId: "org", budget: 1e6, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live", startedAt: addDays(today, -60), terms, original: terms, ...pmExtra }, ...extra })
  seed("projects/p1/boqItems/i1", { itemNo: "03-02-01", quantity: "100", unitPrice: "900", executedQuantity: 0, pmInspect: true })
}
beforeEach(() => resetFakeDb())

describe("PRG-01 · WF-32 — activities (FX-10, FX-70)", () => {
  it("a one-day activity is valid; an end before its start is not", () => {
    expect(activityBlocks({ name: "Pour", from: "2026-11-05", to: "2026-11-05", pred: null }, [])).toEqual([])
    expect(activityBlocks({ name: "Pour", from: "2026-11-10", to: "2026-11-05", pred: null }, [])).toEqual(["dates"])
    expect(activityDays({ from: "2026-11-05", to: "2026-11-05" })).toBe(1)
  })

  it("the rules allow end = start in both places", () => {
    const body = rules.slice(rules.indexOf("match /pmActivities/{activityId}"), rules.indexOf("match /pmSubcontracts/{contractId}"))
    expect(body.match(/request\.resource\.data\.to >= request\.resource\.data\.from/g)).toHaveLength(2)
    expect(body).not.toMatch(/data\.to > request/)
  })

  it("one is added from its form; once live, its dates are the baseline (WF-32)", async () => {
    seedProject({}, { lifecycle: "plan" })
    const id = await addActivity(db, pm, "p1", pmA, { name: "FX-70", from: addDays(today, 5), to: addDays(today, 5), itemIds: [], pred: null, permit: "hot" })
    expect(readDoc(`projects/p1/pmActivities/${id}`)).toMatchObject({ from: addDays(today, 5), to: addDays(today, 5), permit: "hot" })
    seed("projects/p1", { ...readDoc("projects/p1")!, pm: { ...(readDoc<{ pm: object }>("projects/p1")!.pm), lifecycle: "live" } })
    await expect(updateActivity(db, pm, "p1", id, { name: "FX-70", from: addDays(today, 6), to: addDays(today, 6), itemIds: [], pred: null })).rejects.toMatchObject({ blocks: ["dates_locked"] })
    await updateActivity(db, pm, "p1", id, { name: "renamed", from: addDays(today, 5), to: addDays(today, 5), itemIds: [], pred: null, permit: null })
    expect(readDoc(`projects/p1/pmActivities/${id}`)).toMatchObject({ name: "renamed", permit: false })
    expect(PmActivityError).toBeDefined()
  })
})

describe("DLY-01 — a daily obstacle enters the obstacles list (FX-28)", () => {
  it("logged as an obstacle dated today when the obstacles list is on; work done stays required", async () => {
    seedProject({ enabledSections: ["daily", "rfi"] })
    await expect(fileDailyReport(db, site, "p1", seA, { labour: 10, plant: 1, done: "", obstacle: "" })).rejects.toBeInstanceOf(PmSiteError)
    await fileDailyReport(db, site, "p1", seA, { labour: 10, plant: 1, done: "Work", obstacle: "Concrete late" })
    expect(readDoc(`projects/p1/pmDaily/${today}`)).toMatchObject({ obstacle: "Concrete late", obsId: "obs-01" })
    expect(readDoc<PmObstacle>("projects/p1/pmObstacles/obs-01")).toMatchObject({ type: "obs", title: "Concrete late", party: "none", openOn: today, src: { daily: today }, closeOn: null })
    expect(readDoc<{ pm: { obstacleCount: number } }>("projects/p1")!.pm.obstacleCount).toBe(1)
  })

  it("not when unticked, nor on a project that keeps no obstacles list", async () => {
    seedProject({ enabledSections: ["daily", "rfi"] })
    await fileDailyReport(db, site, "p1", seA, { labour: 1, plant: 0, done: "x", obstacle: "Rain", logObstacle: false })
    expect(readDoc("projects/p1/pmObstacles/obs-01")).toBeNull()
    resetFakeDb()
    seedProject({ enabledSections: ["daily"] })
    await fileDailyReport(db, site, "p1", seA, { labour: 1, plant: 0, done: "x", obstacle: "Rain" })
    expect(readDoc(`projects/p1/pmDaily/${today}`)).toMatchObject({ obsId: null })
  })
})

describe("OBS-01 — obstacles and RFIs (FX-27)", () => {
  it("an RFI names who owes the answer", () => {
    const base = { archived: false, title: "Q", partyName: "", impact: "x", openOn: today, itemIds: [], knownItems: new Set<string>(), today }
    expect(obstacleBlocks({ ...base, type: "rfi", party: "none" })).toEqual(["rfi_party"])
    expect(obstacleBlocks({ ...base, type: "obs", party: "none" })).toEqual([])
  })

  it("the reply time is averaged overall and per party; one owed by nobody has no reply", () => {
    const s = replyStats([
      { party: "consultant", partyName: null, openOn: "2026-10-01", closeOn: "2026-10-05" },
      { party: "consultant", partyName: null, openOn: "2026-10-01", closeOn: "2026-10-04" },
      { party: "client", partyName: null, openOn: "2026-10-01", closeOn: "2026-10-11" },
      { party: "none", partyName: null, openOn: "2026-10-01", closeOn: "2026-10-30" },
      { party: "client", partyName: null, openOn: "2026-10-01", closeOn: null },
    ])
    expect(s.avg).toBe(5.7)
    expect(s.n).toBe(3)
    expect(s.byParty).toEqual([
      { party: "client", partyName: null, n: 1, avg: 10 },
      { party: "consultant", partyName: null, n: 2, avg: 3.5 },
    ])
    expect(replyStats([]).avg).toBeNull()
  })

  it("a chase is daily | approve — in the guard and in the rules (§C3)", () => {
    expect(pmAllowed(qs, "obstacle.chase")).toBe(false)
    expect(pmAllowed(site, "obstacle.chase")).toBe(true)
    expect(pmAllowed(pm, "obstacle.chase")).toBe(true)
    const body = rules.slice(rules.indexOf("match /pmObstacles/{obstacleId}"), rules.indexOf("match /pmIncidents/{incidentId}"))
    const update = body.slice(body.indexOf("allow update"))
    expect(update).not.toMatch(/pmLiveSeat|pmCeilingHas\('all'\)/)
    expect(update).toMatch(/\(pmDuty\(projectId, 'daily'\) \|\| pmDuty\(projectId, 'approve'\)\)\s*&& \(\(changedKeys\(\)\.hasOnly\(\['chases'/)
  })
})

describe("HSE-01 · WWP-01 — permits of a kind, valid on the start day (FX-29)", () => {
  const p = (k: "hot" | "height", from: string, to: string, closedOn: string | null = null) => ({ k, from, to, closedOn })
  it("a permit has a kind ('other' stated)", () => {
    expect(permitBlocks({ archived: false, type: null, title: "x", who: "y", from: today, to: today })).toEqual(["no_type"])
    expect(permitBlocks({ archived: false, type: "oth", typeText: " ", title: "x", who: "y", from: today, to: today })).toEqual(["type_text"])
  })

  it("only a permit of that kind covering the day, not closed by then, makes it ready", () => {
    const list = [p("hot", "2026-11-01", "2026-11-10")]
    expect(permitValidOn(list, "hot", "2026-11-05")).toBe(true)
    expect(permitValidOn(list, "height", "2026-11-05")).toBe(false)
    expect(permitValidOn(list, "hot", "2026-11-12")).toBe(false)
    expect(permitValidOn([p("hot", "2026-11-01", "2026-11-10", "2026-11-03")], "hot", "2026-11-05")).toBe(false)
    expect(permitValidOn([p("hot", "2026-11-01", "2026-11-10", "2026-11-08")], "hot", "2026-11-05")).toBe(true)
    expect(permitValidOn(list, true, "2026-11-05")).toBe(true)
  })

  it("the look-ahead: a10 needs a kind nobody holds; a5's permit is good until closed early", () => {
    const start = addDays(today, 3)
    const act = (id: string, permit: LookActivity["permit"]): LookActivity => ({ id, seq: 1, name: id, from: start, to: addDays(start, 2), itemIds: [], pred: null, permit, by: "u", at: "" })
    const facts = (permits: LookFacts["permits"]): LookFacts => ({ items: [], activities: [], obstacles: [], livePermits: 0, permits, staleDrawings: 0, on: { docs: false, subm: false, wir: false, rfi: false, hse: true } })
    const w1 = p("hot", today, addDays(today, 10))
    const pmt = (a: LookActivity, f: LookFacts) => activityConstraints(a, f, today).find((c) => c.k === "pmt")
    expect(pmt(act("a10", "height"), facts([w1]))).toMatchObject({ ok: false, detail: { kind: "no_permit", type: "height", day: start } })
    expect(pmt(act("a5", "hot"), facts([w1]))!.ok).toBe(true)
    expect(pmt(act("a5", "hot"), facts([{ ...w1, closedOn: today }]))!.ok).toBe(false)
    expect(pmt(act("a0", null), facts([]))).toBeUndefined()
  })

  it("closing: once, never an expired one; a closed permit is no longer live", () => {
    expect(closePermitBlocks({ archived: false, to: addDays(today, 3), closedOn: null, today })).toEqual([])
    expect(closePermitBlocks({ archived: false, to: addDays(today, 3), closedOn: today, today })).toEqual(["closed"])
    expect(closePermitBlocks({ archived: false, to: addDays(today, -1), closedOn: null, today })).toEqual(["expired"])
    expect(livePermits([{ to: addDays(today, 3), closedOn: today }], today)).toHaveLength(0)
    expect(permitState({ to: addDays(today, 3), closedOn: today }, today)).toBe("closed")
  })
})

describe("WWP-01 · WWP-02 — the look-ahead's inspection and plant constraints (FX-30, FX-31)", () => {
  const base: LookFacts = { items: [], activities: [], obstacles: [], livePermits: 0, staleDrawings: 0, on: { docs: false, subm: false, wir: true, rfi: false, hse: false, eqp: true } }
  const a = (id: string, itemIds: string[], pred: string | null = null): LookActivity => ({ id, seq: 1, name: id, from: addDays(today, 2), to: addDays(today, 4), itemIds, pred, by: "u", at: "" })
  it("a machine requested for the activity and still awaiting approval keeps it not ready", () => {
    const f: LookFacts = { ...base, plant: [{ activityId: "a6", status: "wait", what: "Vibrators", got: null }] }
    expect(activityConstraints(a("a6", []), f, today).find((c) => c.k === "crew")).toMatchObject({ ok: false, detail: { kind: "plant", waiting: true } })
    const rej: LookFacts = { ...base, plant: [{ activityId: "a6", status: "rej", what: "Vibrators", got: null }] }
    expect(activityConstraints(a("a6", []), rej, today).find((c) => c.k === "crew")!.ok).toBeNull()
  })

  it("the preceding work's gated items need a passed inspection", () => {
    const items = [
      { id: "b1", code: "03-01", quantity: 1, rate: 1, executed: 1, gate: { pmInspect: true, pmWir: "open" } },
      { id: "b2", code: "04-01", quantity: 1, rate: 1, executed: 0 },
    ]
    const prev = a("a5", ["b1"])
    const f: LookFacts = { ...base, items, activities: [prev] }
    expect(activityConstraints(a("a6", ["b2"], "a5"), f, today).find((c) => c.k === "insp")).toMatchObject({ ok: false, detail: { kind: "pred_insp", code: "03-01" } })
    const passed: LookFacts = { ...f, items: [{ ...items[0], gate: { pmInspect: true, pmWir: "pass" } }, items[1]] }
    expect(activityConstraints(a("a6", ["b2"], "a5"), passed, today).find((c) => c.k === "insp")!.ok).toBe(true)
  })
})

describe("MS-03 — the last inspection rules (FX-23)", () => {
  it("a late result on an older request never overwrites a newer one", async () => {
    seedProject()
    await requestInspection(db, site, "p1", seA, { itemId: "i1", location: "Slab A", party: "consultant", on: today })
    await requestInspection(db, site, "p1", seA, { itemId: "i1", location: "Slab B", party: "consultant", on: today })
    await recordResult(db, site, "p1", seA, 2, { result: "fail", note: "Cover", on: today })
    expect(readDoc<{ pmWir: string }>("projects/p1/boqItems/i1")!.pmWir).toBe("fail")
    await recordResult(db, site, "p1", seA, 1, { result: "pass", note: null, on: today })
    expect(readDoc<PmInspection>("projects/p1/pmInspections/01")!.status).toBe("pass")
    expect(readDoc<{ pmWir: string }>("projects/p1/boqItems/i1")!.pmWir).toBe("fail")
    expect(gateWrites({ seq: 1, unit: "V1" }, [{ seq: 2, unit: "V2" }])).toEqual({ item: false, unit: true })
  })

  it("with units, the measured unit's own inspection is read", async () => {
    seedProject()
    await requestInspection(db, site, "p1", seA, { itemId: "i1", location: "Villa 1", unit: "V1", party: "consultant", on: today })
    await recordResult(db, site, "p1", seA, 1, { result: "pass", note: null, on: today })
    const line = readDoc<{ pmInspect: boolean; pmWir: "pass"; pmWirByUnit: Record<string, "pass"> }>("projects/p1/boqItems/i1")!
    expect(line.pmWirByUnit).toEqual({ V1: "pass" })
    expect(measurable(line, "V1")).toBe(true)
    expect(measurable(line, "V2")).toBe(false)
    expect(gateOf(line, "V2")).toBe("needs")
    const items = [{ id: "i1", gate: line }]
    expect(sheetBlocks({ archived: false, lines: [{ itemId: "i1", qty: 1, unit: "V2" }], items })).toEqual(["not_measurable"])
    expect(sheetBlocks({ archived: false, lines: [{ itemId: "i1", qty: 1, unit: "V1" }], items })).toEqual([])
    // An item inspected only as a whole still reads the item's result.
    expect(measurable({ pmInspect: true, pmWir: "pass" }, "V9")).toBe(true)
  })
})

describe("PN-02 — closed only by whoever raised it (FX-25)", () => {
  it("the confirmer is the raiser, never chosen", async () => {
    seedProject()
    const seq = await raisePunch(db, site, "p1", seA, { what: "Crack", location: "Stair", severity: "a", source: "cons" })
    await recordFix(db, site, "p1", seA, seq, "Re-plastered")
    await recordConfirmation(db, site, "p1", seA, seq, { party: "int" } as never)
    expect(readDoc<{ status: string; conf: { party: string } }>("projects/p1/pmPunch/01")).toMatchObject({ status: "done", conf: { party: "cons", by: "se1" } })
    const two = await raisePunch(db, site, "p1", seA, { what: "Door", location: "V2", severity: "b", source: "oth", sourceText: "Client's agent" })
    await recordFix(db, site, "p1", seA, two, "Rehung")
    await recordConfirmation(db, site, "p1", seA, two)
    expect(readDoc<{ conf: { party: string; partyText: string } }>("projects/p1/pmPunch/02")!.conf).toMatchObject({ party: "oth", partyText: "Client's agent" })
  })
})

describe("PRJ-02 · HND-01 · WF-28 — suspension (FX-50)", () => {
  it("a reason from the list ('other' stated), a day neither ahead nor before the start", () => {
    const b = { archived: false, lifecycle: "live" as const, to: "hold" as const, today, startOn: "2026-09-01" }
    expect(holdBlocks({ ...b, k: null, since: today })).toEqual(["no_reason"])
    expect(holdBlocks({ ...b, k: "oth", text: " ", since: today })).toEqual(["reason_text"])
    expect(holdBlocks({ ...b, k: "client", since: "2026-08-31" })).toEqual(["before_start"])
    expect(holdBlocks({ ...b, k: "client", since: addDays(today, 1) })).toEqual(["bad_day"])
    expect(holdBlocks({ ...b, k: "pay", since: today })).toEqual([])
  })

  it("suspended and resumed by the approver; the log names who suspended and who resumed", async () => {
    seedProject()
    await expect(holdProject(db, site, "p1", seA, { k: "client", since: today })).rejects.toBeInstanceOf(PmAccessError)
    await holdProject(db, pm, "p1", pmA, { k: "client", note: "Façade redesign", since: addDays(today, -2) })
    let p = readDoc<{ status: string; pm: { lifecycle: string; holdK: string; holdBy: string; holdLog: HoldEntry[] } }>("projects/p1")!
    expect(p).toMatchObject({ status: "hold", pm: { lifecycle: "hold", holdK: "client", holdBy: "pm1" } })
    expect(p.pm.holdLog).toEqual([expect.objectContaining({ since: addDays(today, -2), until: null, k: "client", by: "pm1", note: "Façade redesign" })])
    await expect(resumeProject(db, site, "p1", seA)).rejects.toBeInstanceOf(PmAccessError)
    await resumeProject(db, pm, "p1", { uid: "pm1", name: "Abdullah" })
    p = readDoc("projects/p1")!
    expect(p.pm.lifecycle).toBe("live")
    expect(p.pm.holdLog).toHaveLength(1)
    expect(p.pm.holdLog[0]).toMatchObject({ until: today, by: "pm1", resBy: "pm1", end: "resume" })
  })

  it("final acceptance completes a suspended project, and closes its log line", () => {
    expect(canMove("hold", "done")).toBe(true)
    expect(finalBlocks({ archived: false, lifecycle: "hold", acceptances: { prov: { on: "2026-01-01", by: "u" } }, openPunch: 0 })).toEqual([])
    const closed = closeHold({ holdSince: "2026-10-01", holdK: "site", holdBy: "pm1", holdByName: "A", holdLog: [{ since: "2026-10-01", until: null, k: "site", why: "", by: "pm1" }] }, { uid: "o1", name: "Owner" }, "2026-10-20", "final")
    expect(closed.holdLog![0]).toMatchObject({ until: "2026-10-20", resBy: "o1", end: "final" })
    expect(closed.holdSince).toBeNull()
  })
})

describe("COR-01 · WF-31 — correspondence (FX-26, FX-67…69)", () => {
  it("links only to the project's own records; their numbers are stored Latin", () => {
    const own = { vo: new Set(["03"]), claim: new Set<string>(), obs: new Set(["rfi-07"]) }
    const kept = keepOwnRefs([{ kind: "vo", id: "03" }, { kind: "vo", id: "99" }, { kind: "obs", id: "rfi-07" }, { kind: "vo", id: "03" }], own)
    expect(kept).toEqual([{ kind: "vo", id: "03" }, { kind: "obs", id: "rfi-07" }])
    expect(kept.map(refLabel)).toEqual(["VO-03", "RFI-07"])
  })

  it("our reply closes an incoming letter; theirs answers ours", () => {
    expect(replyStatus("in")).toBe("done")
    expect(replyStatus("out")).toBe("rep")
    expect(shownLetterStatus({ dir: "in", status: "rep" })).toBe("done")
    const body = rules.slice(rules.indexOf("match /pmLetters/{letterId}"), rules.indexOf("match /pmDaily/{day}"))
    expect(body).toContain("request.resource.data.status == (resource.data.status == 'in' ? 'done' : 'rep')")
  })

  it("a late letter: incoming red, outgoing amber — whoever the party", () => {
    expect(lateLettersSeverity([{ dir: "out" }])).toBe("amber")
    expect(lateLettersSeverity([{ dir: "out" }, { dir: "in" }])).toBe("red")
  })

  it("an open letter warns at archive, never blocks", () => {
    const rows = closeoutRows({ hasClient: false, acceptances: { prov: { on: "x", by: "u" }, final: { on: "y", by: "u" } }, punch: [], items: [], cutPool: 0, certificates: [], retentionHeld: 0, retentionReleased: false, letters: [{ status: "in" }], today })
    expect(rows.find((r) => r.key === "corr")).toMatchObject({ ok: false, warn: true })
    expect(closeBlocks(rows)).toEqual([])
  })
})

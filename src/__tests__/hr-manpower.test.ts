/**
 * HR 1.0 — manpower requests (AS-02, WF-12): coverage in order — unassigned
 * now, a site ending within a week, free visas — person by person with honest
 * dates (late when after the day asked) and exclusions by name; the remainder
 * covered as HR chooses (hire · transfer of services · Ajeer when the company
 * allows it · said uncovered). Sending the answer ACTS: the unassigned are
 * assigned now, people on an ending site scheduled on their day, the visas
 * reserved (an arrival takes a reservation back — never a second visa).
 * Projects accepts the plan. On Today it is HR's to answer; leakage stays zero.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import type { HrEmployee } from "@/lib/hr/employee"
import { createEmployee } from "@/lib/hr/employee-writes"
import {
  acceptManpowerPlan,
  ajeerMonthlyCost,
  answerBlocks,
  answerManpowerRequest,
  applyPlannedMove,
  cancelPlannedMove,
  coverage,
  freeVisas,
  manpowerNo,
  plannedBlocks,
  raiseManpowerRequest,
  restLine,
  withdrawManpowerRequest,
  type ManpowerRequest,
} from "@/lib/hr/manpower"
import { normalizeHrSettings } from "@/lib/hr/settings"
import type { HrSite } from "@/lib/hr/sites"
import { DEFAULT_HR_POLICIES, resolveHrPolicies } from "@/lib/hr/statutory"
import { leakage, todayItems } from "@/lib/hr/today"
import { todayDay } from "@/lib/hr/format"

const TODAY = "2026-09-10"
const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: "org", no: 1, names: { ar: id }, nationality: "eg", gender: "m", trade: "mason", category: "labour", siteId: null, join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31", decision: "confirmed" }, status: "active", docs: { iqama: "2027-12-31" }, leaveTaken: 0, ...over }) as HrEmployee
const sites: HrSite[] = [
  { id: "s1", organizationId: "org", name: "Tower", type: "project", projectId: "p1", active: true },
  { id: "s2", organizationId: "org", name: "Villa", type: "project", projectId: "p2", active: true, endDate: "2026-09-20" },
  { id: "s3", organizationId: "org", name: "Mall", type: "project", projectId: "p3", active: true, endDate: "2027-06-01" },
]
/** A record as stored: the id is the document's. */
const rec = ({ id: _id, ...r }: HrEmployee) => r
const employees = [emp("u1"), emp("u2", { docs: { iqama: "2026-09-01" } }), emp("e1", { siteId: "s2" }), emp("e2", { siteId: "s3" }), emp("c1", { trade: "carpenter" })]

describe("coverage", () => {
  it("unassigned now, then a site ending within a week, then free visas — person by person, expired excluded by name", () => {
    const c = coverage({ trade: "mason", count: 5, from: "2026-09-15", today: TODAY, siteId: "s1", employees, sites, visas: 1 })
    expect(c.rows).toEqual([
      { source: "unassigned", employeeId: "u1", name: "u1", fromSiteId: null, date: "2026-09-15", late: false },
      { source: "site_ending", employeeId: "e1", name: "e1", fromSiteId: "s2", date: "2026-09-21", late: true },
      { source: "visa", employeeId: null, name: null, fromSiteId: null, date: "2026-12-09", late: true },
    ])
    expect(c.lines).toEqual([
      { source: "unassigned", count: 1, date: "2026-09-15", names: ["u1"] },
      { source: "site_ending", count: 1, date: "2026-09-21", names: ["e1"] },
      { source: "visa", count: 1, date: "2026-12-09" },
    ])
    expect(c.excluded).toEqual([{ name: "u2", reason: "iqama_expired" }])
    expect(c).toMatchObject({ covered: 3, short: 2, onTime: 1, late: 2 })
  })

  it("the remainder is ONE line, as HR chose it — hire, a transfer of services, Ajeer, or said uncovered", () => {
    expect(restLine("hire", 2, "2026-09-15", TODAY)).toEqual({ source: "hire", count: 2, date: "2026-12-09" })
    expect(restLine("xfer", 2, "2026-09-15", TODAY)).toEqual({ source: "xfer", count: 2, date: "2026-10-10" })
    expect(restLine("ajeer", 2, "2026-09-15", TODAY)).toEqual({ source: "ajeer", count: 2, date: "2026-09-15" })
    expect(restLine("none", 2, "2026-09-15", TODAY)).toBeNull()
    expect(restLine("hire", 0, "2026-09-15", TODAY)).toBeNull()
  })

  it("a shortfall needs a choice; Ajeer only when the company allows it; people to place need a workplace", () => {
    const pol = { ajeer: true }
    expect(answerBlocks({ short: 2, rest: null, policies: pol, peopleRows: 0, siteId: "s1" })).toEqual(["no_rest"])
    expect(answerBlocks({ short: 2, rest: "ajeer", policies: { ajeer: false }, peopleRows: 0, siteId: "s1" })).toEqual(["no_ajeer"])
    expect(answerBlocks({ short: 0, rest: null, policies: pol, peopleRows: 1, siteId: null })).toEqual(["no_site"])
    expect(answerBlocks({ short: 2, rest: "none", policies: pol, peopleRows: 1, siteId: "s1" })).toEqual([])
  })

  it("Ajeer is a company policy — allowed by default at ×1.4, its cost a month estimated from the trade", () => {
    expect(resolveHrPolicies(null)).toMatchObject({ ajeer: true, ajeerFactor: 1.4 })
    expect(resolveHrPolicies({ ajeer: false, ajeerFactor: 1.6 })).toMatchObject({ ajeer: false, ajeerFactor: 1.6 })
    expect(resolveHrPolicies({ ajeerFactor: 9 } as never).ajeerFactor).toBe(1.4)
    expect(ajeerMonthlyCost("mason", { ajeerFactor: 1.4 })).toBe(Math.round(2200 * 1.35 * 1.4))
  })

  it("visas reserved by earlier plans are not offered again", () => {
    expect(freeVisas({ visas: 5, visasReserved: 2 })).toBe(3)
    expect(freeVisas({ visas: 1, visasReserved: 3 })).toBe(0)
    expect(normalizeHrSettings({ establishment: { visas: 4, visasReserved: 2 } } as never).establishment).toMatchObject({ visas: 4, visasReserved: 2 })
  })

  it("someone already promised to another plan is not offered twice", () => {
    const c = coverage({ trade: "mason", count: 2, from: "2026-09-15", today: TODAY, siteId: "s1", employees: [emp("u1", { planned: { siteId: "s9", on: "2026-09-30", requestId: "r0" } }), emp("u3")], sites, visas: 0 })
    expect(c.rows.map((r) => r.employeeId)).toEqual(["u3"])
  })

  it("someone recorded before his start date is offered once that date has come — and not before", () => {
    const joined = [emp("n1", { status: "expected", join: "2026-09-01" }), emp("n2", { status: "expected", join: "2026-10-01" })]
    const c = coverage({ trade: "mason", count: 2, from: "2026-09-15", today: TODAY, siteId: "s1", employees: joined, sites: [], visas: 0 })
    expect(c.rows.map((r) => r.employeeId)).toEqual(["n1"])
    expect(c.covered).toBe(1)
  })
})

describe("the request", () => {
  const db = fakeFirestore as unknown as Firestore
  const hrm: HrContext = { uid: "hrm", owner: false, roles: new Set(["manager"]), employeeId: null, sites: [] }
  const H = { uid: "hrm", name: "H" }
  const today = todayDay()
  beforeEach(() => resetFakeDb())

  const raise = (over: Partial<Parameters<typeof raiseManpowerRequest>[3]> = {}) =>
    raiseManpowerRequest(db, { uid: "pm", name: "PM", allowed: true }, "org", { projectId: "p1", projectName: "Tower", siteId: "s1", trade: "mason", count: 3, from: today, ...over })
  const read = (id: string) => ({ id, ...(readDoc(`manpowerRequests/${id}`) as Omit<ManpowerRequest, "id">) }) as ManpowerRequest
  const seedWorld = () => {
    seed("hrSites/s1", { ...sites[0] })
    seed("hrSites/s2", { ...sites[1] })
    seed("employees/u1", rec(emp("u1")))
    seed("employees/e1", rec(emp("e1", { siteId: "s2" })))
    seed("hrSettings/org", { organizationId: "org", establishment: { visas: 2 } })
  }

  it("Projects asks — numbered MP-yyyy/NNN; Today shows it as HR's to answer — leakage zero", async () => {
    await expect(raiseManpowerRequest(db, { uid: "pm", name: "PM", allowed: false }, "org", { projectId: "p1", projectName: "Tower", siteId: "s1", trade: "mason", count: 2, from: "2026-09-15" })).rejects.toMatchObject({ code: "no_role" })
    await expect(raiseManpowerRequest(db, { uid: "pm", name: "PM", allowed: true }, "org", { projectId: "p1", projectName: "Tower", siteId: "s1", trade: "x", count: 0, from: "" })).rejects.toMatchObject({ blocks: ["no_trade", "bad_count", "no_date"] })
    const id = await raiseManpowerRequest(db, { uid: "pm", name: "PM", allowed: true }, "org", { projectId: "p1", projectName: "Tower", siteId: "s1", trade: "mason", count: 2, from: "2026-09-15" }, { today: TODAY })
    const req = read(id)
    expect(req.no).toBe("MP-2026/001")
    expect(manpowerNo(req.no, "ar")).toBe("ط.عم-2026/001")
    expect(manpowerNo(req.no, "en")).toBe("MP-2026/001")
    const items = todayItems({ ctx: hrm, today: TODAY, renewWindowDays: 60, employees, sites, lastMonth: [], thisMonth: [], injuries: [], exits: [], requests: [], payrolls: [], pays: new Map(), manpower: [req] })
    expect(items.find((x) => x.kind === "manpower")).toMatchObject({ group: "other", action: "answer", source: "project-management" })
    expect(leakage(items)).toBe(0)
  })

  it("the answer acts: the unassigned are assigned now, an ending site's people scheduled, visas reserved — in one go", async () => {
    seedWorld()
    const id = await raise()
    const c = coverage({ trade: "mason", count: 3, from: today, today, siteId: "s1", employees: [emp("u1"), emp("e1", { siteId: "s2" })], sites: [{ ...sites[1], endDate: today }], visas: 2 })
    expect(c.rows.map((r) => r.source)).toEqual(["unassigned", "site_ending", "visa"])
    const gov: HrContext = { ...hrm, uid: "g", roles: new Set(["gov"]) }
    await expect(answerManpowerRequest(db, gov, id, { uid: "g", name: "G" }, { rows: c.rows, excluded: c.excluded })).rejects.toMatchObject({ code: "no_role" })
    await answerManpowerRequest(db, hrm, id, H, { rows: c.rows, excluded: c.excluded, note: "from Monday" }, { policies: DEFAULT_HR_POLICIES })

    expect(readDoc("employees/u1")).toMatchObject({ siteId: "s1", siteSince: today })
    expect(listCollection("employees/u1/log")).toEqual([expect.objectContaining({ kind: "assigned_mp", params: { site: "s1", on: today, request: expect.stringMatching(/^MP-/) } })])
    expect(readDoc("employees/e1")).toMatchObject({ siteId: "s2", planned: { siteId: "s1", on: c.rows[1].date, requestId: id } })
    expect(listCollection("employees/e1/log")).toEqual([expect.objectContaining({ kind: "transfer_planned" })])
    expect(readDoc("hrSettings/org")).toMatchObject({ establishment: { visas: 2, visasReserved: 1 } })
    expect(read(id)).toMatchObject({ state: "answered", answer: { visas: 1, short: 0, rest: null, siteId: "s1", note: "from Monday", byName: "H" } })
    expect(read(id).answer?.plan.map((l) => l.source)).toEqual(["unassigned", "site_ending", "visa"])
  })

  it("the remainder: a choice is required; Ajeer refused when the company does not allow it; 'none' is said as uncovered", async () => {
    seedWorld()
    const id = await raise({ count: 4 })
    const c = coverage({ trade: "mason", count: 4, from: today, today, siteId: "s1", employees: [emp("u1")], sites: [], visas: 0 })
    await expect(answerManpowerRequest(db, hrm, id, H, { rows: c.rows, excluded: [] })).rejects.toMatchObject({ blocks: ["no_rest"] })
    await expect(answerManpowerRequest(db, hrm, id, H, { rows: c.rows, excluded: [], rest: "ajeer" }, { policies: { ...DEFAULT_HR_POLICIES, ajeer: false } })).rejects.toMatchObject({ blocks: ["no_ajeer"] })
    expect(readDoc("employees/u1")).toMatchObject({ siteId: null })
    await answerManpowerRequest(db, hrm, id, H, { rows: c.rows, excluded: [], rest: "none" })
    expect(read(id).answer).toMatchObject({ rest: "none", short: 3 })
    expect(read(id).answer?.plan).toEqual([{ source: "unassigned", count: 1, date: today, names: ["u1"] }])
  })

  it("a choice of transfer of services is written as one line, with its date", async () => {
    seedWorld()
    const id = await raise({ count: 2 })
    await answerManpowerRequest(db, hrm, id, H, { rows: [], excluded: [], rest: "xfer" })
    expect(read(id).answer?.plan).toEqual([{ source: "xfer", count: 2, date: restLine("xfer", 2, today, today)!.date }])
  })

  it("stale: someone moved since the screen computed the plan — nothing is written", async () => {
    seedWorld()
    const id = await raise({ count: 1 })
    const c = coverage({ trade: "mason", count: 1, from: today, today, siteId: "s1", employees: [emp("u1")], sites: [], visas: 0 })
    seed("employees/u1", rec(emp("u1", { siteId: "s2" })))
    await expect(answerManpowerRequest(db, hrm, id, H, { rows: c.rows, excluded: [] })).rejects.toMatchObject({ blocks: ["stale"] })
    expect(read(id).state).toBe("open")
  })

  it("a request from a project with no HR workplace: answered to the project's workplace if HR keeps one, else refused", async () => {
    seedWorld()
    seed("employees/u1", rec(emp("u1")))
    const id = await raise({ siteId: null, projectId: "p9", count: 1 })
    const c = coverage({ trade: "mason", count: 1, from: today, today, siteId: null, employees: [emp("u1")], sites: [], visas: 0 })
    await expect(answerManpowerRequest(db, hrm, id, H, { rows: c.rows, excluded: [] })).rejects.toMatchObject({ blocks: ["no_site"] })
    seed("hrSites/s9", { organizationId: "org", name: "New", type: "project", projectId: "p9", active: true })
    await answerManpowerRequest(db, hrm, id, H, { rows: c.rows, excluded: [] })
    expect(readDoc("employees/u1")).toMatchObject({ siteId: "s9" })
    expect(read(id).answer?.siteId).toBe("s9")
  })

  it("a reserved visa is not spent twice: the arrival takes the reservation back with the visa", async () => {
    seedWorld()
    const id = await raise({ count: 1 })
    await answerManpowerRequest(db, hrm, id, H, { rows: coverage({ trade: "mason", count: 1, from: today, today, siteId: "s1", employees: [], sites: [], visas: 2 }).rows, excluded: [] })
    expect(readDoc("hrSettings/org")).toMatchObject({ establishment: { visas: 2, visasReserved: 1 } })
    const input = { source: "visa" as const, nameAr: "وافد", nationality: "bd", gender: "m" as const, trade: "mason", siteId: null, join: today, contractType: "open" as const, docs: {} }
    await createEmployee(db, hrm, "org", H, input, { visas: 2 })
    expect(readDoc("hrSettings/org")).toMatchObject({ establishment: { visas: 1, visasReserved: 0 } })
    // A second plan cannot reserve more than is free.
    const id2 = await raise({ count: 2 })
    await expect(answerManpowerRequest(db, hrm, id2, H, { rows: coverage({ trade: "mason", count: 2, from: today, today, siteId: "s1", employees: [], sites: [], visas: 2 }).rows, excluded: [] })).rejects.toMatchObject({ blocks: ["stale"] })
  })

  it("Projects accepts the answered plan — whoever asked, once; withdraws only an open one", async () => {
    seedWorld()
    const id = await raise({ count: 1 })
    await expect(acceptManpowerPlan(db, { uid: "pm", name: "PM", allowed: false }, id)).rejects.toMatchObject({ blocks: ["stale"] })
    await answerManpowerRequest(db, hrm, id, H, { rows: [], excluded: [], rest: "hire" })
    await expect(acceptManpowerPlan(db, { uid: "other", name: "O", allowed: false }, id)).rejects.toMatchObject({ code: "no_role" })
    await acceptManpowerPlan(db, { uid: "pm", name: "PM", allowed: false }, id)
    expect(read(id).accepted).toMatchObject({ by: "pm", byName: "PM" })
    await expect(acceptManpowerPlan(db, { uid: "pm", name: "PM", allowed: false }, id)).rejects.toMatchObject({ blocks: ["stale"] })
    await expect(withdrawManpowerRequest(db, { uid: "pm", name: "PM" }, id)).rejects.toMatchObject({ blocks: ["stale"] })
    const id2 = await raise()
    await expect(withdrawManpowerRequest(db, { uid: "x", name: "X" }, id2)).rejects.toMatchObject({ code: "no_role" })
    await withdrawManpowerRequest(db, { uid: "pm", name: "PM" }, id2)
    expect(read(id2).state).toBe("withdrawn")
  })

  it("a scheduled transfer is applied on its day (not before), or cancelled — each said in the log", async () => {
    seed("employees/e1", rec(emp("e1", { siteId: "s2", planned: { siteId: "s1", on: "2026-09-21", requestId: "r1", no: "MP-2026/001" } })))
    expect(plannedBlocks({ planned: null }, "2026-09-21")).toEqual(["none"])
    await expect(applyPlannedMove(db, hrm, "e1", H, { today: "2026-09-20" })).rejects.toMatchObject({ blocks: ["not_due"] })
    await applyPlannedMove(db, hrm, "e1", H, { today: "2026-09-21" })
    expect(readDoc("employees/e1")).toMatchObject({ siteId: "s1", siteSince: "2026-09-21", planned: null })
    expect(listCollection<{ kind: string }>("employees/e1/log").map((l) => l.kind)).toEqual(["moved"])
    seed("employees/e2", rec(emp("e2", { siteId: "s2", planned: { siteId: "s1", on: "2026-09-30", requestId: "r1" } })))
    await cancelPlannedMove(db, hrm, "e2", H)
    expect(readDoc("employees/e2")).toMatchObject({ siteId: "s2", planned: null })
    expect(listCollection<{ kind: string }>("employees/e2/log").map((l) => l.kind)).toEqual(["transfer_cancelled"])
  })
})

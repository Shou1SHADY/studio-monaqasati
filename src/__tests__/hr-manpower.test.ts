/**
 * HR 1.0 — manpower requests (AS-02, WF-12): coverage in order — unassigned
 * now, a site ending within a week, unused visas, then hire or temporary
 * labour — with honest dates and exclusions by name; Projects asks, the HR
 * manager answers; on Today it is HR's to answer, and leakage stays zero.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import type { HrEmployee } from "@/lib/hr/employee"
import { answerManpowerRequest, coverage, raiseManpowerRequest, type ManpowerRequest } from "@/lib/hr/manpower"
import type { HrSite } from "@/lib/hr/sites"
import { leakage, todayItems } from "@/lib/hr/today"

const TODAY = "2026-09-10"
const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: "org", no: 1, names: { ar: id }, nationality: "eg", gender: "m", trade: "mason", category: "labour", siteId: null, join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31", decision: "confirmed" }, status: "active", docs: { iqama: "2027-12-31" }, leaveTaken: 0, ...over }) as HrEmployee
const sites: HrSite[] = [
  { id: "s1", organizationId: "org", name: "Tower", type: "project", projectId: "p1", active: true },
  { id: "s2", organizationId: "org", name: "Villa", type: "project", projectId: "p2", active: true, endDate: "2026-09-20" },
  { id: "s3", organizationId: "org", name: "Mall", type: "project", projectId: "p3", active: true, endDate: "2027-06-01" },
]
const employees = [
  emp("u1"),
  emp("u2", { docs: { iqama: "2026-09-01" } }),
  emp("e1", { siteId: "s2" }),
  emp("e2", { siteId: "s3" }),
  emp("c1", { trade: "carpenter" }),
]

describe("coverage", () => {
  it("unassigned now, then a site ending within a week, then visas, then hire or Ajeer — expired excluded by name", () => {
    const c = coverage({ trade: "mason", count: 5, from: "2026-09-15", today: TODAY, siteId: "s1", employees, sites, visas: 1 })
    expect(c.lines).toEqual([
      { source: "unassigned", count: 1, date: "2026-09-15", names: ["u1"] },
      { source: "site_ending", count: 1, date: "2026-09-21", names: ["e1"] },
      { source: "visa", count: 1, date: "2026-12-09" },
      { source: "hire", count: 2, date: "2026-12-09" },
      { source: "ajeer", count: 2, date: "2026-10-25" },
    ])
    expect(c.excluded).toEqual([{ name: "u2", reason: "iqama_expired" }])
    expect(c.covered).toBe(3)
  })

  it("a project with no HR workplace yet still gets the unassigned people (the request carries no site)", () => {
    const c = coverage({ trade: "mason", count: 1, from: "2026-09-15", today: TODAY, siteId: null, employees, sites, visas: 0 })
    expect(c.lines).toEqual([{ source: "unassigned", count: 1, date: "2026-09-15", names: ["u1"] }])
    expect(c.covered).toBe(1)
  })

  it("someone recorded before his start date is offered once that date has come — and not before", () => {
    const joined = [emp("n1", { status: "expected", join: "2026-09-01" }), emp("n2", { status: "expected", join: "2026-10-01" })]
    const c = coverage({ trade: "mason", count: 2, from: "2026-09-15", today: TODAY, siteId: "s1", employees: joined, sites: [], visas: 0 })
    expect(c.lines[0]).toEqual({ source: "unassigned", count: 1, date: "2026-09-15", names: ["n1"] })
    expect(c.covered).toBe(1)
  })
})

describe("the request", () => {
  const db = fakeFirestore as unknown as Firestore
  beforeEach(() => resetFakeDb())

  it("Projects asks; the HR manager answers with the plan; Today shows it as HR's to answer — leakage zero", async () => {
    await expect(raiseManpowerRequest(db, { uid: "pm", name: "PM", allowed: false }, "org", { projectId: "p1", projectName: "Tower", siteId: "s1", trade: "mason", count: 2, from: "2026-09-15" })).rejects.toMatchObject({ code: "no_role" })
    await expect(raiseManpowerRequest(db, { uid: "pm", name: "PM", allowed: true }, "org", { projectId: "p1", projectName: "Tower", siteId: "s1", trade: "x", count: 0, from: "" })).rejects.toMatchObject({ blocks: ["no_trade", "bad_count", "no_date"] })
    const id = await raiseManpowerRequest(db, { uid: "pm", name: "PM", allowed: true }, "org", { projectId: "p1", projectName: "Tower", siteId: "s1", trade: "mason", count: 2, from: "2026-09-15" })
    const req = { id, ...(readDoc(`manpowerRequests/${id}`) as Omit<ManpowerRequest, "id">) } as ManpowerRequest

    const hrm: HrContext = { uid: "hrm", owner: false, roles: new Set(["manager"]), employeeId: null, sites: [] }
    const items = todayItems({ ctx: hrm, today: TODAY, renewWindowDays: 60, employees, sites, lastMonth: [], thisMonth: [], injuries: [], exits: [], requests: [], payrolls: [], pays: new Map(), manpower: [req] })
    expect(items.find((x) => x.kind === "manpower")).toMatchObject({ group: "other", action: "answer", source: "project-management" })
    expect(leakage(items)).toBe(0)

    const c = coverage({ trade: "mason", count: 2, from: "2026-09-15", today: TODAY, siteId: "s1", employees, sites, visas: 0 })
    const gov: HrContext = { ...hrm, uid: "g", roles: new Set(["gov"]) }
    await expect(answerManpowerRequest(db, gov, id, { uid: "g", name: "G" }, { plan: c.lines, excluded: c.excluded })).rejects.toMatchObject({ code: "no_role" })
    await answerManpowerRequest(db, hrm, id, { uid: "hrm", name: "H" }, { plan: c.lines, excluded: c.excluded, note: "u1 from Monday" })
    expect(readDoc(`manpowerRequests/${id}`)).toMatchObject({ state: "answered", answer: { note: "u1 from Monday", byName: "H" } })
  })
})

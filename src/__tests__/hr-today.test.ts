/**
 * HR 1.0 — Today (TD-02, TD-03) and the injury register (DC-07): each role
 * sees what it may act on, in four groups; what another module holds has its
 * source and no button — the leakage count is zero; the iqama clock runs 90
 * days from arrival (DC-05); the injury report is due in 3 working days.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrExit } from "@/lib/hr/exit-writes"
import { injuryState, recordInjury, recordInjuryReport, type HrInjury } from "@/lib/hr/injuries"
import type { Payroll } from "@/lib/hr/payroll"
import type { HrSite } from "@/lib/hr/sites"
import { leakage, todayItems, type TodayInput } from "@/lib/hr/today"

const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const TODAY = "2026-09-08"
const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: "org", no: 1, names: { ar: id }, nationality: "eg", gender: "m", trade: "mason", category: "labour", siteId: "s1", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31", decision: "confirmed" }, status: "active", docs: { iqama: "2027-01-01" }, leaveTaken: 0, ...over }) as HrEmployee
const sites: HrSite[] = [{ id: "s1", organizationId: "org", name: "Tower", type: "project", projectId: "p1", active: true, supervisorUserId: "sup" }]
const base = (c: HrContext, over: Partial<TodayInput> = {}): TodayInput => ({
  ctx: c,
  today: TODAY,
  renewWindowDays: 60,
  employees: [emp("e1"), emp("e2", { docs: { iqama: "2026-09-01" } }), emp("e3", { source: "visa", siteId: null, join: "2026-06-01", docs: {} }), emp("e4", { probation: { end: "2026-09-15" } })],
  sites,
  lastMonth: [],
  thisMonth: [],
  injuries: [],
  exits: [],
  requests: [],
  payrolls: [],
  pays: new Map<string, EmployeePay>([["e1", { employeeId: "e1", organizationId: "org", basic: 1, housing: 0, transport: 0, iban: "x", ibanState: "returned" }]]),
  ...over,
})

describe("Today", () => {
  it("the HR manager: an expired iqama on a site blocks; the month to close; probation ending; the iqama clock", () => {
    const items = todayItems(base(ctx(["manager"], { uid: "hrm" })))
    const kinds = items.map((x) => `${x.group}:${x.kind}`)
    expect(kinds).toEqual(expect.arrayContaining(["blocking:iqama_on_site", "blocking:close_month", "due:probation_end", "due:iqama_clock", "blocking:payroll_prepare"]))
    expect(kinds).not.toContain("blocking:iban_fix")
    const clock = items.find((x) => x.kind === "iqama_clock")!
    expect(clock).toMatchObject({ params: { date: "2026-08-30" }, severity: "red" })
  })

  it("payroll fixes the returned IBAN; the supervisor sees his own site's close and today's sheet only", () => {
    expect(todayItems(base(ctx(["payroll"], { uid: "po" }))).map((x) => x.kind)).toEqual(expect.arrayContaining(["iban_fix", "close_month", "payroll_prepare"]))
    const sup = todayItems(base(ctx(["supervisor"], { uid: "sup", sites: ["s1"] }))).map((x) => x.kind)
    expect(sup.sort()).toEqual(["close_month", "sheet_today"])
    expect(todayItems(base(ctx(["supervisor"], { uid: "x", sites: ["s9"] })))).toEqual([])
  })

  it("what another module holds has its source and no button — leakage zero (TD-03)", () => {
    const exits = [{ id: "x1", employeeName: "e1", state: "leaving", custody: { state: "requested" } }, { id: "x2", employeeName: "e2", state: "settled", custody: { state: "cleared" } }] as unknown as HrExit[]
    const payrolls = [{ key: "2026-08", month: "2026-08", kind: "main", state: "approved", prepared: { by: "po" } }] as unknown as Payroll[]
    const items = todayItems(base(ctx(["manager"], { uid: "hrm" }), { exits, payrolls }))
    const other = items.filter((x) => x.group === "other")
    expect(other.map((x) => `${x.kind}:${x.source}`).sort()).toEqual(["wait_custody:warehouses", "wait_post:payments", "wait_settlement:payments"])
    expect(leakage(items)).toBe(0)
  })
})

describe("injuries", () => {
  const db = fakeFirestore as unknown as Firestore
  beforeEach(() => {
    resetFakeDb()
    seed("employees/e1", { organizationId: "org", no: 1, names: { ar: "أحمد" }, siteId: "s1", userId: "wu", status: "active" })
  })

  it("recorded by the site's supervisor; due in 3 working days; reported by government relations", async () => {
    const sup = ctx(["supervisor"], { uid: "sup", sites: ["s1"] })
    await expect(recordInjury(db, ctx(["supervisor"], { uid: "x", sites: ["s9"] }), "org", { uid: "x", name: null }, { employeeId: "e1", on: "2026-09-03", description: "cut" }, { today: TODAY })).rejects.toMatchObject({ code: "not_your_site" })
    const id = await recordInjury(db, sup, "org", { uid: "sup", name: "S" }, { employeeId: "e1", on: "2026-09-03", description: "cut hand" }, { today: TODAY })
    const inj = { id, ...(readDoc(`hrInjuries/${id}`) as Omit<HrInjury, "id">) } as HrInjury
    expect(inj.due).toBe("2026-09-08") // Thu 3 → Sun 6, Mon 7, Tue 8
    expect(injuryState(inj, "2026-09-08")).toBe("due")
    expect(injuryState(inj, "2026-09-09")).toBe("overdue")
    await expect(recordInjuryReport(db, sup, id, { uid: "sup", name: "S" }, { no: "G-1", on: TODAY })).rejects.toMatchObject({ code: "no_role" })
    await recordInjuryReport(db, ctx(["gov"], { uid: "gro" }), id, { uid: "gro", name: "G" }, { no: "G-1", on: TODAY })
    expect(injuryState(readDoc(`hrInjuries/${id}`) as HrInjury, "2026-09-20")).toBe("reported")
  })
})

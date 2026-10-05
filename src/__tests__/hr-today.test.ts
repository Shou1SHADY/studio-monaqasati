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
import { dutyToday, inPeopleFilter, kpiRole, leakage, renewalQueue, todayItems, todayKpis, type KpiInput, type TodayInput } from "@/lib/hr/today"

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
    const items = todayItems(base(ctx(["manager"], { uid: "hrm" }), { govHeld: false }))
    const kinds = items.map((x) => `${x.group}:${x.kind}`)
    expect(kinds).toEqual(expect.arrayContaining(["blocking:iqama_on_site", "blocking:close_month", "due:probation_end", "blocking:iqama_clock", "blocking:payroll_prepare"]))
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

describe("Today — what the audit found missing or false", () => {
  it("government relations sees an expired iqama of someone on a site — red, to renew (DC-02); the HR manager sees it once, as the block", () => {
    const gov = todayItems(base(ctx(["gov"], { uid: "g" })))
    expect(gov.find((x) => x.key === "doc:e2")).toMatchObject({ group: "blocking", severity: "red", action: "renew", href: "people/e2?renew=iqama" })
    const hrm = todayItems(base(ctx(["manager"], { uid: "hrm" })))
    expect(hrm.filter((x) => x.key === "doc:e2" || x.key === "iqama:e2").map((x) => x.kind)).toEqual(["iqama_on_site"])
  })

  it("a company whose people all joined this month is not asked to close or pay last month", () => {
    const fresh = base(ctx(["manager", "payroll"], { uid: "hrm" }), { employees: [emp("n1", { join: "2026-09-02" }), emp("n2", { join: "2020-01-01", since: "2026-09" })], pays: new Map() })
    const kinds = todayItems(fresh).map((x) => x.kind)
    expect(kinds).not.toContain("close_month")
    expect(kinds).not.toContain("payroll_prepare")
  })

  it("custody cleared: the settlement is the HR manager's turn — a row with its action, not a wait (WF-16)", () => {
    const exits = [{ id: "org__e1", employeeId: "e1", employeeName: "e1", state: "leaving", lastDay: "2026-09-12", custody: { state: "cleared" } }] as unknown as HrExit[]
    const items = todayItems(base(ctx(["manager"], { uid: "hrm" }), { exits }))
    expect(items.find((x) => x.kind === "settlement_ready")).toMatchObject({ group: "blocking", severity: "amber", href: "people/e1", action: "settle" })
    expect(leakage(items)).toBe(0)
    expect(todayItems(base(ctx(["gov"], { uid: "g" }), { exits })).map((x) => x.kind)).not.toContain("settlement_ready")
  })

  it("a prepared supplementary payroll asks for its approval too — never of whoever prepared it (PY-04)", () => {
    const payrolls = [
      { key: "2026-08", month: "2026-08", kind: "main", state: "paid", prepared: { by: "po" } },
      { key: "2026-08-D", month: "2026-08", kind: "supplementary", state: "prepared", prepared: { by: "po" } },
    ] as unknown as Payroll[]
    const row = todayItems(base(ctx(["manager"], { uid: "hrm" }), { payrolls })).find((x) => x.kind === "payroll_approve")
    expect(row).toMatchObject({ params: { month: "2026-08-D" }, action: "approve" })
    expect(todayItems(base(ctx(["manager"], { uid: "po" }), { payrolls })).map((x) => x.kind)).not.toContain("payroll_approve")
  })
})

describe("DC-04 — the officer's list is by person, in the order the renewals are done", () => {
  it("one row per person: passport → insurance → iqama, the worst one in the title; the contract is not a renewal", () => {
    const e = emp("p1", { docs: { iqama: "2026-10-20", passport: "2026-09-01", insurance: "2026-09-30", contract: "2026-09-20" } })
    const gov = todayItems(base(ctx(["gov"], { uid: "g" }), { employees: [e] })).filter((x) => x.kind === "doc_due")
    expect(gov).toHaveLength(1)
    expect(gov[0]).toMatchObject({ key: "doc:p1", severity: "red", params: { doc: "passport", order: "passport,insurance,iqama", count: 3 } })
  })

  it("the renewal queue: one line per person within 120 days, the most urgent first", () => {
    const q = renewalQueue([emp("a", { docs: { iqama: "2026-12-30" } }), emp("b", { docs: { passport: "2026-09-01", iqama: "2026-11-01" } }), emp("c", { docs: { iqama: "2027-06-01" } }), emp("d", { status: "left", docs: { iqama: "2026-09-01" } })], TODAY, 120)
    expect(q.map((x) => [x.employee.id, x.docs.map((d) => d.type).join(">")])).toEqual([
      ["b", "passport>iqama"],
      ["a", "iqama"],
    ])
  })
})

describe("TD-04 — three KPIs per role, each the number of the screen it opens", () => {
  const office: HrSite = { id: "hq", organizationId: "org", name: "HQ", type: "hq", active: true }
  const people = [
    emp("w1"),
    emp("w2"),
    emp("w3"),
    emp("o1", { siteId: "hq", nationality: "sa", docs: {} }),
    emp("o2", { siteId: "hq", nationality: "sa", docs: {} }),
    emp("b1", { siteId: null, docs: { iqama: "2026-09-01" } }),
    emp("x1", { status: "left" }),
  ]
  const sheet = { id: "a", organizationId: "org", siteId: "s1", month: "2026-09", days: { [TODAY]: { by: "sup", byName: null, at: "", listed: ["w1", "w2"], ex: { w2: { status: "sick" } } } }, declarations: [], closed: null } as unknown as TodayInput["thisMonth"][number]
  const officeEx = { id: "b", organizationId: "org", siteId: "hq", month: "2026-09", days: { [TODAY]: { by: "hrm", byName: null, at: "", listed: [], ex: { o2: { status: "absent" } } } }, declarations: [], closed: null } as unknown as TodayInput["thisMonth"][number]
  const input = (c: HrContext, over: Partial<KpiInput> = {}): KpiInput => ({
    ctx: c,
    today: TODAY,
    renewWindowDays: 60,
    employees: people,
    sites: [...sites, office],
    thisMonth: [sheet, officeEx],
    requests: [],
    payrolls: [{ key: "2026-08", month: "2026-08", kind: "main", state: "approved", lines: [{ employeeId: "w1", net: 3000, gross: 3500, gosiEmployer: 70 }, { employeeId: "o1", net: 7000, gross: 8000, gosiEmployer: 940 }] }] as unknown as Payroll[],
    pays: new Map<string, EmployeePay>([
      ["w1", { employeeId: "w1", organizationId: "org", basic: 2500, housing: 625, transport: 250, ibanState: "returned", advance: { amount: 1000, balance: 600, instalment: 300 } }],
      ["b1", { employeeId: "b1", organizationId: "org", basic: 2000, housing: 500, transport: 200 }],
    ]),
    ...over,
  })

  it("today's attendance by place: listed = present, a sheet's exception, an office assumes presence, no sheet = unrecorded", () => {
    const d = dutyToday({ today: TODAY, employees: people, sites: [...sites, office], thisMonth: [sheet, officeEx], requests: [] })
    const by = Object.fromEntries(d.map((x) => [x.siteId, x]))
    expect(by.s1).toMatchObject({ assigned: 3, present: 1, sick: 1, unrecorded: 1 })
    expect(by.hq).toMatchObject({ assigned: 2, present: 1, absent: 1, unrecorded: 0 })
    expect(by.__bench__).toMatchObject({ assigned: 1, present: 1 })
  })

  it("each role has its own three, and pay never reaches a role that does not see it", () => {
    const ids = (roles: HrRole[], over: Partial<HrContext> = {}) => todayKpis(input(ctx(roles, over))).map((k) => k.id)
    expect(ids(["manager"])).toEqual(["on_duty", "documents", "payroll"])
    expect(ids(["gov"])).toEqual(["iqama_expired", "expiring", "arrivals"])
    expect(ids(["payroll"])).toEqual(["estimate", "returned", "advances"])
    expect(ids(["supervisor"], { sites: ["s1"] })).toEqual(["my_workers", "unrecorded", "my_docs"])
    expect(ids(["management"])).toEqual(["bench", "labour_cost", "iqama_on_site"])
    expect(ids([])).toEqual([])
    for (const roles of [["gov"], ["supervisor"]] as HrRole[][]) expect(todayKpis(input(ctx(roles, { sites: ["s1"] }))).some((k) => k.money)).toBe(false)
  })

  it("the numbers: the KPI equals its list — on duty = the places' sum; documents = People's filter", () => {
    const hr = todayKpis(input(ctx(["manager"], { uid: "hrm" })))
    expect(hr[0]).toMatchObject({ value: 3, params: { of: 6, out: 2, unrecorded: 1, bench: 1 } })
    const filtered = people.filter((e) => inPeopleFilter("docs", e, TODAY, 60))
    expect(hr[1].value).toBe(filtered.length)
    expect(hr[1]).toMatchObject({ href: "people?filter=docs", params: { expired: 1, onSite: 0 } })
    expect(hr[2]).toMatchObject({ value: 10000, money: true, params: { returned: 1 } })
    const gov = todayKpis(input(ctx(["gov"])))
    expect(gov[0].value).toBe(people.filter((e) => inPeopleFilter("iqama", e, TODAY, 60)).length)
    const sup = todayKpis(input(ctx(["supervisor"], { sites: ["s1"] })))
    expect(sup.map((k) => k.value)).toEqual([1, 1, 0])
    const pay = todayKpis(input(ctx(["payroll"])))
    expect(pay.map((k) => k.value)).toEqual([3375 + 2700, 1, 600])
    const mg = todayKpis(input(ctx(["management"])))
    expect(mg.map((k) => k.value)).toEqual([2700, 12510, 0])
    expect(mg[1].href).toBe("reports?report=cost")
  })

  it("the role whose Today one sees: the HR manager first, management last", () => {
    expect(kpiRole(ctx(["manager", "management"]))).toBe("manager")
    expect(kpiRole(ctx(["management", "payroll"]))).toBe("payroll")
    expect(kpiRole(ctx([]))).toBeNull()
  })
})

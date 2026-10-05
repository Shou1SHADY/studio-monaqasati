/**
 * HR 1.0 — Reports (RP-01/02): computed from the live record; money reports
 * only for the roles that see pay (RL-03); the prototype's columns — every
 * row has as many cells as the report has columns, never undefined or NaN.
 */
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrExit } from "@/lib/hr/exit-writes"
import type { Payroll, PayrollLine } from "@/lib/hr/payroll"
import { REPORT_IDS, REPORTS, reportCsv, reportRows, visibleReports, type ReportWorld } from "@/lib/hr/reports"
import type { HrSite } from "@/lib/hr/sites"
import type { HrViolation } from "@/lib/hr/violations"

const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const TODAY = "2026-09-10"
const emp = (id: string, no: number, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: "org", no, names: { ar: `ع${id}`, en: `E${id}` }, nationality: "eg", gender: "m", trade: "mason", category: "labour", siteId: "s1", join: "2020-01-01", source: "local", contract: { type: "open" }, probation: { end: "2020-03-30", decision: "confirmed" }, status: "active", docs: { iqama: "2027-06-01" }, leaveTaken: 10, ...over }) as HrEmployee
const pay = (id: string, basic: number, over: Partial<EmployeePay> = {}): [string, EmployeePay] => [id, { employeeId: id, organizationId: "org", basic, housing: basic * 0.25, transport: basic * 0.1, ...over }]
const sites: HrSite[] = [
  { id: "s1", organizationId: "org", name: "Tower", type: "project", active: true, supervisorEmployeeId: "e9", supervisorUserId: "sup" },
  { id: "hq", organizationId: "org", name: "HQ", type: "hq", active: true },
]
const line = (employeeId: string, siteId: string | null, costKind: PayrollLine["costKind"], gross: number, gosiEmployer: number, eosAccrual: number) => ({ employeeId, siteId, costKind, gross, gosiEmployer, eosAccrual }) as unknown as PayrollLine

const world = (over: Partial<ReportWorld> = {}): ReportWorld => ({
  today: TODAY,
  locale: "en",
  employees: [
    emp("e1", 1, { docs: { iqama: "2026-09-01", passport: "2026-11-20" } }),
    emp("e2", 2, { nationality: "sa", trade: "hrOfficer", siteId: "hq", join: "2026-08-15", docs: {} }),
    emp("e3", 3, { status: "leaving", lastDay: "2026-09-30", managerId: "e2" }),
    emp("e4", 4, { status: "left", lastDay: "2026-07-31" }),
    emp("e9", 9, { trade: "foreman", nationality: "sa", docs: {} }),
  ],
  sites,
  pays: new Map([pay("e1", 4000, { advance: { amount: 2000, balance: 1200, instalment: 440 } }), pay("e2", 8000), pay("e3", 3000), pay("e9", 6000)]),
  payrolls: [
    { key: "2026-07", month: "2026-07", kind: "main", state: "paid", lines: [line("e1", "s1", "direct", 1, 1, 1)] },
    { key: "2026-08", month: "2026-08", kind: "main", state: "approved", lines: [line("e1", "s1", "direct", 5400, 108, 225), line("e3", "s1", "direct", 4050, 81, 168.75), line("e2", "hq", "admin", 10800, 1269, 450)] },
  ] as unknown as Payroll[],
  month: "2026-08",
  attendance: [
    {
      id: "a1",
      organizationId: "org",
      siteId: "s1",
      month: "2026-08",
      days: {
        "2026-08-02": { by: "sup", byName: null, at: "", listed: ["e1", "e3"], ex: { e1: { status: "absent" }, e3: { ot: 2 } } },
        "2026-08-03": { by: "sup", byName: null, at: "", listed: ["e1", "e3"], ex: {} },
      },
      declarations: [],
      closed: null,
    } as WorkplaceMonth,
    { id: "a0", organizationId: "org", siteId: "s1", month: "2026-07", days: { "2026-07-05": { by: "sup", byName: null, at: "", listed: ["e1"], ex: {} } }, declarations: [], closed: null } as WorkplaceMonth,
  ],
  requests: [],
  violations: [
    { id: "v1", employeeId: "e1", employeeName: "x", code: "late30", on: "2026-08-20", state: "applied", hearing: { on: "2026-08-22" }, step: 0, amount: 13.5 } as HrViolation,
    { id: "v2", employeeId: "e1", employeeName: "x", code: "late15", on: "2026-08-25", state: "recorded" } as HrViolation,
  ],
  exits: [{ id: "x3", employeeId: "e3", employeeName: "E3", no: 3, siteId: "s1", reason: "resignation", lastDay: "2026-09-30" } as HrExit],
  ...over,
})

describe("RP-01 — who is offered which report", () => {
  it("money reports only to the roles that see pay; turnover to the HR manager and management; supervisors and employees none", () => {
    const ids = (roles: HrRole[]) => visibleReports(ctx(roles)).map((r) => r.id)
    // A feature's reports (lateness, roster — punch) are offered only while it is on.
    const core = REPORT_IDS.filter((x) => !REPORTS[x].feature)
    expect(ids(["manager"])).toEqual(core)
    expect(ids(["management"])).toEqual(core)
    expect(ids(["payroll"])).toEqual(core.filter((x) => x !== "turnover"))
    const gov = ids(["gov"])
    expect(gov).toEqual(["register", "attendance", "documents", "saudization", "movement", "structure"])
    expect(gov.some((id) => REPORTS[id].money)).toBe(false)
    expect(ids(["supervisor"])).toEqual([])
    expect(ids([])).toEqual([])
  })
})

describe("RP-02 — the reports, from the live record", () => {
  it("every report: as many cells as columns, never undefined or NaN", () => {
    for (const id of REPORT_IDS) {
      const rows = reportRows(id, world())
      for (const r of rows) {
        expect({ id, cells: r.length }).toEqual({ id, cells: REPORTS[id].columns.length })
        expect(r.some((x) => x === undefined || (typeof x === "number" && Number.isNaN(x)))).toBe(false)
      }
    }
  })

  it("the register leaves out who has left, by number", () => {
    expect(reportRows("register", world()).map((r) => r[0])).toEqual([1, 2, 3, 9])
    expect(reportRows("register", world())[1]).toEqual([2, "Ee2", "hrOfficer", "sa", "HQ", "2026-08-15", "active"])
  })

  it("monthly attendance reads the month's sheets only; an office assumes presence less its exceptions", () => {
    const rows = reportRows("attendance", world())
    const e1 = rows.find((r) => r[0] === 1)!
    expect(e1.slice(3)).toEqual([1, 1, 0, 0, 0]) // present 1, absent 1 — July's sheet not counted
    expect(rows.find((r) => r[0] === 3)!.slice(3)).toEqual([2, 0, 0, 0, 2])
    // e2 joined Sat 15 Aug at HQ: 15–31 Aug less Fridays (21, 28) = 15 days.
    expect(rows.find((r) => r[0] === 2)![3]).toBe(15)
  })

  it("labour cost by cost centre reads the latest main payroll: gross + employer GOSI (the PRD's columns), the EOS accrual beside it, per head", () => {
    const rows = reportRows("cost", world())
    expect(rows).toEqual([
      ["HQ", "520101", 1, 10800, 1269, 450, 12069, 12069],
      ["Tower", "510201", 2, 9450, 189, 393.75, 9639, 4819.5],
    ])
  })

  it("documents expired or within 90 days, the most urgent first; a Saudi has no iqama row", () => {
    const rows = reportRows("documents", world())
    expect(rows.map((r) => [r[0], r[2], r[4], r[5]])).toEqual([
      [1, "iqama", -9, "expired"],
      [1, "passport", 71, "d90"],
    ])
  })

  it("leave balances and the liability at wage/30 a day; EOS by termination and by resignation", () => {
    const leave = reportRows("leave", world())
    const e1 = leave.find((r) => r[0] === 1)!
    // 6.7 years: 5 × 21 + 1.69 × 30 = 155.7 accrued − 10 taken = 145
    expect(e1.slice(2, 6)).toEqual([6.7, 155, 10, 145])
    expect(e1[6]).toBe(Math.round(((4000 * 1.35) / 30) * 145 * 100) / 100)
    const eos = reportRows("eos", world()).find((r) => r[0] === 1)!
    expect(eos[3]).toBe(5400)
    expect((eos[4] as number) > (eos[5] as number)).toBe(true)
    expect(eos[6]).toBe(450) // wage/12 after five years
  })

  it("outstanding advances; the penalties register leaves out what is not decided", () => {
    expect(reportRows("advances", world())).toEqual([[1, "Ee1", 2000, 1200, 440, 3]])
    expect(reportRows("penalties", world())).toEqual([[1, "Ee1", "late30", "2026-08-20", "2026-08-22", "fraction:0.1", 13.5, "applied"]])
  })

  it("saudization by trade flags a Saudi-only trade; joiners and leavers within 90 days with the reason", () => {
    const sz = reportRows("saudization", world())
    expect(sz[0]).toEqual(["mason", 2, 0, 2, 0, null])
    const hrs = sz.find((r) => r[0] === "hrOfficer")!
    expect(hrs.slice(1)).toEqual([1, 1, 0, 100, "yes"])
    const mv = reportRows("movement", world())
    expect(mv.map((r) => [r[0], r[2], r[4]])).toEqual([
      [3, "left", "resignation"],
      [2, "joined", null],
    ])
  })

  it("turnover by workplace; the structure names the line manager — set on the card, else the site's supervisor, else management", () => {
    expect(reportRows("turnover", world())).toEqual([
      ["Tower", 3, 0, 1, 400],
      ["HQ", 1, 1, 0, 0],
    ])
    const st = reportRows("structure", world())
    expect(st.find((r) => r[0] === 1)!.slice(4)).toEqual(["Ee9", "derived"])
    expect(st.find((r) => r[0] === 3)!.slice(4)).toEqual(["Ee2", "set"])
    expect(st.find((r) => r[0] === 9)!.slice(4)).toEqual([null, "management"])
    expect(st.find((r) => r[0] === 2)!.slice(4)).toEqual([null, "management"])
  })

  it("the CSV is UTF-8 with a BOM, quoted where needed", () => {
    expect(reportCsv(["الاسم", "Note"], [["أحمد", 'a, "b"']])).toBe('﻿الاسم,Note\r\nأحمد,"a, ""b"""\r\n')
  })
})

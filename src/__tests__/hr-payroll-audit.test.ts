/**
 * HR 1.0 — payroll defects found by the audit against PRD-HR-1.0 and the
 * prototype (1 Oct 2026). Each case failed before its fix:
 *  - a settled leaver vanished from the months BEFORE his last day (EX-05);
 *  - the new GOSI scheme starts ON 3 Jul 2024, not the day after;
 *  - a whole month of unpaid leave deducted 31 (or 28) days against a 30-day month;
 *  - a day of approved PAID leave marked absent on the sheet was docked (WF-07);
 *  - exceptions recorded at an office were dropped unless someone closed it (AT-02);
 *  - one date marked absent on two workplaces' sheets was deducted twice;
 *  - sick days were counted twice on a person's first payroll (LV-06);
 *  - the GOSI statement left held lines out while the entry credited them (PY-07);
 *  - the Mudad row showed negative "other earnings" on an absence (PY-07).
 */
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { gosiRates, payLine } from "@/lib/hr/pay"
import { computePayroll, gosiCsv, mudadCsv, onPayroll, payEvent } from "@/lib/hr/payroll"
import type { HrRequest } from "@/lib/hr/requests"
import type { HrSite } from "@/lib/hr/sites"

const ORG = "org"
const r = (n: number) => Math.round(n * 100) / 100
const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: ORG, no: Number(id.slice(1)), names: { ar: id }, nationality: "eg", gender: "m", idNo: `ID${id}`, trade: "mason", category: "labour", siteId: "s1", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31" }, status: "active", docs: {}, leaveTaken: 0, ...over }) as HrEmployee
const wage4050: EmployeePay = { employeeId: "e1", organizationId: ORG, basic: 3_000, housing: 750, transport: 300, iban: "SA01", ibanState: "ok" }
const sites: HrSite[] = [
  { id: "s1", organizationId: ORG, name: "Tower", type: "project", projectId: "p1", active: true },
  { id: "s2", organizationId: ORG, name: "Villa", type: "project", projectId: "p2", active: true },
  { id: "hq", organizationId: ORG, name: "HQ", type: "hq", active: true },
]
const sheet = (listed: string[], ex: Record<string, object> = {}) => ({ by: "sup", byName: "S", at: "", listed, ex })
const month = (siteId: string, m: string, days: WorkplaceMonth["days"], closed = true): WorkplaceMonth => ({
  id: `${ORG}__${siteId}__${m}`,
  organizationId: ORG,
  siteId,
  month: m,
  days,
  declarations: [],
  closed: closed ? { by: "sup", byName: "S", at: "", asIs: false, missing: [] } : null,
})
const leave = (employeeId: string, type: string, from: string, to: string, days: number, unpaidDays = 0) =>
  ({ employeeId, kind: "leave", state: "approved", leave: { type, from, to, days, unpaidDays } }) as unknown as HrRequest
const one = (input: Partial<Parameters<typeof computePayroll>[0]> & { month: string }) =>
  computePayroll({ employees: [emp("e1")], pays: new Map([["e1", wage4050]]), sites, attendance: [], requests: [], ...input }).lines[0]

describe("who is on the month's payroll (EX-05)", () => {
  it("a settled leaver stays on every month before the month of his last day", () => {
    const left = { join: "2020-01-01", status: "left" as const, lastDay: "2026-10-03" }
    expect(onPayroll(left, "2026-09")).toBe(true)
    expect(onPayroll(left, "2026-10")).toBe(false)
    expect(onPayroll(left, "2026-11")).toBe(false)
  })

  it("an old record marked left with no last day is off every payroll", () => {
    expect(onPayroll({ join: "2020-01-01", status: "left" }, "2026-09")).toBe(false)
  })
})

describe("the line (PY-01)", () => {
  it("the new GOSI scheme applies to a Saudi who joined ON 3 Jul 2024", () => {
    expect(gosiRates("sa", "2024-07-02").scheme).toBe("saudiOld")
    expect(gosiRates("sa", "2024-07-03").scheme).toBe("saudiNew")
  })

  it("days without pay never exceed the days paid: a 31-day unpaid month takes the month's wage, no more", () => {
    const l = payLine({ pay: wage4050, nationality: "eg", join: "2025-01-01", month: "2026-10", attendance: { absent: 0, overtimeHours: 0, sickThreeQuarters: 0, sickUnpaid: 0, unpaid: 31 } })
    expect(l.unpaidDeduction).toBe(4_050)
    expect(l.net).toBe(0)
  })

  it("a whole calendar month of unpaid leave is the whole 30-day wage — February too", () => {
    const l = one({ month: "2026-02", requests: [leave("e1", "unpaid", "2026-02-01", "2026-02-28", 28, 28)] })
    expect(l.unpaidDeduction).toBe(4_050)
    expect(l.net).toBe(0)
  })

  it("a day of approved PAID leave marked absent on the sheet is not absence", () => {
    const sept = month("s1", "2026-09", { "2026-09-06": sheet(["e1"], { e1: { status: "absent" } }), "2026-09-07": sheet(["e1"], { e1: { status: "absent" } }) })
    const l = one({ month: "2026-09", attendance: [sept], requests: [leave("e1", "annual", "2026-09-06", "2026-09-10", 5)] })
    expect(l.attendance.absent).toBe(0)
    expect(l.absenceDeduction).toBe(0)
    expect(l.net).toBe(4_050)
  })

  it("an office's recorded exceptions count without a closing (AT-02) — a site's still wait for theirs", () => {
    const hqOpen = month("hq", "2026-09", { "2026-09-07": sheet(["e1"], { e1: { status: "absent" } }), "2026-09-08": sheet(["e1"], { e1: { ot: 4 } }) }, false)
    const office = one({ month: "2026-09", employees: [emp("e1", { siteId: "hq" })], attendance: [hqOpen] })
    expect(office.attendance).toMatchObject({ absent: 1, overtimeHours: 4 })
    expect(office.absenceDeduction).toBe(135)
    const siteOpen = month("s1", "2026-09", { "2026-09-07": sheet(["e1"], { e1: { status: "absent" } }) }, false)
    expect(one({ month: "2026-09", attendance: [siteOpen] }).attendance.absent).toBe(0)
  })

  it("one date on two workplaces' sheets is one day: absent at both = 1; absent at one, present at the other = 0", () => {
    const a = month("s1", "2026-09", { "2026-09-15": sheet(["e1"], { e1: { status: "absent" } }) })
    const bothAbsent = month("s2", "2026-09", { "2026-09-15": sheet(["e1"], { e1: { status: "absent" } }) })
    const presentAtB = month("s2", "2026-09", { "2026-09-15": sheet(["e1"]) })
    expect(one({ month: "2026-09", attendance: [a, bothAbsent] }).attendance.absent).toBe(1)
    expect(one({ month: "2026-09", attendance: [a, presentAtB] }).attendance.absent).toBe(0)
  })

  it("sick days are counted once on a first payroll: 25 in the service year are paid in full (LV-06)", () => {
    // Approval already wrote the leave's days on the record (sick.days = 25); there is no earlier payroll line.
    const e = emp("e1", { join: "2025-01-01", sick: { year: 1, days: 25 } } as Partial<HrEmployee>)
    const l = one({ month: "2026-09", employees: [e], requests: [leave("e1", "sick", "2026-09-01", "2026-09-25", 25)] })
    expect(l.sickDeduction).toBe(0)
    expect(l.sickUsed).toBe(25)
  })

  it("sick days taken before this month still count on a first payroll", () => {
    // 28 days in August and 10 in September, both approved: 38 on the record; September starts at 28 used → 2 full, 8 at 75%.
    const e = emp("e1", { join: "2025-01-01", sick: { year: 1, days: 38 } } as Partial<HrEmployee>)
    const l = one({ month: "2026-09", employees: [e], requests: [leave("e1", "sick", "2026-08-01", "2026-08-28", 28), leave("e1", "sick", "2026-09-01", "2026-09-10", 10)] })
    expect(l.sickDeduction).toBe(r(135 * 8 * 0.25))
    expect(l.sickUsed).toBe(38)
  })
})

describe("the files for the authorities (PY-07)", () => {
  const employees = [emp("e1"), emp("e2", { nationality: "sa", join: "2020-01-01" })]
  const pays = new Map<string, EmployeePay>([
    ["e1", wage4050],
    ["e2", { employeeId: "e2", organizationId: ORG, basic: 4_000, housing: 1_000, transport: 400, iban: "SA02", ibanState: "returned" }],
  ])
  const sept = month("s1", "2026-09", { "2026-09-06": sheet(["e1", "e2"], { e1: { status: "absent" } }), "2026-09-07": sheet(["e1", "e2"], { e1: { status: "absent" } }), "2026-09-08": sheet(["e1", "e2"], { e1: { status: "absent" } }) })
  const { lines } = computePayroll({ month: "2026-09", employees, pays, sites, attendance: [sept], requests: [] })
  const rowsOf = (csv: string) => csv.trim().split("\r\n").slice(1).map((x) => x.split(","))

  it("the GOSI statement totals the GOSI credit — a held transfer still owes its contributions", () => {
    const total = r(rowsOf(gosiCsv(lines, pays)).reduce((s, row) => s + Number(row[7]), 0))
    expect(total).toBe(payEvent({ key: "2026-09", month: "2026-09", kind: "main", lines }).credit.gosi)
    expect(total).toBeGreaterThan(0)
  })

  it("the Mudad row never shows negative earnings: an absence is a deduction, and the row still adds up to the net", () => {
    const [row] = rowsOf(mudadCsv(lines, pays))
    const [id, , , basic, housing, other, deductions, net] = row
    expect(id).toBe("IDe1")
    expect(Number(basic)).toBe(3_000)
    expect(Number(housing)).toBe(750)
    expect(Number(other)).toBe(300)
    expect(Number(deductions)).toBe(405)
    expect(r(Number(basic) + Number(housing) + Number(other) - Number(deductions))).toBe(Number(net))
  })

  it("the files read the pay the payroll was computed with, not a later raise", () => {
    const raised = new Map(pays).set("e1", { ...wage4050, basic: 5_000, housing: 1_250, transport: 500 })
    expect(rowsOf(mudadCsv(lines, raised))[0][3]).toBe("3000.00")
    expect(rowsOf(gosiCsv(lines, raised))[0][4]).toBe("3750.00")
  })
})

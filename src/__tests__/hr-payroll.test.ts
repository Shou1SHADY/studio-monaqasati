/**
 * HR 1.0 — payroll (PY-01…05, PY-07, PY-10; §7.3): computed from the closed
 * months and the contract; blocked before month end or with a workplace open;
 * a bounced IBAN holds its line only; approved by the HR manager who did not
 * prepare it; hr:PAY and hr:EOS balance on their own and are never sent twice.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import {
  computePayroll,
  computeSupplementary,
  eosEvent,
  eventBalances,
  gosiCsv,
  lineWarnings,
  mudadCsv,
  onPayroll,
  payEvent,
  payrollBlocks,
  payrollTotals,
} from "@/lib/hr/payroll"
import { approvePayroll, preparePayroll, prepareSupplementary } from "@/lib/hr/payroll-writes"
import type { HrRequest } from "@/lib/hr/requests"
import type { HrSite } from "@/lib/hr/sites"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const M = "2026-08"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm" })
const pay = ctx(["payroll"], { uid: "po" })

const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: ORG, no: Number(id.slice(1)), names: { ar: id }, nationality: "eg", gender: "m", idNo: `ID${id}`, trade: "mason", category: "labour", siteId: "s1", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31" }, status: "active", docs: {}, leaveTaken: 0, ...over }) as HrEmployee
const pays = new Map<string, EmployeePay>([
  ["e1", { employeeId: "e1", organizationId: ORG, basic: 3_000, housing: 750, transport: 300, iban: "SA01", ibanState: "ok", advance: { amount: 900, balance: 600, instalment: 405 } }],
  ["e2", { employeeId: "e2", organizationId: ORG, basic: 4_000, housing: 1_000, transport: 400, iban: "SA02", ibanState: "returned" }],
  ["e3", { employeeId: "e3", organizationId: ORG, basic: 6_000, housing: 1_500, transport: 600, iban: "SA03", ibanState: "ok", retro: [{ month: M, amount: 270, reason: "raise" }] }],
])
const sites: HrSite[] = [
  { id: "s1", organizationId: ORG, name: "Tower", type: "project", projectId: "p1", active: true },
  { id: "hq", organizationId: ORG, name: "HQ", type: "hq", active: true },
]
const sheet = (listed: string[], ex: Record<string, object> = {}) => ({ by: "sup", byName: "S", at: "", listed, ex })
const wmS1: WorkplaceMonth = {
  id: `${ORG}__s1__${M}`,
  organizationId: ORG,
  siteId: "s1",
  month: M,
  days: { "2026-08-01": sheet(["e1", "e2"], { e1: { status: "absent" }, e2: { ot: 4 } }), "2026-08-02": sheet(["e1", "e2"], { e1: { status: "sick" } }) },
  declarations: [],
  closed: { by: "sup", byName: "S", at: "", asIs: false, missing: [] },
}
const employees = [emp("e1"), emp("e2", { nationality: "sa", join: "2020-01-01" }), emp("e3", { siteId: "hq", join: "2026-08-16" })]

describe("compute", () => {
  const { lines, missingPay } = computePayroll({ month: M, employees, pays, sites, attendance: [wmS1], requests: [] })
  const [l1, l2, l3] = lines

  it("one line each; absence /30, overtime art. 107, sick in full within 30 days, the advance instalment (PY-01)", () => {
    expect(missingPay).toEqual([])
    expect(l1).toMatchObject({ days: 30, wage: 4_050, absenceDeduction: 135, gross: 3_915, sickDeduction: 0, advance: 405, costKind: "direct", projectId: "p1" })
    expect(l1.attendance).toMatchObject({ absent: 1, sick: 1 })
    expect(l2.overtime).toBe(r(((5_400 + 2_000) / 240) * 4))
    expect(l2).toMatchObject({ gosiScheme: "saudiOld", gosiEmployee: r(5_000 * 0.0975) })
  })

  it("pro-rata from the join date; an office needs no sheet (AT-02)", () => {
    expect(l3).toMatchObject({ days: 16, monthWage: r((8_100 * 16) / 30), costKind: "admin" })
  })

  it("a bounced IBAN holds its line only (PY-03)", () => {
    expect(l2).toMatchObject({ held: true, heldReason: "iban_returned" })
    expect(lineWarnings(l2)).toContain("held")
    const t = payrollTotals(lines)
    expect(t.heldCount).toBe(1)
    expect(t.heldNet).toBe(l2.net)
  })

  it("hr:PAY and hr:EOS balance — the held net stays inside salaries payable (§7.3)", () => {
    const p = { key: M, month: M, kind: "main" as const, lines }
    const e = payEvent(p)
    expect(eventBalances(e)).toBe(true)
    expect(e.credit.salariesPayable).toBe(payrollTotals(lines).net)
    expect(eventBalances(eosEvent(p))).toBe(true)
    expect(e.debit.map((d) => d.costKind).sort()).toEqual(["admin", "direct"])
  })

  it("the Mudad file adds up to the net, keyed by ID; held lines stay out; GOSI totals the credit (PY-07)", () => {
    const rows = mudadCsv(lines, pays).trim().split("\r\n").slice(1)
    expect(rows).toHaveLength(2)
    const [id, , , basic, housing, other, deductions, net] = rows[0].split(",")
    expect(id).toBe("IDe1")
    expect(r(Number(basic) + Number(housing) + Number(other) - Number(deductions))).toBe(Number(net))
    // Every line owes its contributions — the held one too: the statement IS the GOSI credit.
    const g = gosiCsv(lines, pays).trim().split("\r\n").slice(1)
    expect(g).toHaveLength(3)
    expect(r(g.reduce((s, row) => s + Number(row.split(",")[7]), 0))).toBe(payEvent({ key: M, month: M, kind: "main", lines }).credit.gosi)
  })

  it("sick days past thirty in the service year are paid at 75% (art. 117)", () => {
    const prev = [{ ...l1, sickUsed: 30, sickYear: 1 }]
    const again = computePayroll({ month: M, employees, pays, sites, attendance: [wmS1], requests: [], previous: prev }).lines[0]
    expect(again.sickDeduction).toBe(r((4_050 / 30) * 0.25))
  })

  it("approved unpaid leave is deducted; absence on a leave day is not absence", () => {
    const req = { employeeId: "e1", kind: "leave", state: "approved", leave: { type: "unpaid", from: "2026-08-01", to: "2026-08-01", days: 1, unpaidDays: 1 } } as unknown as HrRequest
    const l = computePayroll({ month: M, employees, pays, sites, attendance: [wmS1], requests: [req] }).lines[0]
    expect(l).toMatchObject({ absenceDeduction: 0, unpaidDeduction: 135 })
  })

  it("imported staff enter from the import month (PY-10); a missing wage is named, never skipped silently", () => {
    expect(onPayroll({ join: "2020-01-01", status: "active", since: "2026-09" }, M)).toBe(false)
    const r2 = computePayroll({ month: M, employees: [...employees, emp("e4")], pays, sites, attendance: [wmS1], requests: [] })
    expect(r2.missingPay).toEqual(["e4"])
  })

  it("blocks: before the month ends, a workplace not closed (PY-02)", () => {
    expect(payrollBlocks({ month: M, today: "2026-08-31", sites, employees, attendance: [wmS1], missingPay: [] }).blocks).toEqual(["not_over"])
    const open = { ...wmS1, closed: null }
    expect(payrollBlocks({ month: M, today: "2026-09-02", sites, employees, attendance: [open], missingPay: [] })).toEqual({ blocks: ["unclosed"], unclosed: ["s1"] })
  })
})

describe("the writes", () => {
  beforeEach(() => {
    resetFakeDb()
    seed(`hrAttendance/${ORG}__s1__${M}`, wmS1 as unknown as Record<string, unknown>)
    for (const [id, p] of pays) seed(`employeePay/${id}`, p as unknown as Record<string, unknown>)
  })
  const { lines } = computePayroll({ month: M, employees, pays, sites, attendance: [wmS1], requests: [] })

  it("prepared by payroll, approved by the HR manager — never by whoever prepared it; the events go once", async () => {
    await expect(preparePayroll(db, pay, ORG, M, { uid: "po", name: "P" }, { lines, sitesToClose: ["s1"], missingPay: [] }, { today: "2026-08-31" })).rejects.toMatchObject({ blocks: ["not_over"] })
    await preparePayroll(db, pay, ORG, M, { uid: "po", name: "P" }, { lines, sitesToClose: ["s1"], missingPay: [] }, { today: "2026-09-02" })
    await expect(approvePayroll(db, pay, ORG, M, { uid: "po", name: "P" })).rejects.toMatchObject({ code: "no_role" })
    await expect(approvePayroll(db, ctx(["manager"], { uid: "po" }), ORG, M, { uid: "po", name: "P" })).rejects.toMatchObject({ code: "own_request" })
    await approvePayroll(db, hrm, ORG, M, { uid: "hrm", name: "H" })
    expect(readDoc(`hrPayrolls/${ORG}__${M}`)).toMatchObject({ state: "approved", approved: { by: "hrm" } })
    expect(readDoc(`hrEvents/${ORG}__hr:PAY:${M}`)).toMatchObject({ kind: "PAY", state: "sent", key: `hr:PAY:${M}` })
    expect(readDoc(`hrEvents/${ORG}__hr:EOS:${M}`)).toMatchObject({ kind: "EOS" })
    expect(readDoc<EmployeePay>("employeePay/e1")?.advance).toMatchObject({ balance: 195 })
    await expect(preparePayroll(db, pay, ORG, M, { uid: "po", name: "P" }, { lines, sitesToClose: ["s1"], missingPay: [] }, { today: "2026-09-02" })).rejects.toMatchObject({ blocks: ["approved"] })
  })

  it("an open workplace refuses the preparation even if the screen thought it closed", async () => {
    seed(`hrAttendance/${ORG}__s1__${M}`, { ...wmS1, closed: null })
    await expect(preparePayroll(db, pay, ORG, M, { uid: "po", name: "P" }, { lines, sitesToClose: ["s1"], missingPay: [] }, { today: "2026-09-02" })).rejects.toMatchObject({ blocks: ["unclosed"] })
  })

  it("the supplementary -D after the main: retro only, then the retro items are cleared (PY-04)", async () => {
    const sup = computeSupplementary({ month: M, employees, pays, sites })
    expect(sup).toEqual([expect.objectContaining({ employeeId: "e3", retro: 270, net: 270 })])
    await expect(prepareSupplementary(db, pay, ORG, M, { uid: "po", name: "P" }, sup)).rejects.toMatchObject({ blocks: ["main_not_approved"] })
    await preparePayroll(db, pay, ORG, M, { uid: "po", name: "P" }, { lines, sitesToClose: ["s1"], missingPay: [] }, { today: "2026-09-02" })
    await approvePayroll(db, hrm, ORG, M, { uid: "hrm", name: "H" })
    await prepareSupplementary(db, pay, ORG, M, { uid: "po", name: "P" }, sup)
    await approvePayroll(db, hrm, ORG, `${M}-D`, { uid: "hrm", name: "H" })
    const ev = readDoc<{ credit: { salariesPayable: number } }>(`hrEvents/${ORG}__hr:PAY:${M}-D`)
    expect(ev?.credit.salariesPayable).toBe(270)
    expect(readDoc<EmployeePay>("employeePay/e3")?.retro).toEqual([])
  })
})

function r(n: number) {
  return Math.round(n * 100) / 100
}

/**
 * HR 1.0 — payroll parity with the prototype (slice 4 / package E): the pre-Mudad
 * "net below 90%" rule (it used to fire for every new-scheme Saudi), the
 * exceptions view grouped by cost centre (PY-06), the Mudad file with bank,
 * establishment and period, its supplementary and "-R" release files and the
 * GOSI statement's preview (PY-07), the payslip's state for My file (ES-04), the
 * advance decision's facts and the Advances segment (AD-01…04), the month before
 * its payroll (PY-02) and the EOS provision against the ledger (PY-09).
 */
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { advanceFacts } from "@/lib/hr/pay"
import {
  advanceRequestsInView,
  bankOfIban,
  computePayroll,
  contractEstimate,
  costByCentre,
  creditBalance,
  daysAfterPayDay,
  eosReconciliation,
  gosiStatement,
  groupByCostCentre,
  isException,
  lineExceptions,
  lineWarnings,
  mudadFile,
  MUDAD_COLUMNS,
  outstandingAdvances,
  payEvent,
  payrollOpensOn,
  payslipState,
  recordedThrough,
  releaseFile,
  type Payroll,
  type PayrollLine,
  type SupplementaryLine,
} from "@/lib/hr/payroll"
import type { HrRequest } from "@/lib/hr/requests"
import type { HrSite } from "@/lib/hr/sites"
import { gratuity } from "@/lib/hr/eos"

const ORG = "org"
const M = "2026-08"
const r = (n: number) => Math.round(n * 100) / 100
const IBAN_RAJHI = "SA4480000123456789012345"
const IBAN_SNB = "SA0310000000000000000001"

const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: ORG, no: Number(id.slice(1)), names: { ar: id }, nationality: "eg", gender: "m", idNo: `ID${id}`, trade: "mason", category: "labour", siteId: "s1", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31" }, status: "active", docs: {}, leaveTaken: 0, ...over }) as HrEmployee
const pay = (id: string, basic: number, over: Partial<EmployeePay> = {}): EmployeePay => ({ employeeId: id, organizationId: ORG, basic, housing: basic * 0.25, transport: 0, iban: IBAN_RAJHI, ibanState: "ok", ...over })
const sites: HrSite[] = [
  { id: "s1", organizationId: ORG, name: "Tower", type: "project", projectId: "p1", active: true },
  { id: "s2", organizationId: ORG, name: "Villa", type: "project", projectId: "p2", active: true },
  { id: "hq", organizationId: ORG, name: "HQ", type: "hq", active: true },
]
const sheet = (listed: string[], ex: Record<string, object> = {}) => ({ by: "sup", byName: "S", at: "", listed, ex })
const closed = { by: "sup", byName: "S", at: "", asIs: false, missing: [] }
const wm = (siteId: string, days: WorkplaceMonth["days"]): WorkplaceMonth => ({ id: `${ORG}__${siteId}__${M}`, organizationId: ORG, siteId, month: M, days, declarations: [], closed })

describe("pre-Mudad check: net below 90% (PY-08)", () => {
  // A Saudi on the new scheme (joined after 3 Jul 2024), no transport: GOSI 10.25% of the whole wage.
  const saudi = emp("e1", { nationality: "sa", join: "2025-01-01" })
  const run = (p: EmployeePay, days: WorkplaceMonth["days"] = {}) => computePayroll({ month: M, employees: [saudi], pays: new Map([["e1", p]]), sites, attendance: [wm("s1", days)], requests: [] }).lines[0]

  it("a Saudi paid his full wage is not flagged — the GOSI share is not a shortfall", () => {
    const l = run(pay("e1", 5_000))
    expect(l.gosiScheme).toBe("saudiNew")
    // The net is under 90% of the bare wage, which is what used to fire…
    expect(l.net).toBeLessThan(l.monthWage * 0.9)
    // …but not of the wage less his GOSI share.
    expect(lineWarnings(l)).not.toContain("net_below_90")
  })

  it("a deduction Mudad does not know (an advance) below 90% of wage − GOSI is flagged", () => {
    const l = run(pay("e1", 5_000, { advance: { amount: 2_000, balance: 2_000, instalment: 900 } }))
    expect(l.net).toBeLessThan((l.monthWage - l.gosiEmployee) * 0.9)
    expect(lineWarnings(l)).toContain("net_below_90")
  })

  it("a recorded absence explains a short net — not flagged", () => {
    const days = Object.fromEntries(["2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"].map((d) => [d, sheet(["e1"], { e1: { status: "absent" } })]))
    const l = run(pay("e1", 5_000), days)
    expect(l.attendance.absent).toBe(4)
    expect(lineWarnings(l)).not.toContain("net_below_90")
  })

  it("a net of exactly zero is flagged as zero or below", () => {
    const l = run(pay("e1", 5_000))
    expect(lineWarnings({ ...l, net: 0 })).toContain("net_negative")
  })
})

describe("exceptions by cost centre (PY-06)", () => {
  const employees = [emp("e1"), emp("e2", { siteId: "s2" }), emp("e3", { siteId: null }), emp("e4", { siteId: "s2" }), emp("e5")]
  const pays = new Map<string, EmployeePay>([
    ["e1", pay("e1", 3_000)],
    ["e2", pay("e2", 6_000, { ibanState: "returned" })],
    ["e3", pay("e3", 2_000)],
    ["e4", pay("e4", 4_000)],
    ["e5", pay("e5", 3_000, { advance: { amount: 600, balance: 600, instalment: 300 } })],
  ])
  const s1 = wm("s1", { "2026-08-03": sheet(["e1", "e5"], { e1: { status: "absent" } }) })
  const s2 = wm("s2", { "2026-08-03": sheet(["e2", "e4"], { e4: { ot: 3 } }) })
  const { lines } = computePayroll({ month: M, employees, pays, sites, attendance: [s1, s2], requests: [] })
  const by = (id: string) => lines.find((l) => l.employeeId === id)!

  it("an exception is absence, overtime, an advance, a held transfer…; the contract wage paid as agreed is not one", () => {
    expect(lineExceptions(by("e1"))).toEqual(["absence"])
    expect(lineExceptions(by("e4"))).toEqual(["overtime"])
    expect(lineExceptions(by("e5"))).toEqual(["advance"])
    expect(lineExceptions(by("e2"))).toContain("held")
    expect(lineExceptions(by("e3"))).toEqual([])
    expect(isException(by("e3"))).toBe(false)
    expect(lines.filter(isException).map((l) => l.employeeId).sort()).toEqual(["e1", "e2", "e4", "e5"])
  })

  it("groups: largest gross first, the unassigned last; held lines last inside, then the largest net; the group's net leaves held lines out", () => {
    const g = groupByCostCentre(lines)
    expect(g.map((x) => x.siteId)).toEqual(["s2", "s1", null])
    expect(g[0].lines.map((l) => l.employeeId)).toEqual(["e4", "e2"])
    expect(g[0].net).toBe(by("e4").net)
    expect(g[0].count).toBe(2)
  })

  it("the cost by cost centre is what Finance books — it adds up to hr:PAY's debit", () => {
    const c = costByCentre(lines)
    const debit = payEvent({ key: M, month: M, kind: "main", lines }).debit
    expect(r(c.reduce((s, x) => s + x.amount, 0))).toBe(r(debit.reduce((s, d) => s + d.amount, 0)))
    expect(r(c.reduce((s, x) => s + x.share, 0))).toBe(1)
    expect(c[0].amount).toBeGreaterThanOrEqual(c[1].amount)
  })
})

describe("files: Mudad, supplementary, release, GOSI (PY-07)", () => {
  const employees = [emp("e1"), emp("e2", { nationality: "sa", join: "2020-01-01" }), emp("e3")]
  const pays = new Map<string, EmployeePay>([
    ["e1", pay("e1", 3_000, { transport: 300 })],
    ["e2", pay("e2", 4_000, { iban: IBAN_SNB })],
    ["e3", pay("e3", 2_000, { ibanState: "returned" })],
  ])
  const { lines } = computePayroll({ month: M, employees, pays, sites, attendance: [wm("s1", {})], requests: [] })
  const main = (over: Partial<Payroll> = {}): Payroll => ({ id: `${ORG}__${M}`, organizationId: ORG, month: M, key: M, kind: "main", state: "paid", lines, prepared: { by: "p", byName: null, at: "" }, ...over })
  const rowsOf = (csv: string) => csv.replace(/^﻿/, "").trim().split("\r\n").map((x) => x.split(","))

  it("the bank comes from the IBAN's bank code; a short or foreign IBAN has none", () => {
    expect(bankOfIban(IBAN_RAJHI)).toBe("RJHI")
    expect(bankOfIban("SA03 1000 0000 0000 0000 0001")).toBe("NCBK")
    expect(bankOfIban("SA01")).toBeNull()
    expect(bankOfIban(null)).toBeNull()
  })

  it("the Mudad file carries bank, establishment number and period; held lines are counted outside it", () => {
    const f = mudadFile(main(), pays, "MD-7-1234567")
    expect(f.name).toBe(`mudad-${M}.csv`)
    const [head, first] = rowsOf(f.csv)
    expect(head).toEqual([...MUDAD_COLUMNS])
    expect(first[0]).toBe("IDe1")
    expect(first[2]).toBe("RJHI")
    expect(first.slice(-2)).toEqual(["MD-7-1234567", M])
    expect(f.rows.map((x) => x.employeeId)).toEqual(["e1", "e2"])
    expect(f.heldCount).toBe(1)
    expect(f.heldNet).toBe(lines.find((l) => l.employeeId === "e3")!.net)
    expect(f.total).toBe(r(lines.filter((l) => !l.held).reduce((s, l) => s + l.net, 0)))
  })

  it("a transfer the bank returned stays in the file, marked", () => {
    const f = mudadFile(main({ returned: { e1: { by: "f", byName: null, at: "", reason: "closed" } } }), pays)
    expect(f.rows.find((x) => x.employeeId === "e1")?.returned).toBe(true)
  })

  it("a supplementary's file: no basic, no housing — its late items are 'other', its net the row's", () => {
    const sup: SupplementaryLine = { employeeId: "e1", no: 1, name: "e1", idNo: "IDe1", siteId: "s1", costKind: "direct", projectId: "p1", iban: IBAN_RAJHI, held: false, heldReason: null, retro: 270, commission: 100, refunds: 0, net: 370 }
    const f = mudadFile({ key: `${M}-D`, month: M, kind: "supplementary", lines: [], supplementary: [sup] }, pays)
    expect(f.name).toBe(`mudad-${M}-D.csv`)
    expect(f.rows[0]).toMatchObject({ basic: 0, housing: 0, other: 370, deductions: 0, net: 370 })
  })

  it("the '-R' release file holds the lines paid after the month — none before one was", () => {
    expect(releaseFile(main(), pays)).toBeNull()
    const f = releaseFile(main({ paidHeld: { e3: { by: "f", byName: null, at: "2026-09-20T10:00:00Z", date: "2026-09-20" } } }), pays, "MD-1")!
    expect(f.name).toBe(`mudad-${M}-R.csv`)
    expect(f.rows.map((x) => x.employeeId)).toEqual(["e3"])
    expect(f.total).toBe(lines.find((l) => l.employeeId === "e3")!.net)
  })

  it("the GOSI statement: Saudis one by one, non-Saudis in one row; its total is the GOSI credit", () => {
    const g = gosiStatement(lines, pays)
    expect(g.saudi.map((x) => x.employeeId)).toEqual(["e2"])
    expect(g.nonSaudi.count).toBe(2)
    expect(g.total).toBe(payEvent({ key: M, month: M, kind: "main", lines }).credit.gosi)
  })
})

describe("the payslip's state for My file (ES-04)", () => {
  const line = { employeeId: "e1", net: 3_000, held: false, heldReason: null } as unknown as PayrollLine
  const heldLine = { employeeId: "e2", net: 2_000, held: true, heldReason: "iban_returned" } as unknown as PayrollLine
  const p = (over: Partial<Payroll>): Payroll => ({ id: "x", organizationId: ORG, month: M, key: M, kind: "main", state: "approved", lines: [line, heldLine], prepared: { by: "p", byName: null, at: "" }, ...over })

  it("preparing → with Finance → paid; held lines say so; returned and repaid with Finance's reason and dates", () => {
    expect(payslipState(null, "e1").state).toBe("none")
    expect(payslipState(p({}), "e9").state).toBe("none")
    expect(payslipState(p({ state: "prepared" }), "e1").state).toBe("preparing")
    expect(payslipState(p({ state: "posted" }), "e1")).toMatchObject({ state: "with_finance", net: 3_000 })
    expect(payslipState(p({ state: "posted" }), "e2")).toMatchObject({ state: "held", reason: "iban_returned" })
    const paid = p({ state: "paid", paid: { by: "f", byName: null, at: "", date: "2026-09-05" } })
    expect(payslipState(paid, "e1")).toMatchObject({ state: "paid", date: "2026-09-05" })
    expect(payslipState({ ...paid, returned: { e1: { by: "f", byName: null, at: "", reason: "account closed", date: "2026-09-08" } } }, "e1")).toMatchObject({ state: "returned", reason: "account closed", date: "2026-09-08" })
    expect(payslipState({ ...paid, paidHeld: { e2: { by: "f", byName: null, at: "", date: "2026-09-20" } } }, "e2")).toMatchObject({ state: "repaid", date: "2026-09-20" })
  })
})

describe("advances (AD-01…04)", () => {
  it("the decision's facts: wage, limit, outstanding, the art. 92 schedule, past the contract", () => {
    const f = advanceFacts({ pay: { basic: 3_000, housing: 750, transport: 300 }, amount: 1_000, maxMonths: 1, today: "2026-10-05" })
    expect(f).toMatchObject({ wage: 4_050, limit: 4_050, overLimit: false, outstanding: 0, instalment: 405, count: 3, last: 190, firstMonth: "2026-11", lastMonth: "2027-01", pastContract: false, blocks: [] })
    expect(r(f.instalment * (f.count - 1) + f.last)).toBe(1_000)
    const over = advanceFacts({ pay: { basic: 3_000, housing: 750, transport: 300 }, amount: 5_000, maxMonths: 1, today: "2026-10-05", contractEnd: "2027-03-31", outstanding: 200 })
    expect(over).toMatchObject({ overLimit: true, pastContract: true, blocks: ["outstanding"], outstanding: 200 })
    expect(advanceFacts({ pay: null, amount: 0, maxMonths: 1, today: "2026-10-05" }).blocks).toEqual(["no_wage", "bad_amount"])
  })

  it("the Advances segment: running advances with months left; requests waiting, with Finance, unpaid or lately declined", () => {
    const pays = new Map<string, EmployeePay>([
      ["e1", pay("e1", 3_000, { advance: { amount: 1_000, balance: 595, instalment: 405 } })],
      ["e2", pay("e2", 3_000, { advance: null })],
    ])
    expect(outstandingAdvances([emp("e1"), emp("e2")], pays)).toEqual([{ employeeId: "e1", no: 1, name: "e1", amount: 1_000, balance: 595, instalment: 405, monthsLeft: 2 }])
    const req = (id: string, state: HrRequest["state"], over: object = {}) => ({ id, kind: "advance", state, createdAt: `2026-10-0${id.slice(1)}`, ...over }) as unknown as HrRequest
    const list = advanceRequestsInView(
      [req("r1", "pending"), req("r2", "finance"), req("r3", "approved"), req("r4", "approved", { payout: { date: "2026-10-04" } }), req("r5", "declined", { decision: { at: "2026-06-01" } }), req("r6", "declined", { decision: { at: "2026-10-01" } }), { ...req("r7", "pending"), kind: "leave" } as HrRequest],
      "2026-10-05"
    )
    expect(list.map((x) => x.id)).toEqual(["r6", "r3", "r2", "r1"])
  })
})

describe("the month before its payroll (PY-02) and the EOS provision (PY-09)", () => {
  it("the contract estimate is the wage of everyone on the month; recorded through is the earliest last sheet", () => {
    const pays = new Map<string, EmployeePay>([["e1", pay("e1", 3_000)], ["e2", pay("e2", 4_000)]])
    expect(contractEstimate([emp("e1"), emp("e2", { join: "2026-09-02" })], pays, M)).toBe(3_750)
    expect(recordedThrough([wm("s1", { "2026-08-03": sheet([]), "2026-08-05": sheet([]) }), wm("s2", { "2026-08-04": sheet([]) })], ["s1", "s2"])).toBe("2026-08-04")
    expect(recordedThrough([wm("s1", {})], ["s1"])).toBeNull()
    expect(payrollOpensOn(M)).toBe("2026-09-01")
    expect(daysAfterPayDay(M, 5, "2026-09-07")).toBe(2)
    expect(daysAfterPayDay(M, 5, "2026-09-03")).toBe(0)
  })

  it("the EOS reconciliation compares today's gratuity of everyone in service with the provision's balance", () => {
    const pays = new Map<string, EmployeePay>([["e1", pay("e1", 3_000)], ["e2", pay("e2", 4_000)]])
    const employees = [emp("e1", { join: "2020-01-01" }), emp("e2", { status: "left", lastDay: "2026-01-31" })]
    const ledger = creditBalance(
      [
        { lines: [{ account: "220201", credit: 5_000 }, { account: "510201", debit: 5_000 }] },
        { lines: [{ account: "220201", debit: 1_000 }] },
      ],
      "220201"
    )
    expect(ledger).toBe(4_000)
    const x = eosReconciliation(employees, pays, "2026-10-05", ledger)
    expect(x.people).toBe(1)
    expect(x.accrued).toBe(gratuity(3_750, "2020-01-01", "2026-10-05", "termination_notice"))
    expect(x.difference).toBe(r(x.accrued - 4_000))
    expect(eosReconciliation(employees, pays, "2026-10-05", null).difference).toBeNull()
  })
})

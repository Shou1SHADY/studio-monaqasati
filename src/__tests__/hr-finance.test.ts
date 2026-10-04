/**
 * HR 1.0 — Finance's side (§7.2–7.4): hr:PAY and hr:EOS post balanced entries
 * once; the transfer leaves held lines in salaries payable; a returned transfer
 * is owed again and its IBAN goes to payroll, then to the HR manager — never
 * the same hand — before Finance pays the line; an advance is paid out once.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { ACC } from "@/lib/accounting/accounts"
import { hrAllowed, type HrContext, type HrRole } from "@/lib/hr/access"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { approveIban, fixIban } from "@/lib/hr/employee-writes"
import { markReturned, owedLines, payAdvance, payHeldLine, postHrEvent, recordPayrollPaid, returnableLines, transferAmount, type FinancePayroll, type HrEvent } from "@/lib/hr/finance-writes"
import { computePayroll, payrollTotals, type Payroll } from "@/lib/hr/payroll"
import { approvePayroll, preparePayroll } from "@/lib/hr/payroll-writes"
import type { HrRequest } from "@/lib/hr/requests"
import type { HrSite } from "@/lib/hr/sites"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const M = "2026-08"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm" })
const po = ctx(["payroll"], { uid: "po" })
const fin = { uid: "fin", name: "Fin", allowed: true }
const books = { accountingOn: true, date: "2026-09-05" }

const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: ORG, no: Number(id.slice(1)), names: { ar: id }, nationality: "eg", gender: "m", idNo: id, trade: "mason", category: "labour", siteId: "s1", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31" }, status: "active", docs: {}, leaveTaken: 0, ...over }) as HrEmployee
const employees = [emp("e1"), emp("e2", { siteId: "hq" })]
const pays = new Map<string, EmployeePay>([
  ["e1", { employeeId: "e1", organizationId: ORG, basic: 3_000, housing: 750, transport: 300, iban: "SA0000000000000000000001", ibanState: "ok" }],
  ["e2", { employeeId: "e2", organizationId: ORG, basic: 4_000, housing: 1_000, transport: 400, iban: "SA0000000000000000000002", ibanState: "returned" }],
])
const sites: HrSite[] = [
  { id: "s1", organizationId: ORG, name: "Tower", type: "project", projectId: "p1", active: true },
  { id: "hq", organizationId: ORG, name: "HQ", type: "hq", active: true },
]
const wm: WorkplaceMonth = { id: `${ORG}__s1__${M}`, organizationId: ORG, siteId: "s1", month: M, days: {}, declarations: [], closed: { by: "s", byName: null, at: "", asIs: false, missing: [] } }
const payroll = () => ({ id: `${ORG}__${M}`, ...(readDoc(`hrPayrolls/${ORG}__${M}`) as Omit<Payroll, "id">) }) as Payroll & { returned?: Record<string, unknown>; paidHeld?: Record<string, unknown> }
const event = (key: string) => ({ id: `${ORG}__${key}`, ...(readDoc(`hrEvents/${ORG}__${key}`) as Omit<HrEvent, "id">) }) as HrEvent
const journal = () => listCollection<{ sourceType: string; lines: Array<{ account: string; debit: number; credit: number }> }>("accounting_journal")

beforeEach(async () => {
  resetFakeDb()
  seed(`hrAttendance/${ORG}__s1__${M}`, wm as unknown as Record<string, unknown>)
  for (const [id, p] of pays) seed(`employeePay/${id}`, p as unknown as Record<string, unknown>)
  for (const e of employees) seed(`employees/${e.id}`, e as unknown as Record<string, unknown>)
  const { lines } = computePayroll({ month: M, employees, pays, sites, attendance: [wm], requests: [] })
  await preparePayroll(db, po, ORG, M, { uid: "po", name: "P" }, { lines, sitesToClose: ["s1"], missingPay: [] }, { today: "2026-09-02" })
  await approvePayroll(db, hrm, ORG, M, { uid: "hrm", name: "H" })
})

describe("posting and paying", () => {
  it("hr:PAY and hr:EOS post balanced entries once, to the payroll accounts, by centre", async () => {
    await expect(postHrEvent(db, { ...fin, allowed: false }, ORG, event(`hr:PAY:${M}`), books)).rejects.toMatchObject({ code: "no_role" })
    await postHrEvent(db, fin, ORG, event(`hr:PAY:${M}`), books)
    await postHrEvent(db, fin, ORG, event(`hr:EOS:${M}`), books)
    const [pay, eos] = [journal().find((j) => j.sourceType === "hr_pay")!, journal().find((j) => j.sourceType === "hr_eos")!]
    for (const e of [pay, eos]) expect(sum(e.lines, "debit")).toBeCloseTo(sum(e.lines, "credit"), 2)
    const accounts = pay.lines.map((l) => l.account)
    expect(accounts).toEqual(expect.arrayContaining([ACC.costLabour, ACC.adminSalaries, ACC.employeeAccruals, ACC.gosiPayable]))
    expect(eos.lines.map((l) => l.account)).toEqual(expect.arrayContaining([ACC.endOfServiceProvision, ACC.leaveProvision]))
    expect(payroll().state).toBe("posted")
    await expect(postHrEvent(db, fin, ORG, event(`hr:PAY:${M}`), books)).rejects.toMatchObject({ blocks: ["stale"] })
  })

  it("the transfer leaves the held line in salaries payable; paid state and event follow", async () => {
    await postHrEvent(db, fin, ORG, event(`hr:PAY:${M}`), books)
    const p = payroll()
    const t = payrollTotals(p.lines)
    expect(transferAmount(p)).toBe(Math.round((t.net - t.heldNet) * 100) / 100)
    await recordPayrollPaid(db, fin, ORG, p, books)
    expect(payroll()).toMatchObject({ state: "paid", paid: { date: "2026-09-05" } })
    expect(event(`hr:PAY:${M}`).state).toBe("paid")
    const payment = journal().find((j) => j.sourceType === "hr_pay_payment")!
    expect(sum(payment.lines, "debit")).toBe(transferAmount(p))
  })

  it("a returned transfer is owed again; payroll fixes the IBAN, the HR manager approves — then Finance pays the line", async () => {
    await postHrEvent(db, fin, ORG, event(`hr:PAY:${M}`), books)
    await recordPayrollPaid(db, fin, ORG, payroll(), books)
    await markReturned(db, fin, ORG, payroll(), "e1", "account closed", books)
    expect(readDoc<EmployeePay>("employeePay/e1")?.ibanState).toBe("returned")
    expect(journal().find((j) => j.sourceType === "hr_pay_return")).toBeTruthy()
    await expect(payHeldLine(db, fin, ORG, payroll(), "e1", books)).rejects.toMatchObject({ blocks: ["iban_not_ready"] })
    await expect(fixIban(db, po, "e1", { uid: "po", name: "P" }, "SA12")).rejects.toMatchObject({ blocks: ["bad_iban"] })
    await fixIban(db, po, "e1", { uid: "po", name: "P" }, "SA44 2000 0001 2345 6789 1234")
    await expect(approveIban(db, ctx(["manager"], { uid: "po" }), "e1", { uid: "po", name: "P" })).rejects.toMatchObject({ code: "own_request" })
    await approveIban(db, hrm, "e1", { uid: "hrm", name: "H" })
    await payHeldLine(db, fin, ORG, payroll(), "e1", books)
    expect(payroll().paidHeld?.e1).toBeTruthy()
    await expect(payHeldLine(db, fin, ORG, payroll(), "e1", books)).rejects.toMatchObject({ blocks: ["stale"] })
  })

  it("the entries of ONE line — a returned transfer, a held line paid — name no person: the payroll and the line's place only (RL-03, §3 #18)", async () => {
    await postHrEvent(db, fin, ORG, event(`hr:PAY:${M}`), books)
    await recordPayrollPaid(db, fin, ORG, payroll(), books)
    // Number the people far from their places in the payroll, so a number cannot pass for a place.
    const p = { ...payroll(), lines: payroll().lines.map((l) => ({ ...l, no: 40 + l.no })) }
    const pos = p.lines.findIndex((l) => l.employeeId === "e1") + 1
    await markReturned(db, fin, ORG, p, "e1", "account closed", books)
    await fixIban(db, po, "e1", { uid: "po", name: "P" }, "SA44 2000 0001 2345 6789 1234")
    await approveIban(db, hrm, "e1", { uid: "hrm", name: "H" })
    await payHeldLine(db, fin, ORG, { ...p, returned: payroll().returned }, "e1", books)
    const one = listCollection<{ id: string; sourceType: string; sourceId: string; description: string; lines: Array<{ note?: string }> }>("accounting_journal").filter(
      (j) => j.sourceType === "hr_pay_return" || (j.sourceType === "hr_pay_payment" && j.sourceId.includes(":held:"))
    )
    expect(one.map((j) => j.sourceId).sort()).toEqual([`${M}:L${pos}`, `${M}:held:L${pos}`].sort())
    for (const j of one) {
      const said = JSON.stringify({ id: j.id, sourceId: j.sourceId, description: j.description, notes: j.lines.map((l) => l.note ?? "") })
      for (const who of ["e1", "41", "0041"]) expect({ said, who, named: said.includes(who) }).toEqual({ said, who, named: false })
    }
  })

  it("an approved advance is paid out once — Dr employee advances, no name on the entry", async () => {
    seed("hrRequests/r1", { organizationId: ORG, no: "AV-2026/001", kind: "advance", state: "approved", employeeId: "e1", advance: { amount: 900 } })
    const r = { id: "r1", ...(readDoc("hrRequests/r1") as object) } as HrRequest
    await payAdvance(db, fin, ORG, r, books)
    const e = journal().find((j) => j.sourceType === "hr_advance") as unknown as { description: string; lines: Array<{ account: string; debit: number }> }
    expect(e.lines[0]).toMatchObject({ account: ACC.employeeAdvances, debit: 900 })
    expect(e.description).not.toContain("e1")
    await expect(payAdvance(db, fin, ORG, { ...r, payout: { at: "x" } } as HrRequest, books)).rejects.toMatchObject({ blocks: ["stale"] })
  })

  it("held and returned lines stay in view on every paid payroll, however old; a return is recorded on any of them (PY-03)", async () => {
    await postHrEvent(db, fin, ORG, event(`hr:PAY:${M}`), books)
    await recordPayrollPaid(db, fin, ORG, payroll(), books)
    // Four newer payrolls paid since — the desk used to look at the newest three only.
    const later = ["2026-09", "2026-10", "2026-11", "2026-12"].map((m) => ({ ...payroll(), id: `${ORG}__${m}`, key: m, month: m, lines: payroll().lines.map((l) => ({ ...l, held: false })), returned: {}, paidHeld: {} }))
    const all = [payroll(), ...later] as FinancePayroll[]
    expect(owedLines(all).map((h) => [h.p.key, h.employeeId])).toEqual([[M, "e2"]])
    // A transfer of August comes back in December: recorded on August, not on the newest payroll.
    expect(returnableLines(payroll()).map((l) => l.employeeId)).toEqual(["e1"])
    await markReturned(db, fin, ORG, payroll(), "e1", "account closed", books)
    expect(owedLines([payroll(), ...later] as FinancePayroll[]).map((h) => [h.p.key, h.employeeId, h.reason])).toEqual([
      [M, "e1", "account closed"],
      [M, "e2", null],
    ])
    expect(returnableLines(payroll())).toEqual([])
  })

  it("the owner of a company with no payroll officer fixes a returned IBAN and approves it (AC-04)", async () => {
    const owner = ctx(["manager", "management"], { uid: "own", owner: true })
    expect(hrAllowed(owner, "iban.fix")).toBe(true)
    // An HR manager who is not the owner still may not (the fix is payroll's, the approval his).
    expect(hrAllowed(hrm, "iban.fix")).toBe(false)
    await postHrEvent(db, fin, ORG, event(`hr:PAY:${M}`), books)
    await recordPayrollPaid(db, fin, ORG, payroll(), books)
    await markReturned(db, fin, ORG, payroll(), "e1", "account closed", books)
    await fixIban(db, owner, "e1", { uid: "own", name: "O" }, "SA44 2000 0001 2345 6789 1234")
    await approveIban(db, owner, "e1", { uid: "own", name: "O" })
    expect(readDoc<EmployeePay>("employeePay/e1")?.ibanState).toBe("ok")
    await payHeldLine(db, fin, ORG, payroll(), "e1", books)
    expect(payroll().paidHeld?.e1).toBeTruthy()
  })

  it("with Accounting off the payment is still recorded, straight from approved", async () => {
    await recordPayrollPaid(db, fin, ORG, payroll(), { ...books, accountingOn: false })
    expect(payroll().state).toBe("paid")
    expect(journal()).toHaveLength(0)
  })
})

function sum(lines: Array<{ debit?: number; credit?: number }>, k: "debit" | "credit") {
  return Math.round(lines.reduce((s, l) => s + (l[k] ?? 0), 0) * 100) / 100
}

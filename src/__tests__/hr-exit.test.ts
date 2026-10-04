/**
 * HR 1.0 — end of service (EX-01…05, WF-16): the gratuity by art. 84/85, no
 * settlement before Inventory clears the custody, the settlement computed —
 * gratuity, leave in cash, the last month, notice, deductions — then paid by
 * Finance in one balanced entry; the payroll stops the month the employee leaves.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { ACC } from "@/lib/accounting/accounts"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { EmployeePay } from "@/lib/hr/employee"
import { exitBlocks, exitId, gratuity, settlementQuote } from "@/lib/hr/eos"
import { serviceSpan } from "@/lib/hr/statutory"
import { approveSettlement, clearCustody, setExitTask, startExit, type HrSettlement } from "@/lib/hr/exit-writes"
import { paySettlement } from "@/lib/hr/finance-writes"
import { leaveBalance } from "@/lib/hr/leave"
import { onPayroll } from "@/lib/hr/payroll"
import type { HrSite } from "@/lib/hr/sites"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e-hrm" })
const gov = ctx(["gov"], { uid: "gro" })
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })
const sites: HrSite[] = [{ id: "s1", organizationId: ORG, name: "Tower", type: "project", projectId: "p1", active: true }]
const ID = exitId(ORG, "e1")

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { organizationId: ORG, no: 7, names: { ar: "أحمد" }, siteId: "s1", userId: "wu", nationality: "eg", join: "2020-01-01", status: "active", contract: { type: "open" }, probation: { end: "2020-03-30", decision: "confirmed" }, leaveTaken: 100 } as unknown as Record<string, unknown>)
  seed("employees/e-hrm", { organizationId: ORG, no: 2, names: { ar: "سارة" }, siteId: null, userId: "hrm", nationality: "sa", join: "2020-01-01", status: "active" } as unknown as Record<string, unknown>)
  seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 4_000, housing: 1_000, transport: 1_000, iban: "SA1", ibanState: "ok", advance: { amount: 900, balance: 300, instalment: 300 } })
})

describe("the maths", () => {
  it("art. 84 half a month for five years then a month; art. 85 fractions on resignation; nothing in probation (EX-02)", () => {
    // Joined 1 Jan 2020, last day 31 Dec 2026: seven calendar years exactly.
    expect(gratuity(6_000, "2020-01-01", "2026-12-31", "contract_end")).toBe(6_000 * (2.5 + 2))
    // Three years and one day.
    expect(gratuity(6_000, "2023-01-01", "2026-01-01", "resignation")).toBeCloseTo(6_000 * 0.5 * (3 + 1 / 365) * (1 / 3), 2)
    expect(gratuity(6_000, "2026-01-01", "2026-02-01", "probation")).toBe(0)
  })

  it("service is counted by the calendar: two years end on the second anniversary, leap day or not (EX-01/02)", () => {
    // Joined 1 Mar 2024, resigned with 28 Feb 2026 his last day: two full years — art. 85's third is due.
    // (days ÷ 365 made it 729/365 = 1.997 years and nothing was due.)
    expect(serviceSpan("2024-03-01", "2026-02-28")).toEqual({ years: 2, months: 0, days: 0 })
    expect(gratuity(6_000, "2024-03-01", "2026-02-28", "resignation")).toBe(2_000)
    expect(gratuity(6_000, "2024-03-01", "2026-02-27", "resignation")).toBe(0)
    expect(serviceSpan("2024-01-31", "2024-03-15")).toEqual({ years: 0, months: 1, days: 16 })
  })

  it("art. 77 on a fixed term is the rest of the contract, read from its end date — never typed (EX-01)", () => {
    const base = { wage: 6_000, join: "2024-01-01", lastDay: "2026-09-30", reason: "termination_notice" as const, leaveTaken: 0, art77: true, lastMonth: null }
    // 273 days left to 30 Jun 2027 → 6,000 / 30 × 273
    expect(settlementQuote({ ...base, contract: { type: "fixed", end: "2027-06-30" } }, leaveBalance)).toMatchObject({ art77: 54_600, art77Days: 273 })
    // Ten days left: never below two months' wage.
    expect(settlementQuote({ ...base, contract: { type: "fixed", end: "2026-10-10" } }, leaveBalance).art77).toBe(12_000)
    // Open contract: 15 days a year (2y 9m → 2.75 × 3,000 = 8,250), floor two months.
    expect(settlementQuote({ ...base, contract: { type: "open" } }, leaveBalance).art77).toBe(12_000)
  })

  it("the settlement: gratuity + leave in cash + the last month's pay + notice − advance − custody", () => {
    const lastMonth = { days: 15, net: 2_900, gosiEmployee: 0, gosiEmployer: 50, penalties: 0, cost: 3_050 }
    const s = settlementQuote({ wage: 6_000, join: "2020-01-01", lastDay: "2026-09-15", reason: "termination_pay", leaveTaken: 100, advanceBalance: 300, custodyShortfall: 250, lastMonth }, leaveBalance)
    expect(s.lastMonthDays).toBe(15)
    expect(s.lastPay).toBe(2_900)
    expect(s.noticePay).toBe(12_000)
    expect(s.leaveCash).toBe(Math.round((6_000 / 30) * s.leaveDays * 100) / 100)
    expect(s.net).toBe(Math.round((s.gross - 550) * 100) / 100)
  })

  it("exit reasons are checked: contract end needs a fixed contract; probation only inside it", () => {
    const emp = { join: "2020-01-01", status: "active", probation: { end: "2020-03-30", decision: "confirmed" }, contract: { type: "open" } }
    expect(exitBlocks(emp, { reason: "contract_end", lastDay: "2026-09-15" })).toEqual(["contract_open"])
    expect(exitBlocks(emp, { reason: "probation", lastDay: "2026-09-15" })).toEqual(["probation_over"])
  })

  it("payroll stops the month of the last day — the settlement pays it (EX-05)", () => {
    const e = { join: "2020-01-01", status: "leaving" as const, lastDay: "2026-09-15" }
    expect(onPayroll(e, "2026-08")).toBe(true)
    expect(onPayroll(e, "2026-09")).toBe(false)
  })
})

describe("the flow", () => {
  it("no settlement before Inventory clears the custody; then approved, sent, paid in one balanced entry", async () => {
    await expect(startExit(db, hrm, ORG, who(hrm), "e-hrm", { reason: "resignation", lastDay: "2026-09-15" })).rejects.toMatchObject({ code: "own_request" })
    await startExit(db, hrm, ORG, who(hrm), "e1", { reason: "resignation", lastDay: "2026-09-15", noticeOn: "2026-08-15" })
    expect(readDoc("employees/e1")).toMatchObject({ status: "leaving", lastDay: "2026-09-15" })
    expect(readDoc(`hrExits/${ID}`)).toMatchObject({ state: "leaving", custody: { state: "requested" } })
    await expect(approveSettlement(db, hrm, ORG, who(hrm), ID, { sites, attendance: [], requests: [], violations: [] }, { today: "2026-09-16" })).rejects.toMatchObject({ blocks: ["custody"] })
    await expect(clearCustody(db, { uid: "x", name: null, allowed: false }, ID, {})).rejects.toMatchObject({ code: "no_role" })
    await clearCustody(db, { uid: "wh", name: "Store", allowed: true }, ID, { shortfall: 250, note: "drill missing" })
    const s = await approveSettlement(db, hrm, ORG, who(hrm), ID, { sites, attendance: [], requests: [], violations: [] }, { today: "2026-09-16" })
    expect(s).toMatchObject({ advance: 300, custody: 250 })
    expect(readDoc<{ status: string }>("employees/e1")?.status).toBe("left")
    expect(readDoc<EmployeePay>("employeePay/e1")?.advance).toBeNull()
    expect(readDoc(`hrEvents/${ORG}__hr:FS:7`)).toMatchObject({ kind: "FS", state: "sent" })

    await setExitTask(db, gov, who(gov), ID, "gosi", true)
    expect((readDoc(`hrExits/${ID}`) as { tasks: Record<string, unknown> }).tasks.gosi).toBeTruthy()

    const st = { id: ID, ...(readDoc(`hrSettlements/${ID}`) as Omit<HrSettlement, "id">) } as HrSettlement
    await paySettlement(db, { uid: "fin", name: "F", allowed: true }, ORG, st, { accountingOn: true, date: "2026-09-20" })
    const entry = listCollection<{ sourceType: string; description: string; lines: Array<{ account: string; debit?: number; credit?: number }> }>("accounting_journal").find((j) => j.sourceType === "hr_settlement")!
    const dr = entry.lines.reduce((x, l) => x + (l.debit ?? 0), 0)
    const cr = entry.lines.reduce((x, l) => x + (l.credit ?? 0), 0)
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100))
    expect(entry.lines.map((l) => l.account)).toEqual(expect.arrayContaining([ACC.endOfServiceProvision, ACC.leaveProvision, ACC.costLabour, ACC.employeeAdvances, ACC.sundryIncome]))
    expect(entry.description).not.toContain("أحمد")
    expect(readDoc<{ state: string }>(`hrExits/${ID}`)?.state).toBe("paid")
    expect(readDoc<{ state: string }>(`hrSettlements/${ID}`)?.state).toBe("paid")
  })

  it("the last month is a payroll line up to the last day — join date, absence, GOSI — and posts balanced (EX-04)", async () => {
    seed("employees/e2", { organizationId: ORG, no: 8, names: { ar: "فهد" }, siteId: "s1", userId: null, nationality: "sa", join: "2026-09-10", status: "active", contract: { type: "open" }, probation: { end: "2026-12-08" }, leaveTaken: 0 } as unknown as Record<string, unknown>)
    seed("employeePay/e2", { employeeId: "e2", organizationId: ORG, basic: 4_000, housing: 1_000, transport: 1_000, iban: "SA2", ibanState: "ok" })
    const sheet = (ex: Record<string, object> = {}) => ({ by: "sup", byName: "S", at: "", listed: ["e2"], ex })
    const attendance = [{ id: `${ORG}__s1__2026-09`, organizationId: ORG, siteId: "s1", month: "2026-09", days: { "2026-09-13": sheet(), "2026-09-14": sheet({ e2: { status: "absent" } }), "2026-09-25": sheet({ e2: { status: "absent" } }) }, declarations: [], closed: null }]
    await startExit(db, hrm, ORG, who(hrm), "e2", { reason: "probation", lastDay: "2026-09-20" })
    await clearCustody(db, { uid: "wh", name: "Store", allowed: true }, exitId(ORG, "e2"), {})
    const s = await approveSettlement(db, hrm, ORG, who(hrm), exitId(ORG, "e2"), { sites, attendance: attendance as never, requests: [], violations: [] }, { today: "2026-09-22" })
    // 10–20 Sept = 11 days: 6,000 × 11/30 = 2,200 − one absence (200; the 25th is after the last day) = 2,000;
    // GOSI new scheme 10.25% of 5,000 × 11/30 = 187.92 → 1,812.08 (the old way: 20 × 200 = 4,000).
    expect(s).toMatchObject({ lastMonthDays: 11, lastPay: 1_812.08, lastGosiEmployee: 187.92, gratuity: 0 })
    const st = { id: exitId(ORG, "e2"), ...(readDoc(`hrSettlements/${exitId(ORG, "e2")}`) as Omit<HrSettlement, "id">) } as HrSettlement
    await paySettlement(db, { uid: "fin", name: "F", allowed: true }, ORG, st, { accountingOn: true, date: "2026-09-25" })
    const entry = listCollection<{ sourceType: string; lines: Array<{ account: string; debit?: number; credit?: number }> }>("accounting_journal").find((j) => j.sourceType === "hr_settlement")!
    const sum = (k: "debit" | "credit") => Math.round(entry.lines.reduce((x, l) => x + (l[k] ?? 0), 0) * 100)
    expect(sum("debit")).toBe(sum("credit"))
    // Both GOSI shares are owed to GOSI: 10.25% + 12.25% of 1,833.33.
    expect(entry.lines.find((l) => l.account === ACC.gosiPayable)?.credit).toBe(412.5)
  })

  it("a last day in a month whose payroll already paid him: that month is not paid again; later paid months are named (EX-04)", async () => {
    const line = () => ({ employeeId: "e1", no: 7, net: 5_000 })
    seed(`hrPayrolls/${ORG}__2026-08`, { organizationId: ORG, month: "2026-08", key: "2026-08", kind: "main", state: "paid", lines: [line()] })
    seed(`hrPayrolls/${ORG}__2026-09`, { organizationId: ORG, month: "2026-09", key: "2026-09", kind: "main", state: "approved", lines: [line()] })
    await startExit(db, hrm, ORG, who(hrm), "e1", { reason: "resignation", lastDay: "2026-08-20" })
    await clearCustody(db, { uid: "wh", name: "Store", allowed: true }, ID, {})
    const s = await approveSettlement(db, hrm, ORG, who(hrm), ID, { sites, attendance: [], requests: [], violations: [] }, { today: "2026-10-05" })
    expect(s).toMatchObject({ lastPay: 0, lastMonthPaid: true })
    expect(readDoc(`hrSettlements/${ID}`)).toMatchObject({ lastPay: 0, paidAfter: ["2026-09"] })
  })

  it("an exit is started once", async () => {
    await startExit(db, hrm, ORG, who(hrm), "e1", { reason: "resignation", lastDay: "2026-09-15" })
    await expect(startExit(db, hrm, ORG, who(hrm), "e1", { reason: "resignation", lastDay: "2026-09-15" })).rejects.toMatchObject({ blocks: ["left"] })
  })
})


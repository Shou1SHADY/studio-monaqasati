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
    expect(gratuity(6_000, "2020-01-01", "2026-12-31", "contract_end")).toBeCloseTo(6_000 * (2.5 + 2.0027), 0)
    expect(gratuity(6_000, "2023-01-01", "2026-01-01", "resignation")).toBeCloseTo(6_000 * 0.5 * 3.0027 * (1 / 3), 0)
    expect(gratuity(6_000, "2026-01-01", "2026-02-01", "probation")).toBe(0)
  })

  it("the settlement: gratuity + leave in cash + the last month's days + notice − advance − custody", () => {
    const s = settlementQuote({ wage: 6_000, join: "2020-01-01", lastDay: "2026-09-15", reason: "termination_pay", leaveTaken: 100, advanceBalance: 300, custodyShortfall: 250 }, leaveBalance)
    expect(s.lastMonthDays).toBe(15)
    expect(s.lastPay).toBe(3_000)
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
    await expect(approveSettlement(db, hrm, ORG, who(hrm), ID, { sites })).rejects.toMatchObject({ blocks: ["custody"] })
    await expect(clearCustody(db, { uid: "x", name: null, allowed: false }, ID, {})).rejects.toMatchObject({ code: "no_role" })
    await clearCustody(db, { uid: "wh", name: "Store", allowed: true }, ID, { shortfall: 250, note: "drill missing" })
    const s = await approveSettlement(db, hrm, ORG, who(hrm), ID, { sites })
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

  it("an exit is started once", async () => {
    await startExit(db, hrm, ORG, who(hrm), "e1", { reason: "resignation", lastDay: "2026-09-15" })
    await expect(startExit(db, hrm, ORG, who(hrm), "e1", { reason: "resignation", lastDay: "2026-09-15" })).rejects.toMatchObject({ blocks: ["left"] })
  })
})


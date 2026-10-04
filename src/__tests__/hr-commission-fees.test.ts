/**
 * HR 1.0 — what was approved elsewhere and reaches the money: the commission
 * Sales approved goes on the month's payroll line, or — that payroll already
 * approved — on its supplementary (PY-01); a renewal's fee goes to Finance as
 * a payment request hr:PR and is paid there once, Dr government & recruitment
 * fees (DC-03, HR-Pipeline §2.1).
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { ACC } from "@/lib/accounting/accounts"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { feeEventKey, recordCommission, recordRenewal } from "@/lib/hr/employee-writes"
import { payFeeRequest, type HrFeeEvent } from "@/lib/hr/finance-writes"
import { settlementLastMonth } from "@/lib/hr/exit-writes"
import { computePayroll, computeSupplementary, payEvent, eventBalances, type Payroll } from "@/lib/hr/payroll"
import type { HrSite } from "@/lib/hr/sites"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e-hrm" })
const gov = ctx(["gov"], { uid: "gro" })
const sites: HrSite[] = [{ id: "hq", organizationId: ORG, name: "HQ", type: "hq", active: true }]
const e1 = { id: "e1", organizationId: ORG, no: 12, names: { ar: "أحمد" }, nationality: "eg", gender: "m", idNo: "1", trade: "mason", category: "labour", siteId: "hq", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31" }, status: "active", docs: { iqama: "2026-11-01", passport: "2040-01-01" }, leaveTaken: 0 } as HrEmployee
const pay0: EmployeePay = { employeeId: "e1", organizationId: ORG, basic: 3_000, housing: 750, transport: 300, iban: "SA0000000000000000000001", ibanState: "ok" }
const payDoc = () => readDoc<EmployeePay>("employeePay/e1") as EmployeePay
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", e1 as unknown as Record<string, unknown>)
  seed("employeePay/e1", pay0 as unknown as Record<string, unknown>)
})

describe("commission (PY-01)", () => {
  it("reaches the month's payroll line, in the gross, not in the GOSI base", async () => {
    await recordCommission(db, hrm, "e1", who(hrm), { month: "2026-09", amount: 1_250, reason: "Sales Q3 approval SA-77" }, { today: "2026-10-01" })
    const [line] = computePayroll({ month: "2026-09", employees: [e1], pays: new Map([["e1", payDoc()]]), sites, attendance: [], requests: [] }).lines
    expect(line.commission).toBe(1_250)
    expect(line.gross).toBe(4_050 + 1_250)
    expect(line.gosiEmployer).toBe(75) // 2% of 3,750 — unchanged by the commission
    expect(line.commissionIds).toHaveLength(1)
    // Not another month's.
    expect(computePayroll({ month: "2026-10", employees: [e1], pays: new Map([["e1", payDoc()]]), sites, attendance: [], requests: [] }).lines[0].commission).toBe(0)
    // The log names the month, never the amount (RL-03).
    const log = listCollection<{ kind: string; params: Record<string, unknown> }>("employees/e1/log").find((l) => l.kind === "commission_recorded")
    expect(log?.params).toEqual({ month: "2026-09", reason: "Sales Q3 approval SA-77" })
  })

  it("approved after the month's payroll: on its supplementary, as cost; never one's own; never a future month", async () => {
    const [line] = computePayroll({ month: "2026-09", employees: [e1], pays: new Map([["e1", pay0]]), sites, attendance: [], requests: [] }).lines
    const main = { state: "approved", lines: [line] } as Pick<Payroll, "state" | "lines">
    await recordCommission(db, hrm, "e1", who(hrm), { month: "2026-09", amount: 800, reason: "late approval SA-80" }, { today: "2026-10-06" })
    const sup = computeSupplementary({ month: "2026-09", employees: [e1], pays: new Map([["e1", payDoc()]]), sites, main })
    expect(sup).toEqual([expect.objectContaining({ commission: 800, net: 800 })])
    const ev = payEvent({ key: "2026-09-D", month: "2026-09", kind: "supplementary", lines: [], supplementary: sup })
    expect(ev.debit.reduce((s, d) => s + d.amount, 0)).toBe(800)
    expect(eventBalances(ev)).toBe(true)
    await expect(recordCommission(db, ctx(["manager"], { uid: "x", employeeId: "e1" }), "e1", who(hrm), { month: "2026-09", amount: 1, reason: "r" })).rejects.toMatchObject({ code: "own_request" })
    await expect(recordCommission(db, hrm, "e1", who(hrm), { month: "2026-11", amount: 1, reason: "r" }, { today: "2026-10-06" })).rejects.toMatchObject({ blocks: ["future_month"] })
  })
})

describe("a leaver's last-month commission (PY-01, EX-04)", () => {
  it("is paid by his settlement — and not again by a supplementary of a payroll he was not on", async () => {
    await recordCommission(db, hrm, "e1", who(hrm), { month: "2026-09", amount: 500, reason: "SA-90" }, { today: "2026-09-20" })
    const leaver = { ...e1, status: "leaving", lastDay: "2026-09-15" } as HrEmployee
    const last = settlementLastMonth(leaver, payDoc(), "2026-09-15", { sites, attendance: [], requests: [], violations: [] })
    // 15 days: 4,050 × 15/30 = 2,025 + 500 commission − 2% employer only (non-Saudi: no employee share)
    expect(last?.net).toBe(2_525)
    const main = { state: "approved", lines: [] } as Pick<Payroll, "state" | "lines">
    expect(computeSupplementary({ month: "2026-09", employees: [leaver], pays: new Map([["e1", payDoc()]]), sites, main })).toEqual([])
  })
})

describe("a renewal's fee goes to Finance (DC-03)", () => {
  it("government relations records the renewal; hr:PR waits for Finance, which pays it once to government fees", async () => {
    await recordRenewal(db, gov, "e1", who(gov), { type: "iqama", expiry: "2038-11-01", fee: 650 })
    const key = feeEventKey(12, "iqama", "2038-11-01")
    expect(key).toBe("hr:PR:DOC:12:iqama:2038-11-01")
    const doc = readDoc<HrFeeEvent>(`hrEvents/${ORG}__${key}`)
    expect(doc).toMatchObject({ kind: "PR", prType: "doc", amount: 650, employeeNo: 12, doc: "iqama", state: "sent" })
    const ev = { ...(doc as HrFeeEvent), id: `${ORG}__${key}` }
    await expect(payFeeRequest(db, { uid: "x", name: null, allowed: false }, ORG, ev, { accountingOn: true, date: "2026-10-07" })).rejects.toMatchObject({ code: "no_role" })
    await payFeeRequest(db, { uid: "fin", name: "F", allowed: true }, ORG, ev, { accountingOn: true, date: "2026-10-07" })
    const entry = listCollection<{ sourceType: string; description: string; lines: Array<{ account: string; debit: number; credit: number }> }>("accounting_journal").find((j) => j.sourceType === "hr_fee")!
    expect(entry.lines).toEqual(expect.arrayContaining([expect.objectContaining({ account: ACC.govFees, debit: 650 }), expect.objectContaining({ account: ACC.bankMain, credit: 650 })]))
    expect(entry.description).not.toContain("أحمد")
    expect(readDoc(`hrEvents/${ORG}__${key}`)).toMatchObject({ state: "paid" })
    await expect(payFeeRequest(db, { uid: "fin", name: "F", allowed: true }, ORG, ev, { accountingOn: true, date: "2026-10-07" })).rejects.toMatchObject({ blocks: ["stale"] })
  })

  it("no fee, no request", async () => {
    await recordRenewal(db, gov, "e1", who(gov), { type: "passport", expiry: "2045-01-01" })
    expect(listCollection("hrEvents")).toHaveLength(0)
  })
})

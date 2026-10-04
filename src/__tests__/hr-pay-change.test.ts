/**
 * HR 1.0 — a pay change from its effective date (EM-04, WF-10) and the
 * supplementary payroll (PY-04). A future-dated raise waits for its day; a
 * mid-month one pays each wage for its days; one back-dated into the last
 * closed month — read by the write itself, never handed in by the screen —
 * sends that month's difference to a supplementary, and further back is
 * refused. What arrives after one supplementary was approved goes to the
 * next (-D2), never paid twice; a supplementary is posted on the day Finance
 * posts it, not into the closed month.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { changePay } from "@/lib/hr/employee-writes"
import { eventPostingDate, postHrEvent, type HrEvent } from "@/lib/hr/finance-writes"
import { payOn, paySegments } from "@/lib/hr/pay"
import { computePayroll, computeSupplementary, type Payroll } from "@/lib/hr/payroll"
import { approvePayroll, prepareSupplementary } from "@/lib/hr/payroll-writes"
import type { HrSite } from "@/lib/hr/sites"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm" })
const po = ctx(["payroll"], { uid: "po" })
const actor = { uid: "hrm", name: "Sara" }
const sites: HrSite[] = [{ id: "hq", organizationId: ORG, name: "HQ", type: "hq", active: true }]
const e1 = { id: "e1", organizationId: ORG, no: 1, names: { ar: "أحمد" }, nationality: "eg", gender: "m", idNo: "1", trade: "mason", category: "labour", siteId: "hq", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31" }, status: "active", docs: {}, leaveTaken: 0 } as HrEmployee
// wage 2,200 + 550 + 220 = 2,970 → with basic 2,600: 2,600 + 650 + 260 = 3,510
const pay0: EmployeePay = { employeeId: "e1", organizationId: ORG, basic: 2_200, housing: 550, transport: 220, iban: "SA0000000000000000000001", ibanState: "ok", retro: [] }
const payDoc = () => readDoc<EmployeePay>("employeePay/e1") as EmployeePay
const line = (month: string, p: EmployeePay = payDoc()) => computePayroll({ month, employees: [e1], pays: new Map([["e1", p]]), sites, attendance: [], requests: [] }).lines[0]
const approvedMain = (month: string) => {
  const lines = computePayroll({ month, employees: [e1], pays: new Map([["e1", pay0]]), sites, attendance: [], requests: [] }).lines
  seed(`hrPayrolls/${ORG}__${month}`, { organizationId: ORG, month, key: month, kind: "main", state: "approved", lines, prepared: { by: "po", byName: "P", at: "" }, approved: { by: "hrm", byName: "H", at: "" } })
}
const raise = (basic: number, effectiveOn: string, today: string) => changePay(db, hrm, "e1", actor, { basic, effectiveOn, reason: "annual review", kind: "raise" }, { today })

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", e1 as unknown as Record<string, unknown>)
  seed("employeePay/e1", pay0 as unknown as Record<string, unknown>)
})

describe("a pay change applies from its date (EM-04)", () => {
  it("a future-dated raise waits for its day: this month pays the old wage, its month the new", async () => {
    await raise(2_600, "2026-10-01", "2026-09-10")
    // In force today: the old pay, on the document as on every screen.
    expect(payDoc()).toMatchObject({ basic: 2_200, housing: 550 })
    expect(payOn(payDoc(), "2026-10-01")).toMatchObject({ basic: 2_600, housing: 650, transport: 260 })
    expect(line("2026-09").monthWage).toBe(2_970)
    expect(line("2026-10").monthWage).toBe(3_510)
  })

  it("from the middle of a month: each wage for its days, GOSI on each base", async () => {
    await raise(2_600, "2026-10-16", "2026-09-10")
    expect(paySegments(payDoc(), e1.join, "2026-10").map((s) => s.days)).toEqual([14, 16])
    const l = line("2026-10")
    // 2,970 × 14/30 + 3,510 × 16/30 = 1,386 + 1,872
    expect(l.monthWage).toBe(3_258)
    // non-Saudi: 2% employer on (basic + housing) × days / 30 → (2,750 × 14 + 3,250 × 16) / 30 × 2%
    expect(l.gosiEmployer).toBe(60.33)
  })

  it("back-dated into the last closed month — read by the write, not passed in — the difference goes to its supplementary", async () => {
    approvedMain("2026-08")
    const r = await raise(2_600, "2026-08-17", "2026-09-10")
    // 15 days of August at +540 a month → 270
    expect(r).toEqual({ retro: 270, retroMonth: "2026-08" })
    expect(payDoc().retro).toEqual([expect.objectContaining({ month: "2026-08", amount: 270 })])
    expect(payDoc()).toMatchObject({ basic: 2_600 })
    // The open month after it pays the new wage in full; August stays as approved.
    expect(line("2026-09").monthWage).toBe(3_510)
  })

  it("further back than the last closed month is refused (one closed month, PY-04)", async () => {
    approvedMain("2026-08")
    await expect(raise(2_600, "2026-07-20", "2026-09-10")).rejects.toMatchObject({ blocks: ["too_old"] })
  })

  it("into a month whose payroll is not approved yet: no retro — that payroll computes it", async () => {
    approvedMain("2026-07")
    const r = await raise(2_600, "2026-08-17", "2026-09-10")
    expect(r.retro).toBe(0)
    expect(line("2026-08").monthWage).toBe(r2(2_970 * 15 / 30 + 3_510 * 15 / 30))
  })
})

describe("the supplementary (PY-04)", () => {
  const sup = (month: string) => {
    const done = listCollection<Payroll>("hrPayrolls").filter((p) => p.kind === "supplementary" && p.month === month)
    const main = readDoc<Payroll>(`hrPayrolls/${ORG}__${month}`)
    return computeSupplementary({ month, employees: [e1], pays: new Map([["e1", payDoc()]]), sites, main, done })
  }

  it("what arrives after a supplementary was approved goes to the next key, never paid twice", async () => {
    approvedMain("2026-08")
    await raise(2_600, "2026-08-17", "2026-09-10")
    const first = sup("2026-08")
    expect(first).toEqual([expect.objectContaining({ retro: 270, net: 270 })])
    expect(await prepareSupplementary(db, po, ORG, "2026-08", { uid: "po", name: "P" }, first)).toBe("2026-08-D")
    await approvePayroll(db, hrm, ORG, "2026-08-D", actor)
    expect(payDoc().retro).toEqual([])
    // A correction back-dated into August arrives after -D went: a second difference, in -D2.
    await raise(2_700, "2026-08-17", "2026-09-12")
    const second = sup("2026-08")
    // 15 days at (3,645 − 3,510) → 67.5
    expect(second).toEqual([expect.objectContaining({ retro: 67.5, net: 67.5 })])
    expect(await prepareSupplementary(db, po, ORG, "2026-08", { uid: "po", name: "P" }, second)).toBe("2026-08-D2")
    // The first one's lines cannot be paid again under the new key.
    await expect(prepareSupplementary(db, po, ORG, "2026-08", { uid: "po", name: "P" }, first)).rejects.toMatchObject({ blocks: ["stale"] })
    await approvePayroll(db, hrm, ORG, "2026-08-D2", actor)
    expect(readDoc(`hrEvents/${ORG}__hr:PAY:2026-08-D2`)).toMatchObject({ kind: "PAY", credit: { salariesPayable: 67.5 } })
    expect(readDoc(`hrEvents/${ORG}__hr:PAY:2026-08-D`)).toMatchObject({ credit: { salariesPayable: 270 } })
  })

  it("is posted on the day Finance posts it — the closed month's period is never reopened", async () => {
    approvedMain("2026-08")
    await raise(2_600, "2026-08-17", "2026-09-10")
    await prepareSupplementary(db, po, ORG, "2026-08", { uid: "po", name: "P" }, sup("2026-08"))
    await approvePayroll(db, hrm, ORG, "2026-08-D", actor)
    // August is locked in the books.
    seed(`accounting_periods/${ORG}__2026-08`, { organizationId: ORG, period: "2026-08", status: "closed" })
    const ev = { id: `${ORG}__hr:PAY:2026-08-D`, ...(readDoc(`hrEvents/${ORG}__hr:PAY:2026-08-D`) as Omit<HrEvent, "id">) } as HrEvent
    expect(eventPostingDate(ev, "2026-09-20")).toBe("2026-09-20")
    expect(eventPostingDate({ kind: "PAY", month: "2026-08", payrollKey: "2026-08" }, "2026-09-20")).toBe("2026-08-31")
    await postHrEvent(db, { uid: "fin", name: "F", allowed: true }, ORG, ev, { accountingOn: true, date: "2026-09-20" })
    const entry = listCollection<{ sourceType: string; date: string }>("accounting_journal").find((j) => j.sourceType === "hr_pay")
    expect(entry?.date).toBe("2026-09-20")
  })
})

function r2(n: number) {
  return Math.round(n * 100) / 100
}

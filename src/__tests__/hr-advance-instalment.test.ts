/**
 * HR 1.0 — the advance instalment (AD-01, WF-08 step 4): taken back from the
 * month after Finance paid the advance out (fin:PRPAID), never on approval
 * alone; one brought in by the import runs from the import month (§21 edge
 * case); and taken once — a month computed on a balance another month's
 * approval has since taken is recomputed before it is approved.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { computePayroll } from "@/lib/hr/payroll"
import { approvePayroll, preparePayroll } from "@/lib/hr/payroll-writes"
import type { HrRequest } from "@/lib/hr/requests"
import type { HrSite } from "@/lib/hr/sites"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm" })
const po = ctx(["payroll"], { uid: "po" })
const sites: HrSite[] = [{ id: "hq", organizationId: ORG, name: "HQ", type: "hq", active: true }]
const e1 = { id: "e1", organizationId: ORG, no: 1, names: { ar: "أحمد" }, nationality: "eg", gender: "m", idNo: "1", trade: "mason", category: "labour", siteId: "hq", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31" }, status: "active", docs: {}, leaveTaken: 0 } as HrEmployee
// wage 3,000 → instalment 300
const pay: EmployeePay = { employeeId: "e1", organizationId: ORG, basic: 2_222.22, housing: 555.56, transport: 222.22, iban: "SA0000000000000000000001", ibanState: "ok", advance: { amount: 600, balance: 600, instalment: 300 } }
const advance = (over: Partial<HrRequest> & { payout?: { date: string } } = {}) =>
  ({ id: "r1", organizationId: ORG, no: "AV-2026/001", kind: "advance", employeeId: "e1", state: "approved", advance: { amount: 600, reason: "x", instalment: 300, months: 2, overLimit: false }, createdAt: "2026-08-20T10:00:00Z", ...over }) as HrRequest
const lineOf = (month: string, requests: HrRequest[], p: EmployeePay = pay) => computePayroll({ month, employees: [e1], pays: new Map([["e1", p]]), sites, attendance: [], requests }).lines[0]

describe("the instalment starts after the payout (AD-01)", () => {
  it("approved and not paid out: nothing is taken", () => {
    expect(lineOf("2026-08", [advance()]).advance).toBe(0)
    expect(lineOf("2026-09", [advance()]).advance).toBe(0)
  })

  it("paid out on 3 September: not September's payroll — October's", () => {
    const paid = [advance({ payout: { date: "2026-09-03" } })]
    expect(lineOf("2026-08", paid).advance).toBe(0)
    expect(lineOf("2026-09", paid).advance).toBe(0)
    expect(lineOf("2026-10", paid).advance).toBe(300)
  })

  it("an advance brought in by the import (no request) runs from the import month", () => {
    expect(lineOf("2026-08", []).advance).toBe(300)
  })
})

describe("taken once (AD-01)", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("employeePay/e1", { ...pay, advance: { amount: 600, balance: 300, instalment: 300 } } as unknown as Record<string, unknown>)
  })

  it("two months prepared on the same balance: the second is refused until recomputed", async () => {
    const p300 = { ...pay, advance: { amount: 600, balance: 300, instalment: 300 } }
    for (const m of ["2026-08", "2026-09"]) {
      const { lines } = computePayroll({ month: m, employees: [e1], pays: new Map([["e1", p300]]), sites, attendance: [], requests: [] })
      expect(lines[0].advance).toBe(300)
      await preparePayroll(db, po, ORG, m, { uid: "po", name: "P" }, { lines, sitesToClose: [], missingPay: [] }, { today: "2026-10-02" })
    }
    await approvePayroll(db, hrm, ORG, "2026-08", { uid: "hrm", name: "H" })
    expect(readDoc<EmployeePay>("employeePay/e1")?.advance).toBeNull()
    await expect(approvePayroll(db, hrm, ORG, "2026-09", { uid: "hrm", name: "H" })).rejects.toMatchObject({ blocks: ["advance_stale"] })
    // Recomputed on the balance as it is now: nothing left to take.
    const now = readDoc<EmployeePay>("employeePay/e1") as EmployeePay
    const { lines } = computePayroll({ month: "2026-09", employees: [e1], pays: new Map([["e1", now]]), sites, attendance: [], requests: [] })
    expect(lines[0].advance).toBe(0)
    await preparePayroll(db, po, ORG, "2026-09", { uid: "po", name: "P" }, { lines, sitesToClose: [], missingPay: [] }, { today: "2026-10-02" })
    await approvePayroll(db, hrm, ORG, "2026-09", { uid: "hrm", name: "H" })
    expect(readDoc(`hrPayrolls/${ORG}__2026-09`)).toMatchObject({ state: "approved" })
  })
})

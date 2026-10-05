/**
 * HR 1.0 — violations and penalties (PN-01…04, WF-09): the ladder counts
 * applied penalties only; the hearing date blocks; five days' wage a month,
 * reduced not carried; an objection within 15 days suspends it, and a
 * cancelled one never counts again; the sheet records a violation once.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import { recordDay } from "@/lib/hr/attendance-writes"
import { decideObjection, decidePenalty, objectPenalty, recordViolation } from "@/lib/hr/violation-writes"
import { applyQuote, historyOf, monthPenalties, violationId, type HrViolation } from "@/lib/hr/violations"
import { ACC } from "@/lib/accounting/accounts"
import { postHrPay } from "@/lib/accounting/posting-rules"
import type { HrEmployee } from "@/lib/hr/employee"
import { computePayroll, computeSupplementary, eventBalances, payEvent, type Payroll } from "@/lib/hr/payroll"
import { approvePayroll, preparePayroll, prepareSupplementary } from "@/lib/hr/payroll-writes"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e-hrm" })
const sup = ctx(["supervisor"], { uid: "sup", sites: ["s1"] })
const worker = ctx([], { uid: "wu", employeeId: "e1" })
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })
const V = (id: string) => ({ id, ...(readDoc(`hrViolations/${id}`) as Omit<HrViolation, "id">) }) as HrViolation
const all = () => listCollection<HrViolation>("hrViolations") as HrViolation[]

const v = (over: Partial<HrViolation>): HrViolation => ({ id: "x", organizationId: ORG, employeeId: "e1", employeeUserId: "wu", employeeName: "e1", siteId: "s1", code: "late15", on: "2026-08-01", source: "manual", state: "applied", recorded: { by: "", byName: null, at: "" }, ...over })

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { organizationId: ORG, no: 1, names: { ar: "أحمد" }, siteId: "s1", userId: "wu", nationality: "eg", join: "2025-01-01", status: "active" } as unknown as Record<string, unknown>)
  seed("employees/e-hrm", { organizationId: ORG, no: 2, names: { ar: "سارة" }, siteId: null, userId: "hrm", nationality: "sa", join: "2025-01-01", status: "active" } as unknown as Record<string, unknown>)
  seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 2_400, housing: 600, transport: 0 })
})

describe("the ladder and the cap", () => {
  it("the step counts applied same-code penalties in 180 days — not dismissed or cancelled ones (PN-01)", () => {
    const history = historyOf([v({ id: "a" }), v({ id: "b", state: "cancelled" }), v({ id: "c", state: "dismissed" }), v({ id: "d", code: "ppe" })], "e1")
    const q = applyQuote({ code: "late15", on: "2026-09-01", state: "recorded" }, { hearingOn: "2026-09-02", today: "2026-09-03", wage: 3_000, history })
    expect(q).toMatchObject({ step: 1, stepKind: "fraction", amount: 5, blocks: [] })
    expect(applyQuote({ code: "late15", on: "2027-06-01", state: "recorded" }, { hearingOn: "2027-06-02", today: "2027-06-03", wage: 3_000, history }).step).toBe(0)
  })

  it("the hearing date blocks: missing, before the violation, or in the future (PN-02)", () => {
    const base = { code: "absentDay" as const, on: "2026-09-01", state: "recorded" as const }
    const x = { today: "2026-09-03", wage: 3_000, history: [] }
    expect(applyQuote(base, { ...x, hearingOn: null }).blocks).toEqual(["no_hearing"])
    expect(applyQuote(base, { ...x, hearingOn: "2026-08-30" }).blocks).toEqual(["hearing_before"])
    expect(applyQuote(base, { ...x, hearingOn: "2026-09-05" }).blocks).toEqual(["hearing_future"])
  })

  it("five days' wage a month — reduced, not carried; an objected one waits (PN-03, PN-04)", () => {
    const list = [
      v({ id: "1", code: "fighting", amount: 300, deductMonth: "2026-09", decision: { by: "", byName: null, at: "1" } }),
      v({ id: "2", code: "absentDay", amount: 400, deductMonth: "2026-09", decision: { by: "", byName: null, at: "2" } }),
      v({ id: "3", code: "absentDay", amount: 100, deductMonth: "2026-09", state: "objected" }),
      v({ id: "4", code: "absentDay", amount: 100, deductMonth: "2026-10" }),
    ]
    expect(monthPenalties(list, "e1", "2026-09", 3_000)).toMatchObject({ total: 500, items: [{ deducted: 300 }, { deducted: 200 }] })
    expect(monthPenalties(list, "e1", "2026-10", 3_000).total).toBe(100)
  })
})

describe("the writes", () => {
  it("the supervisor's sheet records a violation once; the day is then locked, so it is never recorded twice", async () => {
    const sheet = { listed: ["e1"], ex: { e1: { violation: "ppe" as const } } }
    await recordDay(db, sup, ORG, { id: "s1", type: "project" }, "2026-09-01", who(sup), sheet, { today: "2026-09-01" })
    await expect(recordDay(db, sup, ORG, { id: "s1", type: "project" }, "2026-09-01", who(sup), sheet, { today: "2026-09-01" })).rejects.toMatchObject({ blocks: ["recorded"] })
    expect(all()).toHaveLength(1)
    expect(V(violationId(ORG, "e1", "2026-09-01", "ppe"))).toMatchObject({ source: "sheet", state: "recorded", employeeUserId: "wu" })
  })

  it("decided after a hearing by the HR manager — never his own; the objection suspends; uphold moves it to that month", async () => {
    const id = await recordViolation(db, sup, ORG, who(sup), { employeeId: "e1", code: "absentDay", on: "2026-09-01" }, { today: "2026-09-01" })
    await expect(recordViolation(db, sup, ORG, who(sup), { employeeId: "e1", code: "absentDay", on: "2026-09-01" }, { today: "2026-09-01" })).rejects.toMatchObject({ blocks: ["exists"] })
    await expect(decidePenalty(db, sup, id, who(sup), { verdict: "apply", hearingOn: "2026-09-02" }, { history: [], today: "2026-09-03" })).rejects.toMatchObject({ code: "no_role" })
    await expect(decidePenalty(db, hrm, id, who(hrm), { verdict: "apply" }, { history: [], today: "2026-09-03" })).rejects.toMatchObject({ blocks: ["no_hearing"] })
    await decidePenalty(db, hrm, id, who(hrm), { verdict: "apply", hearingOn: "2026-09-02" }, { history: [], today: "2026-09-03" })
    expect(V(id)).toMatchObject({ state: "applied", step: 0, amount: 100, deductMonth: "2026-09", notifiedOn: "2026-09-03" })
    await expect(objectPenalty(db, hrm, id, who(hrm), "no", { today: "2026-09-04" })).rejects.toMatchObject({ code: "no_role" })
    await expect(objectPenalty(db, worker, id, who(worker), "I was on leave", { today: "2026-09-25" })).rejects.toMatchObject({ blocks: ["objection_late"] })
    await objectPenalty(db, worker, id, who(worker), "I was on leave", { today: "2026-09-10" })
    expect(V(id).state).toBe("objected")
    // September's payroll is still to come: upheld, it is deducted there, in its own month.
    await decideObjection(db, hrm, id, who(hrm), "uphold", "the sheet is signed", { today: "2026-10-02" })
    expect(V(id)).toMatchObject({ state: "upheld", deductMonth: "2026-09" })
  })

  describe("an objection after the month's payroll (PN-03/04)", () => {
    const sites = [{ id: "s1", organizationId: ORG, name: "Tower", type: "project" as const, projectId: "p1", active: true }]
    const e1 = { id: "e1", organizationId: ORG, no: 1, names: { ar: "أحمد" }, siteId: "s1", userId: "wu", nationality: "eg", join: "2025-01-01", status: "active", contract: { type: "open" }, probation: { end: "2025-03-31" }, docs: {}, leaveTaken: 0 } as unknown as HrEmployee
    const pay = { employeeId: "e1", organizationId: ORG, basic: 2_400, housing: 600, transport: 0, iban: "SA0000000000000000000001", ibanState: "ok" as const }
    const wm = { id: `${ORG}__s1__2026-09`, organizationId: ORG, siteId: "s1", month: "2026-09", days: {}, declarations: [], closed: { by: "s", byName: null, at: "", asIs: false, missing: [] } }
    const payroll = ctx(["payroll"], { uid: "po" })
    // Applied on 25 Sept (deducted in September), September's payroll approved on 2 Oct, objected on 5 Oct.
    async function deductedThenObjected() {
      const id = await recordViolation(db, hrm, ORG, who(hrm), { employeeId: "e1", code: "absentDay", on: "2026-09-20" }, { today: "2026-09-20" })
      await decidePenalty(db, hrm, id, who(hrm), { verdict: "apply", hearingOn: "2026-09-24" }, { history: [], today: "2026-09-25" })
      seed(`hrAttendance/${ORG}__s1__2026-09`, wm as unknown as Record<string, unknown>)
      const { lines } = computePayroll({ month: "2026-09", employees: [e1], pays: new Map([["e1", pay]]), sites, attendance: [wm], requests: [], violations: all() })
      expect(lines[0].penalties).toBe(100)
      await preparePayroll(db, payroll, ORG, "2026-09", who(payroll), { lines, sitesToClose: ["s1"], missingPay: [] }, { today: "2026-10-01" })
      await approvePayroll(db, ctx(["manager"], { uid: "hrm2" }), ORG, "2026-09", who(hrm))
      await objectPenalty(db, worker, id, who(worker), "I was sick", { today: "2026-10-05" })
      return id
    }

    it("upheld: September's deduction stands — October takes nothing again", async () => {
      const id = await deductedThenObjected()
      await decideObjection(db, hrm, id, who(hrm), "uphold", "no sick note", { today: "2026-10-08" })
      expect(V(id)).toMatchObject({ state: "upheld", deductMonth: "2026-09" })
      expect(monthPenalties(all(), "e1", "2026-10", 3_000).total).toBe(0)
    })

    it("cancelled: what September deducted is paid back by September's supplementary, out of the fines fund", async () => {
      const id = await deductedThenObjected()
      await decideObjection(db, hrm, id, who(hrm), "cancel", "sick note produced", { today: "2026-10-08" })
      const main = readDoc<Payroll>(`hrPayrolls/${ORG}__2026-09`)
      const sup = computeSupplementary({ month: "2026-09", employees: [e1], pays: new Map([["e1", pay]]), sites, main, violations: all() })
      expect(sup).toEqual([expect.objectContaining({ employeeId: "e1", refunds: 100, net: 100, items: [{ kind: "refund", id, amount: 100 }] })])
      const ev = payEvent({ key: "2026-09-D", month: "2026-09", kind: "supplementary", lines: [], supplementary: sup })
      expect(ev.credit).toMatchObject({ salariesPayable: 100, fines: -100 })
      expect(eventBalances(ev)).toBe(true)
      const entry = postHrPay({ key: ev.key, month: "2026-09", date: "2026-10-10", debit: ev.debit, credit: ev.credit })
      expect(entry.lines).toEqual(expect.arrayContaining([expect.objectContaining({ account: ACC.finesFund, debit: 100 }), expect.objectContaining({ account: ACC.employeeAccruals, credit: 100 })]))
      expect(entry.empty).toBe(false)
      // Approved once, it is not paid back a second time.
      await prepareSupplementary(db, payroll, ORG, "2026-09", who(payroll), sup)
      await approvePayroll(db, ctx(["manager"], { uid: "hrm2" }), ORG, "2026-09-D", who(hrm))
      const done = listCollection<Payroll>("hrPayrolls").filter((p) => p.kind === "supplementary")
      expect(computeSupplementary({ month: "2026-09", employees: [e1], pays: new Map([["e1", pay]]), sites, main, done, violations: all() })).toEqual([])
    })

    it("upheld after it waited — September's payroll went without it — it is deducted in the month decided", async () => {
      const id = await recordViolation(db, hrm, ORG, who(hrm), { employeeId: "e1", code: "absentDay", on: "2026-09-20" }, { today: "2026-09-20" })
      await decidePenalty(db, hrm, id, who(hrm), { verdict: "apply", hearingOn: "2026-09-24" }, { history: [], today: "2026-09-25" })
      await objectPenalty(db, worker, id, who(worker), "I was sick", { today: "2026-09-28" })
      const { lines } = computePayroll({ month: "2026-09", employees: [e1], pays: new Map([["e1", pay]]), sites, attendance: [wm], requests: [], violations: all() })
      expect(lines[0].penalties).toBe(0)
      seed(`hrAttendance/${ORG}__s1__2026-09`, wm as unknown as Record<string, unknown>)
      await preparePayroll(db, payroll, ORG, "2026-09", who(payroll), { lines, sitesToClose: ["s1"], missingPay: [] }, { today: "2026-10-01" })
      await approvePayroll(db, ctx(["manager"], { uid: "hrm2" }), ORG, "2026-09", who(hrm))
      await decideObjection(db, hrm, id, who(hrm), "uphold", "no sick note", { today: "2026-10-08" })
      expect(V(id)).toMatchObject({ state: "upheld", deductMonth: "2026-10" })
    })
  })

  it("the HR manager's own violation is not his to decide", async () => {
    const id = await recordViolation(db, hrm, ORG, who(hrm), { employeeId: "e-hrm", code: "late15", on: "2026-09-01" }, { today: "2026-09-01" })
    await expect(decidePenalty(db, hrm, id, who(hrm), { verdict: "dismiss", note: "x" }, { history: [], today: "2026-09-02" })).rejects.toMatchObject({ code: "own_request" })
  })

  it("a dismissal needs its reason", async () => {
    const id = await recordViolation(db, hrm, ORG, who(hrm), { employeeId: "e1", code: "ppe", on: "2026-09-01" }, { today: "2026-09-01" })
    await expect(decidePenalty(db, hrm, id, who(hrm), { verdict: "dismiss" }, { history: [], today: "2026-09-02" })).rejects.toMatchObject({ blocks: ["no_reason"] })
  })
})

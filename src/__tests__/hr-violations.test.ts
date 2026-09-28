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
  it("the supervisor's sheet records a violation once; saving the sheet again does not duplicate it", async () => {
    const sheet = { listed: ["e1"], ex: { e1: { violation: "ppe" as const } } }
    await recordDay(db, sup, ORG, { id: "s1", type: "project" }, "2026-09-01", who(sup), sheet, { today: "2026-09-01" })
    await recordDay(db, sup, ORG, { id: "s1", type: "project" }, "2026-09-01", who(sup), sheet, { today: "2026-09-01" })
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
    await decideObjection(db, hrm, id, who(hrm), "uphold", "the sheet is signed", { today: "2026-10-02" })
    expect(V(id)).toMatchObject({ state: "upheld", deductMonth: "2026-10" })
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

/**
 * HR 1.0 — requests (LV-01…07, AD-01…04, LV-05, RL-02): the balance as of the
 * start, above it only unpaid, no travel past a lapsing iqama, the supervisor
 * endorses and HR decides — the HR manager's own goes to management; an
 * advance is 10% a month, never a second, above the limit to Finance.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { cancelRequest, decideRequest, endorseRequest, fileRequest, financeDecideAdvance } from "@/lib/hr/request-writes"
import { advanceQuote, leaveQuote, requestActions, requestNoDisplay, type HrRequest } from "@/lib/hr/requests"
import { DEFAULT_HR_POLICIES } from "@/lib/hr/statutory"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e-hrm" })
const mgmt = ctx(["management"], { uid: "ceo", employeeId: "e-ceo" })
const sup = ctx(["supervisor"], { uid: "sup", employeeId: "e-sup", sites: ["s1"] })
const worker = ctx([], { uid: "wu", employeeId: "e1" })
const opts = { policies: DEFAULT_HR_POLICIES, today: "2026-03-01" }
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })

const empBase: Omit<HrEmployee, "id"> = {
  organizationId: ORG,
  no: 1,
  names: { ar: "أحمد" },
  nationality: "eg",
  gender: "m",
  trade: "mason",
  category: "labour",
  siteId: "s1",
  userId: "wu",
  join: "2024-01-01",
  source: "local",
  contract: { type: "open" },
  probation: { end: "2024-03-30", decision: "confirmed" },
  status: "active",
  docs: { iqama: "2027-12-31", passport: "2029-01-01" },
  leaveTaken: 30,
}
const emp = (id: string) => readDoc<HrEmployee>(`employees/${id}`) as HrEmployee
const req = (id: string) => readDoc<HrRequest>(`hrRequests/${id}`) as HrRequest
const pay = (id: string) => readDoc<EmployeePay>(`employeePay/${id}`) as EmployeePay

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { ...empBase })
  seed("employees/e-hrm", { ...empBase, no: 2, userId: "hrm", siteId: null })
  seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 2_000, housing: 500, transport: 200 })
})

describe("leave", () => {
  it("the balance as of the start; above it, only the excess unpaid (LV-02, LV-03)", () => {
    const q = leaveQuote(empBase, { type: "annual", from: "2026-01-01", to: "2026-01-15", excessUnpaid: false, travel: false })
    expect(q.balance).toBe(12)
    expect(q.blocks).toEqual(["above_balance"])
    const u = leaveQuote(empBase, { type: "annual", from: "2026-01-01", to: "2026-01-15", excessUnpaid: true, travel: false })
    expect(u).toMatchObject({ days: 15, fromBalance: 12, unpaidDays: 3, blocks: [], warnings: ["excess_unpaid"] })
    expect(leaveQuote(empBase, { type: "annual", from: "2026-01-01", to: "2026-01-10", excessUnpaid: false, travel: false }, { holidays: [{ from: "2026-01-05", days: 3 }] }).days).toBe(7)
  })

  it("statutory types: maternity for women, fixed lengths, Hajj once after two years (LV-01)", () => {
    const x = { from: "2026-01-01", excessUnpaid: false, travel: false }
    expect(leaveQuote(empBase, { ...x, type: "maternity", to: "2026-01-10" }).blocks).toEqual(["female_only"])
    expect(leaveQuote(empBase, { ...x, type: "paternity", to: "2026-01-04" }).blocks).toEqual(["too_long"])
    expect(leaveQuote({ ...empBase, hajjTaken: true }, { ...x, type: "hajj", to: "2026-01-10" }).blocks).toEqual(["once_taken"])
    expect(leaveQuote(empBase, { ...x, type: "unpaid", to: "2026-01-04" })).toMatchObject({ unpaidDays: 4, blocks: [] })
  })

  it("sick leave by the service year's bands (LV-06); travel past a lapsing iqama is told (LV-04)", () => {
    const e = { ...empBase, sick: { year: 2, days: 25 } }
    expect(leaveQuote(e, { type: "sick", from: "2026-02-01", to: "2026-02-10", excessUnpaid: false, travel: false }).sick).toEqual({ full: 5, threeQuarters: 5, unpaid: 0, beyond: 0 })
    const t = leaveQuote({ ...empBase, docs: { iqama: "2026-01-10", passport: "2029-01-01" } }, { type: "annual", from: "2026-01-01", to: "2026-01-10", excessUnpaid: false, travel: true })
    expect(t.warnings).toEqual(["travel_docs"])
  })
})

describe("advance", () => {
  it("10% of the wage a month; never a second; above one month's wage to Finance (AD-01…03)", () => {
    const p = { basic: 2_000, housing: 500, transport: 500, advance: null }
    const q = advanceQuote(p, { amount: 1_000, reason: "rent" }, { policies: DEFAULT_HR_POLICIES, today: "2026-03-01" })
    expect(q).toMatchObject({ instalment: 300, months: 4, overLimit: false, blocks: [] })
    expect(advanceQuote(p, { amount: 3_500, reason: "x" }, { policies: DEFAULT_HR_POLICIES, today: "2026-03-01" }).warnings).toEqual(["over_limit"])
    expect(advanceQuote({ ...p, advance: { amount: 900, balance: 300, instalment: 300 } }, { amount: 100, reason: "x" }, { policies: DEFAULT_HR_POLICIES, today: "2026-03-01" }).blocks).toEqual(["outstanding"])
    expect(advanceQuote(p, { amount: 3_000, reason: "x" }, { policies: DEFAULT_HR_POLICIES, today: "2026-03-01", contractEnd: "2026-05-31" }).warnings).toEqual(["past_contract"])
  })
})

describe("who acts", () => {
  const r = { id: "r", kind: "leave", state: "pending", employeeId: "e1", siteId: "s1", lineManagerId: null, deciderLevel: "manager" } as unknown as HrRequest
  it("the supervisor endorses his site's leave, never his own; the HR manager's own goes to management", () => {
    expect(requestActions(sup, r, { today: "2026-03-01", financeAllowed: false })).toEqual(["endorse"])
    expect(requestActions(sup, { ...r, employeeId: "e-sup" }, { today: "2026-03-01", financeAllowed: false })).toEqual(["cancel"])
    const own = { ...r, employeeId: "e-hrm", deciderLevel: "management" as const }
    expect(requestActions(hrm, own, { today: "2026-03-01", financeAllowed: false })).toEqual(["cancel"])
    expect(requestActions(mgmt, own, { today: "2026-03-01", financeAllowed: false })).toEqual(["approve", "decline"])
  })
  it("numbers read ط.إ / ط.سل in Arabic", () => {
    expect(requestNoDisplay("LV-2026/004", "ar")).toBe("ط.إ-2026/004")
    expect(requestNoDisplay("AV-2026/004", "ar")).toBe("ط.سل-2026/004")
  })
})

describe("the writes", () => {
  const leave = { type: "annual" as const, from: "2026-03-10", to: "2026-03-14", excessUnpaid: false, travel: true }

  it("filed by the employee, endorsed by his supervisor, approved by HR; cancelled before it starts, the days come back", async () => {
    const { id, no } = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "leave", leave, supervisor: { employeeId: "e-sup", userId: "sup" } }, opts)
    expect(no).toBe("LV-2026/001")
    expect(req(id)).toMatchObject({ state: "pending", deciderLevel: "manager", employeeUserId: "wu", lineManagerUserId: "sup", onBehalf: false })
    await expect(endorseRequest(db, ctx(["supervisor"], { uid: "x", sites: ["s9"] }), id, who(sup))).rejects.toMatchObject({ code: "no_role" })
    await endorseRequest(db, sup, id, who(sup), "fine")
    expect(req(id).state).toBe("endorsed")
    await expect(decideRequest(db, hrm, id, who(hrm), "decline", " ", opts)).rejects.toMatchObject({ blocks: ["no_reason"] })
    await decideRequest(db, hrm, id, who(hrm), "approve", "", opts)
    expect(req(id).state).toBe("approved")
    expect(emp("e1").leaveTaken).toBe(35)
    await cancelRequest(db, hrm, id, who(hrm), "project needs him", opts)
    expect(emp("e1").leaveTaken).toBe(30)
    expect(req(id).state).toBe("cancelled")
  })

  it("the HR manager's own leave goes to management — he cannot approve it (LV-05, RL-02)", async () => {
    const { id } = await fileRequest(db, hrm, ORG, who(hrm), { employeeId: "e-hrm", kind: "leave", leave }, opts)
    expect(req(id).deciderLevel).toBe("management")
    await expect(decideRequest(db, hrm, id, who(hrm), "approve", "", opts)).rejects.toMatchObject({ code: "own_request" })
    await decideRequest(db, mgmt, id, who(mgmt), "approve", "", opts)
    expect(emp("e-hrm").leaveTaken).toBe(35)
  })

  it("not approvable for travel while the iqama lapses abroad (LV-04)", async () => {
    seed("employees/e1", { ...empBase, docs: { iqama: "2026-03-12", passport: "2029-01-01" } })
    const { id } = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "leave", leave }, opts)
    await expect(decideRequest(db, hrm, id, who(hrm), "approve", "", opts)).rejects.toMatchObject({ blocks: ["travel_docs"] })
  })

  it("an advance within the limit lands on pay; a second is refused; above the limit Finance decides", async () => {
    const a = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "advance", advance: { amount: 900, reason: "rent" } }, opts)
    expect(a.no).toBe("AV-2026/001")
    await decideRequest(db, hrm, a.id, who(hrm), "approve", "", opts)
    expect(pay("e1").advance).toEqual({ amount: 900, balance: 900, instalment: 270 })
    await expect(fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "advance", advance: { amount: 100, reason: "x" } }, opts)).rejects.toMatchObject({ blocks: ["outstanding"] })

    seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 2_000, housing: 500, transport: 200, advance: null })
    const b = await fileRequest(db, hrm, ORG, who(hrm), { employeeId: "e1", kind: "advance", advance: { amount: 5_000, reason: "family" } }, opts)
    expect(req(b.id).onBehalf).toBe(true)
    const r = await decideRequest(db, hrm, b.id, who(hrm), "approve", "HR supports it", opts)
    expect(r.state).toBe("finance")
    expect(req(b.id)).toMatchObject({ financeHold: true, decision: { note: "HR supports it" } })
    await expect(financeDecideAdvance(db, { uid: "fin", name: "Fin" }, false, b.id, "approve", "")).rejects.toMatchObject({ code: "no_role" })
    await financeDecideAdvance(db, { uid: "fin", name: "Fin" }, true, b.id, "approve", "")
    expect(req(b.id).state).toBe("approved")
    expect(pay("e1").advance).toMatchObject({ amount: 5_000, balance: 5_000 })
  })

  it("only the employee himself or the HR manager files", async () => {
    await expect(fileRequest(db, sup, ORG, who(sup), { employeeId: "e1", kind: "leave", leave }, opts)).rejects.toMatchObject({ code: "no_role" })
  })
})

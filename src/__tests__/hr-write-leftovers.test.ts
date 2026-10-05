/**
 * HR 1.0 — the write layer's leftovers: nobody decides his own probation or
 * approves his own bank account (the owner excepted, flagged); "today" is
 * Riyadh's day in every write; a request reads the wage in force on its day;
 * one platform user is linked to one employee record; Today shows overdue
 * returns from leave and pending assignment corrections to the hand that acts;
 * the final settlement issues the experience certificate (art. 64).
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { approveIban, decideProbation, linkUser } from "@/lib/hr/employee-writes"
import { exitId } from "@/lib/hr/eos"
import { approveSettlement, clearCustody, startExit } from "@/lib/hr/exit-writes"
import { recordInjury } from "@/lib/hr/injuries"
import { fileLetter } from "@/lib/hr/letter-writes"
import type { HrLetter } from "@/lib/hr/letters"
import { preparePayroll } from "@/lib/hr/payroll-writes"
import { decideRequest, fileRequest } from "@/lib/hr/request-writes"
import type { HrRequest } from "@/lib/hr/requests"
import type { AssignFix, HrSite } from "@/lib/hr/sites"
import { DEFAULT_HR_POLICIES } from "@/lib/hr/statutory"
import { leakage, todayItems, type TodayInput } from "@/lib/hr/today"
import { recordViolation } from "@/lib/hr/violation-writes"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e-hrm" })
const owner = ctx(["manager", "management"], { uid: ORG, owner: true, employeeId: "e-own" })
const sup = ctx(["supervisor"], { uid: "sup", employeeId: "e-sup", sites: ["s1"] })
const worker = ctx([], { uid: "wu", employeeId: "e1" })
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })
const sites: HrSite[] = [{ id: "s1", organizationId: ORG, name: "Tower", type: "project", projectId: "p1", active: true, supervisorUserId: "sup" }]

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
const logOf = (e: string) => listCollection<{ kind: string; params: Record<string, unknown> }>(`employees/${e}/log`)

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { ...empBase })
  seed("employees/e-hrm", { ...empBase, no: 2, userId: "hrm", siteId: null, nationality: "sa", join: "2026-02-01", probation: { end: "2026-05-01", decision: null } })
  seed("employees/e-own", { ...empBase, no: 3, userId: ORG, siteId: null, nationality: "sa", join: "2026-02-01", probation: { end: "2026-05-01", decision: null } })
})

describe("own record, in the write layer (RL-02)", () => {
  it("the HR manager never decides his own probation; the owner may, flagged", async () => {
    await expect(decideProbation(db, hrm, "e-hrm", who(hrm), "confirm", {}, { today: "2026-03-01" })).rejects.toMatchObject({ code: "own_request" })
    expect(readDoc<HrEmployee>("employees/e-hrm")?.probation.decision).toBeNull()
    await decideProbation(db, owner, "e-own", who(owner), "confirm", {}, { today: "2026-03-01" })
    expect(readDoc<HrEmployee & { probation: { ownFlagged?: boolean } }>("employees/e-own")?.probation).toMatchObject({ decision: "confirmed", ownFlagged: true })
    // Another's, as before — and not flagged.
    seed("employees/e3", { ...empBase, no: 5, userId: null, join: "2026-02-01", probation: { end: "2026-05-01", decision: null } })
    await decideProbation(db, hrm, "e3", who(hrm), "confirm", {}, { today: "2026-03-01" })
    expect(readDoc<HrEmployee & { probation: { ownFlagged?: boolean } }>("employees/e3")?.probation).toMatchObject({ decision: "confirmed" })
    expect(readDoc<HrEmployee & { probation: { ownFlagged?: boolean } }>("employees/e3")?.probation.ownFlagged).toBeUndefined()
  })

  it("the HR manager never approves his own corrected IBAN, whoever fixed it; the owner may, flagged in the log", async () => {
    seed("employeePay/e-hrm", { employeeId: "e-hrm", organizationId: ORG, basic: 9_000, housing: 0, transport: 0, iban: "SA03", ibanState: "fixed", ibanFixedBy: "pay" })
    await expect(approveIban(db, hrm, "e-hrm", who(hrm))).rejects.toMatchObject({ code: "own_request" })
    expect(readDoc<EmployeePay>("employeePay/e-hrm")?.ibanState).toBe("fixed")
    seed("employeePay/e-own", { employeeId: "e-own", organizationId: ORG, basic: 9_000, housing: 0, transport: 0, iban: "SA03", ibanState: "fixed", ibanFixedBy: "pay" })
    await approveIban(db, owner, "e-own", who(owner))
    expect(readDoc<EmployeePay>("employeePay/e-own")?.ibanState).toBe("ok")
    expect(logOf("e-own").find((l) => l.kind === "iban_approved")?.params).toEqual({ ownFlagged: 1 })
  })
})

describe("Riyadh's day in the writes (§17)", () => {
  const OLD_TZ = process.env.TZ
  beforeEach(() => {
    // 22:30 UTC on 30 September is 01:30 on 1 October in Riyadh; the browser's clock reads UTC.
    process.env.TZ = "UTC"
    jest.useFakeTimers({ now: new Date("2026-09-30T22:30:00Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })
  })
  afterEach(() => {
    jest.useRealTimers()
    process.env.TZ = OLD_TZ
  })

  it("September's payroll may be prepared at 01:30 on 1 October in Riyadh", async () => {
    await preparePayroll(db, ctx(["payroll"], { uid: "pay" }), ORG, "2026-09", { uid: "pay", name: "P" }, { lines: [], sitesToClose: [], missingPay: [] })
    expect(readDoc<{ state: string }>(`hrPayrolls/${ORG}__2026-09`)?.state).toBe("prepared")
  })

  it("a violation and an injury of 1 October are not 'in the future' at 01:30 Riyadh", async () => {
    await recordViolation(db, sup, ORG, who(sup), { employeeId: "e1", code: "late30", on: "2026-10-01" })
    await recordInjury(db, sup, ORG, who(sup), { employeeId: "e1", on: "2026-10-01", description: "fall" })
    expect(listCollection("hrViolations")).toHaveLength(1)
    expect(listCollection("hrInjuries")).toHaveLength(1)
  })
})

describe("the wage in force on the request's day (EM-04)", () => {
  it("an advance is judged on a raise already in force, though the stored figures lag", async () => {
    seed("employeePay/e1", {
      employeeId: "e1",
      organizationId: ORG,
      basic: 2_000,
      housing: 500,
      transport: 200,
      steps: [
        { from: "", basic: 2_000, housing: 500, transport: 200 },
        { from: "2026-02-01", basic: 4_000, housing: 1_000, transport: 400 },
      ],
    })
    const opts = { policies: DEFAULT_HR_POLICIES, today: "2026-03-01" }
    // 4,000 is above one month of the old wage (2,700) and within the new (5,400): HR's to decide, not Finance's.
    const { id } = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "advance", advance: { amount: 4_000, reason: "rent" } }, opts)
    expect(readDoc<HrRequest>(`hrRequests/${id}`)?.advance).toMatchObject({ overLimit: false, instalment: 540 })
    expect(await decideRequest(db, hrm, id, who(hrm), "approve", "", opts)).toEqual({ state: "approved" })
    expect(readDoc<EmployeePay>("employeePay/e1")?.advance).toMatchObject({ amount: 4_000, instalment: 540 })
  })
})

describe("one user, one record (EM-01)", () => {
  it("a user already linked to a record is refused on a second; relinking the same record is fine", async () => {
    seed("employees/e2", { ...empBase, no: 4, userId: null })
    await expect(linkUser(db, hrm, "e2", who(hrm), "wu")).rejects.toMatchObject({ code: "blocked", blocks: ["user_linked"] })
    expect(readDoc<HrEmployee>("employees/e2")?.userId).toBeNull()
    await linkUser(db, hrm, "e1", who(hrm), "wu")
    await linkUser(db, hrm, "e1", who(hrm), null)
    await linkUser(db, hrm, "e2", who(hrm), "wu")
    expect(readDoc<HrEmployee>("employees/e2")?.userId).toBe("wu")
  })
})

describe("Today — overdue returns and assignment corrections (AT-05, AS-03)", () => {
  const TODAY = "2026-03-20"
  const leave = (id: string, over: Partial<HrRequest> = {}): HrRequest =>
    ({ id, organizationId: ORG, no: "LV-2026/001", kind: "leave", employeeId: "e1", employeeUserId: "wu", employeeName: "أحمد", siteId: "s1", state: "approved", leave: { type: "annual", from: "2026-03-01", to: "2026-03-08" }, ...over }) as HrRequest
  const fix: AssignFix = { id: "f1", organizationId: ORG, employeeId: "e2", employeeName: "فهد", fromSiteId: null, siteId: "s1", since: "2026-03-10", note: null, by: "sup", byName: "S", at: "", state: "pending" }
  const input = (c: HrContext, over: Partial<TodayInput> = {}): TodayInput => ({
    ctx: c,
    today: TODAY,
    renewWindowDays: 60,
    employees: [],
    sites,
    lastMonth: [],
    thisMonth: [],
    injuries: [],
    exits: [],
    requests: [leave("r1"), leave("r2", { employeeId: "e9", employeeName: "سعيد", siteId: null, leave: { type: "annual", from: "2026-03-15", to: "2026-03-18" } as HrRequest["leave"] }), leave("r3", { returned: { on: "2026-03-09", by: "sup", byName: null, at: "", lateDays: 0 } })],
    payrolls: [],
    pays: new Map(),
    assignFixes: [fix, { ...fix, id: "f2", state: "done" }],
    ...over,
  })

  it("the HR manager sees every overdue return (on the file) and the pending correction; nothing waits with a button", () => {
    const items = todayItems(input(hrm, { payrolls: [{ kind: "main", month: "2026-02", key: "2026-02", state: "paid", lines: [] } as never] }))
    const back = items.filter((x) => x.kind.startsWith("leave_return"))
    // 12 days after 8 March: the written warning is due (art. 80) — it blocks; 2 days after the 18th is due.
    expect(back.map((x) => [x.key, x.kind, x.group, x.href, x.params.days])).toEqual([
      ["return:r1", "leave_return_warning", "blocking", "people/e1", 12],
      ["return:r2", "leave_return_due", "blocking", "people/e9", 2],
    ])
    expect(items.find((x) => x.kind === "assign_fix")).toMatchObject({ key: "assignfix:f1", group: "requests", href: "sites/s1", action: "decide", params: { name: "فهد", site: "Tower", date: "2026-03-10" } })
    expect(items.filter((x) => x.kind === "assign_fix")).toHaveLength(1)
    expect(leakage(items)).toBe(0)
  })

  it("the site's supervisor sees his site's overdue return (on the sheet) — never the unassigned one, never a correction to decide", () => {
    const items = todayItems(input(sup))
    expect(items.filter((x) => x.kind.startsWith("leave_return")).map((x) => [x.key, x.href])).toEqual([["return:r1", "sites/s1"]])
    expect(items.some((x) => x.kind === "assign_fix")).toBe(false)
    expect(todayItems(input(ctx(["supervisor"], { uid: "x", sites: ["s9"] }))).filter((x) => x.kind.startsWith("leave_return"))).toEqual([])
    // Nobody records his own return.
    expect(todayItems(input(ctx(["supervisor"], { uid: "wu", employeeId: "e1", sites: ["s1"] }))).filter((x) => x.kind.startsWith("leave_return"))).toEqual([])
  })

  it("fifteen days late makes termination possible: red", () => {
    const items = todayItems(input(hrm, { today: "2026-03-23" }))
    expect(items.find((x) => x.key === "return:r1")).toMatchObject({ kind: "leave_return_termination", severity: "red", group: "blocking" })
  })
})

describe("the experience certificate with the final settlement (art. 64, EX-05)", () => {
  const ID = exitId(ORG, "e1")
  const facts = { sites, attendance: [], requests: [], violations: [] }
  const head = { name: "شركة البناء", cr: "1010", mol: "7-1" }
  const letters = () => listCollection<HrLetter>("hrLetters").filter((l) => l.kind === "exp")
  const settle = async () => {
    seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 4_000, housing: 1_000, transport: 1_000, iban: "SA1", ibanState: "ok" })
    await startExit(db, hrm, ORG, who(hrm), "e1", { reason: "resignation", lastDay: "2026-03-15", noticeOn: "2026-02-15" }, { today: "2026-03-01" })
    await clearCustody(db, { uid: "wh", name: "Store", allowed: true }, ID, {})
  }

  it("is filed and issued in the settlement's act, with its yearly serial, and the employee is told", async () => {
    await settle()
    await approveSettlement(db, hrm, ORG, who(hrm), ID, { ...facts, head }, { today: "2026-03-16" })
    const [l] = letters()
    expect(l).toMatchObject({ state: "issued", serial: "LT-2026/001", employeeId: "e1", signerLevel: "manager", onBehalf: true, head, card: { nameAr: "أحمد", lastDay: "2026-03-15" } })
    expect(listCollection<{ type: string }>("users/wu/notifications").map((n) => n.type)).toContain("hr_letter_issued")
    expect(logOf("e1").map((x) => x.kind)).toEqual(expect.arrayContaining(["settlement_approved", "letter_filed", "letter_issued"]))
  })

  it("one he already asked for is the one issued; one already issued is never issued twice", async () => {
    await settle()
    const { id } = await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "exp", addressee: "Next employer", lang: "en" })
    await approveSettlement(db, hrm, ORG, who(hrm), ID, { ...facts, head }, { today: "2026-03-16" })
    expect(letters().map((l) => [l.id, l.state, l.addressee])).toEqual([[id, "issued", "Next employer"]])
  })
})

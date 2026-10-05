/**
 * HR 1.0 — My file and self-service (package A of the prototype parity, slices
 * 7–9): what the employee's own screen computes from what he may read; the two
 * projections written for him (his attendance on his record, the approved
 * payroll line on his pay — he reads neither the workplace month nor the
 * payroll); the attendance correction (form 11) decided by whoever keeps the
 * sheet; the bank's document filed on the record when an IBAN is approved.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import { closeMonth, recordDay } from "@/lib/hr/attendance-writes"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import {
  attendancePatches,
  attentionItems,
  maskIban,
  myActions,
  myDocuments,
  myLeaveFacts,
  myLineManager,
  mySlips,
  myToday,
  payHistory,
  roleHolders,
  whoRecordsMe,
  type MyAttendance,
  type PayslipDoc,
  type SlipProjection,
} from "@/lib/hr/me"
import { computePayroll, type PayrollLine } from "@/lib/hr/payroll"
import { approvePayroll } from "@/lib/hr/payroll-writes"
import { decideRequest, fileRequest } from "@/lib/hr/request-writes"
import { attfixBlocks, instalmentSchedule, requestActions, requestHolder, requestNoDisplay, type HrRequest } from "@/lib/hr/requests"
import { DEFAULT_HR_POLICIES } from "@/lib/hr/statutory"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e-hrm" })
const sup = ctx(["supervisor"], { uid: "sup", employeeId: "e-sup", sites: ["s1"] })
const worker = ctx([], { uid: "wu", employeeId: "e1" })
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })
const opts = { policies: DEFAULT_HR_POLICIES, today: "2026-08-05" }

const empBase: Omit<HrEmployee, "id"> = {
  organizationId: ORG,
  no: 1,
  names: { ar: "أحمد علي" },
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
const emp = (id: string) => readDoc<HrEmployee & { att?: MyAttendance }>(`employees/${id}`)!
const req = (id: string) => readDoc<HrRequest>(`hrRequests/${id}`) as HrRequest
const wmId = (m: string) => `hrAttendance/${ORG}__s1__${m}`

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { ...empBase })
  seed("employees/e2", { ...empBase, no: 2, userId: "wu2", names: { ar: "سالم" } })
  seed("hrSites/s1", { organizationId: ORG, name: "Tower", type: "project", active: true, supervisorUserId: "sup", supervisorEmployeeId: "e-sup" })
})

// ---------------------------------------------------------------------------
// What My file computes
// ---------------------------------------------------------------------------

describe("what the employee's screen computes", () => {
  const today = "2026-08-05"

  it("the IBAN is masked: the first six, the last four (ES-01)", () => {
    expect(maskIban("SA4420000001234567891234")).toBe("SA4420…1234")
    expect(maskIban(null)).toBeNull()
  })

  it("only HIS documents: no iqama for a Saudi, a licence only for a driver, the contract only when fixed-term — from the contract's end", () => {
    const mason = myDocuments({ ...empBase, nationality: "sa", docs: { passport: "2027-01-01", licence: "2026-09-01", contract: "2026-01-01" } }, today, 60).map((d) => d.type)
    expect(mason).toEqual(["passport", "insurance"])
    const driver = myDocuments({ ...empBase, trade: "driver", contract: { type: "fixed", end: "2026-09-30" }, docs: { iqama: "2026-08-01", licence: "2026-09-01" } }, today, 60)
    expect(driver.map((d) => d.type)).toEqual(["iqama", "passport", "insurance", "licence", "contract"])
    expect(driver.find((d) => d.type === "iqama")).toMatchObject({ state: "expired", left: -4 })
    expect(driver.find((d) => d.type === "contract")).toMatchObject({ expiry: "2026-09-30", left: 56 })
  })

  it("the leave tile states its formula: accrued − taken = balance; 21 a year, 30 after five years; sick days of 120", () => {
    const f = myLeaveFacts({ ...empBase, sick: { year: 2, days: 12 } }, today)
    expect(f.accrued - f.taken).toBe(f.balance)
    expect(f).toMatchObject({ taken: 30, entitlement: 21, thirtyFrom: "2028-12-30", sickUsed: 12, sickCap: 120 })
    expect(myLeaveFacts({ ...empBase, join: "2019-01-01" }, today)).toMatchObject({ entitlement: 30, thirtyFrom: null })
  })

  it("quick actions show only at work or on leave; an advance is disabled with its reason (AD-02)", () => {
    const pay = { basic: 2_000, housing: 500, transport: 200, advance: { amount: 900, balance: 600, instalment: 270 } }
    expect(myActions({ emp: empBase, pay, requests: [], today }).find((a) => a.key === "advance")?.blocked).toBe("outstanding")
    expect(myActions({ emp: empBase, pay: { ...pay, advance: null }, requests: [{ kind: "advance", state: "finance" }], today }).find((a) => a.key === "advance")?.blocked).toBe("pending_advance")
    expect(myActions({ emp: empBase, pay: { ...pay, advance: null }, requests: [], today }).every((a) => a.blocked === null)).toBe(true)
    expect(myActions({ emp: { ...empBase, status: "leaving" }, pay, requests: [], today })).toEqual([])
  })

  it("needs your attention: a penalty he may still object to first, the documents in their window, a returned transfer, no mobile, this week's decisions", () => {
    const items = attentionItems({
      emp: { ...empBase, docs: { iqama: "2026-09-10", passport: "2029-01-01" }, contact: null },
      pay: { iban: "SA4420000001234567891234", ibanState: "returned" },
      payKnown: true,
      violations: [
        { id: "v1", code: "late15", state: "applied", notifiedOn: "2026-08-01", amount: 50, stepKind: "fraction" },
        { id: "v2", code: "late15", state: "applied", notifiedOn: "2026-07-01", amount: 50, stepKind: "fraction" },
      ],
      requests: [
        { id: "r1", kind: "leave", state: "declined", no: "LV-2026/001", data: null, decision: { by: "hrm", byName: "Sara", at: "2026-08-03T10:00:00Z", note: "busy month" }, finance: null },
        { id: "r2", kind: "leave", state: "approved", no: "LV-2026/002", data: null, decision: { by: "hrm", byName: "Sara", at: "2026-07-01T10:00:00Z" }, finance: null },
      ],
      today,
      renewWindowDays: 60,
    })
    // Red first, then amber, then blue; the window-closed penalty and last month's decision are not here.
    expect(items.map((i) => i.kind)).toEqual(["penalty", "iban_returned", "doc", "declined", "no_mobile"])
    expect(items[0]).toMatchObject({ kind: "penalty", params: { until: "2026-08-16" }, action: { object: "v1" } })
    expect(items.find((i) => i.kind === "iban_returned")?.action).toEqual({ data: "iban" })
    expect(items.find((i) => i.kind === "declined")?.params).toMatchObject({ note: "busy month" })
    // A pending IBAN update: the prompt stays, its button goes.
    const pending = attentionItems({ emp: { ...empBase, contact: { mobile: "05" } }, pay: { iban: null, ibanState: "returned" }, payKnown: true, violations: [], requests: [{ id: "d", kind: "data", state: "pending", no: "HQ-2026/001", data: { field: "iban", value: "SA" }, decision: null, finance: null }], today, renewWindowDays: 60 })
    expect(pending).toEqual([expect.objectContaining({ kind: "iban_returned", action: null })])
  })

  it("payslip states: paid, with Finance before payment, held with its reason; a returned transfer marks the last paid month (ES-04)", () => {
    const line = { net: 2_400, held: false } as unknown as PayrollLine
    const slips: PayslipDoc[] = [{ id: "p1", key: "2026-06", month: "2026-06", kind: "main", line, paidOn: "2026-07-05" }]
    const slip = (held: boolean): SlipProjection => ({ key: "2026-07", month: "2026-07", line, held, heldReason: held ? "iban_returned" : null, approvedOn: "2026-08-02" })
    expect(mySlips(slips, slip(false), "ok").map((s) => [s.key, s.state])).toEqual([["2026-07", "finance"], ["2026-06", "paid"]])
    expect(mySlips(slips, slip(true), "returned")).toEqual([expect.objectContaining({ key: "2026-07", state: "held", heldReason: "iban_returned" }), expect.objectContaining({ key: "2026-06", returned: true })])
    // Once paid, the payslip replaces the projection.
    expect(mySlips([...slips, { ...slips[0], id: "p2", key: "2026-07", month: "2026-07" }], slip(false), "ok").map((s) => s.state)).toEqual(["paid", "paid"])
  })

  it("my day: on leave, then today's sheet, else an office assumes presence; who records me is the site's supervisor", () => {
    const att: MyAttendance = { today: { day: today, status: "absent" } }
    expect(myToday({ att, today, onLeave: true, assumed: false })).toBe("leave")
    expect(myToday({ att, today, onLeave: false, assumed: false })).toBe("absent")
    expect(myToday({ att: { today: { day: "2026-08-04", status: "absent" } }, today, onLeave: false, assumed: false })).toBe("none")
    expect(myToday({ att: null, today, onLeave: false, assumed: true })).toBe("assumed")
    expect(whoRecordsMe("s1", { type: "project", supervisorUserId: "sup" })).toEqual({ kind: "supervisor", userId: "sup" })
    expect(whoRecordsMe("hq", { type: "hq" })).toEqual({ kind: "assumed" })
    expect(whoRecordsMe(null, null)).toEqual({ kind: "assumed" })
  })

  it("names: the line manager (named on the card, else the site's supervisor — never himself); each HR role's holder from the default group", () => {
    const members = [
      { id: "own", name: "Owner" },
      { id: "sup", name: "Khalid", organizationRole: "member", defaultGroupId: "g-sup" },
      { id: "hr", name: "Sara", organizationRole: "member", defaultGroupId: "g-hr" },
    ]
    expect(myLineManager({ id: "e1", siteId: "s1", userId: "wu" }, { supervisorUserId: "sup", supervisorEmployeeId: "e-sup" }, [], members)).toEqual({ userId: "sup", name: "Khalid" })
    expect(myLineManager({ id: "e-sup", siteId: "s1", userId: "sup" }, { supervisorUserId: "sup", supervisorEmployeeId: "e-sup" }, [], members)).toBeNull()
    expect(myLineManager({ id: "e1", managerId: "e9", siteId: "s1", userId: "wu" }, null, [{ id: "e9", userId: "hr", names: { ar: "x" } }], members)).toEqual({ userId: "hr", name: "Sara" })
    const h = roleHolders(members, [{ id: "g-hr", permissions: ["employees.manage"] }, { id: "g-sup", permissions: ["hr.supervisor"] }])
    expect(h).toEqual({ manager: "Sara", gov: "Owner", management: "Owner", finance: "Owner" })
  })

  it("who holds a request now: a leave the line manager first, a correction whoever keeps the sheet, the HR manager or management, Finance above the limit", () => {
    const base = { kind: "leave" as const, state: "pending" as const, deciderLevel: "manager" as const, lineManagerUserId: "sup" }
    expect(requestHolder(base)).toEqual({ role: "line_manager", userId: "sup" })
    expect(requestHolder({ ...base, state: "endorsed" })).toEqual({ role: "hr", userId: null })
    expect(requestHolder({ ...base, kind: "attfix" })).toEqual({ role: "supervisor", userId: "sup" })
    expect(requestHolder({ ...base, kind: "data", deciderLevel: "management" })).toEqual({ role: "management", userId: null })
    expect(requestHolder({ ...base, kind: "advance", state: "finance" })).toEqual({ role: "finance", userId: null })
    expect(requestHolder({ ...base, state: "approved" })).toBeNull()
  })

  it("the advance schedule reads i × n + last = amount (AD-01); the pay history is newest first with each change", () => {
    expect(instalmentSchedule(900, 270)).toEqual({ instalment: 270, full: 3, last: 90 })
    expect(instalmentSchedule(540, 270)).toEqual({ instalment: 270, full: 1, last: 270 })
    const h = payHistory([
      { from: "2025-01-01", basic: 2_000, housing: 500, transport: 200 },
      { from: "2026-03-01", basic: 2_400, housing: 600, transport: 240 },
    ])
    expect(h).toEqual([
      { from: "2026-03-01", basic: 2_400, wage: 3_240, delta: 540 },
      { from: "2025-01-01", basic: 2_000, wage: 2_700, delta: null },
    ])
  })

  it("an attendance correction: within a week, not in the future, a reason; forgotten punches only with punch, three a month; one per day", () => {
    const x = { type: "abs" as const, day: "2026-08-04", reason: "I was on site" }
    const c = { today, punch: false, mine: [] as HrRequest[] }
    expect(attfixBlocks(x, c)).toEqual([])
    expect(attfixBlocks({ ...x, day: "2026-07-28" }, c)).toEqual(["too_old"])
    expect(attfixBlocks({ ...x, day: "2026-08-06" }, c)).toEqual(["future"])
    expect(attfixBlocks({ ...x, reason: " " }, c)).toEqual(["no_reason"])
    expect(attfixBlocks({ ...x, type: "miss" }, c)).toEqual(["bad_fix_type"])
    const miss = (i: number) => ({ kind: "attfix", state: "pending", attfix: { type: "miss", day: `2026-08-0${i}`, reason: "x" }, createdAt: `2026-08-0${i}T09:00:00Z` }) as HrRequest
    expect(attfixBlocks({ ...x, type: "miss" }, { ...c, punch: true, mine: [miss(1), miss(2), miss(3)] })).toEqual(["over_cap"])
    expect(attfixBlocks(x, { ...c, mine: [{ ...miss(4), attfix: { type: "abs", day: "2026-08-04", reason: "y" } } as HrRequest] })).toEqual(["duplicate"])
    expect(requestNoDisplay("AQ-2026/004", "ar")).toBe("ط.ح-2026/004")
  })

  it("the projection: each person's month and — when the sheet is today's — today; the month before last is dropped", () => {
    const wm = { month: "2026-08", days: { "2026-08-04": { listed: ["e1", "e2"], ex: { e1: { status: "absent" as const } } }, "2026-08-05": { listed: ["e1"], ex: { e1: { ot: 2 } } } }, declarations: [] }
    const p = attendancePatches(wm, ["e1", "e2"], { day: "2026-08-05", today: "2026-08-05" })
    expect(p.get("e1")).toEqual({ "att.m.2026-08": { present: 1, absent: 1, sick: 0, permission: 0, declared: 0, ot: 2, closed: false }, "att.m.2026-06": null, "att.today": { day: "2026-08-05", status: "present", ot: 2 } })
    // Not on today's sheet: no today written for him.
    expect(p.get("e2")).not.toHaveProperty("att.today")
  })
})

// ---------------------------------------------------------------------------
// The writes
// ---------------------------------------------------------------------------

describe("the projections are written beside their source", () => {
  it("a supervisor's sheet writes each listed person's month and today on his record (he reads it, never the sheet)", async () => {
    await recordDay(db, sup, ORG, { id: "s1", type: "project" }, "2026-08-05", who(sup), { listed: ["e1", "e2"], ex: { e2: { status: "absent" } } }, { today: "2026-08-05" })
    expect(emp("e1").att).toEqual({ m: { "2026-08": expect.objectContaining({ present: 1, absent: 0 }) }, today: { day: "2026-08-05", status: "present" } })
    expect(emp("e2").att?.today).toEqual({ day: "2026-08-05", status: "absent" })
    // Closing marks the month closed on his record.
    await closeMonth(db, sup, ORG, { id: "s1", type: "project" }, "2026-08", who(sup), "warn", { today: "2026-09-01" })
    expect(emp("e1").att?.m?.["2026-08"]).toMatchObject({ closed: true })
  })

  it("an approved MAIN payroll puts each line on its employee's pay — 'with Finance' or held, until the payslip opens", async () => {
    const M = "2026-07"
    const pays = new Map<string, EmployeePay>([
      ["e1", { employeeId: "e1", organizationId: ORG, basic: 3_000, housing: 750, transport: 300, iban: "SA01", ibanState: "ok" }],
      ["e2", { employeeId: "e2", organizationId: ORG, basic: 3_000, housing: 750, transport: 300, iban: "SA02", ibanState: "returned" }],
    ])
    for (const [id, p] of pays) seed(`employeePay/${id}`, p as unknown as Record<string, unknown>)
    const employees = ["e1", "e2"].map((id) => readDoc<HrEmployee>(`employees/${id}`)!)
    const { lines } = computePayroll({ month: M, employees, pays, sites: [{ id: "s1", organizationId: ORG, name: "T", type: "hq", active: true }], attendance: [], requests: [] })
    seed(`hrPayrolls/${ORG}__${M}`, { organizationId: ORG, month: M, key: M, kind: "main", state: "prepared", lines, prepared: { by: "po", byName: "P", at: "" } })
    await approvePayroll(db, hrm, ORG, M, who(hrm))
    const slip = (id: string) => readDoc<EmployeePay & { slip?: SlipProjection }>(`employeePay/${id}`)!.slip
    expect(slip("e1")).toMatchObject({ key: M, held: false, line: { employeeId: "e1" } })
    expect(slip("e2")).toMatchObject({ key: M, held: true, heldReason: "iban_returned" })
  })
})

describe("attendance correction (PRD form 11)", () => {
  const absentDay = async () => recordDay(db, sup, ORG, { id: "s1", type: "project" }, "2026-08-04", who(sup), { listed: ["e1", "e2"], ex: { e1: { status: "absent", note: "not seen" } } }, { today: "2026-08-04" })

  it("filed by the employee to the supervisor who keeps the sheet; his approval takes the absence off that day and his record follows", async () => {
    await absentDay()
    const { id, no } = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "attfix", attfix: { type: "abs", day: "2026-08-04", reason: "I was on the 3rd floor" }, supervisor: { employeeId: "e-sup", userId: "sup" } }, opts)
    expect(no).toBe("AQ-2026/001")
    expect(req(id)).toMatchObject({ kind: "attfix", state: "pending", lineManagerUserId: "sup", attfix: { type: "abs", day: "2026-08-04" } })
    // The supervisor decides it (not the HR manager's queue only), and never the employee himself.
    expect(requestActions(sup, req(id), { today: "2026-08-05", financeAllowed: false })).toEqual(["approve", "decline"])
    expect(requestActions(worker, req(id), { today: "2026-08-05", financeAllowed: false })).toEqual(["cancel"])
    await expect(decideRequest(db, ctx(["supervisor"], { uid: "x", sites: ["s9"] }), id, who(sup), "approve", "", opts)).rejects.toMatchObject({ code: "no_role" })
    await decideRequest(db, sup, id, who(sup), "approve", "", opts)
    expect(req(id).state).toBe("approved")
    const wm = readDoc<WorkplaceMonth>(wmId("2026-08"))!
    expect(wm.days["2026-08-04"].ex.e1).toEqual({ note: "not seen" })
    expect(emp("e1").att?.m?.["2026-08"]).toMatchObject({ present: 1, absent: 0 })
    const notes = listCollection<{ type: string }>("users/wu/notifications")
    expect(notes.map((n) => n.type)).toContain("hr_request_decided")
  })

  it("refused when the day does not show him absent, or once the month is closed — a closed month never reopens", async () => {
    await absentDay()
    const a = await fileRequest(db, ctx([], { uid: "wu2", employeeId: "e2" }), ORG, { uid: "wu2", name: "S" }, { employeeId: "e2", kind: "attfix", attfix: { type: "abs", day: "2026-08-04", reason: "x" } }, opts)
    await expect(decideRequest(db, sup, a.id, who(sup), "approve", "", opts)).rejects.toMatchObject({ blocks: ["not_absent"] })
    const b = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "attfix", attfix: { type: "abs", day: "2026-08-04", reason: "x" } }, opts)
    await closeMonth(db, hrm, ORG, { id: "s1", type: "project" }, "2026-08", who(hrm), "warn", { today: "2026-09-01" })
    await expect(decideRequest(db, sup, b.id, who(sup), "approve", "", opts)).rejects.toMatchObject({ blocks: ["month_closed"] })
    // Declined needs its reason.
    await expect(decideRequest(db, sup, b.id, who(sup), "decline", " ", opts)).rejects.toMatchObject({ blocks: ["no_reason"] })
    await decideRequest(db, sup, b.id, who(sup), "decline", "closed — HR will add it to a supplementary", opts)
    expect(req(b.id).state).toBe("declined")
  })

  it("the HR manager decides his workers' corrections too — never his own", async () => {
    seed("employees/e-hrm", { ...empBase, no: 9, userId: "hrm", siteId: null })
    const { id } = await fileRequest(db, hrm, ORG, who(hrm), { employeeId: "e-hrm", kind: "attfix", attfix: { type: "abs", day: "2026-08-04", reason: "x" } }, opts)
    await expect(decideRequest(db, hrm, id, who(hrm), "approve", "", opts)).rejects.toMatchObject({ code: "own_request" })
  })
})

describe("data update with the bank's document (ES-03, EM-07)", () => {
  const file = { path: `organizations/${ORG}/hr/employees/e1/1_letter.pdf`, name: "letter.pdf", size: 20_000, contentType: "application/pdf" }

  it("an IBAN carries the uploaded letter; the HR manager's approval applies it, files the letter on the record and tells Finance a returned line may be paid", async () => {
    seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 2_000, housing: 500, transport: 200, iban: "SA0000", ibanState: "returned" })
    await expect(fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "data", data: { field: "iban", value: "SA4420000001234567891234" } }, opts)).rejects.toMatchObject({ blocks: ["no_document"] })
    // A file under someone else's folder is refused.
    await expect(fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "data", data: { field: "iban", value: "SA4420000001234567891234", file: { ...file, path: `organizations/${ORG}/hr/employees/e2/x.pdf` } } }, opts)).rejects.toMatchObject({ blocks: ["bad_path"] })
    const { id } = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "data", data: { field: "iban", value: "SA4420000001234567891234", file } }, opts)
    expect(req(id).data).toMatchObject({ document: "letter.pdf", file })
    await decideRequest(db, hrm, id, who(hrm), "approve", "", opts)
    expect(readDoc<EmployeePay>("employeePay/e1")).toMatchObject({ iban: "SA4420000001234567891234", ibanState: "ok" })
    expect(listCollection("employees/e1/files")).toEqual([expect.objectContaining({ kind: "bank", path: file.path, by: "hrm" })])
  })

  it("the qualification is a field he may ask to change", async () => {
    const { id } = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "data", data: { field: "qualification", value: "دبلوم كهرباء" } }, opts)
    await decideRequest(db, hrm, id, who(hrm), "approve", "", opts)
    expect(emp("e1")).toMatchObject({ contact: { qualification: "دبلوم كهرباء" } })
  })
})

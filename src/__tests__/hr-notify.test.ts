/**
 * HR 1.0 — who is told what (PRD "Notifications", TD-05). One helper for the
 * module: recipients by HR role read from each member's DEFAULT group (the
 * owner holds them all), Finance, Inventory or named users; the actor never
 * hears of his own act, nor the employee a decision about him he must not take;
 * keys each reader renders in his language plus the sender's Arabic text for
 * push; never an amount (RL-03); a once-only event at a fixed id. Then each act
 * of the module that the PRD or the prototype says tells someone, does.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import fs from "fs"
import path from "path"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { HrEmployee } from "@/lib/hr/employee"
import { approveIban, createEmployee, fixIban } from "@/lib/hr/employee-writes"
import { exitId } from "@/lib/hr/eos"
import { approveSettlement, clearCustody, startExit } from "@/lib/hr/exit-writes"
import { markReturned, paySettlement, recordPayrollPaid } from "@/lib/hr/finance-writes"
import type { HrSettlement } from "@/lib/hr/exit-writes"
import { recordInjury } from "@/lib/hr/injuries"
import { fileLetter } from "@/lib/hr/letter-writes"
import { answerManpowerRequest, raiseManpowerRequest } from "@/lib/hr/manpower"
import {
  emitHrNotice,
  HR_NOTICE_COPY_AR,
  HR_NOTICE_KINDS,
  HR_NOTICE_PARAM_COPY_AR,
  hrNoticeMessageKey,
  hrNoticeTitleKey,
  iqamaOnSiteNotices,
  renderHrNotice,
  type HrNotificationDoc,
} from "@/lib/hr/notify"
import type { Payroll } from "@/lib/hr/payroll"
import { approvePayroll, preparePayroll } from "@/lib/hr/payroll-writes"
import { decideRequest, fileRequest, financeDecideAdvance } from "@/lib/hr/request-writes"
import { decideAssignFix, raiseAssignFix } from "@/lib/hr/site-writes"
import type { HrSite } from "@/lib/hr/sites"
import { DEFAULT_HR_POLICIES } from "@/lib/hr/statutory"
import { decideObjection, decidePenalty, objectPenalty, recordViolation } from "@/lib/hr/violation-writes"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ROOT = path.resolve(__dirname, "../..")
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e-hrm" })
const payroll = ctx(["payroll"], { uid: "pay" })
const sup = ctx(["supervisor"], { uid: "sup", employeeId: "e-sup", sites: ["s1"] })
const worker = ctx([], { uid: "wu", employeeId: "e1" })
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })
const fin = { uid: "fin", name: "F", allowed: true }
const opts = { policies: DEFAULT_HR_POLICIES, today: "2026-03-01" }
const sites: HrSite[] = [{ id: "s1", organizationId: ORG, name: "Tower", type: "project", projectId: "p1", active: true, supervisorUserId: "sup" }]

const inbox = (uid: string) => listCollection<HrNotificationDoc>(`users/${uid}/notifications`)
const kinds = (uid: string) => inbox(uid).map((n) => n.type)
const one = (uid: string, kind: string) => inbox(uid).find((n) => n.type === kind)

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

/** A team: each member's DEFAULT group carries his role, as the rules and access.ts read it. */
function seedTeam() {
  const groups: Record<string, string[]> = {
    "g-hr": ["employees.manage"],
    "g-mgmt": ["hr.management"],
    "g-gov": ["hr.gov"],
    "g-pay": ["hr.payroll"],
    "g-sup": ["hr.supervisor"],
    "g-fin": ["invoices.manage"],
    "g-acc": ["accounting.post"],
    "g-wh": ["warehouses.manage"],
    "g-none": ["projects.view"],
  }
  for (const [id, permissions] of Object.entries(groups)) seed(`teamGroups/${id}`, { organizationId: ORG, permissions })
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner" })
  const members: Record<string, string> = { hrm: "g-hr", hrm2: "g-hr", ceo: "g-mgmt", gro: "g-gov", pay: "g-pay", sup: "g-sup", fin: "g-fin", acc: "g-acc", wh: "g-wh", wu: "g-none", pm: "g-none" }
  for (const [uid, g] of Object.entries(members)) seed(`users/${uid}`, { organizationId: ORG, organizationRole: "member", defaultGroupId: g })
}

beforeEach(() => {
  resetFakeDb()
  seedTeam()
  seed("employees/e1", { ...empBase })
  seed("employees/e-hrm", { ...empBase, no: 2, userId: "hrm", siteId: null, nationality: "sa" })
  seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 2_000, housing: 500, transport: 200 })
})

// ---------------------------------------------------------------------------
// The helper
// ---------------------------------------------------------------------------

describe("the helper", () => {
  const load = (locale: "ar" | "en") => JSON.parse(fs.readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")).Portal.Shared as Record<string, unknown>
  const at = (dict: Record<string, unknown>, key: string): unknown => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict)

  it("every kind has its two keys in both languages; the Arabic table IS the Arabic message copy", () => {
    for (const locale of ["ar", "en"] as const) {
      const dict = load(locale)
      const missing = [...HR_NOTICE_KINDS.flatMap((k) => [hrNoticeTitleKey(k), hrNoticeMessageKey(k)]), ...Object.keys(HR_NOTICE_PARAM_COPY_AR)].filter((k) => typeof at(dict, k) !== "string")
      expect({ locale, missing }).toEqual({ locale, missing: [] })
    }
    const ar = load("ar")
    for (const k of HR_NOTICE_KINDS) {
      expect(at(ar, hrNoticeTitleKey(k))).toBe(HR_NOTICE_COPY_AR[k].title)
      expect(at(ar, hrNoticeMessageKey(k))).toBe(HR_NOTICE_COPY_AR[k].message)
    }
    for (const [k, v] of Object.entries(HR_NOTICE_PARAM_COPY_AR)) expect(at(ar, k)).toBe(v)
  })

  it("never an amount, never the riyal glyph — in any language (RL-03; push has no font)", () => {
    const money = /\{(amount|net|gross|wage|salary|basic|total|value)\}|ر\.س|SAR|[⃁﷼]/
    for (const locale of ["ar", "en"] as const) {
      const dict = load(locale)
      for (const k of HR_NOTICE_KINDS) expect(`${at(dict, hrNoticeTitleKey(k))} ${at(dict, hrNoticeMessageKey(k))}`).not.toMatch(money)
    }
  })

  it("roles come from the default group; the owner holds them all; the actor and `except` are never told; links per reader", async () => {
    const n = await emitHrNotice(db, { uid: "hrm", name: "Sara" }, {
      kind: "hr_request_filed",
      organizationId: ORG,
      to: [{ hr: "manager" }, { users: ["wu"] }],
      except: ["hrm2"],
      params: { name: "أحمد", no: "LV-2026/004", req: "@hr_req_kind.leave" },
      link: "hr",
      links: { wu: "hr/me" },
      once: "r1",
    })
    // hrm (actor) and hrm2 (except) out; the owner and the named user in.
    expect(n).toBe(2)
    expect(kinds("hrm")).toEqual([])
    expect(kinds("hrm2")).toEqual([])
    expect(kinds("gro")).toEqual([])
    const [owner] = listCollection<HrNotificationDoc & { id: string }>(`users/${ORG}/notifications`)
    expect(owner).toMatchObject({ id: "hr_request_filed__r1", link: "hr", type: "hr_request_filed", i18n: { title: "pn_hr_request_filed_title", params: { actor: "Sara", req: "@hr_req_kind.leave" } } })
    // The sender's Arabic text for push: the request's number as it reads in Arabic, the kind translated.
    expect(owner.title).toBe("طلب بانتظار قرارك — ط.إ-2026/004")
    expect(owner.message).toBe("طلب إجازة من أحمد (ط.إ-2026/004). راجعه وقرّر فيه من «اليوم» في الموارد البشرية.")
    expect(one("wu", "hr_request_filed")?.link).toBe("hr/me")
  })

  it("Finance is the owner, invoices.manage and accounting.post; Inventory is warehouses.manage", async () => {
    await emitHrNotice(db, { uid: "x", name: null }, { kind: "hr_payroll_approved", organizationId: ORG, to: [{ finance: true }], params: { month: "2026-09" }, link: "accounting/hr-desk" })
    await emitHrNotice(db, { uid: "x", name: null }, { kind: "hr_custody_requested", organizationId: ORG, to: [{ inventory: true }], params: { name: "a", lastDay: "2026-09-30" }, link: "warehouses/custody" })
    expect(kinds("fin")).toEqual(["hr_payroll_approved"])
    expect(kinds("acc")).toEqual(["hr_payroll_approved"])
    expect(kinds("wh")).toEqual(["hr_custody_requested"])
    expect(kinds("hrm")).toEqual([])
  })

  it("an empty note leaves no dangling words; the rendered text follows the sender's translator when given", () => {
    expect(renderHrNotice("hr_request_decided", { no: "AV-2026/002", req: "@hr_req_kind.advance", verdict: "@hr_verdict.approved", note: "" }).message).toBe("طلب سلفة ط.سل-2026/002: اعتُمد.")
    const t = Object.assign((k: string, p?: Record<string, string | number>) => `${k}|${p?.month ?? ""}`, { has: () => true })
    expect(renderHrNotice("hr_payslip_ready", { month: "2026-09" }, t)).toEqual({ title: "pn_hr_payslip_ready_title|2026-09", message: "pn_hr_payslip_ready|2026-09" })
  })
})

// ---------------------------------------------------------------------------
// The events, wired
// ---------------------------------------------------------------------------

describe("requests", () => {
  const leave = { type: "annual" as const, from: "2026-03-10", to: "2026-03-14" }

  it("a leave filed → the HR manager decides and the line manager endorses — never the employee; the decision → the employee", async () => {
    const { id } = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "leave", leave, supervisor: { employeeId: "e-sup", userId: "sup" } }, opts)
    expect(one("hrm", "hr_request_filed")).toMatchObject({ link: "hr", i18n: { params: { name: "أحمد", req: "@hr_req_kind.leave" } } })
    expect(one("hrm2", "hr_request_filed")).toBeDefined()
    expect(one("sup", "hr_leave_to_endorse")).toMatchObject({ i18n: { params: { from: "2026-03-10", to: "2026-03-14" } } })
    expect(kinds("wu")).toEqual([])
    expect(kinds("ceo")).toEqual([])
    await decideRequest(db, hrm, id, who(hrm), "decline", "Peak week", opts)
    expect(one("wu", "hr_request_decided")).toMatchObject({ link: "hr/me", i18n: { params: { verdict: "@hr_verdict.declined", note: "Peak week" } } })
  })

  it("the HR manager's own goes to management; filed on someone's behalf, the filer hears the decision on the record", async () => {
    await fileRequest(db, hrm, ORG, who(hrm), { employeeId: "e-hrm", kind: "leave", leave }, opts)
    expect(kinds("ceo")).toEqual(["hr_request_filed"])
    expect(kinds("hrm2")).toEqual([])
    const { id } = await fileRequest(db, hrm, ORG, who(hrm), { employeeId: "e1", kind: "leave", leave: { ...leave, from: "2026-04-10", to: "2026-04-12" } }, opts)
    await decideRequest(db, ctx(["manager"], { uid: "hrm2" }), id, who(ctx([], { uid: "hrm2" })), "approve", "", opts)
    expect(one("hrm", "hr_request_decided")?.link).toBe("hr/people/e1")
    expect(one("wu", "hr_request_decided")?.link).toBe("hr/me")
    // A non-Saudi's approved leave abroad: government relations issues the exit re-entry visa.
    expect(one("gro", "hr_exit_reentry")).toMatchObject({ link: "hr/people/e1", i18n: { params: { from: "2026-04-10" } } })
  })

  it("an advance above the limit → Finance (no amount); Finance's decision → the employee", async () => {
    const { id } = await fileRequest(db, worker, ORG, who(worker), { employeeId: "e1", kind: "advance", advance: { amount: 5_000, reason: "rent" } }, opts)
    expect(one("hrm", "hr_request_filed")?.i18n.params.req).toBe("@hr_req_kind.advance")
    await decideRequest(db, hrm, id, who(hrm), "approve", "", opts)
    const n = one("fin", "hr_advance_to_finance")!
    expect(n.link).toBe("accounting/hr-desk")
    expect(JSON.stringify(n)).not.toMatch(/5000|5,000/)
    expect(kinds("wu")).toEqual([])
    await financeDecideAdvance(db, { uid: "fin", name: "F" }, true, id, "approve", "")
    expect(one("wu", "hr_request_decided")?.i18n.params.verdict).toBe("@hr_verdict.approved")
  })
})

describe("violations and penalties", () => {
  it("recorded → the HR manager and the employee; applied → the employee with the 15 days' last day; objection → HR; its decision → the employee", async () => {
    const id = await recordViolation(db, sup, ORG, who(sup), { employeeId: "e1", code: "late30", on: "2026-03-02" }, { today: "2026-03-02" })
    expect(one("hrm", "hr_violation_recorded")).toMatchObject({ link: "hr/people/e1", i18n: { params: { on: "2026-03-02" } } })
    expect(one("wu", "hr_violation_recorded")?.link).toBe("hr/me")
    await decidePenalty(db, hrm, id, who(hrm), { verdict: "apply", hearingOn: "2026-03-03" }, { history: [], today: "2026-03-04" })
    expect(one("wu", "hr_penalty_applied")).toMatchObject({ link: "hr/me", i18n: { params: { on: "2026-03-02", until: "2026-03-19" } } })
    expect(JSON.stringify(one("wu", "hr_penalty_applied"))).not.toMatch(/amount/)
    await objectPenalty(db, worker, id, who(worker), "I was at the clinic", { today: "2026-03-05" })
    expect(one("hrm2", "hr_objection_filed")?.i18n.params.name).toBe("أحمد")
    await decideObjection(db, hrm, id, who(hrm), "cancel", "clinic note seen", { today: "2026-03-06" })
    expect(one("wu", "hr_objection_decided")?.i18n.params.verdict).toBe("@hr_verdict.cancelled")
  })
})

describe("letters", () => {
  it("a letter filed → its signer: government relations for an embassy letter, the HR manager for the rest", async () => {
    await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "emb", addressee: "Embassy", lang: "en" })
    expect(one("gro", "hr_letter_filed")).toMatchObject({ link: "hr", i18n: { params: { letter: "@hr_letter_kind.emb" } } })
    expect(kinds("hrm")).toEqual([])
    await fileLetter(db, worker, ORG, who(worker), { employeeId: "e1", kind: "noc", purpose: "licence", addressee: "Traffic", lang: "ar" })
    expect(kinds("hrm")).toEqual(["hr_letter_filed"])
  })
})

describe("payroll and the returned transfer", () => {
  const line = (employeeId: string, userId: string | null, held = false) => ({ employeeId, userId, no: 1, name: "أحمد", net: 2_000, held, heldReason: held ? "no_iban" : null })

  it("prepared → the HR managers who may approve, never the preparer; approved → Finance, once", async () => {
    await preparePayroll(db, ctx(["manager", "payroll"], { uid: "hrm" }), ORG, "2026-02", { uid: "hrm", name: "S" }, { lines: [], sitesToClose: [], missingPay: [] }, { today: "2026-03-02" })
    expect(kinds("hrm2")).toEqual(["hr_payroll_prepared"])
    expect(kinds("hrm")).toEqual([])
    await approvePayroll(db, ctx(["manager"], { uid: "hrm2" }), ORG, "2026-02", { uid: "hrm2", name: "M" })
    expect(listCollection<{ id: string }>("users/fin/notifications").map((n) => n.id)).toEqual([`hr_payroll_approved__${ORG}__2026-02`])
  })

  it("paid → each paid employee's payslip is ready (not a held line's), with no amount; a return → the employee and payroll", async () => {
    const p = { id: `${ORG}__2026-02`, organizationId: ORG, month: "2026-02", key: "2026-02", kind: "main", state: "approved", lines: [line("e1", "wu"), line("e2", "u2", true)], prepared: { by: "pay" } } as unknown as Payroll
    seed(`hrPayrolls/${p.id}`, p as unknown as Record<string, unknown>)
    seed(`hrEvents/${ORG}__hr:PAY:2026-02`, { organizationId: ORG, state: "sent" })
    await recordPayrollPaid(db, fin, ORG, p, { accountingOn: false, date: "2026-03-01" })
    expect(one("wu", "hr_payslip_ready")).toMatchObject({ link: "hr/me", i18n: { params: { month: "2026-02" } } })
    expect(JSON.stringify(inbox("wu"))).not.toMatch(/2000|2,000/)
    expect(kinds("u2")).toEqual([])
    await markReturned(db, fin, ORG, { ...p, state: "paid" }, "e1", "account closed", { accountingOn: false, date: "2026-03-03" })
    expect(one("wu", "hr_transfer_returned")?.link).toBe("hr/me")
    expect(one("pay", "hr_iban_to_fix")).toMatchObject({ link: "hr/people/e1", i18n: { params: { reason: "account closed" } } })
  })

  it("a corrected IBAN → the HR manager (not the hand that fixed it); approved → Finance pays the held line", async () => {
    await fixIban(db, payroll, "e1", who(payroll), "SA0380000000608010167519")
    expect(one("hrm", "hr_iban_to_approve")?.link).toBe("hr/people/e1")
    expect(kinds("pay")).toEqual([])
    await approveIban(db, hrm, "e1", who(hrm))
    expect(one("fin", "hr_iban_approved")?.link).toBe("accounting/hr-desk")
  })
})

describe("end of service", () => {
  const ID = exitId(ORG, "e1")
  it("started → Inventory clears the custody, government relations has the platform tasks; cleared → HR; approved → Finance; paid → the final exit", async () => {
    seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 4_000, housing: 1_000, transport: 1_000, iban: "SA1", ibanState: "ok" })
    await startExit(db, hrm, ORG, who(hrm), "e1", { reason: "resignation", lastDay: "2026-03-15", noticeOn: "2026-02-15" }, { today: "2026-03-01" })
    expect(one("wh", "hr_custody_requested")).toMatchObject({ link: "warehouses/custody", i18n: { params: { lastDay: "2026-03-15" } } })
    expect(one("gro", "hr_exit_started")?.link).toBe("hr/people/e1")
    expect(kinds("wu")).toEqual([])
    await clearCustody(db, { uid: "wh", name: "Store", allowed: true }, ID, { shortfall: 250 })
    expect(one("hrm", "hr_custody_cleared")).toMatchObject({ link: "hr/people/e1" })
    expect(JSON.stringify(one("hrm", "hr_custody_cleared"))).not.toMatch(/250/)
    await approveSettlement(db, hrm, ORG, who(hrm), ID, { sites, attendance: [], requests: [], violations: [] }, { today: "2026-03-16" })
    expect(one("fin", "hr_settlement_approved")?.link).toBe("accounting/hr-desk")
    const st = { id: ID, ...(readDoc(`hrSettlements/${ID}`) as Omit<HrSettlement, "id">) } as HrSettlement
    await paySettlement(db, fin, ORG, st, { accountingOn: false, date: "2026-03-20" })
    expect(one("gro", "hr_settlement_paid")?.i18n.params.name).toBe("أحمد")
  })
})

describe("workplaces, injuries, arrivals", () => {
  it("a manpower request → the HR manager; its answer → whoever asked, on the project's team", async () => {
    const id = await raiseManpowerRequest(db, { uid: "pm", name: "PM", allowed: true }, ORG, { projectId: "p1", projectName: "Tower", siteId: "s1", trade: "mason", count: 4, from: "2026-04-01" })
    expect(one("hrm", "hr_manpower_requested")).toMatchObject({ link: "hr/sites", i18n: { params: { project: "Tower", count: 4 } } })
    await answerManpowerRequest(db, hrm, id, who(hrm), { plan: [], excluded: [] })
    expect(one("pm", "hr_manpower_answered")?.link).toBe("/contractor/projects/p1?tab=team")
  })

  it("an assignment correction → the HR manager; the decision → the supervisor who raised it", async () => {
    seed("hrSites/s1", { ...sites[0] })
    seed("employees/e2", { ...empBase, no: 3, userId: null, siteId: null })
    const id = await raiseAssignFix(db, sup, ORG, who(sup), { employeeId: "e2", siteId: "s1", since: "2026-02-20" }, { today: "2026-03-01" })
    expect(one("hrm", "hr_assign_fix_raised")).toMatchObject({ link: "hr/sites/s1", i18n: { params: { site: "Tower", since: "2026-02-20" } } })
    await decideAssignFix(db, hrm, id, who(hrm), "decline", "he is on the bench", { today: "2026-03-01" })
    expect(one("sup", "hr_assign_fix_decided")?.i18n.params).toMatchObject({ verdict: "@hr_verdict.refused", note: "he is on the bench" })
  })

  it("an injury → government relations (GOSI in 3 working days); a visa arrival → his iqama within 90 days", async () => {
    await recordInjury(db, sup, ORG, who(sup), { employeeId: "e1", on: "2026-03-01", description: "fall" }, { today: "2026-03-01" })
    expect(one("gro", "hr_injury_recorded")).toMatchObject({ link: "hr/people/e1", i18n: { params: { on: "2026-03-01" } } })
    seed(`hrSettings/${ORG}`, { organizationId: ORG, establishment: { visas: 2 } })
    const { id } = await createEmployee(db, hrm, ORG, who(hrm), { nameAr: "راجو", nationality: "in", gender: "m", trade: "mason", siteId: null, join: "2026-03-01", source: "visa", contractType: "open", docs: {}, basic: 1_500 } as never, { visas: 2 })
    expect(one("gro", "hr_iqama_clock")).toMatchObject({ link: `hr/people/${id}`, i18n: { params: { join: "2026-03-01", date: "2026-05-30" } } })
  })

  it("an expired iqama on a site → government relations, once per lapse; not on the bench, not a Saudi", () => {
    const e = (id: string, over: Partial<HrEmployee>) => ({ ...empBase, id, ...over }) as HrEmployee
    const notices = iqamaOnSiteNotices(ORG, [e("a", { docs: { iqama: "2026-02-01" } }), e("b", { docs: { iqama: "2026-02-01" }, siteId: null }), e("c", { nationality: "sa", docs: {} }), e("d", {})], sites, "2026-03-01")
    expect(notices.map((n) => [n.once, n.params?.site])).toEqual([["a_2026-02-01", "Tower"]])
  })
})

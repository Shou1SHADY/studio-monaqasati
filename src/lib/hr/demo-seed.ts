// HR 1.0 — the UAT demo company's HR data (scripts/seed-hr-demo.ts writes it).
// Pure: it builds every document the seed writes, in the shapes the write layer
// writes them, computed by the module's own functions (payroll, leave, the
// settlement, penalties, document numbers) — so what a tester clicks through on
// UAT is what the app itself would have produced. Dates are relative to `today`
// (Riyadh's day), so a later run still makes a coherent month: last month's
// sheets closed and ready for payroll, the month before it paid, this month's
// sheet open with one forgotten day. No I/O, no clock: `today` comes in.

import { attendanceId, compactExceptions, dueDays, onLeaveOn, onSheet, type AttendanceException, type Declaration, type WorkplaceMonth } from "./attendance"
import { costKindOf, HR_ASSIGN_FIXES, UNASSIGNED_SITE, type AssignFix, type HrSite, type SiteType } from "./sites"
import { HR_ATTENDANCE, HR_EMPLOYEES, HR_EVENTS, HR_EXITS, HR_INJURIES, HR_LETTER_PAY, HR_LETTERS, HR_PAY, HR_PAYROLLS, HR_PAYSLIPS, HR_REQUESTS, HR_SETTLEMENTS, HR_SITES, HR_VIOLATIONS } from "./collections"
import { injuryReportDue, type DocDates } from "./documents"
import { probationEnd, type EmployeePay, type HrEmployee } from "./employee"
import { HR_COUNTERS, HR_LOG } from "./employee-writes"
import { exitId, settlementQuote, type ExitReason } from "./eos"
import { settlementLastMonth, type HrExit, type HrSettlement } from "./exit-writes"
import { payslipId } from "./finance-writes"
import { injuryState, type HrInjury } from "./injuries"
import { accruedDays, leaveBalance } from "./leave"
import { letterCardOf, LETTER_NUMBER_TYPE, type HrLetter, type LetterPay } from "./letters"
import { MANPOWER_REQUESTS, type ManpowerRequest } from "./manpower"
import { advanceInstalment, payFromBasic, payOn, wageOf, type PayStep } from "./pay"
import { computePayroll, eosEvent, payEvent, payrollId, payrollTotals, type Payroll, type Stamp } from "./payroll"
import { eventId } from "./payroll-writes"
import { advanceQuote, leaveQuote, REQUEST_NUMBER_TYPE, type HrRequest, type HrRequestKind } from "./requests"
import { HR_SETTINGS, type HrSettings } from "./settings"
import { addDays, DEFAULT_HR_POLICIES } from "./statutory"
import { tradeOf } from "./trades"
import { applyQuote, violationId, type HrViolation } from "./violations"
import { formatYearlyDocNumber } from "../sales-numbering"
import { MFG_COUNTERS } from "../manufacturing-engine"

/** Stands for `serverTimestamp()` — the script swaps it for the admin SDK's FieldValue. Top-level fields only. */
export const SERVER_TS = "__hrdemo_server_timestamp__" as const

/** Written into `hrSettings/{orgId}.demoSeed` — the seed refuses to run twice without `--force-update`. */
export const DEMO_SEED_TAG = "seed-hr-demo"
export const DEMO_SEED_VERSION = 1

export interface DemoMember {
  uid: string
  name: string | null
}

export interface HrDemoInput {
  orgId: string
  /** Riyadh's day (`todayDay()`). */
  today: string
  /** The org owner — the HR manager (owner passes every check) and the approver. */
  owner: DemoMember
  /** Finance — also payroll (`hr.payroll`): prepares the payroll the owner approves, then pays it. */
  finance: DemoMember | null
  /** The project site's supervisor (`hr.supervisor`). */
  supervisor: DemoMember | null
  /** The plain employee whose record is linked to his account (My file). */
  employee: DemoMember | null
  company?: { name?: string | null } | null
  /** The org's project, when it has one — the project site names it and Projects' manpower request is for it. */
  project?: { id: string; name: string } | null
  /** Sequences already used on the project: the employee number and the yearly `mfgCounters` (`{TYPE}__{year}` → last). */
  counters?: { lastEmployeeNo?: number; yearly?: Record<string, number> } | null
  /** Leave the workshop's last month recorded but NOT closed, so "close the month" can be clicked (payroll then waits for it). */
  leaveWorkshopOpen?: boolean
}

export interface DemoWrite {
  path: string
  data: Record<string, unknown>
  /** create: only if missing · counter: `last`/`lastEmployeeNo` raised to at least this value, never lowered. */
  mode: "create" | "counter"
  /** One line for the dry run. */
  note: string
}

export interface DemoLog {
  employeeId: string
  path: string
  entry: { organizationId: string; at: string; by: string; byName: string | null; kind: string; params: Record<string, string | number | null>; source: "hr" }
}

export interface HrDemo {
  months: { m0: string; m1: string; m2: string }
  settings: HrSettings & { organizationId: string }
  sites: HrSite[]
  employees: HrEmployee[]
  pays: Map<string, EmployeePay>
  attendance: WorkplaceMonth[]
  requests: HrRequest[]
  payroll: Payroll
  payslips: Array<{ id: string; employeeId: string; employeeUserId: string | null }>
  letters: HrLetter[]
  letterPay: Array<LetterPay & { letterId: string }>
  exits: Array<HrExit & Record<string, unknown>>
  settlements: HrSettlement[]
  violations: HrViolation[]
  injuries: HrInjury[]
  assignFixes: AssignFix[]
  manpower: ManpowerRequest[]
  logs: DemoLog[]
  counters: { lastEmployeeNo: number; yearly: Record<string, number> }
  /** Who is who, for the summary and the test. */
  ids: { projectSite: string; workshopSite: string; officeSite: string; linkedEmployee: string | null; leaving: string; leaver: string; visaArrival: string; expected: string; probation: string }
  /** Permissions the seed adds to a member's default group, so the flows run without new logins. */
  grants: Array<{ member: "finance" | "supervisor"; permission: string }>
  writes: DemoWrite[]
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, "0")
const prevMonth = (m: string) => addDays(`${m}-01`, -1).slice(0, 7)
const dayOf = (m: string, d: number) => `${m}-${pad(d)}`
/** An instant on a Riyadh day (UTC+3, no daylight saving). */
const at = (day: string, hour = 9, minute = 0) => new Date(`${day}T${pad(hour)}:${pad(minute)}:00+03:00`).toISOString()
const SEED_ACTOR: DemoMember = { uid: DEMO_SEED_TAG, name: null }
const stamp = (m: DemoMember, day: string, hour = 9, minute = 0): Stamp => ({ by: m.uid, byName: m.name, at: at(day, hour, minute) })

/** Deterministic ten-digit numbers: a Saudi ID starts 1, an iqama 2. */
const idNoOf = (saudi: boolean, n: number) => `${saudi ? 1 : 2}${pad((104729 * (n + 11) + 3571 * n * n) % 1_000_000_000, 9)}`
/** SA + 22 digits. */
const ibanOf = (n: number) => `SA${pad(10 + ((n * 7) % 89))}80000${pad(((n + 3) * 9_876_541) % 1_000_000_000_000_000, 15)}`

type SiteKey = "project" | "workshop" | "office"

interface Spec {
  key: string
  ar: string
  en: string
  nationality: string
  gender: "m" | "f"
  trade: string
  site: SiteKey | null
  join: string
  source: HrEmployee["source"]
  contract: HrEmployee["contract"]
  basic: number
  /** A raise: the basic before it and the day it took effect. */
  raise?: { from: string; oldBasic: number }
  docs: DocDates
  iban: boolean
  /** The leave balance he is meant to have today (days already taken make up the rest). */
  balance: number
  userId?: string | null
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function buildHrDemo(input: HrDemoInput): HrDemo {
  const { orgId, today: T } = input
  const owner = input.owner
  const finance = input.finance ?? SEED_ACTOR
  const supervisor = input.supervisor ?? SEED_ACTOR
  const m0 = T.slice(0, 7)
  const m1 = prevMonth(m0)
  const m2 = prevMonth(m1)
  const d = (n: number) => addDays(T, n)
  const writes: DemoWrite[] = []
  const logs: DemoLog[] = []
  const put = (path: string, data: Record<string, unknown>, note: string, mode: DemoWrite["mode"] = "create") => writes.push({ path, data, mode, note })
  const id = (what: string) => `hrdemo-${orgId}-${what}`

  // ---- sequences: after whatever the project already used --------------------
  const yearly: Record<string, number> = { ...(input.counters?.yearly ?? {}) }
  const draw = (type: string, day: string) => {
    const year = Number(day.slice(0, 4))
    const k = `${type}__${year}`
    yearly[k] = (yearly[k] ?? 0) + 1
    return formatYearlyDocNumber(type, year, yearly[k])
  }
  let lastNo = input.counters?.lastEmployeeNo ?? 0

  // ---- settings and workplaces -------------------------------------------------
  const establishment = { name: input.company?.name?.trim() || "شركة الرواد المتحدة للمقاولات", cr: "1010654321", mol: "13-1846251", gosi: "601284573", visas: 3, visasAsOf: d(-30) }
  const settings: HrSettings & { organizationId: string } = {
    features: [],
    policies: { ...DEFAULT_HR_POLICIES },
    businessType: "contractor",
    defaultsAppliedFor: "contractor",
    establishment,
    organizationId: orgId,
  }
  put(`${HR_SETTINGS}/${orgId}`, { ...settings, demoSeed: { tag: DEMO_SEED_TAG, version: DEMO_SEED_VERSION, today: T }, updatedAt: SERVER_TS, updatedBy: owner.uid }, `core features, contractor, ${establishment.visas} visas, default policies`)

  const site = (key: SiteKey, name: string, type: SiteType, extra: Partial<HrSite> = {}): HrSite => ({
    id: id(`site-${key}`),
    organizationId: orgId,
    name,
    type,
    projectId: null,
    endDate: null,
    supervisorEmployeeId: null,
    supervisorUserId: null,
    active: true,
    ...extra,
  })
  const sites: Record<SiteKey, HrSite> = {
    project: site("project", input.project ? `موقع ${input.project.name}` : "موقع برج الياسمين — حي الملقا", "project", {
      projectId: input.project?.id ?? null,
      endDate: d(180),
      supervisorUserId: input.supervisor?.uid ?? null,
    }),
    workshop: site("workshop", "الورشة المركزية — السلي", "workshop"),
    office: site("office", "المكتب الرئيسي — الرياض", "hq"),
  }
  for (const s of Object.values(sites)) {
    const { id: sid, ...data } = s
    put(`${HR_SITES}/${sid}`, { ...data, createdAt: SERVER_TS, updatedAt: SERVER_TS, updatedBy: owner.uid }, `${s.type}${s.supervisorUserId ? ", supervisor set" : ""}${s.projectId ? `, project ${s.projectId}` : ""}`)
  }

  // ---- people --------------------------------------------------------------------
  const leaverLastDay = dayOf(m2, 20)
  const leaverJoin = `${Number(leaverLastDay.slice(0, 4)) - 2}-${leaverLastDay.slice(5, 7)}-21`
  const leavingLastDay = d(-1) >= `${m0}-01` ? d(-1) : T
  const linkedName = input.employee?.name?.trim() || "فاطمة الزهراني"
  const specs: Spec[] = [
    { key: "01", ar: "فهد العنزي", en: "Fahad Al-Anazi", nationality: "sa", gender: "m", trade: "siteEngineer", site: "project", join: d(-2010), source: "local", contract: { type: "open", end: null }, basic: 9500, raise: { from: d(-365), oldBasic: 8500 }, docs: { insurance: d(240) }, iban: true, balance: 20 },
    { key: "02", ar: "محمد عبد الفتاح", en: "Mohamed Abdelfattah", nationality: "eg", gender: "m", trade: "foreman", site: "project", join: d(-1480), source: "transfer", contract: { type: "open", end: null }, basic: 3800, docs: { iqama: d(300), passport: d(1400), insurance: d(300) }, iban: true, balance: 14 },
    { key: "03", ar: "راجيش كومار", en: "Rajesh Kumar", nationality: "in", gender: "m", trade: "electrician", site: "project", join: d(-1100), source: "visa", contract: { type: "open", end: null }, basic: 2600, docs: { iqama: d(20), passport: d(1200), insurance: d(20) }, iban: true, balance: 11 },
    { key: "04", ar: "محمد عمران", en: "Muhammad Imran", nationality: "pk", gender: "m", trade: "steelFixer", site: "project", join: d(-760), source: "visa", contract: { type: "open", end: null }, basic: 2300, docs: { iqama: d(400), passport: d(800), insurance: d(400) }, iban: true, balance: 9 },
    // A visa arrival 100 days ago whose iqama was never issued: illegal on a site since day 90 (DC-05) — and no bank account yet.
    { key: "05", ar: "رحيم الدين", en: "Rahim Uddin", nationality: "bd", gender: "m", trade: "labourer", site: "project", join: d(-100), source: "visa", contract: { type: "open", end: null }, basic: 1500, docs: { passport: d(1500) }, iban: false, balance: 0 },
    // An expired passport before an iqama due within 180 days: the passport is renewed first (DC-03).
    { key: "06", ar: "خوسيه رييس", en: "Jose Reyes", nationality: "ph", gender: "m", trade: "mechanic", site: "workshop", join: d(-2250), source: "visa", contract: { type: "open", end: null }, basic: 3300, docs: { iqama: d(150), passport: d(-15), insurance: d(150) }, iban: true, balance: 24 },
    { key: "07", ar: "أحمد السيد", en: "Ahmed El-Sayed", nationality: "eg", gender: "m", trade: "stoneMason", site: "workshop", join: d(-540), source: "transfer", contract: { type: "fixed", end: d(200) }, basic: 2700, docs: { iqama: d(500), passport: d(1100), insurance: d(200), contract: d(200) }, iban: true, balance: 10 },
    // Resigned — his exit is started and Inventory has not cleared his custody yet.
    { key: "08", ar: "سوريش ناير", en: "Suresh Nair", nationality: "in", gender: "m", trade: "welder", site: "workshop", join: d(-930), source: "visa", contract: { type: "open", end: null }, basic: 2600, docs: { iqama: d(380), passport: d(900), insurance: d(380) }, iban: true, balance: 12 },
    // Joined two months ago: on probation (art. 53), on the new GOSI scheme.
    { key: "09", ar: "عبدالله الدوسري", en: "Abdullah Al-Dosari", nationality: "sa", gender: "m", trade: "security", site: "project", join: d(-60), source: "local", contract: { type: "open", end: null }, basic: 4000, docs: { insurance: d(300) }, iban: true, balance: 0 },
    { key: "10", ar: "نورة القحطاني", en: "Noura Al-Qahtani", nationality: "sa", gender: "f", trade: "hrOfficer", site: "office", join: d(-1200), source: "local", contract: { type: "open", end: null }, basic: 8000, docs: { insurance: d(280) }, iban: true, balance: 16 },
    // The employee behind the demo "employee" account — her My file.
    { key: "11", ar: linkedName, en: linkedName === "فاطمة الزهراني" ? "Fatimah Al-Zahrani" : "", nationality: "sa", gender: "f", trade: "accountant", site: "office", join: d(-1500), source: "local", contract: { type: "open", end: null }, basic: 7500, docs: { insurance: d(260) }, iban: true, balance: 15, userId: input.employee?.uid ?? null },
    // Starts next week (an iqama transfer).
    { key: "12", ar: "يوسف الخطيب", en: "Yousef Al-Khatib", nationality: "jo", gender: "m", trade: "surveyor", site: "project", join: d(7), source: "transfer", contract: { type: "open", end: null }, basic: 4500, docs: { iqama: d(330), passport: d(1000), insurance: d(330) }, iban: true, balance: 0 },
    // Left at his contract's end in the month before last — settled and paid.
    { key: "13", ar: "سالم باوزير", en: "Salem Bawazir", nationality: "ye", gender: "m", trade: "carpenter", site: "project", join: leaverJoin, source: "transfer", contract: { type: "fixed", end: leaverLastDay }, basic: 2300, docs: { iqama: addDays(leaverLastDay, 200), passport: addDays(leaverLastDay, 700), insurance: leaverLastDay }, iban: true, balance: 8 },
  ]
  const empId = (key: string) => id(`emp-${key}`)
  const movingIn = addDays(`${m2}-01`, -5)
  const employees: HrEmployee[] = []
  const pays = new Map<string, EmployeePay>()
  let logSeq = 0
  const log = (employeeId: string, actor: DemoMember, when: string, kind: string, params: Record<string, string | number | null> = {}) => {
    logSeq += 1
    logs.push({ employeeId, path: `${HR_EMPLOYEES}/${employeeId}/${HR_LOG}/hrdemo-${pad(logSeq, 3)}`, entry: { organizationId: orgId, at: when, by: actor.uid, byName: actor.name, kind, params, source: "hr" } })
  }

  for (const [i, s] of specs.entries()) {
    lastNo += 1
    const eid = empId(s.key)
    const trade = tradeOf(s.trade)!
    const createdOn = s.join > T ? d(-3) : s.join < movingIn ? movingIn : s.join
    const taken = s.join > T ? 0 : Math.max(0, Math.floor(accruedDays(s.join, T)) - s.balance)
    const emp: HrEmployee = {
      id: eid,
      organizationId: orgId,
      no: lastNo,
      names: { ar: s.ar, en: s.en || null },
      nationality: s.nationality,
      gender: s.gender,
      idNo: idNoOf(s.nationality === "sa", lastNo),
      trade: s.trade,
      category: trade.category,
      siteId: s.site ? sites[s.site].id : null,
      managerId: null,
      userId: s.userId ?? null,
      join: s.join,
      since: null,
      source: s.source,
      contract: s.contract,
      probation: { end: probationEnd(s.join), consentOn: null, decision: null, decidedOn: null },
      status: s.join > T ? "expected" : "active",
      docs: s.docs,
      leaveTaken: taken,
      openingLeave: 0,
      sick: null,
      hajjTaken: false,
    }
    employees.push(emp)
    const now = payFromBasic(s.basic, settings.policies)
    const steps: PayStep[] = s.raise ? [{ from: "", ...payFromBasic(s.raise.oldBasic, settings.policies) }, { from: s.raise.from, ...now }] : [{ from: "", ...now }]
    pays.set(eid, { employeeId: eid, organizationId: orgId, ...now, iban: s.iban ? ibanOf(i + 1) : null, ibanState: s.iban ? "ok" : null, advance: null, retro: [], steps })
    log(eid, owner, at(createdOn, 10, 0), "created", { no: emp.no, site: emp.siteId, trade: emp.trade })
    if (s.raise) log(eid, owner, at(s.raise.from, 11, 0), "pay_changed", { on: s.raise.from, reason: "زيادة سنوية بعد التقييم", trade: null })
  }
  const E = (key: string) => employees.find((e) => e.id === empId(key))!
  const set = (key: string, patch: Partial<HrEmployee>) => Object.assign(E(key), patch)

  // An advance outstanding from before the system (taken back every month — no request behind it, AD-01).
  const advanceOwner = E("02")
  const advancePay = pays.get(advanceOwner.id)!
  const advanceAmount = 2400
  advancePay.advance = { amount: advanceAmount, balance: advanceAmount, instalment: advanceInstalment(wageOf(advancePay)) }

  // ---- the two leavers ---------------------------------------------------------------
  const leaving = E("08")
  set("08", { status: "leaving", lastDay: leavingLastDay })
  const leaver = E("13")
  set("13", { status: "left", lastDay: leaverLastDay })
  const linked = input.employee ? E("11") : null
  if (!linked) set("11", { userId: null })

  // ---- requests (numbers drawn in filing order, as request-writes draws them) --------
  const requests: HrRequest[] = []
  const projectSite = sites.project
  const lineManager = (e: HrEmployee) => {
    const s = Object.values(sites).find((x) => x.id === e.siteId)
    return { lineManagerId: s?.supervisorEmployeeId && s.supervisorEmployeeId !== e.id ? s.supervisorEmployeeId : null, lineManagerUserId: s?.supervisorUserId && s.supervisorUserId !== e.userId ? s.supervisorUserId : null }
  }
  const request = (key: string, e: HrEmployee, kind: HrRequestKind, filer: DemoMember, filedAt: string, body: Partial<HrRequest>): HrRequest => {
    const r: HrRequest = {
      id: id(`req-${key}`),
      organizationId: orgId,
      no: draw(REQUEST_NUMBER_TYPE[kind], filedAt.slice(0, 10)),
      kind,
      employeeId: e.id,
      employeeUserId: e.userId ?? null,
      employeeName: e.names.ar,
      siteId: e.siteId ?? null,
      ...lineManager(e),
      deciderLevel: "manager",
      filedBy: { by: filer.uid, byName: filer.name, at: filedAt, note: null },
      onBehalf: filer.uid !== e.userId,
      state: "pending",
      createdAt: filedAt,
      ...body,
    }
    requests.push(r)
    log(e.id, filer, filedAt, `${kind}_filed`, { no: r.no })
    return r
  }

  // 1. An annual leave last month, endorsed by the site's supervisor and approved; he came back on time.
  const onLeave = E("01")
  {
    const from = dayOf(m1, 8)
    const to = dayOf(m1, 14)
    const filed = at(dayOf(m1, 1), 10)
    const q = leaveQuote(onLeave, { type: "annual", from, to, mode: null }, { deciding: true })
    if (q.blocks.length) throw new Error(`demo leave blocked: ${q.blocks.join(",")}`)
    const r = request("lv-approved", onLeave, "leave", owner, filed, {
      state: "approved",
      leave: { type: "annual", from, to: q.to, days: q.days, balance: q.balance, fromBalance: q.fromBalance, unpaidDays: q.unpaidDays, mode: null, requestedTo: null, travel: q.travel, sick: q.sick, note: "إجازة سنوية — زيارة الأهل في حائل" },
      endorsement: { ...stamp(supervisor, dayOf(m1, 1), 13), note: null },
      decision: { ...stamp(owner, dayOf(m1, 2), 11), note: null, ownFlagged: false },
      returned: { on: addDays(q.to, 1), by: supervisor.uid, byName: supervisor.name, at: at(addDays(q.to, 1), 8, 30), lateDays: 0 },
    })
    set("01", { leaveTaken: onLeave.leaveTaken + q.fromBalance })
    log(onLeave.id, owner, at(dayOf(m1, 2), 11), "leave_approved", { no: r.no, from, to: q.to })
    log(onLeave.id, supervisor, at(addDays(q.to, 1), 8, 30), "leave_returned", { no: r.no, on: addDays(q.to, 1), late: 0 })
  }

  // 2. A data update from My file (a new mobile), approved — applied to the record.
  const dataPerson = linked ?? E("10")
  const dataFiler = linked ? input.employee! : owner
  {
    const filed = at(d(-12), 12)
    const r = request("hq-mobile", dataPerson, "data", dataFiler, filed, {
      state: "approved",
      data: { field: "mobile", value: "0553184729", document: null },
      decision: { ...stamp(owner, d(-11), 10), note: "تم التحديث", ownFlagged: false },
    })
    Object.assign(dataPerson, { contact: { mobile: "0553184729" } })
    log(dataPerson.id, owner, at(d(-11), 10), "data_updated", { no: r.no, field: "mobile" })
  }

  // 3. An advance asked for on a worker's behalf, waiting for the HR manager.
  const advanceAsker = E("04")
  {
    const q = advanceQuote(payOn(pays.get(advanceAsker.id)!, T), { amount: 1500, reason: "ظروف عائلية — علاج الوالدة" }, { policies: settings.policies, today: T })
    if (q.blocks.length) throw new Error(`demo advance blocked: ${q.blocks.join(",")}`)
    request("av-pending", advanceAsker, "advance", owner, at(d(-2), 9, 30), { advance: { amount: 1500, reason: "ظروف عائلية — علاج الوالدة", instalment: q.instalment, months: q.months, overLimit: q.overLimit } })
  }

  // 4. A leave the linked employee filed from My file, waiting for HR.
  const pendingLeaver = linked ?? E("10")
  {
    const from = d(10)
    const to = d(16)
    const q = leaveQuote(pendingLeaver, { type: "annual", from, to }, {})
    if (q.blocks.length) throw new Error(`demo pending leave blocked: ${q.blocks.join(",")}`)
    request("lv-pending", pendingLeaver, "leave", linked ? input.employee! : owner, at(d(-1), 16), {
      leave: { type: "annual", from, to, days: q.days, balance: q.balance, fromBalance: q.fromBalance, unpaidDays: q.unpaidDays, travel: q.travel, sick: q.sick, note: "إجازة سنوية" },
    })
  }

  // ---- attendance -------------------------------------------------------------------
  const attendance: WorkplaceMonth[] = []
  const on = (key: string) => empId(key)
  type ExPlan = Array<[number, string, AttendanceException]>
  const sheetMonth = (s: HrSite, month: string, opts: { recorder: DemoMember; plan: ExPlan; declare?: { index: number; note: string } | null; skipIndex?: number | null; closer?: DemoMember | null; closeOn?: string | null }) => {
    const due = dueDays(month, T)
    const skip = new Set<string>()
    if (opts.skipIndex != null && due[opts.skipIndex]) skip.add(due[opts.skipIndex])
    const declared = opts.declare && due[opts.declare.index] ? due[opts.declare.index] : null
    if (declared) skip.add(declared)
    const days: WorkplaceMonth["days"] = {}
    for (const [n, day] of due.entries()) {
      if (skip.has(day)) continue
      const listed = employees.filter((e) => onSheet(e, s.id, day)).map((e) => e.id)
      const leave = onLeaveOn(requests, day)
      const raw: Record<string, AttendanceException> = {}
      for (const [i, who, ex] of opts.plan) if (i === n && listed.includes(who) && !leave.has(who)) raw[who] = { ...raw[who], ...ex }
      days[day] = { by: opts.recorder.uid, byName: opts.recorder.name, at: at(day, 17, 30), listed, ex: compactExceptions(raw), unlisted: [] }
    }
    const declarations: Declaration[] = declared
      ? [{ days: [declared], employees: employees.filter((e) => onSheet(e, s.id, declared)).map((e) => e.id), by: opts.recorder.uid, byName: opts.recorder.name, at: at(addDays(declared, 2), 9), note: opts.declare!.note }]
      : []
    const wm: WorkplaceMonth = {
      id: attendanceId(orgId, s.id, month),
      organizationId: orgId,
      siteId: s.id,
      month,
      days,
      declarations,
      closed: opts.closer && opts.closeOn ? { by: opts.closer.uid, byName: opts.closer.name, at: at(opts.closeOn, 9), asIs: false, missing: [] } : null,
    }
    attendance.push(wm)
    return wm
  }
  const firstOf = (m: string) => `${m}-01`
  // The month before last — closed on the first of last month, paid since.
  sheetMonth(projectSite, m2, { recorder: supervisor, plan: [[2, on("13"), { ot: 1 }], [3, on("04"), { status: "absent" }], [5, on("02"), { ot: 2 }], [9, on("03"), { ot: 2.5 }]], closer: supervisor, closeOn: firstOf(m1) })
  sheetMonth(sites.workshop, m2, { recorder: owner, plan: [[7, on("06"), { ot: 3 }], [11, on("07"), { ot: 2 }]], closer: finance, closeOn: firstOf(m1) })
  // Last month — closed on the first of this month; one forgotten day filled by a named declaration.
  sheetMonth(projectSite, m1, {
    recorder: supervisor,
    plan: [
      [2, on("02"), { ot: 2 }],
      [4, on("03"), { ot: 3 }],
      [6, on("04"), { status: "absent", note: "لم يحضر ولم يبلغ" }],
      [9, on("02"), { ot: 2 }],
      [11, on("03"), { status: "permission", note: "مراجعة الجوازات" }],
      [12, on("04"), { status: "sick", note: "تقرير طبي من المستوصف" }],
      [13, on("09"), { ot: 1 }],
      [15, on("02"), { ot: 2 }],
    ],
    declare: { index: 1, note: "لم يُسجَّل كشف اليوم لانقطاع الشبكة في الموقع — حضر الجميع حسب سجل الحارس" },
    closer: supervisor,
    closeOn: firstOf(m0),
  })
  sheetMonth(sites.workshop, m1, {
    recorder: owner,
    plan: [[3, on("06"), { ot: 2 }], [5, on("08"), { ot: 1.5 }], [8, on("07"), { status: "absent" }], [10, on("06"), { ot: 2 }]],
    closer: input.leaveWorkshopOpen ? null : finance,
    closeOn: input.leaveWorkshopOpen ? null : firstOf(m0),
  })
  // This month, on the project site: the days so far, the first one left unrecorded for a declaration.
  const m0Due = dueDays(m0, T)
  const lastRecordedIdx = m0Due.length - 1 >= 1 ? m0Due.length - 1 : null
  const sheetViolationDay = lastRecordedIdx != null ? m0Due[lastRecordedIdx] : null
  if (m0Due.length)
    sheetMonth(projectSite, m0, {
      recorder: supervisor,
      plan: lastRecordedIdx != null ? [[lastRecordedIdx, on("02"), { ot: 2 }], [lastRecordedIdx, on("03"), { violation: "late15", note: "تأخر عن بداية الوردية" }]] : [],
      skipIndex: 0,
    })

  // ---- the month before last: payroll prepared by payroll, approved by the owner, paid by Finance ----
  const payrollDocId = payrollId(orgId, m2)
  // Violations so far all fall in this month: none reaches the month before last.
  const computed = computePayroll({ month: m2, employees, pays, sites: Object.values(sites), attendance, requests, previous: null, violations: [] })
  if (computed.missingPay.length) throw new Error(`demo payroll: no pay for ${computed.missingPay.join(",")}`)
  const prepared = stamp(finance, dayOf(m1, 2), 10)
  const approved = stamp(owner, dayOf(m1, 3), 9)
  const paidDay = dayOf(m1, settings.policies.payDay)
  const paidStamp = { ...stamp(finance, paidDay, 12), date: paidDay }
  const payroll: Payroll & { totals: ReturnType<typeof payrollTotals>; ownFlagged: boolean } = {
    id: payrollDocId,
    organizationId: orgId,
    month: m2,
    key: m2,
    kind: "main",
    state: "paid",
    lines: computed.lines,
    prepared,
    approved,
    // Accounting may be off on UAT: Finance pays an approved payroll without posting it (no journal entry is seeded).
    posted: null,
    paid: paidStamp,
    totals: payrollTotals(computed.lines),
    ownFlagged: false,
  }
  // Approval took each instalment off the advance it was computed on.
  for (const l of computed.lines) {
    const p = pays.get(l.employeeId)
    if (p?.advance && l.advance > 0) {
      const balance = Math.round((p.advance.balance - l.advance) * 100) / 100
      p.advance = balance > 0 ? { ...p.advance, balance } : null
    }
  }

  // ---- violations ---------------------------------------------------------------------
  const violations: HrViolation[] = []
  {
    // Decided after a hearing, told today or two days ago — inside the 15-day objection window, deducted this month.
    const who = E("07")
    const decided = d(-2) >= `${m0}-01` ? d(-2) : T
    const vOn = addDays(decided, -3)
    const q = applyQuote({ code: "late30", on: vOn, state: "recorded" }, { hearingOn: decided, today: decided, wage: wageOf(payOn(pays.get(who.id)!, decided)), history: [] })
    const v: HrViolation = {
      id: violationId(orgId, who.id, vOn, "late30"),
      organizationId: orgId,
      employeeId: who.id,
      employeeUserId: who.userId ?? null,
      employeeName: who.names.ar,
      siteId: who.siteId ?? null,
      code: "late30",
      on: vOn,
      note: "تأخر 25 دقيقة عن بداية الدوام",
      source: "manual",
      state: "applied",
      recorded: stamp(owner, vOn, 12),
      hearing: { on: decided, note: "حضر جلسة الاستماع وأقر بالتأخير" },
      step: q.step,
      stepKind: q.stepKind,
      amount: q.amount,
      deductMonth: decided.slice(0, 7),
      notifiedOn: decided,
      decision: { ...stamp(owner, decided, 11), note: "الخطوة الأولى من لائحة الجزاءات" },
    }
    violations.push(v)
    log(who.id, owner, v.recorded.at, "violation_recorded", { code: v.code, on: v.on })
    log(who.id, owner, v.decision!.at, "penalty_applied", { code: v.code, on: v.on, step: q.step + 1 })
  }
  {
    // Recorded on this month's sheet by the supervisor — waiting for the HR manager's hearing.
    const who = E("03")
    const vOn = sheetViolationDay ?? T
    const v: HrViolation = {
      id: violationId(orgId, who.id, vOn, "late15"),
      organizationId: orgId,
      employeeId: who.id,
      employeeUserId: who.userId ?? null,
      employeeName: who.names.ar,
      siteId: who.siteId ?? null,
      code: "late15",
      on: vOn,
      note: sheetViolationDay ? null : "تأخر عن بداية الوردية",
      source: sheetViolationDay ? "sheet" : "manual",
      state: "recorded",
      recorded: { by: supervisor.uid, byName: supervisor.name, at: at(vOn, 17, 30) },
    }
    violations.push(v)
    if (!sheetViolationDay) log(who.id, supervisor, v.recorded.at, "violation_recorded", { code: v.code, on: v.on })
  }

  // ---- letters ------------------------------------------------------------------------
  const letters: HrLetter[] = []
  const letterPay: Array<LetterPay & { letterId: string }> = []
  const head = { name: establishment.name, cr: establishment.cr, mol: establishment.mol }

  // ---- exits and the settlement ----------------------------------------------------------
  const exits: Array<HrExit & Record<string, unknown>> = []
  const settlements: HrSettlement[] = []
  {
    // The finished leaver: contract ended, custody cleared, settlement approved and paid, certificate issued.
    const started = stamp(owner, dayOf(m2, 2), 10)
    const cleared = stamp(owner, dayOf(m2, 21), 11)
    const sApproved = stamp(owner, dayOf(m1, 3), 12)
    const sPaid = { ...stamp(finance, dayOf(m1, 6), 12), date: dayOf(m1, 6) }
    const xid = exitId(orgId, leaver.id)
    const pay = pays.get(leaver.id)!
    const lastMonth = settlementLastMonth(leaver, pay, leaverLastDay, { sites: Object.values(sites), attendance, requests, violations, previous: null, paidMain: payroll })
    const reason: ExitReason = "contract_end"
    const q = settlementQuote(
      { wage: wageOf(payOn(pay, leaverLastDay)), join: leaver.join, lastDay: leaverLastDay, reason, leaveTaken: leaver.leaveTaken, openingLeave: leaver.openingLeave ?? 0, art77: false, contract: leaver.contract, ticket: 0, advanceBalance: 0, custodyShortfall: 0, lastMonth },
      leaveBalance
    )
    const settlement: HrSettlement & { paid: typeof sPaid; entryId: null } = {
      ...q,
      id: xid,
      organizationId: orgId,
      employeeId: leaver.id,
      employeeUserId: leaver.userId ?? null,
      no: leaver.no,
      lastDay: leaverLastDay,
      reason,
      siteId: leaver.siteId,
      costKind: leaver.siteId ? costKindOf(projectSite.type) : "admin",
      projectId: projectSite.projectId ?? null,
      paidAfter: [],
      state: "paid",
      approved: sApproved,
      paid: sPaid,
      entryId: null,
    }
    settlements.push(settlement)
    exits.push({
      id: xid,
      organizationId: orgId,
      employeeId: leaver.id,
      employeeUserId: leaver.userId ?? null,
      employeeName: leaver.names.ar,
      no: leaver.no,
      siteId: leaver.siteId,
      reason,
      noticeOn: null,
      lastDay: leaverLastDay,
      art77: false,
      note: "انتهاء العقد محدد المدة وعدم تجديده",
      state: "paid",
      started,
      custody: { state: "cleared", requestedAt: started.at, by: cleared.by, byName: cleared.byName, at: cleared.at, shortfall: null, note: "سلّم العدة والخوذة وبطاقة الدخول" },
      tasks: { gosi: stamp(owner, dayOf(m1, 7), 10), insurance: stamp(owner, dayOf(m1, 7), 11), finalExit: stamp(owner, dayOf(m1, 8), 10) },
      settled: sApproved,
      paid: sPaid,
    })
    log(leaver.id, owner, started.at, "exit_started", { reason, lastDay: leaverLastDay })
    log(leaver.id, owner, sApproved.at, "settlement_approved", { lastDay: leaverLastDay })
    // The experience certificate (art. 64), filed and issued with the settlement.
    const issuedOn = dayOf(m1, 3)
    const serial = draw(LETTER_NUMBER_TYPE, issuedOn)
    letters.push({
      id: id("letter-exp"),
      organizationId: orgId,
      kind: "exp",
      title: null,
      purpose: null,
      addressee: "لمن يهمه الأمر",
      lang: "ar",
      employeeId: leaver.id,
      employeeUserId: leaver.userId ?? null,
      employeeName: leaver.names.ar,
      signerLevel: "manager",
      filedBy: { ...sApproved, note: null },
      onBehalf: true,
      state: "issued",
      createdAt: sApproved.at,
      serial,
      issuedOn,
      text: null,
      card: letterCardOf(leaver),
      head,
      travel: null,
      decision: { ...stamp(owner, issuedOn, 12, 5), note: null, role: "manager", ownFlagged: false },
    })
    log(leaver.id, owner, sApproved.at, "letter_filed", { letter: "exp", addressee: "لمن يهمه الأمر" })
    log(leaver.id, owner, at(issuedOn, 12, 5), "letter_issued", { letter: "exp", addressee: "لمن يهمه الأمر", serial })
  }
  {
    // The one leaving now: resigned, last day yesterday — Inventory has his custody to clear (flow 6).
    const started = stamp(owner, d(-20), 10)
    exits.push({
      id: exitId(orgId, leaving.id),
      organizationId: orgId,
      employeeId: leaving.id,
      employeeUserId: leaving.userId ?? null,
      employeeName: leaving.names.ar,
      no: leaving.no,
      siteId: leaving.siteId,
      reason: "resignation",
      noticeOn: addDays(leavingLastDay, -30),
      lastDay: leavingLastDay,
      art77: false,
      note: "استقالة — قدّم إشعاره قبل ثلاثين يوماً",
      state: "leaving",
      started,
      custody: { state: "requested", requestedAt: started.at },
      tasks: {},
    })
    log(leaving.id, owner, started.at, "exit_started", { reason: "resignation", lastDay: leavingLastDay })
  }

  // The linked employee's salary letter: asked from My file, signed by the HR manager.
  if (linked) {
    const filed = at(d(-6), 10)
    const issuedOn = d(-5)
    const serial = draw(LETTER_NUMBER_TYPE, issuedOn)
    const lid = id("letter-sal")
    letters.push({
      id: lid,
      organizationId: orgId,
      kind: "sal",
      title: null,
      purpose: null,
      addressee: "البنك الأهلي السعودي",
      lang: "ar",
      employeeId: linked.id,
      employeeUserId: linked.userId ?? null,
      employeeName: linked.names.ar,
      signerLevel: "manager",
      filedBy: { by: input.employee!.uid, byName: input.employee!.name, at: filed, note: null },
      onBehalf: false,
      state: "issued",
      createdAt: filed,
      serial,
      issuedOn,
      text: null,
      card: letterCardOf(linked),
      head,
      travel: null,
      decision: { ...stamp(owner, issuedOn, 9, 30), note: null, role: "manager", ownFlagged: false },
    })
    const p = pays.get(linked.id)!
    letterPay.push({ letterId: lid, organizationId: orgId, employeeId: linked.id, employeeUserId: linked.userId ?? null, basic: p.basic, housing: p.housing, transport: p.transport })
    log(linked.id, input.employee!, filed, "letter_filed", { letter: "sal", addressee: "البنك الأهلي السعودي" })
    log(linked.id, owner, at(issuedOn, 9, 30), "letter_issued", { letter: "sal", addressee: "البنك الأهلي السعودي", serial })
  }
  {
    // A no-objection letter asked for a worker, waiting in the HR manager's queue on Today.
    const who = E("02")
    const filed = at(d(-3), 11)
    letters.push({
      id: id("letter-noc"),
      organizationId: orgId,
      kind: "noc",
      title: null,
      purpose: "لا مانع لدى الشركة من استقدام زوجته وأبنائه بتأشيرة زيارة عائلية لمدة ثلاثة أشهر",
      addressee: "المديرية العامة للجوازات",
      lang: "ar",
      employeeId: who.id,
      employeeUserId: who.userId ?? null,
      employeeName: who.names.ar,
      signerLevel: "manager",
      filedBy: { by: owner.uid, byName: owner.name, at: filed, note: null },
      onBehalf: true,
      state: "pending",
      createdAt: filed,
    })
    log(who.id, owner, filed, "letter_filed", { letter: "noc", addressee: "المديرية العامة للجوازات" })
  }

  // ---- the supervisor's site: an injury to report and a correction by ID number ----------
  const injuries: HrInjury[] = []
  {
    const who = E("04")
    const injOn = d(-3)
    const recorded = stamp(supervisor, injOn, 14)
    injuries.push({
      id: id("injury-1"),
      organizationId: orgId,
      employeeId: who.id,
      employeeUserId: who.userId ?? null,
      employeeName: who.names.ar,
      siteId: who.siteId ?? null,
      on: injOn,
      description: "جرح في اليد اليسرى أثناء قص حديد التسليح — أُسعف في الموقع ونُقل إلى المستوصف",
      due: injuryReportDue(injOn),
      recorded,
      report: null,
    })
    log(who.id, supervisor, recorded.at, "injury_recorded", { on: injOn })
  }
  const assignFixes: AssignFix[] = []
  {
    const who = E("06")
    assignFixes.push({
      id: id("assignfix-1"),
      organizationId: orgId,
      employeeId: null,
      idNo: who.idNo ?? null,
      employeeName: "خوسيه رييس",
      fromSiteId: null,
      siteId: projectSite.id,
      since: d(-3),
      note: "يعمل معنا في صيانة المعدات منذ ثلاثة أيام بطلب مدير المشروع وليس في كشفي",
      by: supervisor.uid,
      byName: supervisor.name,
      at: at(d(-2), 10),
      state: "pending",
      decision: null,
    })
  }
  const manpower: ManpowerRequest[] = []
  if (input.project)
    manpower.push({
      id: id("manpower-1"),
      organizationId: orgId,
      projectId: input.project.id,
      projectName: input.project.name,
      siteId: projectSite.id,
      trade: "mason",
      count: 3,
      from: d(14),
      note: "لأعمال البلوك في الدور الثالث",
      state: "open",
      requested: stamp(owner, d(-1), 12),
      answer: null,
    })

  // ---- documents to write ------------------------------------------------------------------
  for (const e of employees) {
    const { id: eid, ...data } = e
    const p = pays.get(eid)!
    put(`${HR_EMPLOYEES}/${eid}`, { ...data, name: e.names.ar, createdAt: SERVER_TS, updatedAt: SERVER_TS }, `#${e.no} ${e.names.en || e.names.ar} · ${e.nationality} · ${e.trade} · ${e.siteId ?? UNASSIGNED_SITE} · ${e.status}${e.userId ? " · linked to a user" : ""}`)
    put(`${HR_PAY}/${eid}`, { ...p, updatedAt: SERVER_TS }, `basic ${p.basic}${p.iban ? "" : " · no IBAN"}${p.advance ? ` · advance balance ${p.advance.balance}` : ""}`)
  }
  for (const l of logs) put(l.path, { ...l.entry }, `log ${l.entry.kind}`)
  for (const wm of attendance) {
    const { id: aid, ...data } = wm
    put(`${HR_ATTENDANCE}/${aid}`, { ...data, updatedAt: SERVER_TS }, `${Object.keys(wm.days).length} days recorded${wm.declarations.length ? `, ${wm.declarations.length} declaration` : ""}${wm.closed ? ", closed" : ", open"}`)
  }
  for (const r of requests) {
    const { id: rid, ...data } = r
    put(`${HR_REQUESTS}/${rid}`, { ...data, updatedAt: SERVER_TS }, `${r.no} ${r.kind} · ${r.state} · ${r.employeeName}`)
  }
  {
    const { id: pid, ...data } = payroll
    put(`${HR_PAYROLLS}/${pid}`, { ...data, updatedAt: SERVER_TS }, `${m2} main · paid · ${payroll.lines.length} lines · net ${payroll.totals.net}`)
    const pe = payEvent(payroll)
    const ee = eosEvent(payroll)
    const base = { organizationId: orgId, month: m2, payrollId: payrollDocId, payrollKey: m2, sent: approved, createdAt: SERVER_TS }
    put(`${HR_EVENTS}/${eventId(orgId, pe.key)}`, { ...base, state: "paid", kind: "PAY", ...pe, paid: paidStamp, updatedAt: SERVER_TS }, `${pe.key} · paid (no journal entry)`)
    put(`${HR_EVENTS}/${eventId(orgId, ee.key)}`, { ...base, state: "sent", kind: "EOS", ...ee }, `${ee.key} · sent (posting is Finance's, with Accounting on)`)
  }
  const payslips: HrDemo["payslips"] = []
  for (const l of payroll.lines.filter((x) => !x.held)) {
    const sid = payslipId(payrollDocId, l.employeeId)
    payslips.push({ id: sid, employeeId: l.employeeId, employeeUserId: l.userId ?? null })
    put(`${HR_PAYSLIPS}/${sid}`, { organizationId: orgId, payrollId: payrollDocId, key: m2, month: m2, kind: "main", employeeId: l.employeeId, employeeUserId: l.userId ?? null, line: l, paidOn: paidDay, createdAt: SERVER_TS }, `#${l.no} ${m2}`)
  }
  for (const s of settlements) {
    const fs = `hr:FS:${s.no}`
    const { id: sid, ...data } = s
    put(`${HR_SETTLEMENTS}/${sid}`, { ...data, updatedAt: SERVER_TS }, `#${s.no} ${s.reason} · net ${s.net} · paid`)
    put(`${HR_EVENTS}/${eventId(orgId, fs)}`, { organizationId: orgId, key: fs, kind: "FS", month: s.lastDay.slice(0, 7), settlementId: sid, state: "paid", sent: s.approved, net: s.net, createdAt: SERVER_TS, paid: (s as HrSettlement & { paid: unknown }).paid, entryId: null, updatedAt: SERVER_TS }, `${fs} · paid (no journal entry)`)
  }
  for (const x of exits) {
    const { id: xid, ...data } = x
    put(`${HR_EXITS}/${xid}`, { ...data, updatedAt: SERVER_TS }, `#${x.no} ${x.reason} · ${x.state} · custody ${x.custody.state}`)
  }
  for (const l of letters) {
    const { id: lid, ...data } = l
    put(`${HR_LETTERS}/${lid}`, { ...data, updatedAt: SERVER_TS }, `${l.kind} · ${l.state}${l.serial ? ` ${l.serial}` : ""} · ${l.employeeName}`)
  }
  for (const lp of letterPay) {
    const { letterId, ...data } = lp
    put(`${HR_LETTER_PAY}/${letterId}`, { ...data, updatedAt: SERVER_TS }, `figures of ${letterId}`)
  }
  for (const v of violations) {
    const { id: vid, ...data } = v
    put(`${HR_VIOLATIONS}/${vid}`, { ...data, updatedAt: SERVER_TS }, `${v.code} · ${v.state} · ${v.employeeName}`)
  }
  for (const i of injuries) {
    const { id: iid, ...data } = i
    put(`${HR_INJURIES}/${iid}`, { ...data, updatedAt: SERVER_TS }, `on ${i.on} · GOSI report ${injuryState(i, T)} by ${i.due}`)
  }
  for (const f of assignFixes) {
    const { id: fid, ...data } = f
    put(`${HR_ASSIGN_FIXES}/${fid}`, { ...data, updatedAt: SERVER_TS }, `by ID ${f.idNo} · ${f.state}`)
  }
  for (const m of manpower) {
    const { id: mid, ...data } = m
    put(`${MANPOWER_REQUESTS}/${mid}`, { ...data, updatedAt: SERVER_TS }, `${m.count} × ${m.trade} from ${m.from} · ${m.state}`)
  }

  // ---- sequences: raised to what was used, never lowered --------------------------------------
  const used = (k: string) => (yearly[k] ?? 0) > (input.counters?.yearly?.[k] ?? 0)
  for (const [k, last] of Object.entries(yearly)) {
    if (!used(k)) continue
    const [type, year] = k.split("__")
    put(`${MFG_COUNTERS}/${orgId}__${type}__${year}`, { organizationId: orgId, type, year: Number(year), last, updatedAt: SERVER_TS }, `${type} ${year} → at least ${last}`, "counter")
  }
  put(`${HR_COUNTERS}/${orgId}`, { organizationId: orgId, lastEmployeeNo: lastNo, updatedAt: SERVER_TS }, `last employee number → at least ${lastNo}`, "counter")

  return {
    months: { m0, m1, m2 },
    settings,
    sites: Object.values(sites),
    employees,
    pays,
    attendance,
    requests,
    payroll,
    payslips,
    letters,
    letterPay,
    exits,
    settlements,
    violations,
    injuries,
    assignFixes,
    manpower,
    logs,
    counters: { lastEmployeeNo: lastNo, yearly },
    ids: {
      projectSite: projectSite.id,
      workshopSite: sites.workshop.id,
      officeSite: sites.office.id,
      linkedEmployee: linked?.id ?? null,
      leaving: leaving.id,
      leaver: leaver.id,
      visaArrival: empId("05"),
      expected: empId("12"),
      probation: empId("09"),
    },
    grants: [
      { member: "finance", permission: "hr.payroll" },
      { member: "supervisor", permission: "hr.supervisor" },
    ],
    writes,
  }
}


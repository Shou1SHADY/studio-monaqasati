// HR 1.0 — My file (PRD ES-00…06, §5 "ملفي"; the prototype's later VIEWS.me):
// what the employee's own screen computes from what he may read — his record,
// his pay, his requests, his payslips, his violations, the workplaces — and
// from two projections written for him, since the documents they come from
// carry other people's facts he must never read:
//
//  - `employees/{id}.att` — his attendance: one entry per month (present ·
//    absent · sick · permission · declared · OT hours · closed) and today's
//    state, written beside the supervisor's sheet (recordDay, declareMissing,
//    closeMonth, an approved correction). The workplace month (`hrAttendance`)
//    holds the whole site's exceptions, so he is never given it.
//  - `employeePay/{id}.slip` — the line of the last payroll the HR manager
//    approved, written at approval: "with Finance" / "held" before a payslip
//    exists (payslips open at payment). The payroll holds every wage.
//
// Pure: no I/O.

import type { HrRole } from "./access"
import type { AttendanceException, Declaration, DaySheet } from "./attendance"
import { employeeMonth } from "./attendance"
import { docState, mayDrive, type DocState, type DocType } from "./documents"
import type { EmployeePay, HrEmployee } from "./employee"
import { statusOn } from "./employee"
import { accruedDays, leaveBalance } from "./leave"
import { advanceInstalment, gosiRates, overtimeRate, wageOf, type PayStep } from "./pay"
import type { PayrollLine } from "./payroll"
import { sickUsedIn, type DataField, type HrRequest } from "./requests"
import { assumesPresence } from "./attendance"
import type { HrSite } from "./sites"
import { addDays, daysBetween, r2, serviceYears, STATUTORY } from "./statutory"
import { tradeOf } from "./trades"
import type { HrViolation } from "./violations"

// ---------------------------------------------------------------------------
// The projections
// ---------------------------------------------------------------------------

export type MyDayStatus = "present" | "absent" | "sick" | "permission"

export interface MyMonth {
  present: number
  absent: number
  sick: number
  permission: number
  /** Days filled by a declaration (AT-04), counted present — shown apart. */
  declared: number
  ot: number
  closed?: boolean
}

/** `employees/{id}.att` — written for him, read by him (and anyone who reads his record). */
export interface MyAttendance {
  /** By month, "yyyy-mm" — the current and the previous are kept. */
  m?: Record<string, MyMonth>
  /** The last day recorded for him on a sheet that was recorded on that very day. */
  today?: { day: string; status: MyDayStatus; ot?: number } | null
}

type SheetMonth = { days?: Record<string, Pick<DaySheet, "listed" | "ex">> | null; declarations?: Array<Pick<Declaration, "employees" | "days">> | null }

/** One person's month at one workplace, as he is shown it. */
export function myMonthOf(wm: SheetMonth | null, employeeId: string, closed = false): MyMonth {
  const m = employeeMonth({ days: (wm?.days ?? {}) as Record<string, DaySheet>, declarations: (wm?.declarations ?? []) as Declaration[] }, employeeId)
  return { present: m.present, absent: m.absent, sick: m.sick, permission: m.permission, declared: m.declared, ot: m.overtimeHours, closed }
}

/** A day's status for one person on a sheet: listed and no exception = present. */
export function dayStatusOf(sheet: Pick<DaySheet, "listed" | "ex"> | null | undefined, employeeId: string): { status: MyDayStatus; ot?: number } | null {
  if (!sheet?.listed?.includes(employeeId)) return null
  const e: AttendanceException | undefined = sheet.ex?.[employeeId]
  const status: MyDayStatus = e?.status === "absent" || e?.status === "sick" || e?.status === "permission" ? e.status : "present"
  return e?.ot ? { status, ot: e.ot } : { status }
}

/** "yyyy-mm" one month back. */
export const monthBefore = (month: string) => addDays(`${month}-01`, -1).slice(0, 7)

/**
 * The field writes that keep each person's projection in step with a workplace month just written: his
 * month (and, when the sheet is today's, today's state); the month before last is dropped so the map
 * holds two. Values are plain — `null` stands for "delete this field".
 */
export function attendancePatches(
  wm: SheetMonth & { month: string; closed?: unknown },
  employeeIds: readonly string[],
  opts: { day?: string | null; today: string }
): Map<string, Record<string, MyMonth | MyAttendance["today"] | null>> {
  const out = new Map<string, Record<string, MyMonth | MyAttendance["today"] | null>>()
  const old = monthBefore(monthBefore(wm.month))
  for (const id of new Set(employeeIds)) {
    const patch: Record<string, MyMonth | MyAttendance["today"] | null> = { [`att.m.${wm.month}`]: myMonthOf(wm, id, Boolean(wm.closed)), [`att.m.${old}`]: null }
    if (opts.day && opts.day === opts.today) {
      const st = dayStatusOf(wm.days?.[opts.day], id)
      if (st) patch["att.today"] = { day: opts.day, ...st }
    }
    out.set(id, patch)
  }
  return out
}

/** `employeePay/{id}.slip` — the line of the last main payroll approved for him. */
export interface SlipProjection {
  key: string
  month: string
  line: PayrollLine
  held: boolean
  heldReason: PayrollLine["heldReason"]
  approvedOn: string
}

export const slipOf = (p: { key: string; month: string }, l: PayrollLine, approvedOn: string): SlipProjection => ({ key: p.key, month: p.month, line: l, held: l.held, heldReason: l.heldReason, approvedOn })

// ---------------------------------------------------------------------------
// Pay: masked IBAN, payslip states, history
// ---------------------------------------------------------------------------

/** ES-01 — «الآيبان مقنّعاً»: the first six and the last four. */
export const maskIban = (iban: string | null | undefined) => (iban && iban.length > 10 ? `${iban.slice(0, 6)}…${iban.slice(-4)}` : iban || null)

export type SlipState = "paid" | "finance" | "held"

export interface MySlip {
  id: string
  key: string
  month: string
  kind: "main" | "supplementary"
  line: PayrollLine | { net: number; held?: boolean }
  state: SlipState
  paidOn: string | null
  heldReason: PayrollLine["heldReason"]
  /** The bank returned this month's transfer (PY-03) — his IBAN is wrong. */
  returned: boolean
}

export interface PayslipDoc {
  id: string
  key: string
  month: string
  kind: "main" | "supplementary"
  line: PayrollLine | { net: number; held?: boolean }
  paidOn: string
}

/** ES-04 — every month he was paid, and the month approved but not paid yet: "with Finance", or held when
 * his IBAN keeps the line back (outside the transfer, inside salaries payable). A returned transfer marks
 * the latest paid month. Newest first. */
export function mySlips(payslips: PayslipDoc[], slip: SlipProjection | null | undefined, ibanState: EmployeePay["ibanState"] | null | undefined): MySlip[] {
  const out: MySlip[] = payslips.map((p) => ({ id: p.id, key: p.key, month: p.month, kind: p.kind, line: p.line, state: "paid", paidOn: p.paidOn, heldReason: null, returned: false }))
  if (slip && !payslips.some((p) => p.kind === "main" && p.key === slip.key)) {
    out.push({ id: `slip:${slip.key}`, key: slip.key, month: slip.month, kind: "main", line: slip.line, state: slip.held ? "held" : "finance", paidOn: null, heldReason: slip.heldReason, returned: false })
  }
  out.sort((a, b) => b.key.localeCompare(a.key))
  if (ibanState === "returned") {
    const last = out.find((s) => s.kind === "main" && s.state === "paid")
    if (last) last.returned = true
  }
  return out
}

/** EM-04 — the pay's history, newest first: each step's wage and its change from the one before. */
export function payHistory(steps: PayStep[] | null | undefined): Array<{ from: string; basic: number; wage: number; delta: number | null }> {
  const sorted = [...(steps ?? [])].sort((a, b) => a.from.localeCompare(b.from))
  return sorted
    .map((s, i) => ({ from: s.from, basic: s.basic, wage: wageOf(s), delta: i === 0 ? null : r2(wageOf(s) - wageOf(sorted[i - 1])) }))
    .reverse()
}

export interface MyPayFacts {
  wage: number
  /** Art. 107 — (wage + ½ basic) / 240. */
  otHour: number
  /** His GOSI share of basic + housing (0 for a non-Saudi). */
  gosiRate: number
  advance: { amount: number; balance: number; instalment: number; monthsLeft: number } | null
  /** What an advance's instalment would be (art. 92), when he has none. */
  instalmentIf: number
}

export function myPayFacts(pay: Pick<EmployeePay, "basic" | "housing" | "transport" | "advance">, emp: Pick<HrEmployee, "nationality" | "join">): MyPayFacts {
  const wage = wageOf(pay)
  const a = pay.advance && pay.advance.balance > 0 ? pay.advance : null
  return {
    wage,
    otHour: r2(overtimeRate(pay)),
    gosiRate: gosiRates(emp.nationality, emp.join).employee,
    advance: a ? { ...a, monthsLeft: a.instalment > 0 ? Math.ceil(a.balance / a.instalment) : 0 } : null,
    instalmentIf: wage > 0 ? advanceInstalment(wage) : 0,
  }
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export interface MyLeaveFacts {
  /** Accrued to today, with an imported opening balance — the formula is accrued − taken = balance. */
  accrued: number
  taken: number
  balance: number
  /** 21 days a year, 30 after five years — and the day it becomes 30. */
  entitlement: number
  thirtyFrom: string | null
  sickUsed: number
  sickCap: number
}

export function myLeaveFacts(emp: Pick<HrEmployee, "join" | "leaveTaken" | "openingLeave" | "sick">, today: string): MyLeaveFacts {
  const L = STATUTORY.leave
  const five = serviceYears(emp.join, today) >= L.fiveYears
  const S = STATUTORY.sick
  return {
    accrued: Math.floor(accruedDays(emp.join, today) + (emp.openingLeave ?? 0)),
    taken: emp.leaveTaken ?? 0,
    balance: leaveBalance(emp.join, today, emp.leaveTaken ?? 0, emp.openingLeave ?? 0),
    entitlement: five ? L.afterFive : L.base,
    thirtyFrom: five ? null : addDays(emp.join, L.fiveYears * 365),
    sickUsed: sickUsedIn(emp, today),
    sickCap: S.full + S.threeQuarters + S.unpaid,
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface MyDoc {
  type: DocType
  expiry: string | null
  state: DocState
  /** Days left (negative once expired), null when not recorded. */
  left: number | null
}

/** DC-01, ES-06 — the documents that are HIS: the iqama only for a non-Saudi, a licence or forklift
 * permit only for a trade that drives one, the contract only when it is fixed-term (its end is the
 * contract's, not a document date); passport and insurance for everyone. */
export function myDocuments(emp: Pick<HrEmployee, "nationality" | "docs" | "trade" | "contract">, today: string, renewWindowDays: number): MyDoc[] {
  const drives = tradeOf(emp.trade)?.drives ?? null
  const types: DocType[] = []
  if (emp.nationality !== "sa") types.push("iqama")
  types.push("passport", "insurance")
  if (drives) types.push(drives)
  const out: MyDoc[] = types.map((type) => {
    const expiry = emp.docs?.[type] ?? null
    return { type, expiry, state: docState(expiry, today, renewWindowDays), left: expiry ? daysBetween(today, expiry) : null }
  })
  if (emp.contract?.type === "fixed") {
    const expiry = emp.contract.end ?? null
    out.push({ type: "contract", expiry, state: docState(expiry, today, renewWindowDays), left: expiry ? daysBetween(today, expiry) : null })
  }
  return out
}

/** The tile «أقرب وثيقة تنتهي»: the recorded one nearest to its end (the contract is not a renewal). */
export const nearestOf = (docs: MyDoc[]) => docs.filter((d) => d.expiry && d.type !== "contract").sort((a, b) => (a.expiry as string).localeCompare(b.expiry as string))[0] ?? null

/** DC-06 — may he drive today (shown when his trade drives). */
export const drivesToday = (emp: Pick<HrEmployee, "docs" | "trade">, today: string) => mayDrive({ docs: emp.docs ?? {}, drives: tradeOf(emp.trade)?.drives ?? null }, today)

// ---------------------------------------------------------------------------
// My day
// ---------------------------------------------------------------------------

export type MyTodayState = MyDayStatus | "leave" | "assumed" | "none"

/** «يومي» — on an approved leave today; else today's sheet; else an office or unassigned assumes presence
 * (AT-02); else not recorded yet. */
export function myToday(input: { att: MyAttendance | null | undefined; today: string; onLeave: boolean; assumed: boolean }): MyTodayState {
  if (input.onLeave) return "leave"
  const t = input.att?.today
  if (t && t.day === input.today) return t.status
  return input.assumed ? "assumed" : "none"
}

export type Recorder = { kind: "assumed" } | { kind: "supervisor"; userId: string } | { kind: "nobody" }

/** «من يسجّل حضوري» — an office or the unassigned bench assumes presence and records exceptions only; any
 * other workplace's supervisor keeps the sheet (with the punch feature, a device or the app — R2). */
export function whoRecordsMe(siteId: string | null | undefined, site: Pick<HrSite, "type" | "supervisorUserId"> | null | undefined): Recorder {
  if (!siteId || assumesPresence(siteId, site?.type ?? null)) return { kind: "assumed" }
  return site?.supervisorUserId ? { kind: "supervisor", userId: site.supervisorUserId } : { kind: "nobody" }
}

export const isAssumed = (siteId: string | null | undefined, site: Pick<HrSite, "type"> | null | undefined) => !siteId || assumesPresence(siteId, site?.type ?? null)

/** Inside one of his approved leaves today. */
export const onLeaveToday = (requests: Array<Pick<HrRequest, "kind" | "state" | "leave">>, today: string) =>
  requests.some((r) => r.kind === "leave" && r.state === "approved" && r.leave && r.leave.from <= today && today <= r.leave.to)

/** His approved leave days falling in a month (the month card's «إجازة»). */
export function leaveDaysIn(requests: Array<Pick<HrRequest, "kind" | "state" | "leave">>, month: string, upTo?: string): number {
  const start = `${month}-01`
  const end = upTo && upTo.slice(0, 7) === month ? upTo : addDays(`${addDays(start, 32).slice(0, 7)}-01`, -1)
  let n = 0
  for (const r of requests) {
    if (r.kind !== "leave" || r.state !== "approved" || !r.leave) continue
    const from = r.leave.from > start ? r.leave.from : start
    const to = r.leave.to < end ? r.leave.to : end
    if (to >= from) n += daysBetween(from, to) + 1
  }
  return n
}

// ---------------------------------------------------------------------------
// Quick actions and "needs your attention"
// ---------------------------------------------------------------------------

export type MyAction = "leave" | "advance" | "letter" | "attfix" | "data"
export type MyActionBlock = "outstanding" | "pending_advance" | "no_wage"

/** «meActs» — shown only while he is at work or on leave; each disabled with its reason (AD-02). */
export function myActions(input: { emp: Pick<HrEmployee, "status" | "join">; pay: Pick<EmployeePay, "basic" | "housing" | "transport" | "advance"> | null; requests: Array<Pick<HrRequest, "kind" | "state">>; today: string }): Array<{ key: MyAction; blocked: MyActionBlock | null }> {
  const st = statusOn(input.emp, input.today)
  if (st !== "active" && st !== "leave") return []
  const adv: MyActionBlock | null =
    (input.pay?.advance?.balance ?? 0) > 0
      ? "outstanding"
      : input.requests.some((r) => r.kind === "advance" && (r.state === "pending" || r.state === "endorsed" || r.state === "finance"))
        ? "pending_advance"
        : !input.pay || !(wageOf(input.pay) > 0)
          ? "no_wage"
          : null
  return [
    { key: "leave", blocked: null },
    { key: "advance", blocked: adv },
    { key: "letter", blocked: null },
    { key: "attfix", blocked: null },
    { key: "data", blocked: null },
  ]
}

export type AttnTone = "red" | "amber" | "blue" | "green"
export type AttnKind = "penalty" | "penalty_objected" | "doc" | "doc_expired" | "contract" | "iban_returned" | "no_iban" | "no_mobile" | "approved" | "declined"

export interface AttnItem {
  key: string
  kind: AttnKind
  tone: AttnTone
  params: Record<string, string | number>
  /** The one action: object to a penalty (the requests segment), or a data update preset to a field. */
  action?: { object: string } | { data: DataField } | null
}

/** The window the attention list shows a decision for. */
export const DECIDED_DAYS = 7
/** A fixed-term contract shows from this many days before its end. */
export const CONTRACT_NOTICE = 60

/** «يحتاج انتباهك» (meAttn) — red first: a penalty he may still object to (art. 72, 15 days), a document
 * expired or in its renewal window (renewal is government relations'), a fixed-term contract ending, a
 * returned transfer or no IBAN (no salary without one), no mobile, and his requests decided this week. */
export function attentionItems(input: {
  emp: Pick<HrEmployee, "nationality" | "docs" | "trade" | "contract" | "contact">
  pay: Pick<EmployeePay, "iban" | "ibanState"> | null
  payKnown: boolean
  violations: Array<Pick<HrViolation, "id" | "code" | "state" | "notifiedOn" | "amount" | "stepKind">>
  requests: Array<Pick<HrRequest, "id" | "kind" | "state" | "no" | "data" | "decision" | "finance">>
  today: string
  renewWindowDays: number
}): AttnItem[] {
  const out: AttnItem[] = []
  const P = STATUTORY.penalties
  for (const v of input.violations) {
    if (!v.notifiedOn || daysBetween(v.notifiedOn, input.today) > P.objectionDays) continue
    const until = addDays(v.notifiedOn, P.objectionDays)
    if (v.state === "applied") out.push({ key: `pen:${v.id}`, kind: "penalty", tone: "red", params: { code: v.code, until }, action: { object: v.id } })
    else if (v.state === "objected") out.push({ key: `pen:${v.id}`, kind: "penalty_objected", tone: "amber", params: { code: v.code } })
  }
  for (const d of myDocuments(input.emp, input.today, input.renewWindowDays)) {
    if (d.type === "contract" || !d.expiry || d.left == null || d.left > input.renewWindowDays) continue
    out.push({ key: `doc:${d.type}`, kind: d.left < 0 ? "doc_expired" : "doc", tone: d.left < 0 ? "red" : "amber", params: { doc: d.type, date: d.expiry } })
  }
  const c = input.emp.contract
  if (c?.type === "fixed" && c.end && c.end >= input.today && daysBetween(input.today, c.end) <= CONTRACT_NOTICE) out.push({ key: "contract", kind: "contract", tone: "blue", params: { date: c.end } })
  const pending = (f: DataField) => input.requests.some((r) => r.kind === "data" && r.data?.field === f && (r.state === "pending" || r.state === "endorsed"))
  if (input.payKnown) {
    if (input.pay?.ibanState === "returned") out.push({ key: "iban", kind: "iban_returned", tone: "red", params: {}, action: pending("iban") ? null : { data: "iban" } })
    else if (!input.pay?.iban && !pending("iban")) out.push({ key: "iban", kind: "no_iban", tone: "amber", params: {}, action: { data: "iban" } })
  }
  if (!input.emp.contact?.mobile && !pending("mobile")) out.push({ key: "mobile", kind: "no_mobile", tone: "blue", params: {}, action: { data: "mobile" } })
  for (const r of input.requests) {
    if (r.state !== "approved" && r.state !== "declined") continue
    const stamp = r.finance ?? r.decision
    if (!stamp?.at || daysBetween(stamp.at.slice(0, 10), input.today) > DECIDED_DAYS) continue
    out.push({ key: `dec:${r.id}`, kind: r.state, tone: r.state === "declined" ? "amber" : "green", params: { no: r.no, kind: r.kind, by: stamp.byName ?? "", note: stamp.note ?? "" } })
  }
  const rank: Record<AttnTone, number> = { red: 0, amber: 1, blue: 2, green: 3 }
  return out.sort((a, b) => rank[a.tone] - rank[b.tone])
}

// ---------------------------------------------------------------------------
// Names: the line manager, and who holds each HR role (ES-02 "by name")
// ---------------------------------------------------------------------------

export interface MemberLite {
  id: string
  name?: string | null
  email?: string | null
  organizationRole?: string | null
  defaultGroupId?: string | null
}

export const memberLabel = (m: MemberLite | null | undefined) => (m ? m.name || m.email || null : null)

/** RL-04 — his line manager: the one named on his card when the viewer can read that record, else his
 * workplace's supervisor — never himself; null means management. */
export function myLineManager(
  emp: Pick<HrEmployee, "id" | "managerId" | "siteId" | "userId">,
  site: Pick<HrSite, "supervisorEmployeeId" | "supervisorUserId"> | null | undefined,
  people: Array<Pick<HrEmployee, "id" | "userId" | "names">>,
  members: MemberLite[]
): { userId: string | null; name: string | null } | null {
  if (emp.managerId && emp.managerId !== emp.id) {
    const m = people.find((p) => p.id === emp.managerId)
    if (m) return { userId: m.userId ?? null, name: memberLabel(members.find((x) => x.id === m.userId)) ?? m.names?.ar ?? null }
  }
  if (site?.supervisorUserId && site.supervisorUserId !== emp.userId && site.supervisorEmployeeId !== emp.id) {
    return { userId: site.supervisorUserId, name: memberLabel(members.find((x) => x.id === site.supervisorUserId)) }
  }
  return null
}

export type HolderKey = "manager" | "gov" | "management" | "finance"

const HOLDER_PERMS: Record<HolderKey, readonly string[]> = {
  manager: ["employees.manage"],
  gov: ["hr.gov"],
  management: ["hr.management"],
  finance: ["invoices.manage", "accounting.post"],
}

/** The person behind each HR role, read as the rules read roles (the DEFAULT group): a member whose group
 * grants it, else the owner, who holds every role. */
export function roleHolders(members: MemberLite[], groups: Array<{ id: string; permissions?: readonly string[] | null }>): Record<HolderKey, string | null> {
  const isOwner = (m: MemberLite) => !m.organizationRole || m.organizationRole === "owner"
  const owner = members.find(isOwner)
  const out = {} as Record<HolderKey, string | null>
  for (const k of Object.keys(HOLDER_PERMS) as HolderKey[]) {
    const m = members.find((x) => !isOwner(x) && (groups.find((g) => g.id === x.defaultGroupId)?.permissions ?? []).some((p) => HOLDER_PERMS[k].includes(p)))
    out[k] = memberLabel(m ?? owner)
  }
  return out
}

/** The staff chip «ملفك كموظف — ودورك … في التبويبات الأخرى»: his roles, in the matrix's order. */
export const staffRoles = (roles: ReadonlySet<HrRole>): HrRole[] => (["manager", "gov", "payroll", "supervisor", "management"] as HrRole[]).filter((r) => roles.has(r))

/** "2026-10" → the month's name in the reader's language, Gregorian, Latin digits. */
export function monthName(month: string, locale: string): string {
  const d = new Date(`${month}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return month
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-US", { month: "long", year: "numeric" })
}

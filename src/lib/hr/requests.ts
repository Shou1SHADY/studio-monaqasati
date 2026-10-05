// HR 1.0 — requests (PRD LV-01…07, AD-01…04, RL-02, LV-05, WF-07, WF-08).
// A request is filed by the employee (My file) or by the HR manager on his
// behalf; a leave is endorsed by the supervisor or line manager, then decided
// by the HR manager — his own goes to management; an advance above the HR
// limit is held with HR's view and decided in Finance. The numbers a request
// carries (days, balance at the start, instalment) are computed, never typed,
// and computed again when it is decided. Pure: no I/O.

import type { HrContext } from "./access"
import { mayDecideRequest, mayEndorse } from "./access"
import type { DocDates } from "./documents"
import type { EmployeePay, HrEmployee } from "./employee"
import { balanceSplit, leaveBalance, leaveDays, leaveEligibility, leaveEndAfter, LEAVE_RULES, sickSplit, type Holiday, type LeaveEligibility, type LeaveType, type SickSplit } from "./leave"
import { advanceInstalment, advanceMonths, wageOf } from "./pay"
import { addDays, daysBetween, serviceYears, STATUTORY, type HrPolicies } from "./statutory"

export const HR_REQUEST_KINDS = ["leave", "advance", "data", "attfix"] as const
export type HrRequestKind = (typeof HR_REQUEST_KINDS)[number]

/** pending → (endorsed) → approved | declined | finance → approved | declined; not started → cancelled. */
export const HR_REQUEST_STATES = ["pending", "endorsed", "approved", "declined", "finance", "cancelled"] as const
export type HrRequestState = (typeof HR_REQUEST_STATES)[number]

/** The yearly sequence codes — shown ط.إ / ط.سل / ط.ص / ط.ح in Arabic. An attendance correction is
 * AQ (ط.ح, "طلب حضور"): no other sequence uses either (the prototype shared ط.ص with data updates; ours
 * keeps one sequence per kind so a number names its kind). */
export const REQUEST_NUMBER_TYPE: Record<HrRequestKind, string> = { leave: "LV", advance: "AV", data: "HQ", attfix: "AQ" }

/** ES-03 — what an employee may ask to change; he never edits his own record. */
export const DATA_FIELDS = ["iban", "mobile", "address", "emergency", "qualification"] as const
export type DataField = (typeof DATA_FIELDS)[number]

/** The bank's document as uploaded with the request (EM-07): a Storage object under the employee's folder.
 * The HR manager's approval files it on the record (`employees/{id}/files`, kind `bank`). */
export interface DataFile {
  path: string
  name: string
  size: number
  contentType: string
}

export interface DataFields {
  field: DataField
  value: string
  /** The supporting document's name (a typed reference on requests filed before uploads). */
  document?: string | null
  /** The uploaded bank document (ES-03) — an IBAN change carries it. */
  file?: DataFile | null
}

export type DataBlock = "no_value" | "bad_iban" | "no_document"

export function dataBlocks(input: { field: DataField; value: string; document?: string | null; file?: DataFile | null }): DataBlock[] {
  const out: DataBlock[] = []
  const v = input.value.trim()
  if (!v) out.push("no_value")
  if (input.field === "iban") {
    if (v && !/^SA\d{22}$/.test(v.replace(/\s+/g, "").toUpperCase())) out.push("bad_iban")
    if (!input.file?.path && !input.document?.trim()) out.push("no_document")
  }
  return out
}

// ---------------------------------------------------------------------------
// Attendance correction (PRD form 11, PT-07; the sheet variant is core)
// ---------------------------------------------------------------------------

/** `abs` — marked absent on the sheet but was at work (every workplace); `miss` — forgot to punch and `out` —
 * outside the fence on duty exist only where people punch (optional: punch). */
export const ATTFIX_TYPES = ["abs", "miss", "out"] as const
export type AttfixType = (typeof ATTFIX_TYPES)[number]
export const attfixTypesFor = (punch: boolean): AttfixType[] => (punch ? ["miss", "out", "abs"] : ["abs"])

/** A correction is asked within a week of the day (the prototype's window), and forgotten punches at most
 * three times a month (company policy `fixMax`, the prototype's default). */
export const ATTFIX_WINDOW_DAYS = 7
export const ATTFIX_MISS_PER_MONTH = 3

export interface AttfixFields {
  type: AttfixType
  day: string
  reason: string
}

export type AttfixBlock = "no_day" | "future" | "too_old" | "no_reason" | "bad_fix_type" | "over_cap" | "duplicate"

type AttfixLike = Pick<HrRequest, "kind" | "state" | "attfix" | "createdAt">

/** Forgotten-punch corrections filed this month (cancelled ones do not count). */
export function attfixUsed(mine: AttfixLike[], month: string): number {
  return mine.filter((r) => r.kind === "attfix" && r.state !== "cancelled" && r.attfix?.type === "miss" && (r.createdAt ?? "").slice(0, 7) === month).length
}

export function attfixBlocks(input: { type: AttfixType; day: string; reason: string }, ctx: { today: string; punch: boolean; mine: AttfixLike[] }): AttfixBlock[] {
  const out: AttfixBlock[] = []
  if (!attfixTypesFor(ctx.punch).includes(input.type)) out.push("bad_fix_type")
  if (!input.day) out.push("no_day")
  else if (input.day > ctx.today) out.push("future")
  else if (daysBetween(input.day, ctx.today) > ATTFIX_WINDOW_DAYS) out.push("too_old")
  if (!input.reason.trim()) out.push("no_reason")
  if (input.type === "miss" && attfixUsed(ctx.mine, ctx.today.slice(0, 7)) >= ATTFIX_MISS_PER_MONTH) out.push("over_cap")
  if (input.day && ctx.mine.some((r) => r.kind === "attfix" && r.attfix?.day === input.day && (r.state === "pending" || r.state === "approved"))) out.push("duplicate")
  return out
}

export type AttfixApplyBlock = "month_closed" | "no_sheet" | "not_absent"

/** Deciding (approve): the day's sheet must still be open and must show him absent — a closed month never
 * reopens (AT-03; a difference is then a supplementary item). Only `abs` touches the sheet. */
export function attfixApplyBlocks(
  wm: { closed?: unknown; days?: Record<string, { listed?: string[]; ex?: Record<string, { status?: string | null }> }> } | null,
  employeeId: string,
  f: Pick<AttfixFields, "type" | "day">
): AttfixApplyBlock[] {
  if (wm?.closed) return ["month_closed"]
  if (f.type !== "abs") return []
  const sheet = wm?.days?.[f.day]
  if (!sheet) return ["no_sheet"]
  if (!sheet.listed?.includes(employeeId) || sheet.ex?.[employeeId]?.status !== "absent") return ["not_absent"]
  return []
}

export interface Stamp {
  by: string
  byName: string | null
  at: string
  note?: string | null
}

export interface LeaveFields {
  type: LeaveType
  from: string
  to: string
  /** Calendar days minus holidays (LV-02). */
  days: number
  /** The annual balance as of the leave's start. */
  balance: number
  /** Taken from the balance, and the excess taken unpaid (LV-03). */
  fromBalance: number
  unpaidDays: number
  /** HR's choice on a leave above the balance (LV-03), and the end asked for when "balance only" shortened it. */
  mode?: LeaveMode | null
  requestedTo?: string | null
  /** A non-Saudi's leave is travel — his iqama and passport must outlast it (LV-04). Computed, never ticked. */
  travel: boolean
  sick?: SickSplit | null
  note?: string | null
}

export interface AdvanceFields {
  amount: number
  reason: string
  /** Art. 92: 10% of the wage a month (min 50); the months it takes. */
  instalment: number
  months: number
  /** Above the HR limit — decided in Finance (AD-03). */
  overLimit: boolean
}

export interface HrRequest {
  id: string
  organizationId: string
  no: string
  kind: HrRequestKind
  employeeId: string
  /** The employee's platform user at filing — lets the rules show him his own. */
  employeeUserId: string | null
  employeeName: string
  siteId: string | null
  /** The line manager (RL-04) as an employee and as a user, when there is one. */
  lineManagerId: string | null
  lineManagerUserId: string | null
  /** Who decides: the HR manager, or management for the HR manager's own (LV-05). */
  deciderLevel: "manager" | "management"
  filedBy: Stamp
  onBehalf: boolean
  state: HrRequestState
  leave?: LeaveFields | null
  advance?: AdvanceFields | null
  data?: DataFields | null
  attfix?: AttfixFields | null
  endorsement?: Stamp | null
  decision?: (Stamp & { ownFlagged?: boolean }) | null
  /** Set when an advance goes to Finance — Finance reads by it, before and after deciding. */
  financeHold?: boolean
  finance?: Stamp | null
  cancel?: Stamp | null
  /** AT-05 — the day he started again after the leave, who recorded it, and the days late (absence without leave). */
  returned?: { on: string; by: string; byName: string | null; at: string; lateDays: number } | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Leave (LV-01…06)
// ---------------------------------------------------------------------------

export type LeaveBlock = "bad_dates" | "too_long" | "above_balance" | "no_balance" | "overlap" | "travel_docs" | LeaveEligibility
export type LeaveWarning = "travel_docs" | "sick_beyond" | "above_balance" | "excess_unpaid"

/** LV-03 — how HR approves a leave above the balance: shortened to the balance, or with the excess unpaid. */
export const LEAVE_MODES = ["balance_only", "excess_unpaid"] as const
export type LeaveMode = (typeof LEAVE_MODES)[number]

export interface LeaveQuote {
  days: number
  balance: number
  fromBalance: number
  unpaidDays: number
  /** Days above the balance still waiting for HR's choice (0 once chosen). */
  excess: number
  /** The last day — the one asked for, or the day the balance runs out ("balance only"). */
  to: string
  sick: SickSplit | null
  /** A non-Saudi's leave is travel (LV-04): his iqama and passport must outlast it. */
  travel: boolean
  blocks: LeaveBlock[]
  warnings: LeaveWarning[]
}

/** The sick days already used in the service year that holds `day` (art. 117 counts per service year). */
export function sickUsedIn(emp: Pick<HrEmployee, "join" | "sick">, day: string): number {
  if (!emp.sick) return 0
  return emp.sick.year === Math.floor(serviceYears(emp.join, day)) ? emp.sick.days : 0
}

/** LV-04 — an iqama or passport that expires on or before the leave's last day: he would come
 * back on an expired document. A date not recorded is not a lapse — a blank stays blank. */
export function travelDocsExpire(docs: DocDates | null | undefined, nationality: string, lastDay: string): boolean {
  if (nationality === "sa") return false
  return (["iqama", "passport"] as const).some((k) => {
    const d = docs?.[k]
    return Boolean(d) && (d as string) <= lastDay
  })
}

/**
 * A leave as the system computes it (WF-07 steps 1–2, 4). Filing, what blocks
 * stops the form and the rest is said before sending: above the balance and a
 * document lapsing before the return are WARNINGS — HR decides. Deciding
 * (`ctx.deciding`), both block until resolved: above the balance needs HR's
 * choice (`mode`), and no leave is approved for travel past a lapsing
 * document (LV-04) — "balance only" may cure that by ending sooner.
 */
export function leaveQuote(
  emp: Pick<HrEmployee, "join" | "gender" | "hajjTaken" | "leaveTaken" | "openingLeave" | "sick" | "docs" | "nationality">,
  input: { type: LeaveType; from: string; to: string; mode?: LeaveMode | null },
  ctx: { holidays?: readonly Holiday[]; others?: Array<{ from: string; to: string }>; deciding?: boolean } = {}
): LeaveQuote {
  const blocks: LeaveBlock[] = []
  const warnings: LeaveWarning[] = []
  const rule = LEAVE_RULES[input.type]
  const valid = Boolean(input.from && input.to && input.to >= input.from)
  if (!valid) blocks.push("bad_dates")
  let to = input.to
  let days = valid ? leaveDays(input.from, input.to, ctx.holidays) : 0
  const balance = input.from ? leaveBalance(emp.join, input.from, emp.leaveTaken ?? 0, emp.openingLeave ?? 0) : 0
  const elig = input.from ? leaveEligibility(input.type, emp, input.from) : null
  if (elig) blocks.push(elig)
  if (rule.days && days > rule.days) blocks.push("too_long")
  if (valid && (ctx.others ?? []).some((o) => o.from <= input.to && input.from <= o.to)) blocks.push("overlap")
  let fromBalance = 0
  let unpaidDays = 0
  let excess = 0
  let sick: SickSplit | null = null
  if (rule.fromBalance) {
    const split = balanceSplit(days, Math.max(0, balance))
    fromBalance = split.fromBalance
    excess = split.excess
    if (excess > 0) {
      if (input.mode === "excess_unpaid") {
        unpaidDays = excess
        excess = 0
        warnings.push("excess_unpaid")
      } else if (input.mode === "balance_only") {
        if (balance <= 0) blocks.push("no_balance")
        else {
          to = leaveEndAfter(input.from, balance, ctx.holidays)
          days = balance
          fromBalance = balance
          excess = 0
        }
      } else (ctx.deciding ? blocks : warnings).push("above_balance")
    }
  } else if (rule.pay === "none") unpaidDays = days
  else if (rule.pay === "sick" && input.from) {
    sick = sickSplit(sickUsedIn(emp, input.from), days)
    if (sick.beyond > 0) warnings.push("sick_beyond")
  }
  const travel = emp.nationality !== "sa"
  if (travel && valid && travelDocsExpire(emp.docs, emp.nationality, to)) (ctx.deciding ? blocks : warnings).push("travel_docs")
  return { days, balance, fromBalance, unpaidDays, excess, to, sick, travel, blocks, warnings }
}

/** LV-03 — the days of a filed leave above its balance, waiting for HR's choice (0 when none,
 * or when an older request already carried "excess unpaid" from the form). */
export function aboveBalance(r: Pick<HrRequest, "kind" | "leave">): number {
  const l = r.leave
  if (r.kind !== "leave" || !l || !LEAVE_RULES[l.type].fromBalance || l.unpaidDays > 0) return 0
  return Math.max(0, l.days - Math.max(0, l.balance))
}

// ---------------------------------------------------------------------------
// The return from leave (AT-05, WF-07 step 6)
// ---------------------------------------------------------------------------

export type ReturnStage = "due" | "warning" | "termination"

/** An approved leave whose end has passed with no return recorded: the days since its last
 * day are absence without leave — 10 in a row make the written warning due, 15 make
 * termination possible (art. 80, and the Qiwa absence report). Null while away or once back. */
export function leaveReturn(r: Pick<HrRequest, "kind" | "state" | "leave" | "returned">, today: string): { daysLate: number; stage: ReturnStage } | null {
  if (r.kind !== "leave" || r.state !== "approved" || !r.leave || r.returned || today <= r.leave.to) return null
  const daysLate = daysBetween(r.leave.to, today)
  const A = STATUTORY.art80
  return { daysLate, stage: daysLate >= A.terminationDays ? "termination" : daysLate >= A.warningDays ? "warning" : "due" }
}

/** Who is not back from a leave on a day: after its last day and before the day his return was recorded. */
export function notBackOn(requests: Array<Pick<HrRequest, "employeeId" | "kind" | "state" | "leave" | "returned">>, day: string): Set<string> {
  const out = new Set<string>()
  for (const r of requests) if (r.kind === "leave" && r.state === "approved" && r.leave && day > r.leave.to && (!r.returned || day < r.returned.on)) out.add(r.employeeId)
  return out
}

// ---------------------------------------------------------------------------
// Advance (AD-01…04)
// ---------------------------------------------------------------------------

export type AdvanceBlock = "bad_amount" | "no_reason" | "no_wage" | "outstanding"
export type AdvanceWarning = "over_limit" | "past_contract"

export function advanceQuote(
  pay: Pick<EmployeePay, "basic" | "housing" | "transport" | "advance"> | null,
  input: { amount: number; reason: string },
  ctx: { policies: HrPolicies; today: string; contractEnd?: string | null; pendingAdvance?: boolean }
): { instalment: number; months: number; overLimit: boolean; blocks: AdvanceBlock[]; warnings: AdvanceWarning[] } {
  const blocks: AdvanceBlock[] = []
  const warnings: AdvanceWarning[] = []
  const wage = pay ? wageOf(pay) : 0
  if (!(input.amount > 0)) blocks.push("bad_amount")
  if (!input.reason.trim()) blocks.push("no_reason")
  if (!(wage > 0)) blocks.push("no_wage")
  // AD-02 — said in the form before sending.
  if ((pay?.advance?.balance ?? 0) > 0 || ctx.pendingAdvance) blocks.push("outstanding")
  const instalment = wage > 0 ? advanceInstalment(wage) : 0
  const months = wage > 0 && input.amount > 0 ? advanceMonths(input.amount, wage) : 0
  const overLimit = wage > 0 && input.amount > wage * ctx.policies.advanceMaxMonths
  if (overLimit) warnings.push("over_limit")
  // AD-04 — the rest comes from the settlement.
  if (ctx.contractEnd && months > 0) {
    const lastMonth = addDays(`${ctx.today.slice(0, 7)}-01`, 31 * months).slice(0, 7)
    if (lastMonth > ctx.contractEnd.slice(0, 7)) warnings.push("past_contract")
  }
  return { instalment, months, overLimit, blocks, warnings }
}

// ---------------------------------------------------------------------------
// Who may do what to a request
// ---------------------------------------------------------------------------

export type RequestAction = "endorse" | "approve" | "decline" | "cancel" | "finance"

/** LV-07 — an approved leave the EMPLOYEE may withdraw himself before its first day: one whose only mark on
 * his record is the balance (sick days and the once-only Hajj are given back by the HR manager). */
export const ownCancellable = (type: LeaveType) => type !== "sick" && type !== "hajj"

/** A request that has not started may be cancelled: pending by its owner or HR; an approved leave before its
 * first day by HR, or by the employee himself (LV-07, owner default 5) — his balance comes back. */
export function mayCancel(ctx: HrContext, r: Pick<HrRequest, "state" | "kind" | "employeeId" | "leave">, today: string): boolean {
  const own = Boolean(ctx.employeeId) && ctx.employeeId === r.employeeId
  const hr = ctx.roles.has("manager")
  if (r.state === "pending" || r.state === "endorsed") return own || hr
  if (r.state === "approved" && r.kind === "leave" && r.leave && r.leave.from > today) return hr || (own && ownCancellable(r.leave.type))
  return false
}

/** An attendance correction is decided by whoever keeps the sheet it corrects: the workplace's supervisor
 * (the line manager on a supervisor-sheet workplace) or the HR manager — never the employee himself. */
export function mayDecideAttfix(ctx: HrContext, r: Pick<HrRequest, "employeeId" | "siteId" | "deciderLevel">): boolean {
  if (ctx.owner) return true
  if (ctx.employeeId && ctx.employeeId === r.employeeId) return false
  if (ctx.roles.has("supervisor") && r.siteId && ctx.sites.includes(r.siteId)) return true
  return r.deciderLevel === "manager" && ctx.roles.has("manager")
}

export function requestActions(ctx: HrContext, r: HrRequest, opts: { today: string; financeAllowed: boolean }): RequestAction[] {
  const out: RequestAction[] = []
  const open = r.state === "pending" || r.state === "endorsed"
  if (r.kind === "leave" && r.state === "pending" && mayEndorse(ctx, { employeeId: r.employeeId, site: r.siteId, lineManagerId: r.lineManagerId })) out.push("endorse")
  if (r.kind === "attfix") {
    if (open && mayDecideAttfix(ctx, r)) out.push("approve", "decline")
  } else if (open && mayDecideRequest(ctx, { employeeId: r.employeeId, isHrManager: r.deciderLevel === "management" }) === null) out.push("approve", "decline")
  if (r.state === "finance" && opts.financeAllowed && ctx.employeeId !== r.employeeId) out.push("finance")
  if (mayCancel(ctx, r, opts.today)) out.push("cancel")
  return out
}

/** The request's number as a person reads it (ط.إ / ط.سل / ط.ص / ط.ح in Arabic). */
export function requestNoDisplay(no: string, locale: string): string {
  if (locale !== "ar") return no
  return no.replace(/^LV-/, "ط.إ-").replace(/^AV-/, "ط.سل-").replace(/^HQ-/, "ط.ص-").replace(/^AQ-/, "ط.ح-")
}

// ---------------------------------------------------------------------------
// Who holds a request now (ES-02) — a role the screen resolves to a NAME
// ---------------------------------------------------------------------------

export type HolderRole = "line_manager" | "supervisor" | "hr" | "management" | "finance"

/** A leave waits for the line manager's endorsement first; an attendance correction for whoever keeps the
 * sheet; the rest for the HR manager — management for the HR manager's own; an advance above the limit for
 * Finance. Null once decided. `userId` names the person when the request carries him. */
export function requestHolder(r: Pick<HrRequest, "kind" | "state" | "deciderLevel" | "lineManagerUserId">): { role: HolderRole; userId: string | null } | null {
  if (r.state === "finance") return { role: "finance", userId: null }
  if (r.state !== "pending" && r.state !== "endorsed") return null
  if (r.kind === "leave" && r.state === "pending" && r.lineManagerUserId) return { role: "line_manager", userId: r.lineManagerUserId }
  if (r.kind === "attfix" && r.lineManagerUserId) return { role: "supervisor", userId: r.lineManagerUserId }
  return { role: r.deciderLevel === "management" ? "management" : "hr", userId: null }
}

/** AD-01 — the schedule as the prototype states it: `instalment × full months + last = amount`. */
export function instalmentSchedule(amount: number, instalment: number): { instalment: number; full: number; last: number } {
  if (!(amount > 0) || !(instalment > 0)) return { instalment, full: 0, last: 0 }
  const months = Math.ceil(amount / instalment)
  return { instalment, full: months - 1, last: Math.round((amount - instalment * (months - 1)) * 100) / 100 }
}

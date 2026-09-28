// HR 1.0 — requests (PRD LV-01…07, AD-01…04, RL-02, LV-05, WF-07, WF-08).
// A request is filed by the employee (My file) or by the HR manager on his
// behalf; a leave is endorsed by the supervisor or line manager, then decided
// by the HR manager — his own goes to management; an advance above the HR
// limit is held with HR's view and decided in Finance. The numbers a request
// carries (days, balance at the start, instalment) are computed, never typed,
// and computed again when it is decided. Pure: no I/O.

import type { HrContext } from "./access"
import { mayDecideRequest, mayEndorse } from "./access"
import { docState, type DocDates } from "./documents"
import type { EmployeePay, HrEmployee } from "./employee"
import { balanceSplit, leaveBalance, leaveDays, leaveEligibility, LEAVE_RULES, sickSplit, type Holiday, type LeaveEligibility, type LeaveType, type SickSplit } from "./leave"
import { advanceInstalment, advanceMonths, wageOf } from "./pay"
import { addDays, serviceYears, type HrPolicies } from "./statutory"

export const HR_REQUEST_KINDS = ["leave", "advance", "data"] as const
export type HrRequestKind = (typeof HR_REQUEST_KINDS)[number]

/** pending → (endorsed) → approved | declined | finance → approved | declined; not started → cancelled. */
export const HR_REQUEST_STATES = ["pending", "endorsed", "approved", "declined", "finance", "cancelled"] as const
export type HrRequestState = (typeof HR_REQUEST_STATES)[number]

/** The yearly sequence codes — shown ط.إ / ط.سل / ط.ص in Arabic. */
export const REQUEST_NUMBER_TYPE: Record<HrRequestKind, string> = { leave: "LV", advance: "AV", data: "HQ" }

/** ES-03 — what an employee may ask to change; he never edits his own record. */
export const DATA_FIELDS = ["iban", "mobile", "address", "emergency"] as const
export type DataField = (typeof DATA_FIELDS)[number]

export interface DataFields {
  field: DataField
  value: string
  /** The supporting document (a bank letter for an IBAN) — its reference; attachments come later (EM-07). */
  document?: string | null
}

export type DataBlock = "no_value" | "bad_iban" | "no_document"

export function dataBlocks(input: { field: DataField; value: string; document?: string | null }): DataBlock[] {
  const out: DataBlock[] = []
  const v = input.value.trim()
  if (!v) out.push("no_value")
  if (input.field === "iban") {
    if (v && !/^SA\d{22}$/.test(v.replace(/\s+/g, "").toUpperCase())) out.push("bad_iban")
    if (!input.document?.trim()) out.push("no_document")
  }
  return out
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
  /** The employee travels — his iqama and passport must outlast the return (LV-04). */
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
  endorsement?: Stamp | null
  decision?: (Stamp & { ownFlagged?: boolean }) | null
  /** Set when an advance goes to Finance — Finance reads by it, before and after deciding. */
  financeHold?: boolean
  finance?: Stamp | null
  cancel?: Stamp | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Leave (LV-01…06)
// ---------------------------------------------------------------------------

export type LeaveBlock = "bad_dates" | "too_long" | "above_balance" | "overlap" | LeaveEligibility
export type LeaveWarning = "travel_docs" | "sick_beyond" | "excess_unpaid"

export interface LeaveQuote {
  days: number
  balance: number
  fromBalance: number
  unpaidDays: number
  sick: SickSplit | null
  blocks: LeaveBlock[]
  warnings: LeaveWarning[]
}

/** The sick days already used in the service year that holds `day` (art. 117 counts per service year). */
export function sickUsedIn(emp: Pick<HrEmployee, "join" | "sick">, day: string): number {
  if (!emp.sick) return 0
  return emp.sick.year === Math.floor(serviceYears(emp.join, day)) ? emp.sick.days : 0
}

/** Documents that would expire before the employee is back (LV-04). */
export function travelDocsExpire(docs: DocDates | null | undefined, nationality: string, returnDay: string): boolean {
  if (nationality === "sa") return false
  return (["iqama", "passport"] as const).some((k) => docState(docs?.[k], returnDay) === "expired" || !docs?.[k])
}

export function leaveQuote(
  emp: Pick<HrEmployee, "join" | "gender" | "hajjTaken" | "leaveTaken" | "openingLeave" | "sick" | "docs" | "nationality">,
  input: { type: LeaveType; from: string; to: string; excessUnpaid: boolean; travel: boolean },
  ctx: { holidays?: Holiday[]; others?: Array<{ from: string; to: string }> } = {}
): LeaveQuote {
  const blocks: LeaveBlock[] = []
  const warnings: LeaveWarning[] = []
  const rule = LEAVE_RULES[input.type]
  const valid = Boolean(input.from && input.to && input.to >= input.from)
  if (!valid) blocks.push("bad_dates")
  const days = valid ? leaveDays(input.from, input.to, ctx.holidays) : 0
  const balance = input.from ? leaveBalance(emp.join, input.from, emp.leaveTaken ?? 0, emp.openingLeave ?? 0) : 0
  const elig = input.from ? leaveEligibility(input.type, emp, input.from) : null
  if (elig) blocks.push(elig)
  if (rule.days && days > rule.days) blocks.push("too_long")
  if (valid && (ctx.others ?? []).some((o) => o.from <= input.to && input.from <= o.to)) blocks.push("overlap")
  let fromBalance = 0
  let unpaidDays = 0
  let sick: SickSplit | null = null
  if (rule.fromBalance) {
    const split = balanceSplit(days, Math.max(0, balance))
    fromBalance = split.fromBalance
    if (split.excess > 0) {
      if (input.excessUnpaid) {
        unpaidDays = split.excess
        warnings.push("excess_unpaid")
      } else blocks.push("above_balance")
    }
  } else if (rule.pay === "none") unpaidDays = days
  else if (rule.pay === "sick" && input.from) {
    sick = sickSplit(sickUsedIn(emp, input.from), days)
    if (sick.beyond > 0) warnings.push("sick_beyond")
  }
  if (input.travel && valid && travelDocsExpire(emp.docs, emp.nationality, addDays(input.to, 1))) warnings.push("travel_docs")
  return { days, balance, fromBalance, unpaidDays, sick, blocks, warnings }
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

/** A request that has not started may be cancelled: pending by its owner or HR; an approved leave before its first day by HR (LV-07). */
export function mayCancel(ctx: HrContext, r: Pick<HrRequest, "state" | "kind" | "employeeId" | "leave">, today: string): boolean {
  const own = Boolean(ctx.employeeId) && ctx.employeeId === r.employeeId
  const hr = ctx.roles.has("manager")
  if (r.state === "pending" || r.state === "endorsed") return own || hr
  if (r.state === "approved" && r.kind === "leave" && r.leave && r.leave.from > today) return hr
  return false
}

export function requestActions(ctx: HrContext, r: HrRequest, opts: { today: string; financeAllowed: boolean }): RequestAction[] {
  const out: RequestAction[] = []
  const open = r.state === "pending" || r.state === "endorsed"
  if (r.kind === "leave" && r.state === "pending" && mayEndorse(ctx, { employeeId: r.employeeId, site: r.siteId, lineManagerId: r.lineManagerId })) out.push("endorse")
  if (open && mayDecideRequest(ctx, { employeeId: r.employeeId, isHrManager: r.deciderLevel === "management" }) === null) out.push("approve", "decline")
  if (r.state === "finance" && opts.financeAllowed && ctx.employeeId !== r.employeeId) out.push("finance")
  if (mayCancel(ctx, r, opts.today)) out.push("cancel")
  return out
}

/** The request's number as a person reads it (ط.إ / ط.سل in Arabic). */
export function requestNoDisplay(no: string, locale: string): string {
  if (locale !== "ar") return no
  return no.replace(/^LV-/, "ط.إ-").replace(/^AV-/, "ط.سل-").replace(/^HQ-/, "ط.ص-")
}

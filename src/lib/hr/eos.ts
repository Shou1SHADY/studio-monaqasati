// HR 1.0 — end of service (PRD EX-01, EX-02, §8; arts. 75, 77, 84, 85). The
// gratuity is computed from the wage and the years of service by the calendar,
// never typed; a resignation earns a fraction of it; art. 77 on a fixed term
// is the rest of the contract, read from its end date; the monthly accrual
// feeds hr:EOS. Pure: no I/O.

import { calendarServiceYears, daysBetween, r2, serviceSpan, STATUTORY } from "./statutory"

export const EXIT_REASONS = ["resignation", "termination_notice", "termination_pay", "contract_end", "probation"] as const
export type ExitReason = (typeof EXIT_REASONS)[number]

/** Art. 84 — a half month's wage for each of the first five years, a month for each after. */
export function fullGratuity(wage: number, years: number): number {
  const h = STATUTORY.eos.halfMonthYears
  return r2(wage * (0.5 * Math.min(years, h) + Math.max(0, years - h)))
}

/** Art. 85 — a resignation earns nothing under 2 years, ⅓ to 5, ⅔ to 10, all after. */
export function resignationShare(years: number): number {
  for (const band of STATUTORY.eos.resignation) if (years < band.below) return band.share
  return 1
}

/** The gratuity due for an exit (EX-02). Leaving during probation earns none. */
export function gratuity(wage: number, join: string, lastDay: string, reason: ExitReason): number {
  if (reason === "probation") return 0
  const years = calendarServiceYears(join, lastDay)
  const full = fullGratuity(wage, years)
  return reason === "resignation" ? r2(full * resignationShare(years)) : full
}

/** The month's accrual toward the provision: wage/24, then wage/12 after five years. */
export const monthlyEosAccrual = (wage: number, years: number) => r2(years < STATUTORY.eos.halfMonthYears ? wage / 24 : wage / 12)

/** Art. 75 — notice pay: two months' wage. */
export const noticePay = (wage: number) => r2(wage * STATUTORY.noticeMonths)

/** Art. 77 — compensation for termination without a valid reason: 15 days a year
 * on an open contract, the wage of the remaining term on a fixed one (wage/30 a
 * day) — never less than two months. */
export function art77Compensation(wage: number, years: number, fixedRemainingDays?: number | null): number {
  const floor = wage * 2
  const due = fixedRemainingDays != null ? (wage / 30) * Math.max(0, fixedRemainingDays) : (wage / 30) * STATUTORY.art77DaysPerYear * years
  return r2(Math.max(floor, due))
}

/** The days a fixed contract still had to run after the last day — read from its end date, never typed. */
export function fixedRemainingDays(contract: { type: string; end?: string | null } | null | undefined, lastDay: string): number | null {
  if (contract?.type !== "fixed" || !contract.end) return null
  return Math.max(0, daysBetween(lastDay, contract.end))
}

/** The leave balance paid out in cash: wage/30 per day. */
export const leaveEncashment = (wage: number, balanceDays: number) => r2((wage / 30) * Math.max(0, balanceDays))

// ---------------------------------------------------------------------------
// The exit and its settlement (EX-01…05, WF-16)
// ---------------------------------------------------------------------------

/** `hrExits/{orgId}__{employeeId}` (no money — Inventory and government relations read it) and
 * `hrSettlements/{same id}` (the money — pay roles, Finance and the employee). */
export const exitId = (orgId: string, employeeId: string) => `${orgId}__${employeeId}`

export const EXIT_TASKS = ["gosi", "insurance", "finalExit"] as const
export type ExitTask = (typeof EXIT_TASKS)[number]

export interface SettlementInput {
  wage: number
  join: string
  lastDay: string
  reason: ExitReason
  /** Annual leave: days taken and the imported opening balance. */
  leaveTaken: number
  openingLeave?: number
  /** Art. 77 compensation is due (termination without a valid reason) — the HR manager's call. */
  art77?: boolean
  /** The contract: on a fixed term art. 77 is the rest of it, from its end date (EX-01). */
  contract?: { type: string; end?: string | null } | null
  /** A ticket owed by the contract — typed, as the contract says. */
  ticket?: number
  /** Deductions: the outstanding advance, and custody Inventory valued as missing. */
  advanceBalance?: number
  custodyShortfall?: number
  /** EX-04 — the month of the last day, computed as a payroll line up to the last day (join date, the month's
   * attendance, sick and unpaid days, penalties, GOSI) with no advance instalment; null when that month's
   * payroll already paid him — a month is never paid twice. */
  lastMonth: LastMonth | null
}

/** What the settlement takes from the last month's line. */
export interface LastMonth {
  days: number
  /** What it pays him: gross less GOSI, sick and unpaid days, penalties. */
  net: number
  gosiEmployee: number
  gosiEmployer: number
  penalties: number
  /** Its cost to the company: gross less sick and unpaid days, plus employer GOSI. */
  cost: number
}

export interface Settlement {
  years: number
  /** Service by the calendar, as the certificate and the gratuity read it. */
  service?: { years: number; months: number; days: number }
  gratuity: number
  leaveDays: number
  leaveCash: number
  /** The last month's paid days up to the last day (payroll stops the month the employee leaves). */
  lastMonthDays: number
  /** The last month's pay — 0 when that month's payroll already paid it (`lastMonthPaid`). */
  lastPay: number
  lastMonthPaid?: boolean
  /** The last month's GOSI (both shares), penalties and cost — for Finance's entry. */
  lastGosiEmployee?: number
  lastGosiEmployer?: number
  lastPenalties?: number
  lastCost?: number
  noticePay: number
  art77: number
  /** On a fixed term, the days of the contract left after the last day. */
  art77Days?: number | null
  ticket: number
  advance: number
  custody: number
  gross: number
  net: number
}

export function settlementQuote(i: SettlementInput, leaveBalanceAt: (join: string, asOf: string, taken: number, opening: number) => number): Settlement {
  const years = calendarServiceYears(i.join, i.lastDay)
  const grat = gratuity(i.wage, i.join, i.lastDay, i.reason)
  const leaveDays = Math.max(0, leaveBalanceAt(i.join, i.lastDay, i.leaveTaken, i.openingLeave ?? 0))
  const leaveCash = leaveEncashment(i.wage, leaveDays)
  const last = i.lastMonth
  const notice = i.reason === "termination_pay" ? noticePay(i.wage) : 0
  const remaining = fixedRemainingDays(i.contract, i.lastDay)
  const comp = i.art77 && (i.reason === "termination_notice" || i.reason === "termination_pay") ? art77Compensation(i.wage, years, remaining) : 0
  const ticket = r2(Math.max(0, i.ticket ?? 0))
  const advance = r2(Math.max(0, i.advanceBalance ?? 0))
  const custody = r2(Math.max(0, i.custodyShortfall ?? 0))
  const lastPay = last ? r2(last.net) : 0
  const gross = r2(grat + leaveCash + lastPay + notice + comp + ticket)
  return {
    years: r2(years),
    service: serviceSpan(i.join, i.lastDay),
    gratuity: grat,
    leaveDays,
    leaveCash,
    lastMonthDays: last?.days ?? 0,
    lastPay,
    lastMonthPaid: last === null,
    lastGosiEmployee: last?.gosiEmployee ?? 0,
    lastGosiEmployer: last?.gosiEmployer ?? 0,
    lastPenalties: last?.penalties ?? 0,
    lastCost: last?.cost ?? 0,
    noticePay: notice,
    art77: comp,
    art77Days: comp > 0 ? remaining : null,
    ticket,
    advance,
    custody,
    gross,
    net: r2(gross - advance - custody),
  }
}

export type ExitBlock = "no_reason" | "no_last_day" | "last_before_join" | "left" | "probation_over" | "contract_open"

export function exitBlocks(emp: { join: string; status: string; probation?: { end: string; decision?: string | null } | null; contract?: { type: string } | null }, input: { reason: ExitReason | null; lastDay: string | null }): ExitBlock[] {
  const out: ExitBlock[] = []
  if (!input.reason) out.push("no_reason")
  if (!input.lastDay) out.push("no_last_day")
  else if (input.lastDay < emp.join) out.push("last_before_join")
  if (emp.status === "left" || emp.status === "leaving") out.push("left")
  if (input.reason === "probation" && input.lastDay && (emp.probation?.decision === "confirmed" || (emp.probation?.end && input.lastDay > emp.probation.end))) out.push("probation_over")
  if (input.reason === "contract_end" && emp.contract?.type !== "fixed") out.push("contract_open")
  return out
}

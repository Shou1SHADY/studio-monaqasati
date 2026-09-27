// HR 1.0 — end of service (PRD EX-01, EX-02, §8; arts. 75, 77, 84, 85). The
// gratuity is computed from the wage and the years, never typed; a resignation
// earns a fraction of it; the monthly accrual feeds hr:EOS. Pure: no I/O.

import { r2, serviceYears, STATUTORY } from "./statutory"

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
  const years = serviceYears(join, lastDay)
  const full = fullGratuity(wage, years)
  return reason === "resignation" ? r2(full * resignationShare(years)) : full
}

/** The month's accrual toward the provision: wage/24, then wage/12 after five years. */
export const monthlyEosAccrual = (wage: number, years: number) => r2(years < STATUTORY.eos.halfMonthYears ? wage / 24 : wage / 12)

/** Art. 75 — notice pay: two months' wage. */
export const noticePay = (wage: number) => r2(wage * STATUTORY.noticeMonths)

/** Art. 77 — compensation for termination without a valid reason: 15 days a year
 * on an open contract, the remaining term on a fixed one — never less than two months. */
export function art77Compensation(wage: number, years: number, fixedRemainingMonths?: number | null): number {
  const floor = wage * 2
  const due = fixedRemainingMonths != null ? wage * fixedRemainingMonths : (wage / 30) * STATUTORY.art77DaysPerYear * years
  return r2(Math.max(floor, due))
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
  /** A fixed contract's remaining months (art. 77 on a fixed term). */
  fixedRemainingMonths?: number | null
  /** A ticket owed by the contract — typed, as the contract says. */
  ticket?: number
  /** Deductions: the outstanding advance, and custody Inventory valued as missing. */
  advanceBalance?: number
  custodyShortfall?: number
}

export interface Settlement {
  years: number
  gratuity: number
  leaveDays: number
  leaveCash: number
  /** The last month's days up to the last day (payroll stops the month the employee leaves). */
  lastMonthDays: number
  lastPay: number
  noticePay: number
  art77: number
  ticket: number
  advance: number
  custody: number
  gross: number
  net: number
}

export function settlementQuote(i: SettlementInput, leaveBalanceAt: (join: string, asOf: string, taken: number, opening: number) => number): Settlement {
  const years = serviceYears(i.join, i.lastDay)
  const grat = gratuity(i.wage, i.join, i.lastDay, i.reason)
  const leaveDays = Math.max(0, leaveBalanceAt(i.join, i.lastDay, i.leaveTaken, i.openingLeave ?? 0))
  const leaveCash = leaveEncashment(i.wage, leaveDays)
  const lastMonthDays = Math.min(STATUTORY.monthDays, Number(i.lastDay.slice(8, 10)))
  const lastPay = r2((i.wage * lastMonthDays) / STATUTORY.monthDays)
  const notice = i.reason === "termination_pay" ? noticePay(i.wage) : 0
  const comp = i.art77 && (i.reason === "termination_notice" || i.reason === "termination_pay") ? art77Compensation(i.wage, years, i.fixedRemainingMonths) : 0
  const ticket = r2(Math.max(0, i.ticket ?? 0))
  const advance = r2(Math.max(0, i.advanceBalance ?? 0))
  const custody = r2(Math.max(0, i.custodyShortfall ?? 0))
  const gross = r2(grat + leaveCash + lastPay + notice + comp + ticket)
  return { years: r2(years), gratuity: grat, leaveDays, leaveCash, lastMonthDays, lastPay, noticePay: notice, art77: comp, ticket, advance, custody, gross, net: r2(gross - advance - custody) }
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

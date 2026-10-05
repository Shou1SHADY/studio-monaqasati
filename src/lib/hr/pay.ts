// HR 1.0 — pay (PRD §8, PY-01, AD-01). The wage, a month's pay line and its
// deductions, computed from the contract and the CLOSED month's attendance —
// never typed. Amounts keep their halalas (r2). Pure: no I/O.

import { DEFAULT_HR_POLICIES, monthRange, r2, STATUTORY, daysBetween, type HrPolicies } from "./statutory"

export interface PayFacts {
  basic: number
  housing: number
  transport: number
}

/** The automatic allowances from a basic, by policy (EM-03, EM-04). */
export function payFromBasic(basic: number, policies: Pick<HrPolicies, "housingShare" | "transportShare"> = DEFAULT_HR_POLICIES): PayFacts {
  return { basic: r2(basic), housing: r2(basic * policies.housingShare), transport: r2(basic * policies.transportShare) }
}

/** Monthly wage = basic + housing + transport. */
export const wageOf = (p: PayFacts) => r2(p.basic + p.housing + p.transport)

/** Paid days in the month: 30, or from the join date (§8) — and, in the month of the last day, up to it (EX-04). */
export function paidDays(join: string, month: string, lastDay?: string | null): number {
  const { start, end } = monthRange(month)
  const to = lastDay && lastDay < end ? lastDay : end
  if (join > to || (lastDay && lastDay < start)) return 0
  if (join <= start && to === end) return STATUTORY.monthDays
  return Math.max(0, Math.min(STATUTORY.monthDays, daysBetween(join > start ? join : start, to) + 1))
}

// ---------------------------------------------------------------------------
// The pay in force on a day (EM-04, WF-10): a change applies from its date
// ---------------------------------------------------------------------------

/** One pay decision and the day it takes effect. The first step of a pay's history starts on "" (always). */
export interface PayStep extends PayFacts {
  from: string
}

/** The pay in force on `day`: the last step on or before it; a pay without steps is its own. */
export function payOn<T extends PayFacts & { steps?: PayStep[] | null }>(pay: T, day: string): T {
  const steps = pay.steps ?? []
  let at: PayStep | null = null
  for (const s of steps) if (s.from <= day && (!at || s.from >= at.from)) at = s
  return at ? { ...pay, basic: at.basic, housing: at.housing, transport: at.transport } : pay
}

/** The month's paid days split by the pay in force on them — a change mid-month pays the old wage
 * up to the day before it and the new from it. A later piece counts its calendar days to the end of
 * the period (at most the paid days), as the retro difference does; the first takes the rest. */
export function paySegments(pay: PayFacts & { steps?: PayStep[] | null }, join: string, month: string, lastDay?: string | null): Array<{ pay: PayFacts; days: number }> {
  const days = paidDays(join, month, lastDay)
  const { start, end } = monthRange(month)
  const from = join > start ? join : start
  const to = lastDay && lastDay < end ? lastDay : end
  const inside = (pay.steps ?? []).filter((s) => s.from > from && s.from <= to).sort((a, b) => a.from.localeCompare(b.from))
  const out: Array<{ pay: PayFacts; days: number }> = []
  let current: PayFacts = payOn(pay, from)
  let left = days
  for (const s of inside) {
    const later = Math.min(left, daysBetween(s.from, to) + 1)
    if (left - later > 0) out.push({ pay: current, days: left - later })
    left = later
    current = s
  }
  if (left > 0 || !out.length) out.push({ pay: current, days: left })
  return out
}

/** Art. 107 — one overtime hour. */
export const overtimeRate = (p: PayFacts) => (wageOf(p) + STATUTORY.overtimeBasicShare * p.basic) / STATUTORY.overtimeDivisor

export type Nationality = "sa" | string

export interface GosiRates {
  employee: number
  employer: number
  scheme: "saudiOld" | "saudiNew" | "nonSaudi"
}

/** GOSI rates: non-Saudi 2% employer only; a Saudi on the new scheme if he joined on or after 3 Jul 2024
 * (the day the new law took effect — the prototype's `join > 2 Jul`). */
export function gosiRates(nationality: Nationality, join: string): GosiRates {
  const g = STATUTORY.gosi
  if (nationality !== "sa") return { ...g.nonSaudi, scheme: "nonSaudi" }
  return join >= g.newSchemeFrom ? { ...g.saudiNew, scheme: "saudiNew" } : { ...g.saudiOld, scheme: "saudiOld" }
}

/** The contribution base for the month: (basic + housing) × paid days / 30. */
export const gosiBase = (p: PayFacts, days: number) => r2(((p.basic + p.housing) * days) / STATUTORY.monthDays)

/** Art. 92 — the advance instalment: 10% of the wage, never below 50 SAR. */
export const advanceInstalment = (wage: number) => r2(Math.max(STATUTORY.advance.minInstalment, wage * STATUTORY.advance.instalmentShare))
export const advanceMonths = (amount: number, wage: number) => Math.ceil(amount / advanceInstalment(wage))

export type AdvanceFactBlock = "no_wage" | "bad_amount" | "outstanding"

export interface AdvanceFacts {
  /** The monthly wage in force (basic + housing + transport). */
  wage: number
  /** The HR manager's limit: wage × the policy's months (`advanceMaxMonths`); above it the request goes to Finance. */
  limit: number
  overLimit: boolean
  /** The balance of the advance already running (0: none). */
  outstanding: number
  /** Art. 92 — the schedule: `instalment × (count − 1) + last = amount`. */
  instalment: number
  count: number
  last: number
  /** The first and the last month an instalment is taken: from the month after the payout (taken as next month). */
  firstMonth: string | null
  lastMonth: string | null
  /** AD-04 — the repayment runs past the contract's end: the rest comes from the settlement. */
  pastContract: boolean
  /** No wage on record · no amount · an advance still running or another request pending (AD-02: never a second). */
  blocks: AdvanceFactBlock[]
}

const nextMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number)
  const i = y * 12 + (m - 1) + n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`
}

/**
 * AD-01…04 — the facts an advance is decided on (the prototype's form `adv`): the wage, the decider's limit, the
 * outstanding balance, the instalment schedule and whether repayment runs past the contract. Pure; the decision
 * dialog shows them and the write checks the same rules again.
 */
export function advanceFacts(input: {
  pay: PayFacts | null
  amount: number
  /** `HrPolicies.advanceMaxMonths`. */
  maxMonths: number
  /** The running advance's balance (`employeePay.advance.balance`). */
  outstanding?: number | null
  /** Another advance request of his is still open. */
  pending?: boolean
  today: string
  /** A fixed contract's end; none for an open one. */
  contractEnd?: string | null
}): AdvanceFacts {
  const wage = input.pay ? wageOf(input.pay) : 0
  const amount = r2(Math.max(0, input.amount || 0))
  const outstanding = r2(Math.max(0, input.outstanding ?? 0))
  const blocks: AdvanceFactBlock[] = []
  if (!(wage > 0)) blocks.push("no_wage")
  if (!(amount > 0)) blocks.push("bad_amount")
  if (outstanding > 0 || input.pending) blocks.push("outstanding")
  const limit = r2(wage * input.maxMonths)
  const instalment = wage > 0 ? Math.min(advanceInstalment(wage), amount || advanceInstalment(wage)) : 0
  const count = instalment > 0 && amount > 0 ? Math.ceil(amount / instalment) : 0
  const last = count > 0 ? r2(amount - instalment * (count - 1)) : 0
  const start = nextMonths(input.today.slice(0, 7), 1)
  const firstMonth = count > 0 ? start : null
  const lastMonth = count > 0 ? nextMonths(start, count - 1) : null
  return {
    wage,
    limit,
    overLimit: wage > 0 && amount > limit,
    outstanding,
    instalment,
    count,
    last,
    firstMonth,
    lastMonth,
    pastContract: Boolean(input.contractEnd && lastMonth && lastMonth > input.contractEnd.slice(0, 7)),
    blocks,
  }
}

/** What the closed month says about one employee (AT-03). */
export interface MonthAttendance {
  absent: number
  overtimeHours: number
  /** Sick days already split by art. 117 bands in this month. */
  sickThreeQuarters: number
  sickUnpaid: number
  /** Unpaid leave days. */
  unpaid: number
}

export const NO_ATTENDANCE: MonthAttendance = { absent: 0, overtimeHours: 0, sickThreeQuarters: 0, sickUnpaid: 0, unpaid: 0 }

export interface PayLineInput {
  pay: PayFacts
  nationality: Nationality
  join: string
  month: string
  attendance: MonthAttendance
  /** Outstanding advance balance and its instalment. */
  advance?: { balance: number; instalment: number } | null
  /** Penalties applied this month, already capped (PN-03). */
  penalties?: number
  /** Approved commission from Sales. */
  commission?: number
  /** The month of the last day pays up to it (EX-04). */
  lastDay?: string | null
  /** The pay in force on each piece of the month (EM-04) — default: `pay` all month. */
  segments?: Array<{ pay: PayFacts; days: number }>
}

export interface PayLine {
  days: number
  wage: number
  monthWage: number
  absenceDeduction: number
  overtime: number
  commission: number
  gross: number
  sickDeduction: number
  unpaidDeduction: number
  penalties: number
  gosiEmployee: number
  gosiEmployer: number
  advance: number
  net: number
  gosiScheme: GosiRates["scheme"]
}

/**
 * One employee's line for the month (§8): month wage − absence + overtime +
 * commission = gross; net = gross − GOSI (employee) − advance − sick − unpaid −
 * penalties. Sick and unpaid days are deducted from net, not gross, as the
 * prototype and the Finance contract have it.
 */
export function payLine(input: PayLineInput): PayLine {
  const days = paidDays(input.join, input.month, input.lastDay)
  const wage = wageOf(input.pay)
  const daily = wage / STATUTORY.monthDays
  const segments = input.segments ?? [{ pay: input.pay, days }]
  const monthWage = r2(segments.reduce((s, x) => s + wageOf(x.pay) * x.days, 0) / STATUTORY.monthDays)
  // Days without pay never exceed the days paid: the month is 30 days on the
  // payroll, so 31 calendar days of unpaid leave take the month's wage, no more.
  let left = days
  const within = (n: number) => {
    const take = Math.max(0, Math.min(n, left))
    left -= take
    return take
  }
  const absent = within(input.attendance.absent)
  const unpaid = within(input.attendance.unpaid)
  const sickUnpaid = within(input.attendance.sickUnpaid)
  const sickThreeQuarters = within(input.attendance.sickThreeQuarters)
  const absenceDeduction = r2(daily * absent)
  const overtime = r2(overtimeRate(input.pay) * input.attendance.overtimeHours)
  const commission = r2(input.commission ?? 0)
  const gross = r2(monthWage - absenceDeduction + overtime + commission)
  const sickDeduction = r2(daily * (sickThreeQuarters * 0.25 + sickUnpaid))
  const unpaidDeduction = r2(daily * unpaid)
  const penalties = r2(input.penalties ?? 0)
  const rates = gosiRates(input.nationality, input.join)
  const base = r2(segments.reduce((s, x) => s + gosiBase(x.pay, x.days), 0))
  const gosiEmployee = r2(base * rates.employee)
  const gosiEmployer = r2(base * rates.employer)
  const advance = input.advance && input.advance.balance > 0 ? r2(Math.min(input.advance.instalment, input.advance.balance)) : 0
  const net = r2(gross - gosiEmployee - advance - sickDeduction - unpaidDeduction - penalties)
  return { days, wage, monthWage, absenceDeduction, overtime, commission, gross, sickDeduction, unpaidDeduction, penalties, gosiEmployee, gosiEmployer, advance, net, gosiScheme: rates.scheme }
}

/** Overtime above the monthly cap is a warning, not a block. */
export const overtimeOverCap = (hours: number) => hours > STATUTORY.overtimeMonthlyCapHours

/** A retro pay difference for up to one closed month (EM-04) — into the -D payroll. */
export function retroDifference(oldWage: number, newWage: number, days: number): number {
  return r2(((newWage - oldWage) / STATUTORY.monthDays) * Math.min(days, STATUTORY.monthDays))
}

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

/** Paid days in the month: 30, or from the join date (§8). */
export function paidDays(join: string, month: string): number {
  const { start, end } = monthRange(month)
  if (join <= start) return STATUTORY.monthDays
  if (join > end) return 0
  return Math.max(0, Math.min(STATUTORY.monthDays, daysBetween(join, end) + 1))
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
  const days = paidDays(input.join, input.month)
  const wage = wageOf(input.pay)
  const daily = wage / STATUTORY.monthDays
  const monthWage = r2((wage * days) / STATUTORY.monthDays)
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
  const base = gosiBase(input.pay, days)
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

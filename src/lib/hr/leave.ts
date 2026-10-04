// HR 1.0 — leave (PRD LV-01…06, §8). The balance is computed as of the leave's
// START (accrued − taken), never typed; holidays inside a leave are not counted;
// sick leave follows art. 117 bands per service year. Pure: no I/O.

import { isHoliday, OFFICIAL_HOLIDAYS, type Holiday } from "./holidays"
import { dayMs, DAY_MS, serviceYears, STATUTORY } from "./statutory"

export type { Holiday } from "./holidays"

export const LEAVE_TYPES = ["annual", "emergency", "sick", "maternity", "paternity", "marriage", "bereavement", "hajj", "exam", "unpaid"] as const
export type LeaveType = (typeof LEAVE_TYPES)[number]

interface LeaveRule {
  /** Paid in full, deducted as unpaid, or by the sick bands. */
  pay: "full" | "none" | "sick"
  /** Taken from the annual balance. */
  fromBalance?: boolean
  /** Fixed statutory length. */
  days?: number
  /** Women only. */
  female?: boolean
  /** Needs this many years of service. */
  minYears?: number
  /** Once in the whole service. */
  once?: boolean
}

/** LV-01 — the statutory types and how each is paid. */
export const LEAVE_RULES: Record<LeaveType, LeaveRule> = {
  annual: { pay: "full", fromBalance: true },
  emergency: { pay: "full", fromBalance: true },
  sick: { pay: "sick" },
  maternity: { pay: "full", days: STATUTORY.maternityDays, female: true },
  paternity: { pay: "full", days: STATUTORY.paternityDays },
  marriage: { pay: "full", days: STATUTORY.marriageDays },
  bereavement: { pay: "full", days: STATUTORY.bereavementDays },
  hajj: { pay: "full", days: STATUTORY.hajjDays, minYears: STATUTORY.hajjMinYears, once: true },
  exam: { pay: "full" },
  unpaid: { pay: "none" },
}

/** Days accrued to `asOf`: 21 a year, 30 a year after five years. */
export function accruedDays(join: string, asOf: string): number {
  const y = serviceYears(join, asOf)
  const L = STATUTORY.leave
  return L.base * Math.min(y, L.fiveYears) + L.afterFive * Math.max(0, y - L.fiveYears)
}

/** LV-02 — the balance as of a day: accrued − taken (+ an imported opening balance), whole days. */
export function leaveBalance(join: string, asOf: string, taken: number, opening = 0): number {
  return Math.floor(accruedDays(join, asOf) + opening - taken)
}

/** Leave days = calendar days from `from` to `to` inclusive, minus the official holidays. */
export function leaveDays(from: string, to: string, holidays: readonly Holiday[] = OFFICIAL_HOLIDAYS): number {
  if (to < from) return 0
  let n = 0
  for (let t = dayMs(from); t <= dayMs(to); t += DAY_MS) if (!isHoliday(new Date(t).toISOString().slice(0, 10), holidays)) n += 1
  return n
}

/** LV-03 — what a leave above the balance means: the part within the balance, and the excess. */
export function balanceSplit(days: number, balance: number): { fromBalance: number; excess: number } {
  const fromBalance = Math.max(0, Math.min(days, balance))
  return { fromBalance, excess: days - fromBalance }
}

export interface SickSplit {
  full: number
  threeQuarters: number
  unpaid: number
  /** Beyond 120 days in the service year — HR's decision. */
  beyond: number
}

/** LV-06 — art. 117: the next `days` sick days given those already used this service year. */
export function sickSplit(usedThisYear: number, days: number): SickSplit {
  const S = STATUTORY.sick
  const out: SickSplit = { full: 0, threeQuarters: 0, unpaid: 0, beyond: 0 }
  for (let i = 0; i < days; i++) {
    const p = usedThisYear + i
    if (p < S.full) out.full += 1
    else if (p < S.full + S.threeQuarters) out.threeQuarters += 1
    else if (p < S.full + S.threeQuarters + S.unpaid) out.unpaid += 1
    else out.beyond += 1
  }
  return out
}

export type LeaveEligibility = "female_only" | "min_years" | "once_taken"

/** Whether an employee may take this type at all. */
export function leaveEligibility(type: LeaveType, emp: { gender?: string | null; join: string; hajjTaken?: boolean }, asOf: string): LeaveEligibility | null {
  const r = LEAVE_RULES[type]
  if (r.female && emp.gender !== "f") return "female_only"
  if (r.minYears && serviceYears(emp.join, asOf) < r.minYears) return "min_years"
  if (r.once && type === "hajj" && emp.hajjTaken) return "once_taken"
  return null
}

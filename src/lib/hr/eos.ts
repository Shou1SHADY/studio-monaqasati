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

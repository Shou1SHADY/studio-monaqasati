// HR 1.0 — the statutory table and the company's policies (PRD §8, §13, ST-01).
//
// Statutory values come from the Saudi Labour Law and GOSI and are READ-ONLY on
// every screen: the company cannot type its own overtime rate or gratuity. The
// company's policies — allowances, pay day, renewal window, the advance limit,
// block-or-warn choices — are editable in Settings and default to these values.
// "Statutory rates live in one table": everything that computes pay reads here.
// Pure: no I/O.

export const STATUTORY = {
  /** Days in a payroll month, whatever the calendar says. */
  monthDays: 30,
  /** Art. 107: an overtime hour = (wage + 50% of basic) / 240. */
  overtimeBasicShare: 0.5,
  overtimeDivisor: 240,
  /** Above this many overtime hours a month is a warning (written consent). */
  overtimeMonthlyCapHours: 60,
  /** Working hours a day; six in Ramadan for everyone (AT-06). */
  normalHours: 8,
  ramadanHours: 6,
  /** GOSI — base is basic + housing. Saudis who joined after 3 Jul 2024 are on the new scheme. */
  gosi: {
    newSchemeFrom: "2024-07-03",
    saudiOld: { employee: 0.0975, employer: 0.1175 },
    saudiNew: { employee: 0.1025, employer: 0.1225 },
    nonSaudi: { employee: 0, employer: 0.02 },
  },
  /** Art. 117 — sick days per service year: 30 full, 60 at 75%, 30 unpaid; beyond is HR's decision. */
  sick: { full: 30, threeQuarters: 60, unpaid: 30 },
  /** Annual leave — 21 days, 30 after five years of service. */
  leave: { base: 21, afterFive: 30, fiveYears: 5 },
  /** Art. 53 — probation 90 days, extendable to 180 with the worker's written consent. */
  probation: { days: 90, maxDays: 180 },
  /** Art. 92 — an advance is repaid at up to 10% of the wage a month (never below 50 SAR). */
  advance: { instalmentShare: 0.1, minInstalment: 50 },
  /** Penalties — a ladder of four steps; recurrence counts APPLIED penalties in 180 days;
   * at most five days' wage a month, reduced not carried; objection within 15 days. */
  penalties: { windowDays: 180, monthlyCapDays: 5, objectionDays: 15 },
  /** Art. 84/85 — end of service. */
  eos: { halfMonthYears: 5, resignation: [{ below: 2, share: 0 }, { below: 5, share: 1 / 3 }, { below: 10, share: 2 / 3 }] as const },
  /** Art. 80 (AT-05) — not back from leave: a written warning is due after 10 days in a row, termination possible after 15. */
  art80: { warningDays: 10, terminationDays: 15 },
  /** Art. 75 — two months' notice; art. 77 — 15 days a year (open contract). */
  noticeMonths: 2,
  art77DaysPerYear: 15,
  /** An iqama is issued within 90 days of arrival; a work injury is reported to GOSI in 3 working days. */
  iqamaIssueDays: 90,
  injuryReportWorkingDays: 3,
  /** Statutory leave (LV-01). */
  maternityDays: 84,
  paternityDays: 3,
  marriageDays: 5,
  bereavementDays: 5,
  hajjDays: 15,
  hajjMinYears: 2,
} as const

export type BlockOrWarn = "block" | "warn"

/** The company's policies (§13) — editable, with these defaults. */
export interface HrPolicies {
  /** Automatic allowances as a share of basic. */
  housingShare: number
  transportShare: number
  /** Day of the month salaries are paid. */
  payDay: number
  /** Days before expiry a document enters the renewal window. */
  renewWindowDays: number
  /** HR approves advances up to this many months' wage; above goes to Finance. */
  advanceMaxMonths: number
  /** Closing a month with an unrecorded day (AT-04). */
  closeMissing: BlockOrWarn
}

export const DEFAULT_HR_POLICIES: HrPolicies = {
  housingShare: 0.25,
  transportShare: 0.1,
  payDay: 5,
  renewWindowDays: 60,
  advanceMaxMonths: 1,
  closeMissing: "block",
}

const frac = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback)
const int = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback)

/** A stored policy set, or nothing, made complete and sane. */
export function resolveHrPolicies(raw: Partial<HrPolicies> | null | undefined): HrPolicies {
  const d = DEFAULT_HR_POLICIES
  return {
    housingShare: frac(raw?.housingShare, d.housingShare),
    transportShare: frac(raw?.transportShare, d.transportShare),
    payDay: int(raw?.payDay, 1, 28, d.payDay),
    renewWindowDays: int(raw?.renewWindowDays, 1, 365, d.renewWindowDays),
    advanceMaxMonths: typeof raw?.advanceMaxMonths === "number" && raw.advanceMaxMonths > 0 && raw.advanceMaxMonths <= 12 ? raw.advanceMaxMonths : d.advanceMaxMonths,
    closeMissing: raw?.closeMissing === "warn" ? "warn" : "block",
  }
}

// ---------------------------------------------------------------------------
// Dates — `YYYY-MM-DD` strings, compared as days (no invented midnight)
// ---------------------------------------------------------------------------

export const DAY_MS = 86_400_000
export const dayMs = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`)
/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / DAY_MS)
export const addDays = (day: string, n: number) => new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10)
/** Service in years (fractional) from the join date to `asOf`. */
export const serviceYears = (join: string, asOf: string) => Math.max(0, daysBetween(join, asOf) / 365)

/** Service by the calendar (EX-01/02, arts. 84/85): whole years and months from the join date to the
 * day AFTER the last day worked — the last day is served — then the days left. Two years end on the
 * second anniversary, whatever the leap days in between; days ÷ 365 moved that threshold by a day. */
export function serviceSpan(join: string, lastDay: string): { years: number; months: number; days: number } {
  const end = addDays(lastDay, 1)
  if (end <= join) return { years: 0, months: 0, days: 0 }
  const [jy, jm, jd] = join.split("-").map(Number)
  const [ey, em] = end.split("-").map(Number)
  let months = (ey - jy) * 12 + (em - jm)
  // The month's anniversary day, clamped to a short month (31 Jan + 1 month = 28/29 Feb).
  const anniversary = (n: number) => {
    const y = jy + Math.floor((jm - 1 + n) / 12)
    const m = ((jm - 1 + n) % 12) + 1
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(jd, last)).padStart(2, "0")}`
  }
  while (months > 0 && anniversary(months) > end) months--
  return { years: Math.floor(months / 12), months: months % 12, days: daysBetween(anniversary(months), end) }
}

/** The span as fractional years for the gratuity — years + months/12 + days/365. */
export function calendarServiceYears(join: string, lastDay: string): number {
  const s = serviceSpan(join, lastDay)
  return s.years + s.months / 12 + s.days / 365
}

/** `YYYY-MM` → its first and last day. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number)
  const start = `${month}-01`
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { start, end }
}

export const r2 = (n: number) => Math.round(n * 100) / 100

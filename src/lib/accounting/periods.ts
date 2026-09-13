// Reporting periods (الفترات المالية) — fiscal-year aware.
//
// "Q1" means nothing until the company's financial year is known: for a company
// whose year opens in April, Q1 is April–June, not January–March. Every preset
// here is therefore computed from `startMonth` (Accounting settings) and a
// fiscal year, and a fiscal year is named by the calendar year it OPENS in —
// FY 2026 for an April start runs 2026-04-01 → 2027-03-31 and reads "2026/27".
//
// Pure functions over ISO date strings (YYYY-MM-DD) in UTC, so the presets are
// unit-testable and never drift by a day across time zones.

export type PeriodKind = "year" | "half" | "quarter" | "month" | "ytd" | "custom"

export interface FiscalPeriod {
  /** Stable within a fiscal year: FY, H1, H2, Q1–Q4, M01–M12 (fiscal order), YTD, CUSTOM. */
  key: string
  kind: PeriodKind
  labelAr: string
  labelEn: string
  from: string
  to: string
  /** The fiscal year the preset belongs to; null for a custom range. */
  fiscalYear: number | null
}

export const MONTH_NAMES_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
]
export const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const pad = (n: number) => String(n).padStart(2, "0")
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function isoToday(reference = new Date()): string {
  return reference.toISOString().slice(0, 10)
}

/** Clamp anything outside 1–12 back to January — a missing setting must still
 * produce a valid calendar rather than NaN dates. */
export function normalizeStartMonth(month: unknown): number {
  const n = Math.trunc(Number(month))
  return n >= 1 && n <= 12 ? n : 1
}

/** Calendar (year, month) of the i-th month of a fiscal year, i = 0…11. */
function fiscalMonth(fiscalYear: number, startMonth: number, i: number): { y: number; m: number } {
  const zeroBased = startMonth - 1 + i
  return { y: fiscalYear + Math.floor(zeroBased / 12), m: (zeroBased % 12) + 1 }
}

function monthStart(y: number, m: number): string {
  return `${y}-${pad(m)}-01`
}

function monthEnd(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(lastDay(y, m))}`
}

/** Which fiscal year a date falls in. */
export function fiscalYearOf(date: string, startMonth: number): number {
  const start = normalizeStartMonth(startMonth)
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  return m >= start ? y : y - 1
}

export function fiscalYearRange(fiscalYear: number, startMonth: number): { from: string; to: string } {
  const start = normalizeStartMonth(startMonth)
  const first = fiscalMonth(fiscalYear, start, 0)
  const last = fiscalMonth(fiscalYear, start, 11)
  return { from: monthStart(first.y, first.m), to: monthEnd(last.y, last.m) }
}

/** "2026" for a calendar-year company, "2026/27" when the year straddles two. */
export function fiscalYearLabel(fiscalYear: number, startMonth: number): string {
  return normalizeStartMonth(startMonth) === 1 ? String(fiscalYear) : `${fiscalYear}/${String((fiscalYear + 1) % 100).padStart(2, "0")}`
}

function span(fiscalYear: number, startMonth: number, fromIndex: number, months: number): { from: string; to: string } {
  const a = fiscalMonth(fiscalYear, startMonth, fromIndex)
  const b = fiscalMonth(fiscalYear, startMonth, fromIndex + months - 1)
  return { from: monthStart(a.y, a.m), to: monthEnd(b.y, b.m) }
}

function rangeWords(fiscalYear: number, startMonth: number, fromIndex: number, months: number, locale: "ar" | "en"): string {
  const a = fiscalMonth(fiscalYear, startMonth, fromIndex)
  const b = fiscalMonth(fiscalYear, startMonth, fromIndex + months - 1)
  const names = locale === "ar" ? MONTH_NAMES_AR : MONTH_NAMES_EN
  const aName = locale === "ar" ? names[a.m - 1] : names[a.m - 1].slice(0, 3)
  const bName = locale === "ar" ? names[b.m - 1] : names[b.m - 1].slice(0, 3)
  return a.y === b.y ? `${aName} – ${bName} ${b.y}` : `${aName} ${a.y} – ${bName} ${b.y}`
}

const QUARTER_AR = ["الربع الأول", "الربع الثاني", "الربع الثالث", "الربع الرابع"]
const HALF_AR = ["النصف الأول", "النصف الثاني"]

/**
 * Every preset of one fiscal year, in the order a picker lists them: the year,
 * year-to-date, halves, quarters, then the twelve months in fiscal order.
 *
 * Year-to-date runs from the year's first day to `today`, capped at the year's
 * end — for a past year it is the whole year, for a future one it is empty
 * (from > to), which the caller treats as "no data yet" rather than an error.
 */
export function fiscalPeriodOptions(opts: { fiscalYear: number; startMonth: number; today?: string }): FiscalPeriod[] {
  const start = normalizeStartMonth(opts.startMonth)
  const fy = opts.fiscalYear
  const yearLabel = fiscalYearLabel(fy, start)
  const year = fiscalYearRange(fy, start)
  const today = opts.today ?? isoToday()
  const out: FiscalPeriod[] = [
    { key: "FY", kind: "year", labelAr: `السنة المالية ${yearLabel}`, labelEn: `Fiscal year ${yearLabel}`, ...year, fiscalYear: fy },
    {
      key: "YTD",
      kind: "ytd",
      labelAr: `منذ بداية السنة ${yearLabel}`,
      labelEn: `Year to date ${yearLabel}`,
      from: year.from,
      to: today < year.to ? today : year.to,
      fiscalYear: fy,
    },
  ]
  for (let h = 0; h < 2; h++) {
    out.push({
      key: `H${h + 1}`,
      kind: "half",
      labelAr: `${HALF_AR[h]} ${yearLabel} (${rangeWords(fy, start, h * 6, 6, "ar")})`,
      labelEn: `H${h + 1} ${yearLabel} (${rangeWords(fy, start, h * 6, 6, "en")})`,
      ...span(fy, start, h * 6, 6),
      fiscalYear: fy,
    })
  }
  for (let q = 0; q < 4; q++) {
    out.push({
      key: `Q${q + 1}`,
      kind: "quarter",
      labelAr: `${QUARTER_AR[q]} ${yearLabel} (${rangeWords(fy, start, q * 3, 3, "ar")})`,
      labelEn: `Q${q + 1} ${yearLabel} (${rangeWords(fy, start, q * 3, 3, "en")})`,
      ...span(fy, start, q * 3, 3),
      fiscalYear: fy,
    })
  }
  for (let i = 0; i < 12; i++) {
    const { y, m } = fiscalMonth(fy, start, i)
    out.push({
      key: `M${pad(i + 1)}`,
      kind: "month",
      labelAr: `${MONTH_NAMES_AR[m - 1]} ${y}`,
      labelEn: `${MONTH_NAMES_EN[m - 1]} ${y}`,
      from: monthStart(y, m),
      to: monthEnd(y, m),
      fiscalYear: fy,
    })
  }
  return out
}

/** The twelve months of a fiscal year, in order — the x-axis of every trend. */
export function fiscalMonths(fiscalYear: number, startMonth: number): FiscalPeriod[] {
  return fiscalPeriodOptions({ fiscalYear, startMonth }).filter((p) => p.kind === "month")
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + "T00:00:00Z")
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** A user-chosen range. Reversed dates are swapped rather than rejected — the
 * intent is unambiguous and refusing it would only cost a click. */
export function customPeriod(from: string, to: string): FiscalPeriod {
  const [a, b] = from <= to ? [from, to] : [to, from]
  return { key: "CUSTOM", kind: "custom", labelAr: `${a} ← ${b}`, labelEn: `${a} → ${b}`, from: a, to: b, fiscalYear: null }
}

export interface PeriodSelection {
  key: string
  fiscalYear: number | null
  customFrom: string
  customTo: string
}

/**
 * Resolve a stored selection into a concrete period. Anything stale or invalid
 * (a custom range with a bad date, a key from an older version) falls back to
 * the current fiscal year, so a reporting screen can never open on nothing.
 */
export function resolvePeriod(selection: PeriodSelection, startMonth: number, today = isoToday()): FiscalPeriod {
  if (selection.key === "CUSTOM" && isValidIsoDate(selection.customFrom) && isValidIsoDate(selection.customTo)) {
    return customPeriod(selection.customFrom, selection.customTo)
  }
  const fy = selection.fiscalYear ?? fiscalYearOf(today, startMonth)
  const options = fiscalPeriodOptions({ fiscalYear: fy, startMonth, today })
  return options.find((p) => p.key === selection.key) ?? options[0]
}

/** Fiscal years worth offering: from the oldest entry's year to the current one. */
export function fiscalYearChoices(dates: string[], startMonth: number, today = isoToday()): number[] {
  const current = fiscalYearOf(today, startMonth)
  let earliest = current
  for (const d of dates) {
    if (!isValidIsoDate(d)) continue
    const fy = fiscalYearOf(d, startMonth)
    if (fy < earliest) earliest = fy
  }
  const years: number[] = []
  for (let y = current; y >= earliest; y--) years.push(y)
  return years
}

/** Inclusive day count of a period, capped at `today` so a year still in
 * progress is measured by the days that have actually happened — the divisor
 * DSO, DIO and DPO need. Never less than one. */
export function elapsedDays(from: string, to: string, today = isoToday()): number {
  const end = to < today ? to : today
  const ms = new Date(end + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

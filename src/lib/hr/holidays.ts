// HR 1.0 — the official holiday calendar (PRD LV-02, AT-06, WF-05; §17 "the
// public holidays are a yearly table"). Statutory and read-only, like every
// value in statutory.ts: the company does not type its own Eid. The
// implementing regulations of the Labour Law (art. 112) give the private
// sector Eid al-Fitr — four days from the day after 29 Ramadan — Eid al-Adha
// — four days from the day of Arafah — both by the Umm al-Qura calendar, plus
// Founding Day (22 Feb) and National Day (23 Sep). Ramadan is kept beside them:
// six working hours for everyone (AT-06), shown on the sheet.
//
// Holidays inside a leave are not counted (LV-02); a holiday is not an
// unrecorded day on a workplace's sheet (WF-05 step 1) — it is paid, and work
// done on it is recorded as overtime like any other hour beyond the day.
// Update the table when a new Hijri year is published. Pure: no I/O.

import { addDays } from "./statutory"

/** A run of days off: the first day and how many. */
export interface Holiday {
  from: string
  days: number
}

export const HOLIDAY_KEYS = ["founding", "fitr", "adha", "national"] as const
export type HolidayKey = (typeof HOLIDAY_KEYS)[number]

export interface PublicHoliday extends Holiday {
  key: HolidayKey
}

/** Umm al-Qura: Ramadan (first and last day), the first day of the Eid al-Fitr
 * holiday (the day after 29 Ramadan) and the day of Arafah. */
const HIJRI: Record<number, { ramadan: [string, string]; fitr: string; adha: string }> = {
  2024: { ramadan: ["2024-03-11", "2024-04-09"], fitr: "2024-04-09", adha: "2024-06-15" },
  2025: { ramadan: ["2025-03-01", "2025-03-29"], fitr: "2025-03-30", adha: "2025-06-05" },
  2026: { ramadan: ["2026-02-18", "2026-03-19"], fitr: "2026-03-19", adha: "2026-05-26" },
  2027: { ramadan: ["2027-02-08", "2027-03-08"], fitr: "2027-03-09", adha: "2027-05-15" },
  2028: { ramadan: ["2028-01-28", "2028-02-25"], fitr: "2028-02-26", adha: "2028-05-04" },
  2029: { ramadan: ["2029-01-16", "2029-02-13"], fitr: "2029-02-14", adha: "2029-04-23" },
  2030: { ramadan: ["2030-01-05", "2030-02-03"], fitr: "2030-02-03", adha: "2030-04-12" },
}

const EID_DAYS = 4

/** The years the table covers. */
export const HOLIDAY_YEARS = Object.keys(HIJRI).map(Number)

/** One year's official holidays, in date order. */
export function publicHolidays(year: number): PublicHoliday[] {
  const h = HIJRI[year]
  const out: PublicHoliday[] = [{ key: "founding", from: `${year}-02-22`, days: 1 }]
  if (h) out.push({ key: "fitr", from: h.fitr, days: EID_DAYS }, { key: "adha", from: h.adha, days: EID_DAYS })
  out.push({ key: "national", from: `${year}-09-23`, days: 1 })
  return out.sort((a, b) => a.from.localeCompare(b.from))
}

/** Every holiday of the table — the default wherever days are counted. */
export const OFFICIAL_HOLIDAYS: readonly PublicHoliday[] = HOLIDAY_YEARS.flatMap(publicHolidays)

/** The holiday a day falls in, if any. */
export function holidayOn(day: string): PublicHoliday | null
export function holidayOn<H extends Holiday>(day: string, holidays: readonly H[]): H | null
export function holidayOn(day: string, holidays: readonly Holiday[] = OFFICIAL_HOLIDAYS): Holiday | null {
  return holidays.find((h) => day >= h.from && day <= addDays(h.from, h.days - 1)) ?? null
}

export const isHoliday = (day: string, holidays: readonly Holiday[] = OFFICIAL_HOLIDAYS) => holidayOn<Holiday>(day, holidays) !== null

/** AT-06 — Ramadan: six working hours a day for everyone (religion is never recorded). */
export function isRamadan(day: string): boolean {
  const h = HIJRI[Number(day.slice(0, 4))]
  return Boolean(h && day >= h.ramadan[0] && day <= h.ramadan[1])
}

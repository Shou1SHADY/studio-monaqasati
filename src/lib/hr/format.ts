import { sarLtr } from "../riyal"
import { docState, DOC_TYPES, type DocDates, type DocState, type DocType } from "./documents"

/** A riyal figure with its halalas, the official sign on the left (SAMA). */
export const hrMoney = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : sarLtr(n.toLocaleString("en-US", { maximumFractionDigits: 2 })))

/** A `YYYY-MM-DD` day in the reader's language, Latin digits. */
export function hrDate(day: string | null | undefined, locale: string): string {
  if (!day) return "—"
  const d = new Date(`${day.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { day: "numeric", month: "short", year: "numeric" })
}

/** Riyadh is UTC+3 all year (no daylight saving). */
const RIYADH_OFFSET_MS = 3 * 3_600_000

/** The day in Riyadh (§17: "Riyadh time") — never the UTC day, which reads
 * 00:00–03:00 as yesterday, nor the reader's own clock abroad. */
export const riyadhDay = (now: Date = new Date()) => new Date(now.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10)

/** Today, as every HR screen and write reads it. */
export const todayDay = () => riyadhDay()

/** The document nearest to expiry (DC-01), for the file's tile and the register. */
export function nearestDocument(docs: DocDates | null | undefined, today: string, renewWindowDays: number): { type: DocType; expiry: string; state: DocState } | null {
  let best: { type: DocType; expiry: string; state: DocState } | null = null
  for (const type of DOC_TYPES) {
    const expiry = docs?.[type]
    if (!expiry) continue
    if (!best || expiry < best.expiry) best = { type, expiry, state: docState(expiry, today, renewWindowDays) }
  }
  return best
}

/** The employee number as shown: 4 digits (EM-02). */
export const empNo = (no: number | null | undefined) => (no == null ? "—" : String(no).padStart(4, "0"))

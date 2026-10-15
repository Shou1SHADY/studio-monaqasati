// How the free supplier's screens write things (PRD NFR-04, SUP-12): one rule for money, dates and
// numbers, the same in every screen and both languages — "SAR 1,200" / "1,200 ر.س", "11 Oct 2026" /
// "11 أكتوبر" (the year only when it is not the data's year), Western digits, thousands separators,
// and the short forms "349 K" / "349 ألف". Pure: the unit words come in as labels.

import { dayNum } from "./deal-logic"

export interface FmtLabels {
  cur: string
  thousand: string
  million: string
}

export type Locale = "ar" | "en"

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })
const nm0 = new Intl.NumberFormat("en-US")
const nm2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtN = (n: number) => nf.format(n)
export const fmtM = (n: number) => (Number.isInteger(Math.round((n + Number.EPSILON) * 100) / 100) ? nm0.format(n) : nm2.format(n))

const dateFmt: Record<Locale, { full: Intl.DateTimeFormat; short: Intl.DateTimeFormat }> = {
  ar: {
    full: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" }),
    short: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" }),
  },
  en: {
    full: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
    short: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
  },
}

/** `11 أكتوبر` / `11 Oct`; with the year when it is not the data's year (or when `year` is forced). */
export function fd(iso: string | null | undefined, locale: Locale, dataYear: number, year?: boolean): string {
  if (!iso) return "—"
  const d = new Date(dayNum(iso))
  const y = d.getUTCFullYear()
  const base = dateFmt[locale].full.format(d)
  return year || y !== dataYear ? `${base} ${y}` : base
}

export function makeFmt(locale: Locale, labels: FmtLabels, dataYear: number) {
  const money = (n: number) => (locale === "ar" ? `${fmtM(n)} ${labels.cur}` : `${labels.cur} ${fmtM(n)}`)
  /** 349 ألف · 1.86 م — the short money form of the cards. */
  const kM = (n: number) => {
    const a = Math.abs(n)
    if (a >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")} ${labels.million}`
    if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")} ${labels.thousand}`
    return fmtN(n)
  }
  const date = (iso: string | null | undefined, year?: boolean) => fd(iso, locale, dataYear, year)
  return { money, kM, date, n: fmtN, cur: labels.cur }
}

export type Fmt = ReturnType<typeof makeFmt>

/** Relative day word keys: the caller maps them to messages. */
export function relKey(n: number): { key: "today" | "tomorrow" | "yesterday" | "inX" | "agoX"; days: number } {
  if (n === 0) return { key: "today", days: 0 }
  if (n === 1) return { key: "tomorrow", days: 1 }
  if (n === -1) return { key: "yesterday", days: 1 }
  return n > 0 ? { key: "inX", days: n } : { key: "agoX", days: -n }
}

/** A Saudi mobile: 05XXXXXXXX, from digits typed in either numeral set. */
export function normalizeMobile(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\d]/g, "")
}
export const isSaudiMobile = (value: string) => /^05\d{8}$/.test(normalizeMobile(value))

// ---- Riyadh time (NFR-05) ---------------------------------------------------------------------------------

const RIYADH_MS = 3 * 3_600_000

/** The moment a stored value names, in ms — an ISO string, a Firestore Timestamp, or `{ seconds }`. 0 when none. */
export function momentOf(v: unknown): number {
  if (!v) return 0
  if (typeof v === "string") {
    const t = Date.parse(v.length <= 10 ? `${v}T00:00:00Z` : v)
    return Number.isFinite(t) ? t : 0
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "object" && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") return (v as { toDate: () => Date }).toDate().getTime()
  if (typeof v === "object" && "seconds" in v) return Number((v as { seconds: number }).seconds) * 1000
  return 0
}

/** The Riyadh day (`yyyy-mm-dd`) of a stored value. A bare date stays as written; a moment is read in Riyadh, so a
 * post at 22:30 UTC belongs to the next day there. */
export function riyadhDayOf(v: unknown): string {
  if (!v) return ""
  if (typeof v === "string" && v.length <= 10) return v
  const t = momentOf(v)
  if (!t) return typeof v === "string" ? v.slice(0, 10) : ""
  return new Date(t + RIYADH_MS).toISOString().slice(0, 10)
}

/** The day-group a notification sits under: today · yesterday · its own date. */
export function dayGroup(day: string, today: string): "today" | "yesterday" | "date" | "" {
  if (!day) return ""
  const n = Math.round((dayNum(day) - dayNum(today)) / 86_400_000)
  return n === 0 ? "today" : n === -1 ? "yesterday" : "date"
}

/** A notification shown to the supplier starts with the contractor's name (MSG-03) — unless its title already names him. */
export function leadWithName(title: string, name: string | null | undefined): string {
  const n = (name || "").trim()
  if (!n || n === "—" || title.includes(n)) return title
  return `${n} · ${title}`
}

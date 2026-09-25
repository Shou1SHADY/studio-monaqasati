import { sarLtr } from "../riyal"

/** A riyal figure with the official sign, for a number isolated in `dir="ltr"`. */
export const pmMoney = (n: number) => sarLtr(Math.round(n).toLocaleString("en-US"))

/** A percentage from a fraction (0.1 → "10%"). */
export const pmPct = (f: number | null | undefined) => (f == null ? "—" : `${Math.round(f * 1000) / 10}%`)

/** A `YYYY-MM-DD` day in the reader's language, Latin digits as elsewhere. */
export function pmDate(day: string | null | undefined, locale: string): string {
  if (!day) return "—"
  const d = new Date(`${day.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { day: "numeric", month: "short", year: "numeric" })
}

export const todayDay = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

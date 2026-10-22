import type { LinkRfqView } from "@/lib/procurement/rfq-share-view"
import { displayCity, displayDistrict } from "@/lib/constants"

type Translate = (key: string, values?: Record<string, string | number>) => string

export const fmtMoney = (n: number, locale: string): string => n.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export const fmtQty = (n: number, locale: string): string => n.toLocaleString(locale, { maximumFractionDigits: 3 })

/** «25 أكتوبر» — a calendar day, read as the day it is (no timezone shift). */
export function fmtDay(day: string | null | undefined, locale: string): string {
  const d = (day || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ""
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" })
}

export const fmtDayLong = (day: string | null | undefined, locale: string): string => {
  const d = (day || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ""
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
}

const dayNum = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)

/** «بعد 5 أيام» from today (Riyadh's day, passed in). */
export function relativeDays(day: string | null, today: string, t: Translate): string {
  if (!day) return ""
  const diff = dayNum(day) - dayNum(today)
  if (diff <= 0) return t("head_rel_today")
  if (diff === 1) return t("head_rel_tomorrow")
  return t("head_rel_days", { count: diff })
}

/** 12 → «سنة», 24 → «سنتين», 6 → «6 أشهر». */
export function monthsText(months: number, t: Translate): string {
  if (months === 12) return t("dur_year1")
  if (months === 24) return t("dur_year2")
  if (months > 24 && months % 12 === 0) return t("dur_years", { count: months / 12 })
  if (months === 1) return t("dur_month1")
  if (months === 2) return t("dur_month2")
  return t("dur_months", { count: months })
}

export function placeText(p: { city: string; district: string }, locale: string): string {
  const city = displayCity(p.city, locale)
  return p.district ? `${city} — ${displayDistrict(p.district, locale)}` : city
}

/** The buyer's terms as one phrase: «100% خلال 30 يوماً». */
export function termsText(rfq: LinkRfqView, tRoot: Translate): string {
  if (rfq.termsList?.length) return rfq.termsList.map((x) => (x.days === 0 ? tRoot("terms_now", { pct: x.pct }) : tRoot("terms_row", { pct: x.pct, days: x.days }))).join(" + ")
  return rfq.paymentTerms || ""
}

export const WARRANTY_CHOICES = (asked: number): number[] => [asked, ...[24, 12, 6, 3].filter((m) => m < asked), 0].filter((m, i, a) => a.indexOf(m) === i)

import { z } from "zod"

export const DEMO_BUSINESS_TYPES = ["manufacturer", "other"] as const
export type DemoBusinessType = (typeof DEMO_BUSINESS_TYPES)[number]

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000
const MAX_DAYS_AHEAD = 120

export function riyadhToday(now: number = Date.now()): string {
  return new Date(now + RIYADH_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function isValidDemoDate(day: string, now: number = Date.now()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const parsed = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return false
  const weekday = parsed.getUTCDay()
  if (weekday === 5 || weekday === 6) return false
  const today = riyadhToday(now)
  return day >= today && day <= addDays(today, MAX_DAYS_AHEAD)
}

export const demoRequestBase = z.object({
  name: z.string().trim().min(2).max(200),
  company: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(7).max(30).regex(/^[+\d\s().\-]+$/),
  email: z.string().trim().toLowerCase().email(),
  preferredDate: z.string().refine((v) => isValidDemoDate(v)),
  businessType: z.enum(DEMO_BUSINESS_TYPES),
  businessOther: z.string().trim().max(120),
})

export const demoRequestSchema = demoRequestBase.refine((v) => v.businessType !== "other" || v.businessOther.length >= 2, {
  path: ["businessOther"],
})

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

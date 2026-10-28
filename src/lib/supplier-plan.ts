// A supplier company is either on the FREE journey (Supplier 1.0: eight screens that answer
// "what do contractors ask of me, and what am I owed?") or on the FULL portal (the module list
// like a contractor's). Suppliers a contractor adds are free until the platform says
// otherwise; the admin switches a company in Components. No document = free.
//
// «Full» can be a TRIAL (`planTrialEndsAt`): the paid portal for a few days, then the company is back on the free journey
// with everything it did kept. Nothing is locked — the plan simply reads «free» once the end has passed.

import { trialClockOf, type TrialClock } from "./subscription-status"

export const COMPANY_PLANS = "companyPlans"

export const SUPPLIER_PLANS = ["free", "full"] as const
export type SupplierPlan = (typeof SUPPLIER_PLANS)[number]

export interface PlanDoc {
  supplierPlan?: unknown
  planTrialEndsAt?: unknown
}

/** The plan the company is on NOW: «full» unless its paid trial has ended. */
export const planOf = (doc: PlanDoc | null | undefined, now: Date = new Date()): SupplierPlan =>
  doc && doc.supplierPlan === "full" && trialClockOf(doc.planTrialEndsAt, now).phase !== "ended" ? "full" : "free"

/** The paid trial on the plan document: running, ended, or none (a plain subscription, or the free plan). */
export const planTrialOf = (doc: PlanDoc | null | undefined, now: Date = new Date()): TrialClock =>
  doc && doc.supplierPlan === "full" ? trialClockOf(doc.planTrialEndsAt, now) : { phase: "none", endsAt: null, daysLeft: null }

/** The pages of the free journey. Every other /supplier page belongs to the full portal. */
const FREE_EXACT = new Set(["/supplier", "/supplier/rfqs", "/supplier/offers", "/supplier/orders", "/supplier/invoices", "/supplier/connections", "/supplier/chats", "/supplier/profile", "/supplier/notifications", "/supplier/search"])

export function freePathAllowed(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/"
  if (FREE_EXACT.has(p)) return true
  return /^\/supplier\/chat\/[^/]+$/.test(p)
}

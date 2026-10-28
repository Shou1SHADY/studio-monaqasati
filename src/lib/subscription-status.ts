// A contractor's subscription status (Procurement 2.0 prototype, admin list and package page — AD-03): «نشط» Active or
// «تجريبي» Trial, shown beside the package. Stored as an optional `subscription` on `companyModules/{orgId}` and written
// only by the admin's routes; no field (every company before it) is Active. It is not the verification status, which stays
// beside it.
//
// A trial has a length. The admin sets it when the account is opened from a request (or later on the package page); the clock
// starts when the account is created — that is the acceptance — and `trialEndsAt` is stored as an ISO instant. Past it the
// company is «expired»: the portal shows a locked page instead of its screens. A trial with no `trialEndsAt` (set before trials
// had a length) never expires.

export const SUBSCRIPTION_STATUSES = ["active", "trial"] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export const subscriptionStatusOf = (raw: unknown): SubscriptionStatus => (raw === "trial" ? "trial" : "active")

export const TRIAL_DEFAULT_DAYS = 14
export const PAID_TRIAL_DEFAULT_DAYS = 7
export const TRIAL_MAX_DAYS = 365

const DAY_MS = 86_400_000

export interface TrialWindow {
  trialDays: number
  trialStartedAt: string
  trialEndsAt: string
  /** The same instant as a number, because the security rules compare it with the request time (they cannot read the ISO text). */
  trialEndsMs: number
}

export const trialWindow = (days: number, from: Date): TrialWindow => {
  const end = new Date(from.getTime() + days * DAY_MS)
  return { trialDays: days, trialStartedAt: from.toISOString(), trialEndsAt: end.toISOString(), trialEndsMs: end.getTime() }
}

export const NO_TRIAL_WINDOW = { trialDays: null, trialStartedAt: null, trialEndsAt: null, trialEndsMs: null } as const

export interface TrialClock {
  phase: "none" | "running" | "ended"
  endsAt: string | null
  daysLeft: number | null
}

/** Where a stored end instant stands against the clock. No (or unreadable) end is «none»: nothing runs, nothing ends. */
export function trialClockOf(endsAt: unknown, now: Date): TrialClock {
  const end = typeof endsAt === "string" ? new Date(endsAt) : null
  if (!end || Number.isNaN(end.getTime())) return { phase: "none", endsAt: null, daysLeft: null }
  const left = end.getTime() - now.getTime()
  if (left <= 0) return { phase: "ended", endsAt: end.toISOString(), daysLeft: 0 }
  return { phase: "running", endsAt: end.toISOString(), daysLeft: Math.ceil(left / DAY_MS) }
}

export type SubscriptionPhase = SubscriptionStatus | "expired"

export interface SubscriptionState {
  phase: SubscriptionPhase
  endsAt: string | null
  daysLeft: number | null
}

interface StoredSubscription {
  subscription?: unknown
  trialEndsAt?: unknown
}

export function subscriptionStateOf(stored: StoredSubscription | null | undefined, now: Date): SubscriptionState {
  if (subscriptionStatusOf(stored?.subscription) !== "trial") return { phase: "active", endsAt: null, daysLeft: null }
  const clock = trialClockOf(stored?.trialEndsAt, now)
  if (clock.phase === "ended") return { phase: "expired", endsAt: clock.endsAt, daysLeft: 0 }
  return { phase: "trial", endsAt: clock.endsAt, daysLeft: clock.daysLeft }
}

export const parseTrialDays = (raw: string): number | null => {
  const n = Number(raw.trim())
  return Number.isInteger(n) && n >= 1 && n <= TRIAL_MAX_DAYS ? n : null
}

/** A trial's end as a calendar day in the reader's language; empty when there is none. */
export const trialDayText = (iso: string | null, locale: string): string =>
  iso ? new Date(iso).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { year: "numeric", month: "short", day: "numeric" }) : ""

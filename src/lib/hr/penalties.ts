// HR 1.0 — violations and penalties (PRD PN-01…04, the work regulation). A
// ladder of four steps per violation; the step is the number of APPLIED
// penalties of the same kind in the last 180 days (a dismissed or cancelled one
// does not count); amounts are fractions of a day's wage; the month's total is
// capped at five days' wage — reduced, not carried. Pure: no I/O.

import { daysBetween, r2, STATUTORY } from "./statutory"

/** One step: a written warning, a fraction of a day's wage, whole days, or termination (art. 80). */
export type PenaltyStep = { kind: "warning" } | { kind: "fraction"; of: number } | { kind: "days"; days: number } | { kind: "termination" }

const w: PenaltyStep = { kind: "warning" }
const f = (of: number): PenaltyStep => ({ kind: "fraction", of })
const d = (days: number): PenaltyStep => ({ kind: "days", days })

export const VIOLATIONS = {
  late15: [w, f(0.05), f(0.1), f(0.2)],
  late30: [f(0.1), f(0.15), f(0.25), f(0.5)],
  late60: [f(0.25), f(0.5), f(0.75), d(1)],
  lateOver: [f(0.3), f(0.5), d(1), d(2)],
  absentDay: [d(1), d(2), d(3), d(4)],
  ppe: [w, f(0.1), f(0.25), f(0.5)],
  leftEarly: [w, f(0.1), f(0.25), f(0.5)],
  negligence: [f(0.25), f(0.5), d(1), d(2)],
  fighting: [d(2), d(3), d(5), { kind: "termination" }],
} as const satisfies Record<string, readonly PenaltyStep[]>

export type ViolationCode = keyof typeof VIOLATIONS
export const VIOLATION_CODES = Object.keys(VIOLATIONS) as ViolationCode[]

export interface PastViolation {
  code: ViolationCode
  /** The day it happened. */
  on: string
  /** Applied (counts), dismissed or cancelled on objection (does not). */
  outcome: "applied" | "dismissed" | "cancelled" | "pending"
}

/** PN-01 — the step (0-based) for a new violation: applied same-code ones in 180 days, max the last step. */
export function penaltyStep(code: ViolationCode, on: string, history: PastViolation[]): number {
  const prior = history.filter((v) => v.code === code && v.outcome === "applied" && daysBetween(v.on, on) >= 0 && daysBetween(v.on, on) <= STATUTORY.penalties.windowDays).length
  return Math.min(prior, VIOLATIONS[code].length - 1)
}

/** The penalty's amount before the monthly cap. */
export function penaltyAmount(step: PenaltyStep, wage: number): number {
  const day = wage / 30
  if (step.kind === "fraction") return r2(day * step.of)
  if (step.kind === "days") return r2(day * step.days)
  return 0
}

/** PN-03 — what may still be deducted this month: five days' wage minus what is already applied. */
export function capRemaining(wage: number, alreadyThisMonth: number): number {
  return r2(Math.max(0, (wage / 30) * STATUTORY.penalties.monthlyCapDays - alreadyThisMonth))
}

/** The amount actually deducted: reduced to the cap, never carried to the next month. */
export const cappedPenalty = (amount: number, wage: number, alreadyThisMonth: number) => r2(Math.min(amount, capRemaining(wage, alreadyThisMonth)))

/** PN-04 — an objection is on time within 15 days of the notice. */
export const objectionOnTime = (notifiedOn: string, today: string) => daysBetween(notifiedOn, today) <= STATUTORY.penalties.objectionDays

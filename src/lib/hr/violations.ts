// HR 1.0 — a violation's record and its penalty (PRD PN-01…05, WF-09). Recorded
// by the supervisor (on his sheet or by hand) or the HR manager; the HR
// manager decides after a hearing — its date is blocking (PN-02); the step is
// the count of APPLIED same-code penalties in 180 days (PN-01); the employee
// may object within 15 days, which suspends it (PN-04); a cancelled one never
// counts again. The five-days cap is applied by the payroll, month by month —
// reduced, not carried (PN-03). Pure: no I/O.

import { cappedPenalty, penaltyAmount, penaltyStep, VIOLATIONS, type PastViolation, type ViolationCode } from "./penalties"
import { daysBetween, STATUTORY } from "./statutory"

/** recorded → applied | dismissed; applied → objected → upheld | cancelled. */
export const VIOLATION_STATES = ["recorded", "applied", "dismissed", "objected", "upheld", "cancelled"] as const
export type ViolationState = (typeof VIOLATION_STATES)[number]

/** `hrViolations/{orgId}__{employeeId}__{day}__{code}` — the same violation is never recorded twice. */
export const violationId = (orgId: string, employeeId: string, on: string, code: ViolationCode) => `${orgId}__${employeeId}__${on}__${code}`

export interface Stamp {
  by: string
  byName: string | null
  at: string
}

export interface HrViolation {
  id: string
  organizationId: string
  employeeId: string
  employeeUserId: string | null
  employeeName: string
  siteId: string | null
  code: ViolationCode
  on: string
  note?: string | null
  source: "sheet" | "manual"
  state: ViolationState
  recorded: Stamp
  /** PN-02 — the hearing, required before a penalty is applied. */
  hearing?: { on: string; note?: string | null } | null
  step?: number | null
  stepKind?: "warning" | "fraction" | "days" | "termination" | null
  /** Before the monthly cap — the payroll caps it. */
  amount?: number | null
  /** The month whose payroll deducts it: the decision's (or the upholding's). */
  deductMonth?: string | null
  /** The day the employee was told — the objection clock starts here. */
  notifiedOn?: string | null
  decision?: (Stamp & { note?: string | null }) | null
  objection?: (Stamp & { text: string }) | null
  objectionDecision?: (Stamp & { note?: string | null }) | null
}

/** What counts for the ladder: applied or upheld = applied; the rest never. */
export function historyOf(all: HrViolation[], employeeId: string, exceptId?: string): PastViolation[] {
  return all
    .filter((v) => v.employeeId === employeeId && v.id !== exceptId)
    .map((v) => ({ code: v.code, on: v.on, outcome: v.state === "applied" || v.state === "upheld" ? "applied" : v.state === "cancelled" ? "cancelled" : v.state === "dismissed" ? "dismissed" : "pending" }))
}

export type ApplyBlock = "no_hearing" | "hearing_before" | "hearing_future" | "decided" | "no_wage"

export function applyQuote(v: Pick<HrViolation, "code" | "on" | "state">, input: { hearingOn: string | null; today: string; wage: number; history: PastViolation[] }) {
  const blocks: ApplyBlock[] = []
  if (v.state !== "recorded") blocks.push("decided")
  if (!input.hearingOn) blocks.push("no_hearing")
  else if (input.hearingOn < v.on) blocks.push("hearing_before")
  else if (input.hearingOn > input.today) blocks.push("hearing_future")
  const step = penaltyStep(v.code, v.on, input.history)
  const s = VIOLATIONS[v.code][step]
  if (!(input.wage > 0) && (s.kind === "fraction" || s.kind === "days")) blocks.push("no_wage")
  return { step, stepKind: s.kind, amount: penaltyAmount(s, input.wage), blocks }
}

/** PN-04 — on time within 15 days of the notice. */
export const mayObject = (v: Pick<HrViolation, "state" | "notifiedOn">, today: string) =>
  v.state === "applied" && Boolean(v.notifiedOn) && daysBetween(v.notifiedOn as string, today) <= STATUTORY.penalties.objectionDays

/** The payroll's penalties for one employee and month: applied or upheld there, in decision order, each capped (PN-03). */
export function monthPenalties(all: HrViolation[], employeeId: string, month: string, wage: number): { total: number; items: Array<{ id: string; amount: number; deducted: number }> } {
  const due = all
    .filter((v) => v.employeeId === employeeId && (v.state === "applied" || v.state === "upheld") && v.deductMonth === month && (v.amount ?? 0) > 0)
    .sort((a, b) => (a.objectionDecision?.at ?? a.decision?.at ?? "").localeCompare(b.objectionDecision?.at ?? b.decision?.at ?? ""))
  let total = 0
  const items = due.map((v) => {
    const deducted = cappedPenalty(v.amount ?? 0, wage, total)
    total += deducted
    return { id: v.id, amount: v.amount ?? 0, deducted }
  })
  return { total: Math.round(total * 100) / 100, items }
}

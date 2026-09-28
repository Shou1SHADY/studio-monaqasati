// PM 1.0 — claims, extensions of time and the programme's duration (PRD WF-07,
// CLM-01…03, PRG-02, §8). The notice deadline runs from the event by the
// contract's period; the client's response is mandatory and granted days are
// mandatory unless rejected. Duration changes only through an approved
// extension — each grant with days issues the next programme revision — and
// delay damages run on the effective duration, never in planning.
// Pure: no I/O.

import type { ContractTerms } from "./terms"

/** `projects/{id}/pmClaims/{NN}`, numbered by the project's `pm.claimCount`. */
export const PM_CLAIMS = "pmClaims"

export const CLAIM_STATUSES = ["draft", "notice", "sub", "appr", "part", "rej"] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]
export const CLAIM_KINDS = ["time", "cost", "both"] as const
export type ClaimKind = (typeof CLAIM_KINDS)[number]
export const CLAIM_RESPONSES = ["appr", "part", "rej"] as const
export type ClaimResponse = (typeof CLAIM_RESPONSES)[number]
/** Who caused the event — the party the claim is against. "oth" is stated (RSN-01). */
export const CLAIM_CAUSES = ["emp", "cons", "force", "oth"] as const
export type ClaimCause = (typeof CLAIM_CAUSES)[number]

export interface PmClaim {
  id: string
  seq: number
  kind: ClaimKind
  /** What happened — the claim's title (the prototype's "الواقعة"). */
  cause: string
  causedBy?: ClaimCause | null
  causedByText?: string | null
  /** The day of the event — the notice deadline runs from it. */
  eventOn: string
  daysAsked: number
  amountAsked: number
  status: ClaimStatus
  by: string
  byName?: string | null
  noticeOn?: string | null
  submittedOn?: string | null
  response?: { on: string; by: string; byName?: string | null; days: number; amount: number; ref?: string | null } | null
  /** The programme revision these granted days issued. */
  revision?: number | null
  /** The obstacle or RFI that evidences it (`pmObstacles/{id}`, WF-19 → WF-07). */
  obstacleId?: string | null
}

export const claimNo = (seq: number) => String(seq).padStart(2, "0")

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const noticeDeadline = (eventOn: string, terms: Pick<ContractTerms, "claimNoticeDays">) => addDays(eventOn, terms.claimNoticeDays)

/** CLM-01: a draft past its notice deadline is a red decision. */
export const noticeLate = (c: Pick<PmClaim, "status" | "eventOn">, terms: Pick<ContractTerms, "claimNoticeDays">, today: string) =>
  c.status === "draft" && today > noticeDeadline(c.eventOn, terms)

/** Whole days from one `YYYY-MM-DD` to another. */
export const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000)

/** A draft inside its notice period: days left to give notice (null otherwise). */
export const noticeDaysLeft = (c: Pick<PmClaim, "status" | "eventOn">, terms: Pick<ContractTerms, "claimNoticeDays">, today: string) =>
  c.status === "draft" && !noticeLate(c, terms, today) ? daysFrom(today, noticeDeadline(c.eventOn, terms)) : null

/** Notice given: how many days after the event it went. */
export const noticeAfter = (c: Pick<PmClaim, "eventOn" | "noticeOn">) => (c.noticeOn ? daysFrom(c.eventOn, c.noticeOn) : null)

/** Open: not yet answered. */
export const openClaims = <T extends Pick<PmClaim, "status">>(claims: T[]) => claims.filter((c) => c.status === "draft" || c.status === "notice" || c.status === "sub")

/** `no_obstacle`: the linked obstacle no longer exists — checked by the write.
 * Only what happened and when are required to log a claim: the days (and the
 * amount) are not invented — they are estimated at submission (C-24). */
export type ClaimBlock = "archived" | "not_started" | "no_cause" | "cause_text" | "event_date" | "bad_days" | "bad_amount_asked" | "no_obstacle"

export function claimBlocks(input: {
  archived: boolean
  lifecycle: string
  kind: ClaimKind
  cause: string
  eventOn: string
  daysAsked: number
  amountAsked: number
  today: string
  causedBy?: ClaimCause | null
  causedByText?: string | null
}): ClaimBlock[] {
  const out: ClaimBlock[] = []
  if (input.archived) out.push("archived")
  if (input.lifecycle === "plan") out.push("not_started")
  if (!input.cause.trim()) out.push("no_cause")
  if (input.causedBy === "oth" && !input.causedByText?.trim()) out.push("cause_text")
  if (!input.eventOn || input.eventOn > input.today) out.push("event_date")
  if (!(Number.isInteger(input.daysAsked) && input.daysAsked >= 0)) out.push("bad_days")
  if (!(Number.isFinite(input.amountAsked) && input.amountAsked >= 0)) out.push("bad_amount_asked")
  return out
}

export type ClaimStepBlock = "archived" | "wrong_state" | "no_days" | "no_amount"

const NEXT: Record<"notice" | "submit", ClaimStatus> = { notice: "draft", submit: "notice" }

/** Notice, then the detailed submission — which is where the days (a time
 * claim) and the amount (a cost claim) become required. */
export function claimStepBlocks(input: { archived: boolean; status: ClaimStatus; step: "notice" | "submit"; kind?: ClaimKind; daysAsked?: number; amountAsked?: number }): ClaimStepBlock[] {
  const out: ClaimStepBlock[] = []
  if (input.archived) out.push("archived")
  if (input.status !== NEXT[input.step]) out.push("wrong_state")
  if (input.step === "submit" && input.kind) {
    if (input.kind !== "cost" && !(Number.isInteger(input.daysAsked) && (input.daysAsked ?? 0) > 0)) out.push("no_days")
    if (input.kind !== "time" && !(Number.isFinite(input.amountAsked) && (input.amountAsked ?? 0) > 0)) out.push("no_amount")
  }
  return out
}

export type RespondBlock = "archived" | "not_submitted" | "no_choice" | "days_required" | "bad_amount"

/** CLM-02: the response is mandatory; granted days are mandatory unless rejected
 * (a time claim); saving with no choice once crashed the screen. */
export function respondBlocks(input: { archived: boolean; status: ClaimStatus; kind: ClaimKind; response: unknown; days: number | null; amount: number | null }): RespondBlock[] {
  const out: RespondBlock[] = []
  if (input.archived) out.push("archived")
  if (input.status !== "sub") out.push("not_submitted")
  if (!(CLAIM_RESPONSES as readonly unknown[]).includes(input.response)) return [...out, "no_choice"]
  if (input.response === "rej") return out
  if (input.kind !== "cost" && !(input.days !== null && Number.isInteger(input.days) && input.days >= 0)) out.push("days_required")
  if (input.kind !== "time" && !(input.amount !== null && Number.isFinite(input.amount) && input.amount >= 0)) out.push("bad_amount")
  return out
}

/** Approved extension days — approved and partly approved claims. */
export const grantedDays = (claims: Array<Pick<PmClaim, "status"> & { response?: { days: number } | null }>) =>
  claims.filter((c) => c.status === "appr" || c.status === "part").reduce((a, c) => a + (c.response?.days ?? 0), 0)

/** The programme's revision: 0 is the baseline; each grant with days issues the next. */
export const programmeRevision = (claims: Pick<PmClaim, "revision">[]) => claims.reduce((m, c) => Math.max(m, c.revision ?? 0), 0)

export interface DelayInput {
  lifecycle: string
  startOn: string | null
  effectiveDays: number
  /** Actual progress by value, 0…100 (acceptance.progressOf), or null when nothing is priced. */
  progress: number | null
  contractValue: number
  damages: ContractTerms["damages"]
  today: string
  /** The planned curve's shape F(x) = 1 − (1 − x)^k (programme.ts `curveK`); 1 = linear. */
  curveK?: number
}

/** §8: days = (planned − actual)% × effective duration; damages = min(cap ×
 * contract, rate × contract × full weeks). None in planning, none before start,
 * none without a priced BOQ to measure progress on. Planned is linear in time
 * unless a curve shape is given (calibrated from the activities). */
export function delayAndDamages(input: DelayInput): { planned: number; delayDays: number; damages: number } | null {
  if (input.lifecycle === "plan" || !input.startOn || input.effectiveDays <= 0 || input.progress === null || input.today < input.startOn) return null
  const elapsed = (Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${input.startOn.slice(0, 10)}T00:00:00Z`)) / 86_400_000
  const x = Math.min(1, Math.max(0, elapsed / input.effectiveDays))
  const planned = 1 - Math.pow(1 - x, input.curveK ?? 1)
  const delayDays = Math.max(0, Math.round((planned - input.progress / 100) * input.effectiveDays))
  const d = input.damages
  const damages = d.on ? Math.round(Math.min(d.cap * input.contractValue, d.weeklyRate * input.contractValue * Math.floor(delayDays / 7)) * 100) / 100 : 0
  return { planned: Math.round(planned * 1000) / 10, delayDays, damages }
}

/** What an extension claim is worth to you: the damages it removes if granted
 * as asked (the prototype's "تُسقط N ر.س غرامة"). */
export function penaltyAvoided(c: Pick<PmClaim, "kind" | "daysAsked">, input: DelayInput): number {
  if (c.kind === "cost" || !(c.daysAsked > 0)) return 0
  const now = delayAndDamages(input)
  const after = delayAndDamages({ ...input, effectiveDays: input.effectiveDays + c.daysAsked })
  return now && after ? Math.max(0, Math.round((now.damages - after.damages) * 100) / 100) : 0
}

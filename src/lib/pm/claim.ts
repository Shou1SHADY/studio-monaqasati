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

export interface PmClaim {
  id: string
  seq: number
  kind: ClaimKind
  cause: string
  /** The day of the event — the notice deadline runs from it. */
  eventOn: string
  daysAsked: number
  amountAsked: number
  status: ClaimStatus
  by: string
  byName?: string | null
  noticeOn?: string | null
  submittedOn?: string | null
  response?: { on: string; by: string; byName?: string | null; days: number; amount: number } | null
  /** The programme revision these granted days issued. */
  revision?: number | null
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

export type ClaimBlock = "archived" | "not_started" | "no_cause" | "event_date" | "no_days" | "no_amount"

export function claimBlocks(input: { archived: boolean; lifecycle: string; kind: ClaimKind; cause: string; eventOn: string; daysAsked: number; amountAsked: number; today: string }): ClaimBlock[] {
  const out: ClaimBlock[] = []
  if (input.archived) out.push("archived")
  if (input.lifecycle === "plan") out.push("not_started")
  if (!input.cause.trim()) out.push("no_cause")
  if (!input.eventOn || input.eventOn > input.today) out.push("event_date")
  if (input.kind !== "cost" && !(Number.isInteger(input.daysAsked) && input.daysAsked > 0)) out.push("no_days")
  if (input.kind !== "time" && !(Number.isFinite(input.amountAsked) && input.amountAsked > 0)) out.push("no_amount")
  return out
}

export type ClaimStepBlock = "archived" | "wrong_state"

const NEXT: Record<"notice" | "submit", ClaimStatus> = { notice: "draft", submit: "notice" }

export function claimStepBlocks(input: { archived: boolean; status: ClaimStatus; step: "notice" | "submit" }): ClaimStepBlock[] {
  const out: ClaimStepBlock[] = []
  if (input.archived) out.push("archived")
  if (input.status !== NEXT[input.step]) out.push("wrong_state")
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
export const grantedDays = (claims: Pick<PmClaim, "status" | "response">[]) =>
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
}

/** §8: days = (planned − actual)% × effective duration; damages = min(cap ×
 * contract, rate × contract × full weeks). None in planning, none before start,
 * none without a priced BOQ to measure progress on. Planned is linear in time. */
export function delayAndDamages(input: DelayInput): { planned: number; delayDays: number; damages: number } | null {
  if (input.lifecycle === "plan" || !input.startOn || input.effectiveDays <= 0 || input.progress === null || input.today < input.startOn) return null
  const elapsed = (Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${input.startOn.slice(0, 10)}T00:00:00Z`)) / 86_400_000
  const planned = Math.min(1, Math.max(0, elapsed / input.effectiveDays))
  const delayDays = Math.max(0, Math.round((planned - input.progress / 100) * input.effectiveDays))
  const d = input.damages
  const damages = d.on ? Math.round(Math.min(d.cap * input.contractValue, d.weeklyRate * input.contractValue * Math.floor(delayDays / 7)) * 100) / 100 : 0
  return { planned: Math.round(planned * 1000) / 10, delayDays, damages }
}

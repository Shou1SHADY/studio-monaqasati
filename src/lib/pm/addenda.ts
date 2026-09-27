// PM 1.0 — contract addenda (PRD §9 AMD-01…10, WF-08, INV-22, INV-23; the
// customer's decision of 24 Sep 2026). The original contract stays exactly as
// signed; every change to its terms after start is a numbered addendum on top
// of it. A draft changes nothing; recording the signature puts it in force for
// what is prepared afterwards (certificates prepared before keep their amounts);
// withdrawing deletes nothing. Value changes by a variation and duration by an
// extension — never here. Pure: no I/O.

import { FINANCIAL_TERMS, sameTermValue, termChanges, termProblems, termsInForce, type ContractTerms, type TermChange, type TermKey } from "./terms"
import type { PmEvent } from "./events"

/** `projects/{id}/pmAddenda/{NN}` — the id is the two-digit sequence. */
export const PM_ADDENDA = "pmAddenda"

export const ADDENDUM_STATUSES = ["draft", "signed", "void"] as const
export type AddendumStatus = (typeof ADDENDUM_STATUSES)[number]

/** Why the terms change (AMD-01) — "other" is stated (RSN-01). */
export const ADDENDUM_REASONS = ["client", "ours", "settle", "other"] as const
export type AddendumReason = (typeof ADDENDUM_REASONS)[number]

/** Why a draft is withdrawn before signing (AMD-06). */
export const WITHDRAW_REASONS = ["refused", "replaced", "other"] as const
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number]

export interface PmAddendum {
  id: string
  seq: number
  status: AddendumStatus
  /** Drafting day, `YYYY-MM-DD`. */
  day: string
  by: string
  byName?: string | null
  reason: AddendumReason
  reasonText?: string | null
  /** from → to for each changed term; `from` is what was in force when drafted. */
  changes: TermChange[]
  note?: string | null
  signedOn?: string | null
  /** The order it was signed in — the order the contract in force applies it. */
  signedSeq?: number | null
  signedBy?: string | null
  signedByName?: string | null
  /** Who signed for the client (optional, AMD-04). */
  signatory?: string | null
  voidOn?: string | null
  voidBy?: string | null
  voidByName?: string | null
  voidReason?: WithdrawReason | null
  voidText?: string | null
}

/** "01", "02"… — the addendum's number inside the project (and its doc id). */
export const addendumNo = (seq: number) => String(seq).padStart(2, "0")

/** The contract in force (INV-22): original + signed addenda in signing order. */
export const inForce = (original: ContractTerms, addenda: Pick<PmAddendum, "status" | "signedSeq" | "changes">[]) => termsInForce(original, addenda)

/** Which terms an addendum may change: all twelve. Value, items and duration are
 * not terms (variation / extension), and VAT is a company setting. */
export const ADDENDUM_TERMS: readonly TermKey[] = [
  "payer",
  "basis",
  "advance",
  "advanceRecovery",
  "retention",
  "retentionCap",
  "retentionRelease",
  "paymentDays",
  "consultantDays",
  "claimNoticeDays",
  "defectsDays",
  "damages",
]

export const isFinancial = (changes: TermChange[]) => changes.some((c) => FINANCIAL_TERMS.includes(c.key))

/** A drafted change whose `from` is no longer what is in force: another addendum
 * changed that term since. Both values are shown and it cannot be signed (AMD-05). */
export function staleChanges(changes: TermChange[], terms: ContractTerms): Array<{ key: TermKey; drafted: unknown; now: unknown }> {
  return changes.filter((c) => !sameTermValue(c.from, terms[c.key])).map((c) => ({ key: c.key, drafted: c.from, now: terms[c.key] }))
}

/** Lowering the cap below what is already held is refused — when drafted and
 * again when signed, since a certificate may be approved in between. Releasing
 * the difference is Finance's action, not an addendum's (AMD-09). */
export function capBelowHeld(changes: TermChange[], contractValue: number, retentionHeld: number): { cap: number; held: number } | null {
  const c = changes.find((x) => x.key === "retentionCap")
  if (!c) return null
  const cap = Math.round(Number(c.to) * contractValue * 100) / 100
  return retentionHeld > cap + 0.005 ? { cap, held: retentionHeld } : null
}

type Stage = { lifecycle: string; archived: boolean }

export type DraftBlock = "not_started" | "archived" | "no_change" | "reason_text" | "invalid_terms" | "cap_below_held"

/** What stops saving a draft (AMD-01, AMD-03, AMD-09, RSN-01). */
export function draftBlocks(input: Stage & {
  terms: ContractTerms
  next: ContractTerms
  reason: AddendumReason | null
  reasonText?: string | null
  contractValue: number
  retentionHeld: number
}): DraftBlock[] {
  const out: DraftBlock[] = []
  if (input.archived) out.push("archived")
  else if (input.lifecycle === "plan") out.push("not_started")
  const changes = termChanges(input.terms, input.next)
  if (!changes.length) out.push("no_change")
  if (!input.reason || (input.reason === "other" && !input.reasonText?.trim())) out.push("reason_text")
  if (termProblems(input.next).length) out.push("invalid_terms")
  if (capBelowHeld(changes, input.contractValue, input.retentionHeld)) out.push("cap_below_held")
  return out
}

export type SignBlock = "not_draft" | "not_started" | "archived" | "stale" | "no_date" | "before_draft" | "before_last" | "future" | "cap_below_held"

/** What stops recording the signature (AMD-04, AMD-05, AMD-09). The date is not
 * before the draft or the last signed addendum, and never in the future. */
export function signBlocks(input: Stage & {
  addendum: Pick<PmAddendum, "status" | "day" | "changes">
  terms: ContractTerms
  signedOn: string | null
  lastSignedOn: string | null
  today: string
  contractValue: number
  retentionHeld: number
}): SignBlock[] {
  const out: SignBlock[] = []
  if (input.addendum.status !== "draft") out.push("not_draft")
  if (input.archived) out.push("archived")
  else if (input.lifecycle === "plan") out.push("not_started")
  if (staleChanges(input.addendum.changes, input.terms).length) out.push("stale")
  if (!input.signedOn) out.push("no_date")
  else {
    if (input.signedOn < input.addendum.day) out.push("before_draft")
    if (input.lastSignedOn && input.signedOn < input.lastSignedOn) out.push("before_last")
    if (input.signedOn > input.today) out.push("future")
  }
  if (capBelowHeld(input.addendum.changes, input.contractValue, input.retentionHeld)) out.push("cap_below_held")
  return out
}

/** The earliest day a signature may carry: the draft's day or the last signature, whichever is later. */
export const earliestSignDay = (draftDay: string, lastSignedOn: string | null) => (lastSignedOn && lastSignedOn > draftDay ? lastSignedOn : draftDay)

export type WithdrawBlock = "not_draft" | "no_reason" | "reason_text"

export function withdrawBlocks(input: { addendum: Pick<PmAddendum, "status">; reason: WithdrawReason | null; reasonText?: string | null }): WithdrawBlock[] {
  const out: WithdrawBlock[] = []
  if (input.addendum.status !== "draft") out.push("not_draft")
  if (!input.reason) out.push("no_reason")
  else if (input.reason === "other" && !input.reasonText?.trim()) out.push("reason_text")
  return out
}

/** The last signature day among signed addenda. */
export function lastSignedOn(addenda: Pick<PmAddendum, "status" | "signedOn">[]): string | null {
  return addenda.filter((a) => a.status === "signed" && a.signedOn).reduce<string | null>((max, a) => (max && max > a.signedOn! ? max : a.signedOn!), null)
}

/** Days a draft has waited for its signature — its amber decision's age (AMD-02). */
export function draftAge(day: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0
}

/** The contract record (AMD-07): signed and withdrawn addenda, newest first.
 * Variations and extensions join it when those doors are built. */
export function contractRecord(addenda: PmAddendum[]): PmAddendum[] {
  const when = (a: PmAddendum) => (a.status === "signed" ? a.signedOn : a.status === "void" ? a.voidOn : a.day) ?? a.day
  return addenda.filter((a) => a.status !== "draft").sort((a, b) => when(b).localeCompare(when(a)) || b.seq - a.seq)
}

/** Which term each signed addendum last changed, for "in force" marks: key → the addendum. */
export function amendedBy(addenda: PmAddendum[]): Partial<Record<TermKey, PmAddendum>> {
  const out: Partial<Record<TermKey, PmAddendum>> = {}
  for (const a of addenda.filter((x) => x.status === "signed").sort((x, y) => (x.signedSeq ?? 0) - (y.signedSeq ?? 0))) for (const c of a.changes) out[c.key] = a
  return out
}

/** One Finance event per signed addendum that changes a financial term —
 * payer · advance and recovery · retention, cap and release · payment period —
 * never a second advance event (AMD-08, INV-23). Not yet in Finance's contract
 * (conflict 17): it waits in the outbox under its key. */
export function amendmentEvent(input: {
  organizationId: string
  projectId: string
  projectNo: string
  addendum: Pick<PmAddendum, "seq" | "changes">
  signedOn: string
  by: string
  at: string
}): PmEvent | null {
  const financial = input.addendum.changes.filter((c) => FINANCIAL_TERMS.includes(c.key))
  if (!financial.length) return null
  return {
    key: `prj:AMD:${input.projectNo}:${input.addendum.seq}`,
    kind: "AMD",
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectNo: input.projectNo,
    amount: 0,
    params: { addendum: addendumNo(input.addendum.seq), signedOn: input.signedOn },
    changes: financial,
    by: input.by,
    at: input.at,
  }
}

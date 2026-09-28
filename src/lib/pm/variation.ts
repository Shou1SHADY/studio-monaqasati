// PM 1.0 — the variation order (PRD WF-06, VO-01…03, CON-06, AMD-07, INV-01).
// The contract value changes through this one door: logged the day it is
// asked (not the day it is priced) with its source and instruction number;
// logging is not approval — nothing enters the contract value until a written
// approval is recorded. Work executed on an unapproved one is a risk decision.
// Pure: no I/O.

/** `projects/{id}/pmVariations/{NN}`, numbered by the project's `pm.voCount`. */
export const PM_VARIATIONS = "pmVariations"

export const VO_STATUSES = ["draft", "wait", "appr", "rej"] as const
export type VoStatus = (typeof VO_STATUSES)[number]

/** Who asked for it — whom it is claimed from, and what settles "on whom"
 * before the work is done. "oth" is stated (RSN-01). */
export const VO_SOURCES = ["client", "cons", "dwg", "site", "law", "us", "oth"] as const
export type VoSource = (typeof VO_SOURCES)[number]

export interface VoFile {
  url: string
  name: string
}

export interface PmVariation {
  id: string
  seq: number
  title: string
  source: VoSource
  sourceText?: string | null
  /** The written instruction; without one the order shows "no instruction" (VO-02). */
  instructionNo?: string | null
  /** The day it was ASKED — not the day it was typed; the notice period runs from it. */
  day: string
  /** The day it was logged. */
  loggedOn?: string | null
  /** BOQ lines it touches; none = a change outside the BOQ, priced as a new item. */
  itemIds?: string[]
  /** Its time impact in days — which extends nothing until an EOT claim is granted. */
  days?: number
  files?: VoFile[]
  /** Priced value, SAR excl. VAT; 0 until priced. */
  value: number
  cost: number
  /** 0…1 of its work executed — work before approval is a decision (VO-03). */
  executedPct: number
  /** 0…1 already billed on owner certificates — moved only by the certificate writes. */
  billedPct?: number
  status: VoStatus
  by: string
  byName?: string | null
  decision?: { on: string; by: string; byName?: string | null; ref?: string | null; reason?: string | null; files?: VoFile[] } | null
}

export const voNo = (seq: number) => String(seq).padStart(2, "0")

const r2 = (n: number) => Math.round(n * 100) / 100

/** Σ approved variations — the live contract value is the base + this (INV-01). */
export const approvedValue = (vos: Pick<PmVariation, "status" | "value">[]) => r2(vos.filter((v) => v.status === "appr").reduce((a, v) => a + v.value, 0))

/** Earned from variations: Σ approved value × executed share (§8). */
export const variationsEarned = (vos: Pick<PmVariation, "status" | "value" | "executedPct">[]) => r2(vos.filter((v) => v.status === "appr").reduce((a, v) => a + v.value * v.executedPct, 0))

/** VO-03: work on a variation not approved. */
export const workBeforeApproval = <T extends Pick<PmVariation, "status" | "executedPct">>(vos: T[]) => vos.filter((v) => (v.status === "draft" || v.status === "wait") && v.executedPct > 0)

/** A priced variation still undecided — open money that blocks closing (ARC-01). */
export const pricedPending = <T extends Pick<PmVariation, "status" | "value">>(vos: T[]) => vos.filter((v) => (v.status === "draft" || v.status === "wait") && v.value > 0)

/** Executed on a variation not approved in writing (rejected included): spent,
 * and claimable from nobody — the prototype's "SAR at risk". */
export const valueAtRisk = (vos: Pick<PmVariation, "status" | "value" | "executedPct">[]) => r2(vos.filter((v) => v.status !== "appr" && v.executedPct > 0).reduce((a, v) => a + v.value * v.executedPct, 0))

export const voAtRisk = (v: Pick<PmVariation, "status" | "value" | "executedPct">) => (v.status !== "appr" && v.executedPct > 0 ? r2(v.value * v.executedPct) : 0)

/** Its margin %, once priced. */
export const voMarginPct = (v: Pick<PmVariation, "value" | "cost">) => (v.value > 0 ? ((v.value - v.cost) / v.value) * 100 : null)

export type VoBlock = "archived" | "no_title" | "source_text" | "bad_value" | "bad_pct" | "bad_day" | "bad_days"

export function logBlocks(input: {
  archived: boolean
  title: string
  source: VoSource | null
  sourceText?: string | null
  value: number
  cost: number
  executedPct: number
  requestedOn?: string | null
  days?: number
  today?: string
}): VoBlock[] {
  const out: VoBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.title.trim()) out.push("no_title")
  if (!input.source || (input.source === "oth" && !input.sourceText?.trim())) out.push("source_text")
  if (!(Number.isFinite(input.value) && input.value >= 0 && Number.isFinite(input.cost) && input.cost >= 0)) out.push("bad_value")
  if (!(Number.isFinite(input.executedPct) && input.executedPct >= 0 && input.executedPct <= 1)) out.push("bad_pct")
  if (input.requestedOn !== undefined && (!input.requestedOn || (input.today && input.requestedOn > input.today))) out.push("bad_day")
  if (input.days !== undefined && !(Number.isInteger(input.days) && input.days >= 0)) out.push("bad_days")
  return out
}

export type VoDecisionBlock = "no_date" | "before_request" | "future"

/** A decision is dated as it arrived: not before the variation was asked, never in the future. */
export function decisionDateBlocks(input: { on: string | null; requestedOn: string; today: string }): VoDecisionBlock[] {
  if (!input.on) return ["no_date"]
  const out: VoDecisionBlock[] = []
  if (input.on < input.requestedOn) out.push("before_request")
  if (input.on > input.today) out.push("future")
  return out
}

export type VoStepBlock = "archived" | "wrong_state" | "unpriced" | "no_reason" | "price_locked" | "bad_pct"

/** draft → wait (priced) → appr | rej. A reason is required to reject; the price
 * is fixed once submitted; the executed share keeps moving until decided. */
export function stepBlocks(input: { archived: boolean; status: VoStatus; step: "submit" | "approve" | "reject" | "progress" | "reprice"; value?: number; reason?: string | null; executedPct?: number }): VoStepBlock[] {
  const out: VoStepBlock[] = []
  if (input.archived) out.push("archived")
  const from: Record<typeof input.step, VoStatus[]> = { submit: ["draft"], approve: ["wait"], reject: ["wait"], progress: ["draft", "wait", "appr"], reprice: ["draft"] }
  if (!from[input.step].includes(input.status)) out.push(input.step === "reprice" ? "price_locked" : "wrong_state")
  if (input.step === "submit" && !((input.value ?? 0) > 0)) out.push("unpriced")
  if (input.step === "reject" && !input.reason?.trim()) out.push("no_reason")
  if (input.step === "progress" && !(Number.isFinite(input.executedPct) && (input.executedPct as number) >= 0 && (input.executedPct as number) <= 1)) out.push("bad_pct")
  return out
}

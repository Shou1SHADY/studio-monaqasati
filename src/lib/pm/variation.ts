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

/** Who asked for it. "oth" is stated (RSN-01). */
export const VO_SOURCES = ["client", "cons", "site", "oth"] as const
export type VoSource = (typeof VO_SOURCES)[number]

export interface PmVariation {
  id: string
  seq: number
  title: string
  source: VoSource
  sourceText?: string | null
  /** The written instruction; without one the order shows "no instruction" (VO-02). */
  instructionNo?: string | null
  day: string
  /** Priced value, SAR excl. VAT; 0 until priced. */
  value: number
  cost: number
  /** 0…1 of its work executed — work before approval is a decision (VO-03). */
  executedPct: number
  status: VoStatus
  by: string
  byName?: string | null
  decision?: { on: string; by: string; byName?: string | null; ref?: string | null; reason?: string | null } | null
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

export type VoBlock = "archived" | "no_title" | "source_text" | "bad_value" | "bad_pct"

export function logBlocks(input: { archived: boolean; title: string; source: VoSource | null; sourceText?: string | null; value: number; cost: number; executedPct: number }): VoBlock[] {
  const out: VoBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.title.trim()) out.push("no_title")
  if (!input.source || (input.source === "oth" && !input.sourceText?.trim())) out.push("source_text")
  if (!(Number.isFinite(input.value) && input.value >= 0 && Number.isFinite(input.cost) && input.cost >= 0)) out.push("bad_value")
  if (!(Number.isFinite(input.executedPct) && input.executedPct >= 0 && input.executedPct <= 1)) out.push("bad_pct")
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

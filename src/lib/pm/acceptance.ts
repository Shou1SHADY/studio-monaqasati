// PM 1.0 — provisional and final handover to the client (PRD WF-25, IPC-05,
// PN-03, INV-09; §8 retention release). Provisional at ≥ 99% progress starts
// the defects-liability period from the contract in force (not a fixed 365
// days) and, on a "half" release term, makes half the retention claimable at
// Finance. Final needs the provisional first and no open punch item; it moves
// the project to "handed over" and the rest of the retention becomes claimable.
// Each sends prj:HND:<project>:<prov|final> once, carrying only what it newly
// makes claimable (`pm.retentionFreed` keeps the running total). Claiming and collecting the
// retention are Finance's (S-02). Pure: no I/O.

import type { PmEvent } from "./events"
import type { RetentionRelease } from "./terms"

/** Provisional handover is recorded at this progress (§13). */
export const PROVISIONAL_AT = 99

export interface AcceptanceRecord {
  on: string
  by: string
  byName?: string | null
}

export interface Acceptances {
  prov?: AcceptanceRecord | null
  final?: AcceptanceRecord | null
}

/** Progress by value (§8): Σ approved executed × rate over Σ contract quantity ×
 * rate, priced items only — an unpriced item weighs nothing, and it says so. */
export function progressOf(items: Array<{ quantity: number; rate: number; executed: number }>): number | null {
  const priced = items.filter((i) => i.rate > 0 && i.quantity > 0)
  const total = priced.reduce((a, i) => a + i.quantity * i.rate, 0)
  if (!(total > 0)) return null
  const earned = priced.reduce((a, i) => a + Math.min(i.executed, i.quantity) * i.rate, 0)
  return Math.round((earned / total) * 1000) / 10
}

export type ProvisionalBlock = "archived" | "not_live" | "already" | "progress"
export type FinalBlock = "archived" | "not_live" | "no_provisional" | "already" | "punch_open" | "in_defects"

export function provisionalBlocks(input: { archived: boolean; lifecycle: string; acceptances: Acceptances; progress: number | null }): ProvisionalBlock[] {
  const out: ProvisionalBlock[] = []
  if (input.archived) out.push("archived")
  else if (input.lifecycle !== "live") out.push("not_live")
  if (input.acceptances.prov) out.push("already")
  if (input.progress === null || input.progress < PROVISIONAL_AT) out.push("progress")
  return out
}

/** No final before provisional (INV-09); an open punch item blocks it (PN-03);
 * and none before the defects period ends (WF-25 — the prototype offers the
 * final only once it has). */
export function finalBlocks(input: { archived: boolean; lifecycle: string; acceptances: Acceptances; openPunch: number; defectsEnd?: string | null; today?: string }): FinalBlock[] {
  const out: FinalBlock[] = []
  if (input.archived) out.push("archived")
  else if (input.lifecycle !== "live") out.push("not_live")
  if (!input.acceptances.prov) out.push("no_provisional")
  if (input.acceptances.final) out.push("already")
  if (input.openPunch > 0) out.push("punch_open")
  if (input.acceptances.prov && input.defectsEnd && input.today && input.today < input.defectsEnd) out.push("in_defects")
  return out
}

/** The day the defects-liability period ends — from the provisional handover and
 * the contract term in force. */
/** Days left in the defects period on `today` — negative once it has ended (prototype «تبقّى / انتهت منذ»). */
export function defectsLeft(end: string, today: string): number {
  return Math.round((Date.parse(`${end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
}

export function defectsEnd(provOn: string, defectsDays: number): string {
  const d = new Date(`${provOn}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + defectsDays)
  return d.toISOString().slice(0, 10)
}

/** How much of the held retention the handovers have made claimable at
 * Finance (IPC-05): half at provisional + the rest after final, or all after final. */
export function retentionClaimable(held: number, release: RetentionRelease, acceptances: Acceptances): number {
  if (acceptances.final) return held
  if (acceptances.prov && release === "half") return Math.round(held * 50) / 100
  return 0
}

/** What ONE handover event makes newly claimable: the cumulative claimable less
 * what earlier events (the provisional, delivery units) already sent — Finance
 * posts each event's amount, so a cumulative figure would release twice. */
export function retentionIncrement(held: number, release: RetentionRelease, acceptances: Acceptances, freed: number): number {
  return Math.max(0, Math.round((retentionClaimable(held, release, acceptances) - freed) * 100) / 100)
}

/** prj:HND:<project>:<prov|final> — the key carries the delivery unit when there
 * is one (conflict 6); units are a later release. */
export function handoverEvent(input: { organizationId: string; projectId: string; projectNo: string; stage: "prov" | "final"; on: string; claimable: number; by: string; at: string }): PmEvent {
  return {
    key: `prj:HND:${input.projectNo}:${input.stage}`,
    kind: "HND",
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectNo: input.projectNo,
    amount: input.claimable,
    params: { stage: input.stage, on: input.on },
    by: input.by,
    at: input.at,
  }
}

// PM 1.0 — the contract record (AMD-07) and what the contract means in cash.
// Three doors change a contract: an approved variation (value), a granted
// extension (duration) and a signed addendum (terms). One record holds all of
// them by date, newest first, the original at the bottom — a withdrawn
// addendum stays in it. Pure: no I/O.

import type { PmAddendum } from "./addenda"
import type { PmClaim } from "./claim"
import type { ContractTerms } from "./terms"
import type { PmVariation } from "./variation"

export type RecordKind = "orig" | "vo" | "eot" | "amd" | "void"

export interface RecordEvent {
  kind: RecordKind
  day: string
  /** The source record: VO / claim / addendum sequence (null for the original). */
  seq: number | null
  title: string
  value?: number
  days?: number
  addendum?: PmAddendum
}

export function contractEvents(input: {
  startOn: string | null
  originalValue: number
  durationDays: number
  variations: Array<Pick<PmVariation, "seq" | "status" | "title" | "value" | "day" | "decision">>
  claims: Array<Pick<PmClaim, "seq" | "status" | "cause" | "eventOn" | "response">>
  addenda: PmAddendum[]
}): RecordEvent[] {
  const out: RecordEvent[] = []
  if (input.startOn) out.push({ kind: "orig", day: input.startOn.slice(0, 10), seq: null, title: "", value: input.originalValue, days: input.durationDays })
  for (const v of input.variations) if (v.status === "appr") out.push({ kind: "vo", day: v.decision?.on ?? v.day, seq: v.seq, title: v.title, value: v.value })
  for (const c of input.claims)
    if ((c.status === "appr" || c.status === "part") && (c.response?.days ?? 0) > 0) out.push({ kind: "eot", day: c.response?.on ?? c.eventOn, seq: c.seq, title: c.cause, days: c.response?.days ?? 0 })
  for (const a of input.addenda) {
    if (a.status === "signed") out.push({ kind: "amd", day: a.signedOn ?? a.day, seq: a.seq, title: "", addendum: a })
    if (a.status === "void") out.push({ kind: "void", day: a.voidOn ?? a.day, seq: a.seq, title: "", addendum: a })
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || (b.seq ?? 0) - (a.seq ?? 0))
}

/** What the terms in force mean in riyals (the prototype's termsCash). */
export function termsCash(terms: Pick<ContractTerms, "payer" | "advance" | "retention" | "retentionCap" | "damages">, contractValue: number) {
  const held = contractValue * Math.min(terms.retention, terms.retentionCap)
  const upfront = contractValue * terms.advance
  return {
    value: contractValue,
    heldUntilHandover: terms.payer === "none" ? 0 : Math.round(held * 100) / 100,
    upfront: terms.payer === "none" ? 0 : Math.round(upfront * 100) / 100,
    worstDamages: terms.damages.on ? Math.round(contractValue * terms.damages.cap * 100) / 100 : 0,
    gap: terms.payer === "none" ? 0 : Math.round(Math.max(0, held - upfront) * 100) / 100,
  }
}

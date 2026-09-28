// PM 1.0 — a project created by hand (the prototype's formPrj without a file):
// the exception path (a direct order, an internal project, a migration from an
// old system). It is born exactly as an accepted handover is — number, "not
// started", terms, its manager seated — only its facts come from the form, not
// from CRM. Name and client are required; the value is an estimate and may stay
// empty (the real value comes from the priced BOQ). Pure: no I/O.

import { isSelfDevelopment, type ProjectKind } from "./handover"
import { defaultTerms, type ContractTerms } from "./terms"

/** The prototype's chips: advance none · 5 · 10 · 15 · 20 %, retention none · 5 · 10 %. */
export const ADVANCE_CHOICES = [0, 0.05, 0.1, 0.15, 0.2] as const
export const RETENTION_CHOICES = [0, 0.05, 0.1] as const
export const DEFAULT_ADVANCE = 0.1
export const DEFAULT_RETENTION = 0.05
/** Without a duration the prototype writes a year. */
export const DEFAULT_DURATION = 365

export interface ManualProjectDraft {
  name: string
  client: string
  kind: ProjectKind
  region: string
  location: string
  startOn: string
  /** Days; empty = a year. */
  duration: string
  /** Estimated value; empty = unknown until the BOQ is priced. */
  value: string
  advance: number
  retention: number
}

export type ManualBlock = "no_name" | "no_client" | "bad_date" | "bad_duration" | "bad_value" | "no_manager"

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function manualProjectBlocks(d: ManualProjectDraft, managerUid: string | null): ManualBlock[] {
  const out: ManualBlock[] = []
  if (!d.name.trim()) out.push("no_name")
  if (!d.client.trim()) out.push("no_client")
  if (!DAY.test(d.startOn)) out.push("bad_date")
  if (d.duration.trim() && !(Number.isInteger(Number(d.duration)) && Number(d.duration) > 0 && Number(d.duration) <= 3650)) out.push("bad_duration")
  if (d.value.trim() && !(Number(d.value) >= 0)) out.push("bad_value")
  if (!managerUid) out.push("no_manager")
  return out
}

export const manualDuration = (d: Pick<ManualProjectDraft, "duration">) => (d.duration.trim() ? Number(d.duration) : DEFAULT_DURATION)
export const manualValue = (d: Pick<ManualProjectDraft, "value">) => (d.value.trim() ? Math.max(0, Number(d.value) || 0) : 0)

/** The contract's end: start + duration days («ينتهي …»). */
export function manualEnd(startOn: string, days: number): string | null {
  if (!DAY.test(startOn) || !(days > 0)) return null
  return new Date(Date.parse(`${startOn}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** The terms a manual project is born with: the §13 defaults with the chosen advance and retention. */
export function manualTerms(d: Pick<ManualProjectDraft, "kind" | "advance" | "retention">): ContractTerms {
  return defaultTerms({ advance: d.advance, retention: d.retention, selfDevelopment: isSelfDevelopment(d.kind) })
}

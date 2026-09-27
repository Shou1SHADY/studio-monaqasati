// PM 1.0 — decisions (PRD §12, DEC-01, S-16): computed from the project's data,
// never typed; each carries a severity (red = money being lost or a closed
// gate · amber = waiting on an action · blue = arriving soon), an amount where
// there is one, an age where it has one, and the tab where it is solved. They
// appear and disappear with their cause. Pure: no I/O.

import { progressOf, PROVISIONAL_AT, type Acceptances } from "./acceptance"
import type { CertificateStatus } from "./certificate"
import { delayAndDamages, grantedDays, noticeLate, type ClaimStatus } from "./claim"
import { isOpenPunch, type PunchStatus } from "./punch"
import { sampleApproved } from "./sample"
import type { ContractTerms } from "./terms"
import { approvedValue, workBeforeApproval, type VoStatus } from "./variation"

export type DecisionKind =
  | "no_pm"
  | "plan_overdue"
  | "sheets_waiting"
  | "unpriced_executed"
  | "wir_failed"
  | "sample_missing"
  | "vo_work"
  | "vo_waiting"
  | "claim_notice_late"
  | "claim_waiting"
  | "addendum_unsigned"
  | "cert_internal"
  | "cert_consultant"
  | "collection_overdue"
  | "damages"
  | "provisional_ready"
  | "final_ready"

export type DecisionTab = "pmMeasure" | "pmWir" | "pmVo" | "pmClaims" | "pmClose" | "ipc" | "team" | "info"

export interface PmDecision {
  kind: DecisionKind
  severity: "red" | "amber" | "blue"
  count?: number
  amount?: number
  /** Days since the oldest cause. */
  age?: number
  tab: DecisionTab
}

export interface DecisionFacts {
  lifecycle: string
  managerless: boolean
  startOn: string | null
  plannedStart: string | null
  durationDays: number
  baseValue: number
  terms: ContractTerms
  acceptances: Acceptances
  items: Array<{ quantity: number; rate: number; executed: number; gate?: { pmInspect?: boolean | null; pmWir?: string | null } | null; pmSample?: boolean | null; pmSub?: string | null }>
  sheets: Array<{ status: string; day: string }>
  addenda: Array<{ status: string; day: string }>
  certificates: Array<{ status: CertificateStatus; net: number; dueOn?: string | null; collected?: number | null; prepOn?: string | null }>
  punch: Array<{ status: PunchStatus }>
  variations: Array<{ status: VoStatus; value: number; executedPct: number; day: string }>
  claims: Array<{ status: ClaimStatus; eventOn: string; response?: { days: number } | null }>
  today: string
}

const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000))
const oldest = (dates: string[], today: string) => dates.reduce((m, d) => Math.max(m, days(d, today)), 0)
const r2 = (n: number) => Math.round(n * 100) / 100
const RANK = { red: 0, amber: 1, blue: 2 }

export function projectDecisions(f: DecisionFacts): PmDecision[] {
  if (f.lifecycle === "closed") return []
  const out: PmDecision[] = []

  if (f.managerless) out.push({ kind: "no_pm", severity: "red", tab: "team" })
  if (f.lifecycle === "plan" && f.plannedStart && f.plannedStart < f.today) out.push({ kind: "plan_overdue", severity: "amber", age: days(f.plannedStart, f.today), tab: "info" })

  const waiting = f.sheets.filter((s) => s.status === "wait")
  if (waiting.length) out.push({ kind: "sheets_waiting", severity: "amber", count: waiting.length, age: oldest(waiting.map((s) => s.day), f.today), tab: "pmMeasure" })

  const unpriced = f.items.filter((i) => !(i.rate > 0) && i.executed > 0).length
  if (unpriced) out.push({ kind: "unpriced_executed", severity: "red", count: unpriced, tab: "pmMeasure" })

  const failed = f.items.filter((i) => i.gate?.pmWir === "fail").length
  if (failed) out.push({ kind: "wir_failed", severity: "red", count: failed, tab: "pmWir" })

  const noSample = f.items.filter((i) => !sampleApproved(i)).length
  if (noSample) out.push({ kind: "sample_missing", severity: "amber", count: noSample, tab: "pmWir" })

  const risky = workBeforeApproval(f.variations)
  if (risky.length) out.push({ kind: "vo_work", severity: "amber", count: risky.length, amount: r2(risky.reduce((a, v) => a + v.value * v.executedPct, 0)), tab: "pmVo" })
  const voWait = f.variations.filter((v) => v.status === "wait")
  if (voWait.length) out.push({ kind: "vo_waiting", severity: "amber", count: voWait.length, amount: r2(voWait.reduce((a, v) => a + v.value, 0)), age: oldest(voWait.map((v) => v.day), f.today), tab: "pmVo" })

  const late = f.claims.filter((c) => noticeLate(c, f.terms, f.today)).length
  if (late) out.push({ kind: "claim_notice_late", severity: "red", count: late, tab: "pmClaims" })
  const claimWait = f.claims.filter((c) => c.status === "sub").length
  if (claimWait) out.push({ kind: "claim_waiting", severity: "amber", count: claimWait, tab: "pmClaims" })

  const drafts = f.addenda.filter((a) => a.status === "draft")
  if (drafts.length) out.push({ kind: "addendum_unsigned", severity: "amber", count: drafts.length, age: oldest(drafts.map((a) => a.day), f.today), tab: "info" })

  const internal = f.certificates.filter((c) => c.status === "int")
  if (internal.length) out.push({ kind: "cert_internal", severity: "amber", count: internal.length, amount: r2(internal.reduce((a, c) => a + c.net, 0)), age: oldest(internal.map((c) => c.prepOn ?? f.today), f.today), tab: "ipc" })
  const withConsultant = f.certificates.filter((c) => c.status === "sub")
  if (withConsultant.length) out.push({ kind: "cert_consultant", severity: "blue", count: withConsultant.length, amount: r2(withConsultant.reduce((a, c) => a + c.net, 0)), tab: "ipc" })
  const overdue = f.certificates.filter((c) => (c.status === "appr" || c.status === "part") && c.dueOn && c.dueOn < f.today)
  if (overdue.length)
    out.push({ kind: "collection_overdue", severity: "red", count: overdue.length, amount: r2(overdue.reduce((a, c) => a + c.net * (1 - Math.min(1, Math.max(0, c.collected ?? 0))), 0)), tab: "ipc" })

  const progress = progressOf(f.items)
  const delay = delayAndDamages({
    lifecycle: f.lifecycle,
    startOn: f.startOn,
    effectiveDays: f.durationDays + grantedDays(f.claims),
    progress,
    contractValue: f.baseValue + approvedValue(f.variations),
    damages: f.terms.damages,
    today: f.today,
  })
  if (delay && delay.damages > 0) out.push({ kind: "damages", severity: "red", count: delay.delayDays, amount: delay.damages, tab: "pmClaims" })

  if (f.lifecycle === "live" && !f.acceptances.prov && progress !== null && progress >= PROVISIONAL_AT) out.push({ kind: "provisional_ready", severity: "blue", tab: "pmClose" })
  if (f.acceptances.prov && !f.acceptances.final && !f.punch.some(isOpenPunch)) out.push({ kind: "final_ready", severity: "blue", tab: "pmClose" })

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.amount ?? 0) - (a.amount ?? 0))
}

// PM 1.0 — decisions (PRD §12, DEC-01, S-16): computed from the project's data,
// never typed; each carries a severity (red = money being lost or a closed
// gate · amber = waiting on an action · blue = arriving soon), an amount where
// there is one, an age where it has one, and the tab where it is solved. They
// appear and disappear with their cause, and each reaches only the people who
// hold the duty that answers it (the prototype's final filter). Pure: no I/O.

import { defectsEnd, progressOf, PROVISIONAL_AT, type Acceptances } from "./acceptance"
import { CERTIFICATE_READY_AT, type CertificateStatus } from "./certificate"
import { delayAndDamages, grantedDays, noticeDeadline, noticeLate, type ClaimStatus } from "./claim"
import { isLetterLate, type PmLetter } from "./correspondence"
import { staleDocuments, type PmDocument } from "./documents"
import { isOpenPunch, type PunchStatus } from "./punch"
import { blockingObstacles, unprotectedObstacles, type PmObstacle } from "./site"
import type { ContractTerms } from "./terms"
import { approvedValue, workBeforeApproval, type VoStatus } from "./variation"

export type DecisionKind =
  | "no_pm"
  | "plan_overdue"
  | "sheets_waiting"
  | "unpriced_executed"
  | "wir_failed"
  | "sample_rejected"
  | "sample_late"
  | "vo_work"
  | "vo_waiting"
  | "claim_notice_late"
  | "claim_notice_due"
  | "claim_waiting"
  | "addendum_unsigned"
  | "ipc_ready"
  | "cert_internal"
  | "cert_mine"
  | "cert_consultant"
  | "collection_overdue"
  | "damages"
  | "slip"
  | "hold"
  | "provisional_ready"
  | "final_ready"
  | "final_overdue"
  | "sub_cert_waiting"
  | "doc_stale"
  | "letters_late"
  | "obstacle_blocking"
  | "obstacle_unprotected"
  | "cvr_stale"

export type DecisionTab = "pmMeasure" | "pmQa" | "pmSubm" | "pmVo" | "pmClaims" | "pmClose" | "pmProgramme" | "pmTerms" | "pmSubs" | "pmDocs" | "pmCorr" | "pmSite" | "pmCvr" | "ipc" | "team" | "info"

/** The prototype's four groups (DGRP): money on hold, contract risk, what
 * stops the site, and what waits on you. */
export type DecisionGroup = "money" | "risk" | "block" | "appr"
export const DECISION_GROUP: Record<DecisionKind, DecisionGroup> = {
  ipc_ready: "money",
  collection_overdue: "money",
  final_overdue: "money",
  provisional_ready: "money",
  unpriced_executed: "money",
  vo_work: "risk",
  vo_waiting: "risk",
  hold: "risk",
  slip: "risk",
  damages: "risk",
  claim_notice_late: "risk",
  claim_notice_due: "risk",
  claim_waiting: "risk",
  addendum_unsigned: "risk",
  letters_late: "risk",
  obstacle_unprotected: "risk",
  cvr_stale: "money",
  wir_failed: "block",
  sample_rejected: "block",
  sample_late: "block",
  doc_stale: "block",
  obstacle_blocking: "block",
  no_pm: "appr",
  plan_overdue: "appr",
  sheets_waiting: "appr",
  cert_internal: "appr",
  cert_mine: "appr",
  cert_consultant: "appr",
  final_ready: "appr",
  sub_cert_waiting: "appr",
}

/** The order of the group chips for each seat (the prototype's GORD). */
export const GROUP_ORDER: Record<"owner" | "pm" | "site" | "qs", DecisionGroup[]> = {
  owner: ["money", "risk", "appr", "block"],
  pm: ["appr", "block", "money", "risk"],
  site: ["block", "appr", "risk", "money"],
  qs: ["money", "risk", "appr", "block"],
}

export interface PmDecision {
  kind: DecisionKind
  severity: "red" | "amber" | "blue"
  count?: number
  amount?: number
  /** Days since the oldest cause. */
  age?: number
  tab: DecisionTab
}

export interface DecisionViewer {
  uid: string
  has: (key: string) => boolean
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
  items: Array<{ quantity: number; rate: number; executed: number; billed?: number; gate?: { pmInspect?: boolean | null; pmWir?: string | null } | null; pmSample?: boolean | null; pmSub?: string | null }>
  sheets: Array<{ status: string; day: string }>
  addenda: Array<{ status: string; day: string }>
  certificates: Array<{ status: CertificateStatus; net: number; dueOn?: string | null; collected?: number | null; prepOn?: string | null; prep?: string | null }>
  punch: Array<{ status: PunchStatus }>
  variations: Array<{ status: VoStatus; value: number; executedPct: number; day: string }>
  claims: Array<{ status: ClaimStatus; eventOn: string; response?: { days: number } | null; obstacleId?: string | null }>
  submittals?: Array<{ itemId: string; status: string; rev: number; day: string }>
  subCertificates?: Array<{ status: string; gross: number; prepOn: string }>
  documents?: Array<Pick<PmDocument, "type" | "revisions">>
  /** The last certificate's day — a drawing issued after it is stale. */
  lastCertDay?: string | null
  letters?: Array<Pick<PmLetter, "status" | "day" | "due" | "party">>
  obstacles?: Array<Pick<PmObstacle, "id" | "type" | "closeOn" | "itemIds" | "openOn">>
  /** The last approved monthly reconciliation (CVR-01), if any. */
  eac?: { on: string } | null
  /** When the project was put on hold, if it is. */
  holdSince?: string | null
  today: string
  /** Who is looking: decisions reach only the duty that answers them. Absent = everything. */
  viewer?: DecisionViewer | null
}

const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000))
const oldest = (dates: string[], today: string) => dates.reduce((m, d) => Math.max(m, days(d, today)), 0)
const r2 = (n: number) => Math.round(n * 100) / 100
const RANK = { red: 0, amber: 1, blue: 2 }

/** Who each decision reaches (the prototype's filter over decisions()). */
const REACHES: Record<DecisionKind, (h: (k: string) => boolean) => boolean> = {
  no_pm: (h) => h("all") && h("approve"),
  plan_overdue: (h) => h("approve"),
  sheets_waiting: (h) => h("approve"),
  unpriced_executed: (h) => h("money"),
  wir_failed: (h) => h("measure") || h("approve") || h("qa"),
  sample_rejected: (h) => h("measure") || h("approve"),
  sample_late: (h) => h("measure") || h("approve"),
  vo_work: (h) => h("measure") || h("client"),
  vo_waiting: (h) => h("client"),
  claim_notice_late: (h) => h("approve") || h("prep"),
  claim_notice_due: (h) => h("approve") || h("prep"),
  claim_waiting: (h) => h("approve") || h("prep"),
  addendum_unsigned: (h) => h("approve") || h("prep"),
  ipc_ready: (h) => h("client"),
  cert_internal: (h) => h("ipcOk"),
  cert_mine: () => true,
  cert_consultant: (h) => h("client"),
  collection_overdue: (h) => h("client") && h("money"),
  damages: (h) => h("client"),
  slip: (h) => h("client"),
  hold: (h) => h("client"),
  provisional_ready: (h) => h("approve"),
  final_ready: (h) => h("approve"),
  final_overdue: (h) => h("approve"),
  sub_cert_waiting: (h) => h("ipcOk"),
  doc_stale: (h) => h("measure") || h("approve"),
  letters_late: (h) => h("corr") || h("approve"),
  obstacle_blocking: () => true,
  obstacle_unprotected: (h) => h("approve") || h("prep"),
  cvr_stale: (h) => h("approve") && h("money"),
}

export function projectDecisions(f: DecisionFacts): PmDecision[] {
  if (f.lifecycle === "closed") return []
  const out: PmDecision[] = []

  if (f.managerless) out.push({ kind: "no_pm", severity: "red", tab: "team" })
  if (f.lifecycle === "plan" && f.plannedStart && f.plannedStart < f.today) out.push({ kind: "plan_overdue", severity: "amber", age: days(f.plannedStart, f.today), tab: "info" })
  if (f.lifecycle === "hold") {
    const age = f.holdSince ? days(f.holdSince, f.today) : undefined
    out.push({ kind: "hold", severity: (age ?? 0) > 30 ? "red" : "amber", age, tab: "info" })
  }

  const waiting = f.sheets.filter((s) => s.status === "wait")
  if (waiting.length) {
    const age = oldest(waiting.map((s) => s.day), f.today)
    out.push({ kind: "sheets_waiting", severity: age > 4 ? "red" : "amber", count: waiting.length, age, tab: "pmMeasure" })
  }

  const unpriced = f.items.filter((i) => !(i.rate > 0) && i.executed > 0).length
  if (unpriced) out.push({ kind: "unpriced_executed", severity: "red", count: unpriced, tab: "pmMeasure" })

  const unbilled = r2(f.items.reduce((a, i) => a + (i.rate > 0 ? Math.max(0, i.executed - (i.billed ?? 0)) * i.rate : 0), 0))
  if (unbilled > CERTIFICATE_READY_AT) out.push({ kind: "ipc_ready", severity: "red", amount: unbilled, tab: "ipc" })

  const failed = f.items.filter((i) => i.gate?.pmWir === "fail").length
  if (failed) out.push({ kind: "wir_failed", severity: "red", count: failed, tab: "pmQa" })

  // The latest revision per item decides: a rejected sample stops the item; one
  // with the consultant more than 10 days is chased.
  const latest = new Map<string, { status: string; rev: number; day: string }>()
  for (const s of f.submittals ?? []) {
    const cur = latest.get(s.itemId)
    if (!cur || s.rev > cur.rev) latest.set(s.itemId, s)
  }
  const rejected = Array.from(latest.values()).filter((s) => s.status === "rej")
  if (rejected.length) out.push({ kind: "sample_rejected", severity: "red", count: rejected.length, age: oldest(rejected.map((s) => s.day), f.today), tab: "pmSubm" })
  const late = Array.from(latest.values()).filter((s) => s.status === "sub" && days(s.day, f.today) > 10)
  if (late.length) out.push({ kind: "sample_late", severity: "amber", count: late.length, age: oldest(late.map((s) => s.day), f.today), tab: "pmSubm" })

  const blocking = blockingObstacles(f.obstacles ?? [])
  if (blocking.length) out.push({ kind: "obstacle_blocking", severity: "amber", count: blocking.length, age: oldest(blocking.map((o) => o.openOn), f.today), tab: "pmSite" })
  const unprotected = unprotectedObstacles(f.obstacles ?? [], f.claims, f.today)
  if (unprotected.length) out.push({ kind: "obstacle_unprotected", severity: "amber", count: unprotected.length, age: oldest(unprotected.map((o) => o.openOn), f.today), tab: "pmClaims" })

  const risky = workBeforeApproval(f.variations)
  if (risky.length) out.push({ kind: "vo_work", severity: "red", count: risky.length, amount: r2(risky.reduce((a, v) => a + v.value * v.executedPct, 0)), tab: "pmVo" })
  const voWait = f.variations.filter((v) => v.status === "wait")
  if (voWait.length) out.push({ kind: "vo_waiting", severity: "amber", count: voWait.length, amount: r2(voWait.reduce((a, v) => a + v.value, 0)), age: oldest(voWait.map((v) => v.day), f.today), tab: "pmVo" })

  const noticeOver = f.claims.filter((c) => noticeLate(c, f.terms, f.today)).length
  if (noticeOver) out.push({ kind: "claim_notice_late", severity: "red", count: noticeOver, tab: "pmClaims" })
  const noticeSoon = f.claims.filter((c) => c.status === "draft" && !noticeLate(c, f.terms, f.today) && days(f.today, noticeDeadline(c.eventOn, f.terms)) <= 7)
  if (noticeSoon.length) out.push({ kind: "claim_notice_due", severity: "amber", count: noticeSoon.length, tab: "pmClaims" })
  const claimWait = f.claims.filter((c) => c.status === "sub").length
  if (claimWait) out.push({ kind: "claim_waiting", severity: "amber", count: claimWait, tab: "pmClaims" })

  const subWait = (f.subCertificates ?? []).filter((c) => c.status === "int")
  if (subWait.length) out.push({ kind: "sub_cert_waiting", severity: "amber", count: subWait.length, amount: r2(subWait.reduce((a, c) => a + c.gross, 0)), age: oldest(subWait.map((c) => c.prepOn), f.today), tab: "pmSubs" })

  const stale = staleDocuments(f.documents ?? [], f.lastCertDay ?? null)
  if (stale.length) out.push({ kind: "doc_stale", severity: "amber", count: stale.length, age: oldest(stale.map((d) => d.revisions[d.revisions.length - 1]?.day ?? f.today), f.today), tab: "pmDocs" })

  // A letter to the client or the consultant left unanswered builds or loses a claim (COR-01).
  const lateLetters = (f.letters ?? []).filter((l) => isLetterLate(l, f.today))
  if (lateLetters.length)
    out.push({ kind: "letters_late", severity: lateLetters.some((l) => l.party === "cons" || l.party === "own") ? "red" : "amber", count: lateLetters.length, age: oldest(lateLetters.map((l) => l.day), f.today), tab: "pmCorr" })

  const drafts = f.addenda.filter((a) => a.status === "draft")
  if (drafts.length) out.push({ kind: "addendum_unsigned", severity: "amber", count: drafts.length, age: oldest(drafts.map((a) => a.day), f.today), tab: "pmTerms" })

  const internal = f.certificates.filter((c) => c.status === "int")
  const mine = internal.filter((c) => f.viewer && c.prep === f.viewer.uid)
  const others = internal.filter((c) => !mine.includes(c))
  if (others.length) out.push({ kind: "cert_internal", severity: "red", count: others.length, amount: r2(others.reduce((a, c) => a + c.net, 0)), age: oldest(others.map((c) => c.prepOn ?? f.today), f.today), tab: "ipc" })
  if (mine.length) out.push({ kind: "cert_mine", severity: "amber", count: mine.length, amount: r2(mine.reduce((a, c) => a + c.net, 0)), age: oldest(mine.map((c) => c.prepOn ?? f.today), f.today), tab: "ipc" })
  const withConsultant = f.certificates.filter((c) => c.status === "sub")
  if (withConsultant.length) out.push({ kind: "cert_consultant", severity: "blue", count: withConsultant.length, amount: r2(withConsultant.reduce((a, c) => a + c.net, 0)), tab: "ipc" })
  const overdue = f.certificates.filter((c) => (c.status === "appr" || c.status === "part") && c.dueOn && c.dueOn < f.today)
  if (overdue.length) {
    const age = oldest(overdue.map((c) => c.dueOn as string), f.today)
    out.push({ kind: "collection_overdue", severity: age > 30 ? "red" : "amber", count: overdue.length, age, amount: r2(overdue.reduce((a, c) => a + c.net * (1 - Math.min(1, Math.max(0, c.collected ?? 0))), 0)), tab: "ipc" })
  }

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
  if (delay && delay.damages > 0) out.push({ kind: "damages", severity: "amber", count: delay.delayDays, amount: delay.damages, tab: "pmProgramme" })
  if (f.lifecycle === "live" && delay && progress !== null && delay.planned - progress > 4) out.push({ kind: "slip", severity: "amber", count: Math.round(delay.planned - progress), tab: "pmProgramme" })

  // The estimate at completion goes stale after 35 days of work (CVR-01).
  if (f.lifecycle === "live" && (!f.eac || days(f.eac.on, f.today) > 35))
    out.push({ kind: "cvr_stale", severity: "amber", count: f.eac ? days(f.eac.on, f.today) : 0, age: f.eac ? days(f.eac.on, f.today) : undefined, tab: "pmCvr" })

  if (f.lifecycle === "live" && !f.acceptances.prov && progress !== null && progress >= PROVISIONAL_AT) out.push({ kind: "provisional_ready", severity: "blue", tab: "pmClose" })
  if (f.acceptances.prov && !f.acceptances.final) {
    const end = defectsEnd(f.acceptances.prov.on, f.terms.defectsDays)
    if (end < f.today) out.push({ kind: "final_overdue", severity: "red", age: days(end, f.today), tab: "pmClose" })
    else if (!f.punch.some(isOpenPunch)) out.push({ kind: "final_ready", severity: "blue", tab: "pmClose" })
  }

  const h = f.viewer?.has
  return out.filter((d) => !h || REACHES[d.kind](h)).sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.amount ?? 0) - (a.amount ?? 0))
}

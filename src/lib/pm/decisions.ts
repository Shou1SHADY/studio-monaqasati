// PM 1.0 — decisions (PRD §12, DEC-01, S-16): computed from the project's data,
// never typed; each carries a severity (red = money being lost or a closed
// gate · amber = waiting on an action · blue = arriving soon), an amount where
// there is one, an age where it has one, and the tab where it is solved. They
// appear and disappear with their cause, and each reaches only the people who
// hold the duty that answers it (the prototype's final filter), and a kind that
// lives in a section (claims, samples, inspections, documents, reconciliation,
// the store, equipment) only while that section is on. Pure: no I/O.

import { defectsEnd, progressOf, PROVISIONAL_AT, type Acceptances } from "./acceptance"
import { CERTIFICATE_READY_AT, type CertificateStatus } from "./certificate"
import { delayAndDamages, grantedDays, noticeDeadline, noticeLate, type ClaimStatus } from "./claim"
import { isLetterLate, type PmLetter } from "./correspondence"
import { staleDocuments, type PmDocument } from "./documents"
import { wirNo } from "./inspection"
import { RERATE_SHARE, sheetNo } from "./measurement"
import { IDLE_ALERT_DAYS, IDLE_SHARE, idleSince, licenceState, onSite, overdueDays, type PmPlant } from "./plant"
import { isOpenPunch, type PunchStatus } from "./punch"
import { sampleNo } from "./sample"
import { pmTabVisible } from "./sections"
import { blockingObstacles, unprotectedObstacles, type PmObstacle } from "./site"
import { itemProgress, storeBalance, storeState, type PmStoreLine, type StoreItem } from "./store"
import { lineGot, lineNeed, lineOut, lineOver, openChanges, plantHireable, plantReceivable, receivable, reqNo, reqState, type PmMaterialRequest, type PmPlantRequest } from "./supply"
import type { ContractTerms } from "./terms"
import { approvedValue, voNo, workBeforeApproval, type VoStatus } from "./variation"
import type { SectionId } from "../project-sections"
import { unitBlocks, unitDone, unitFigures, unitRetention, unitTight, type PmUnit } from "./units"

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
  | "req_waiting"
  | "req_stop"
  | "req_incoming"
  | "store_move"
  | "store_incoming"
  | "store_close"
  | "store_negative"
  | "change_held"
  | "change_rejected"
  | "need_short"
  | "eqp_waiting"
  | "eqp_receive"
  | "eqp_hire"
  | "eqp_idle"
  | "eqp_overdue"
  | "eqp_offhire"
  | "eqp_licence"
  | "rerate"
  | "po_budget"
  | "zone"
  | "ztight"

export type DecisionTab = "pmUnits" | "pmMeasure" | "pmQa" | "pmSubm" | "pmVo" | "pmClaims" | "pmClose" | "pmProgramme" | "pmTerms" | "pmSubs" | "pmDocs" | "pmCorr" | "pmSite" | "pmCvr" | "pmReq" | "pmStore" | "pmPo" | "boq" | "ipc" | "team" | "info"

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
  cvr_stale: "appr",
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
  req_waiting: "appr",
  req_stop: "appr",
  req_incoming: "appr",
  store_move: "appr",
  store_incoming: "appr",
  change_held: "appr",
  store_close: "money",
  store_negative: "risk",
  change_rejected: "risk",
  rerate: "risk",
  po_budget: "appr",
  need_short: "block",
  eqp_waiting: "appr",
  eqp_receive: "appr",
  eqp_hire: "appr",
  eqp_idle: "appr",
  eqp_overdue: "appr",
  eqp_offhire: "appr",
  eqp_licence: "appr",
  zone: "money",
  ztight: "risk",
}

/** The order of the group chips for each seat (the prototype's GORD). */
export const GROUP_ORDER: Record<"owner" | "pm" | "site" | "qs", DecisionGroup[]> = {
  owner: ["money", "risk", "appr", "block"],
  pm: ["appr", "block", "money", "risk"],
  site: ["block", "appr", "risk", "money"],
  qs: ["money", "risk", "appr", "block"],
}

/** The facts a row's title and sub-line name (the prototype's `t:` / `s:`); `date` is a day the row formats.
 * A kind raised by ONE document names it — its number (`no`) and what it is — as the prototype's rows do. */
export interface DecisionVars {
  no?: string
  /** Lines on the document (a measurement sheet's items). */
  n?: number
  /** A share in whole percent (a variation executed before approval). */
  pct?: number
  note?: string
  /** Days since a fact (the last certificate). */
  days?: number
  name?: string
  cause?: string
  date?: string
  payer?: string
  why?: string
  points?: number
  rate?: number
  cap?: number
}

export interface PmDecision {
  kind: DecisionKind
  severity: "red" | "amber" | "blue"
  count?: number
  amount?: number
  /** Days since the oldest cause. */
  age?: number
  tab: DecisionTab
  /** The title's key under `dec.<kind>` when it names one document (default `title`). */
  title?: string
  /** The sub-line's key under `dec.<kind>` when it names facts (default `detail`). */
  detail?: string
  /** The action's key under `dec.<kind>` (default `act`). */
  act?: string
  vars?: DecisionVars
}

export interface DecisionViewer {
  uid: string
  has: (key: string) => boolean
  /** The company owner: site chores (receipts, store closing, shortages) never reach him. */
  owner?: boolean
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
  items: Array<{ id?: string; code?: string; unit?: string; quantity: number; rate: number; executed: number; billed?: number; gate?: { pmInspect?: boolean | null; pmWir?: string | null } | null; pmSample?: boolean | null; pmSub?: string | null }>
  sheets: Array<{ status: string; day: string; seq?: number; byName?: string | null; lines?: unknown[] }>
  addenda: Array<{ status: string; day: string }>
  certificates: Array<{ status: CertificateStatus; net: number; dueOn?: string | null; collected?: number | null; prepOn?: string | null; prep?: string | null; prepName?: string | null }>
  punch: Array<{ status: PunchStatus; unit?: string | null }>
  /** Inspections: the delivery units they block, and the failed one a decision names. */
  inspections?: Array<{ status: string; unit?: string | null; seq?: number; itemId?: string; location?: string; attempts?: Array<{ on: string; rOn?: string | null; note?: string | null }> }>
  /** Delivery units (section `zone`). */
  units?: PmUnit[]
  variations: Array<{ seq?: number; title?: string; status: VoStatus; value: number; executedPct: number; day: string }>
  claims: Array<{ status: ClaimStatus; eventOn: string; response?: { days: number } | null; obstacleId?: string | null; kind?: string; cause?: string }>
  submittals?: Array<{ itemId: string; status: string; rev: number; day: string; seq?: number; what?: string | null; code?: string | null; reply?: { note?: string | null } | null }>
  subCertificates?: Array<{ status: string; gross: number; prepOn: string }>
  documents?: Array<Pick<PmDocument, "type" | "revisions">>
  /** The last certificate's day — a drawing issued after it is stale. */
  lastCertDay?: string | null
  letters?: Array<Pick<PmLetter, "status" | "day" | "due" | "party">>
  obstacles?: Array<Pick<PmObstacle, "id" | "type" | "closeOn" | "itemIds" | "openOn">>
  /** The last approved monthly reconciliation (CVR-01), if any. */
  eac?: { on: string } | null
  /** The programme's S-curve shape (usePmPlan); absent = linear. */
  curveK?: number
  /** When the project was put on hold, if it is. */
  holdSince?: string | null
  holdWhy?: string | null
  /** Indirect spend to date (staff, site, plant): what a hold keeps burning. */
  indirectSpent?: number | null
  /** Who pays the certificates — Finance chases them. */
  payer?: string | null
  /** The project's switched-on sections; absent = every kind applies. */
  sections?: readonly string[] | null
  /** The project manager's uid: the owner hears of store moves only when the manager logged them. */
  managerId?: string | null
  /** Supply: material requests, the project store, equipment requests and plant on site. */
  requests?: PmMaterialRequest[]
  stores?: PmStoreLine[]
  /** A store line's last paid unit price (price history): what a loss or a use is worth. */
  storeCostOf?: (x: Pick<PmStoreLine, "name" | "unit">) => number | null
  /** Materials short within 30 days with no live request (needsWithin, computed with the programme). */
  shortages?: number
  plantRequests?: Array<Pick<PmPlantRequest, "status" | "rep" | "got" | "day" | "from">>
  plant?: Array<Pick<PmPlant, "status" | "to" | "days" | "dayRate" | "category" | "qty" | "licenceTo" | "offOk">>
  /** Realised margin (earned − actual cost); damages above it turn red. Absent = unknown. */
  margin?: number | null
  /** The project's purchase orders Procurement referred for a budget decision (pmBudget pending). */
  budgetReferrals?: Array<{ askedAt?: string | null; over?: number | null }>
  today: string
  /** Who is looking: decisions reach only the duty that answers them. Absent = everything. */
  viewer?: DecisionViewer | null
}

const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000))
const oldest = (dates: string[], today: string) => dates.reduce((m, d) => Math.max(m, days(d, today)), 0)
const r2 = (n: number) => Math.round(n * 100) / 100
const RANK = { red: 0, amber: 1, blue: 2 }
/** A store move the owner hears of even when the manager did not log it (the prototype's 5,000). */
export const OWNER_STORE_VALUE = 5000

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
  cvr_stale: (h) => h("approve"),
  req_waiting: (h) => h("req") || h("approve"),
  req_stop: (h) => h("req") || h("approve"),
  req_incoming: (h) => h("req"),
  store_move: (h) => h("approve"),
  store_incoming: (h) => h("req"),
  store_close: (h) => h("req") || h("approve"),
  store_negative: (h) => h("approve") || h("measure"),
  change_held: (h) => h("approve"),
  change_rejected: (h) => h("approve"),
  need_short: () => true,
  eqp_waiting: (h) => h("approve"),
  eqp_receive: (h) => h("req") || h("approve"),
  eqp_hire: (h) => h("approve"),
  eqp_idle: () => true,
  eqp_overdue: () => true,
  eqp_offhire: () => true,
  eqp_licence: () => true,
  rerate: (h) => h("client"),
  po_budget: (h) => h("approve"),
  zone: (h) => h("measure") || h("approve"),
  ztight: (h) => h("measure") || h("approve"),
}

/** A kind that lives in a section, and the section (the prototype's HAS2 guards). */
export const SECTION_OF: Partial<Record<DecisionKind, SectionId>> = {
  claim_notice_late: "claim",
  claim_notice_due: "claim",
  claim_waiting: "claim",
  obstacle_unprotected: "claim",
  sample_rejected: "subm",
  sample_late: "subm",
  wir_failed: "qa",
  doc_stale: "docs",
  cvr_stale: "cvr",
  store_move: "store",
  store_incoming: "store",
  store_close: "store",
  store_negative: "store",
  eqp_waiting: "eqp",
  eqp_receive: "eqp",
  eqp_hire: "eqp",
  eqp_idle: "eqp",
  eqp_overdue: "eqp",
  eqp_offhire: "eqp",
  eqp_licence: "eqp",
  zone: "zone",
  ztight: "zone",
}

// Site chores the owner is never sent (the prototype's `CU().role!=='owner'`).
const NOT_FOR_OWNER = new Set<DecisionKind>(["req_stop", "req_incoming", "store_incoming", "store_close", "need_short"])

const until = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000)

function supplyDecisions(f: DecisionFacts, out: PmDecision[]): void {
  const requests = f.requests ?? []
  const stores = f.stores ?? []
  const viewer = f.viewer
  const storeItems: StoreItem[] = f.items.filter((i) => i.id).map((i) => ({ id: i.id as string, code: i.code ?? "", description: "", unit: i.unit ?? "", quantity: i.quantity, executed: i.executed }))
  const itemOf = (id: string | null) => (id ? storeItems.find((i) => i.id === id) : undefined)

  const waiting = requests.filter((r) => reqState(r) === "wait")
  if (waiting.length) {
    const soon = waiting.some((r) => r.needBy && until(f.today, r.needBy) <= 7)
    const over = waiting.some((r) => r.lines.some((l) => lineOver(lineNeed({ key: l.key, stores, items: storeItems, requests, except: r.id }), l.qty) > 0))
    const one = waiting.length === 1 && waiting[0].seq ? waiting[0] : null
    out.push({
      kind: "req_waiting",
      severity: soon ? "red" : over ? "amber" : "blue",
      count: waiting.length,
      age: oldest(waiting.map((r) => r.day ?? f.today), f.today),
      tab: "pmReq",
      ...(one
        ? { title: "title_one", detail: over ? "detail_one_over" : one.needBy ? "detail_one_need" : "detail_one", vars: { no: reqNo(one.seq as number), name: one.title || "—", ...(one.needBy ? { date: one.needBy } : {}) } }
        : {}),
    })
  }

  const going = requests.filter((r) => reqState(r) === "go")
  const stoppable = going
    .filter((r) => !viewer || viewer.has("approve") || r.requestedByUserId === viewer.uid)
    .flatMap((r) =>
      r.lines
        .filter((l) => !l.cl && lineOut(l) > 0)
        .filter((l) => itemProgress(itemOf(l.itemId)) >= 99.5 || (Boolean(r.needBy) && (r.needBy as string) < f.today && lineGot(l) >= l.qty * 0.85))
        .map(() => r)
    )
  if (stoppable.length) {
    const age = oldest(stoppable.map((r) => (r.needBy && r.needBy < f.today ? r.needBy : f.today)), f.today)
    out.push({ kind: "req_stop", severity: "amber", count: stoppable.length, age: age || undefined, tab: "pmReq" })
  }

  const coming = going.flatMap((r) => r.lines.filter((l) => receivable(r, l)))
  if (coming.length) out.push({ kind: "req_incoming", severity: "blue", count: coming.length, tab: "pmReq" })

  const held = going.flatMap((r) => openChanges(r).map(() => r))
  if (held.length) out.push({ kind: "change_held", severity: "amber", count: held.length, age: oldest(held.map((r) => r.day ?? f.today), f.today), tab: "pmReq" })
  const voStatus = new Map(f.variations.filter((v) => v.seq != null).map((v) => [v.seq as number, v.status]))
  const refusedByClient = requests
    .filter((r) => reqState(r) === "go" || reqState(r) === "wait")
    .flatMap((r) => r.lines.filter((l) => !l.cl && l.chg?.st === "own" && l.chg.voSeq != null && voStatus.get(l.chg.voSeq) === "rej"))
  if (refusedByClient.length) out.push({ kind: "change_rejected", severity: "red", count: refusedByClient.length, tab: "pmReq" })

  if ((f.shortages ?? 0) > 0) out.push({ kind: "need_short", severity: "amber", count: f.shortages, tab: "pmReq" })

  // An order above its item's budget waits on the project's word (R-25): accept, or renegotiate.
  const referred = f.budgetReferrals ?? []
  if (referred.length)
    out.push({ kind: "po_budget", severity: "amber", count: referred.length, amount: r2(referred.reduce((a, r) => a + (r.over ?? 0), 0)) || undefined, age: oldest(referred.map((r) => r.askedAt ?? f.today), f.today), tab: "pmPo" })

  // The owner hears of a move the manager logged — or of one worth 5,000 or more, whoever logged it.
  const worth = (x: PmStoreLine, q: number) => r2(q * (f.storeCostOf?.(x) ?? 0))
  const moves = stores.flatMap((x) =>
    x.moves
      .filter((m) => (m.t === "loss" || m.t === "use" || m.t === "rx") && m.st === "wait")
      .filter((m) => !viewer || m.by !== viewer.uid || viewer.owner)
      .filter((m) => !viewer?.owner || m.by === f.managerId || worth(x, m.q) >= OWNER_STORE_VALUE)
      .map((m) => ({ on: m.on, value: worth(x, m.q) }))
  )
  if (moves.length) out.push({ kind: "store_move", severity: "amber", count: moves.length, amount: r2(moves.reduce((a, m) => a + m.value, 0)) || undefined, age: oldest(moves.map((m) => m.on), f.today), tab: "pmStore" })
  const incoming = stores.flatMap((x) => x.moves.filter((m) => m.t === "xi" && m.st === "wait"))
  if (incoming.length) out.push({ kind: "store_incoming", severity: "blue", count: incoming.length, tab: "pmStore" })
  const states = stores.map((x) => storeState(x, storeItems))
  const balanceValue = (want: string) => r2(stores.reduce((a, x, i) => (states[i] === want ? a + Math.abs(storeBalance(x, storeItems)) * (f.storeCostOf?.(x) ?? 0) : a), 0))
  const toClose = states.filter((st) => st === "close").length
  if (toClose) out.push({ kind: "store_close", severity: "amber", count: toClose, amount: balanceValue("close") || undefined, tab: "pmStore" })
  const negative = states.filter((st) => st === "neg").length
  if (negative) out.push({ kind: "store_negative", severity: "amber", count: negative, amount: balanceValue("neg") || undefined, tab: "pmStore" })

  const eqWait = (f.plantRequests ?? []).filter((r) => r.status === "wait")
  if (eqWait.length) out.push({ kind: "eqp_waiting", severity: "amber", count: eqWait.length, age: oldest(eqWait.map((r) => r.day), f.today), tab: "pmReq" })
  const eqGet = (f.plantRequests ?? []).filter((r) => plantReceivable(r) && r.from <= f.today)
  if (eqGet.length) out.push({ kind: "eqp_receive", severity: "amber", count: eqGet.length, tab: "pmReq" })
  const eqHire = (f.plantRequests ?? []).filter(plantHireable)
  if (eqHire.length) out.push({ kind: "eqp_hire", severity: "amber", count: eqHire.length, tab: "pmReq" })
  const site = onSite(f.plant ?? [])
  const idle = site.filter((p) => (p.dayRate ?? 0) > 0 && p.category !== "tool" && idleSince(p) >= IDLE_ALERT_DAYS)
  if (idle.length) {
    const cost = idle.reduce((a, p) => a + (p.dayRate ?? 0) * Math.max(1, p.qty || 1) * IDLE_SHARE * idleSince(p), 0)
    out.push({ kind: "eqp_idle", severity: "red", count: idle.length, age: idle.reduce((m, p) => Math.max(m, idleSince(p)), 0), amount: r2(cost), tab: "pmSite" })
  }
  const late = site.filter((p) => overdueDays(p, f.today) > 0)
  if (late.length) out.push({ kind: "eqp_overdue", severity: "red", count: late.length, age: late.reduce((m, p) => Math.max(m, overdueDays(p, f.today)), 0), tab: "pmSite" })
  const off = site.filter((p) => p.status === "req" && !p.offOk)
  if (off.length) out.push({ kind: "eqp_offhire", severity: "amber", count: off.length, tab: "pmSite" })
  const lic = site.map((p) => licenceState(p, f.today)).filter((st) => st === "expired" || st === "warn")
  if (lic.length) out.push({ kind: "eqp_licence", severity: lic.includes("expired") ? "red" : "amber", count: lic.length, tab: "pmSite" })
}

export function projectDecisions(f: DecisionFacts): PmDecision[] {
  if (f.lifecycle === "closed") return []
  const out: PmDecision[] = []

  if (f.managerless && f.lifecycle !== "done") out.push({ kind: "no_pm", severity: "red", tab: "team" })
  if (f.lifecycle === "plan" && f.plannedStart && f.plannedStart < f.today) out.push({ kind: "plan_overdue", severity: "amber", age: days(f.plannedStart, f.today), tab: "info" })
  if (f.lifecycle === "hold") {
    const age = f.holdSince ? days(f.holdSince, f.today) : undefined
    // The way out of a hold is an extension claim — follow the open one, or log it.
    const claimsOn = !f.sections || pmTabVisible(f.sections as readonly SectionId[], "claim", 0)
    const eot = f.claims.some((c) => (c.kind === "time" || c.kind === "both") && (c.status === "draft" || c.status === "notice" || c.status === "sub"))
    const why = f.holdWhy?.trim()
    out.push({
      kind: "hold",
      severity: (age ?? 0) > 30 ? "red" : "amber",
      age,
      amount: f.indirectSpent && f.indirectSpent > 0 ? r2(f.indirectSpent) : undefined,
      tab: claimsOn ? "pmClaims" : "info",
      detail: why ? "detail_why" : "detail_burn",
      act: claimsOn ? (eot ? "act_follow" : "act_log") : undefined,
      vars: why ? { why } : undefined,
    })
  }

  const waiting = f.sheets.filter((s) => s.status === "wait")
  if (waiting.length) {
    const age = oldest(waiting.map((s) => s.day), f.today)
    const one = waiting.length === 1 && waiting[0].seq ? waiting[0] : null
    const by = one?.byName?.trim()
    out.push({
      kind: "sheets_waiting",
      severity: age > 4 ? "red" : "amber",
      count: waiting.length,
      age,
      tab: "pmMeasure",
      ...(one ? { title: by ? "title_one" : "title_one_plain", detail: "detail_one", vars: { no: sheetNo(one.seq as number), n: one.lines?.length ?? 0, ...(by ? { name: by } : {}) } } : {}),
    })
  }

  const unpriced = f.items.filter((i) => !(i.rate > 0) && i.executed > 0).length
  if (unpriced) out.push({ kind: "unpriced_executed", severity: "red", count: unpriced, tab: "pmMeasure" })

  const unbilled = r2(f.items.reduce((a, i) => a + (i.rate > 0 ? Math.max(0, i.executed - (i.billed ?? 0)) * i.rate : 0), 0))
  if (unbilled > CERTIFICATE_READY_AT) {
    // How long the last billed measurement has sat — the money we are lending (the prototype's age).
    const since = f.lastCertDay ? days(f.lastCertDay, f.today) : null
    out.push({ kind: "ipc_ready", severity: "red", amount: unbilled, tab: "ipc", ...(since !== null ? { age: since || undefined, detail: "detail_since", vars: { days: since } } : {}) })
  }

  const failedItems = f.items.filter((i) => i.gate?.pmWir === "fail")
  if (failedItems.length) {
    const wir =
      failedItems.length === 1 && failedItems[0].id
        ? (f.inspections ?? []).filter((w) => w.status === "fail" && w.itemId === failedItems[0].id && w.seq).reduce<NonNullable<DecisionFacts["inspections"]>[number] | null>((m, w) => (!m || (w.seq ?? 0) > (m.seq ?? 0) ? w : m), null)
        : null
    const last = wir?.attempts?.[wir.attempts.length - 1]
    const note = last?.note?.trim()
    out.push({
      kind: "wir_failed",
      severity: "red",
      count: failedItems.length,
      tab: "pmQa",
      ...(wir
        ? { title: "title_one", detail: note ? "detail_one_note" : "detail_one", age: last ? days(last.rOn ?? last.on, f.today) || undefined : undefined, vars: { no: wirNo(wir.seq as number), name: wir.location?.trim() || "—", ...(note ? { note } : {}) } }
        : {}),
    })
  }

  // The latest revision per item decides: a rejected sample stops the item; one
  // with the consultant more than 10 days is chased.
  const latest = new Map<string, NonNullable<DecisionFacts["submittals"]>[number]>()
  for (const s of f.submittals ?? []) {
    const cur = latest.get(s.itemId)
    if (!cur || s.rev > cur.rev) latest.set(s.itemId, s)
  }
  const rejected = Array.from(latest.values()).filter((s) => s.status === "rej")
  if (rejected.length) {
    const one = rejected.length === 1 && rejected[0].seq ? rejected[0] : null
    const note = one?.reply?.note?.trim()
    out.push({
      kind: "sample_rejected",
      severity: "red",
      count: rejected.length,
      age: oldest(rejected.map((s) => s.day), f.today),
      tab: "pmSubm",
      ...(one ? { title: "title_one", detail: note ? "detail_one_note" : "detail_one", vars: { no: sampleNo(one.seq as number), name: one.what?.trim() || one.code?.trim() || "—", ...(note ? { note } : {}) } } : {}),
    })
  }
  const late = Array.from(latest.values()).filter((s) => s.status === "sub" && days(s.day, f.today) > 10)
  if (late.length) out.push({ kind: "sample_late", severity: "amber", count: late.length, age: oldest(late.map((s) => s.day), f.today), tab: "pmSubm" })

  const blocking = blockingObstacles(f.obstacles ?? [])
  if (blocking.length) out.push({ kind: "obstacle_blocking", severity: "amber", count: blocking.length, age: oldest(blocking.map((o) => o.openOn), f.today), tab: "pmSite" })
  const unprotected = unprotectedObstacles(f.obstacles ?? [], f.claims, f.today)
  if (unprotected.length) out.push({ kind: "obstacle_unprotected", severity: "amber", count: unprotected.length, age: oldest(unprotected.map((o) => o.openOn), f.today), tab: "pmClaims" })

  const risky = workBeforeApproval(f.variations)
  if (risky.length) {
    const one = risky.length === 1 && risky[0].seq != null ? risky[0] : null
    out.push({
      kind: "vo_work",
      severity: "red",
      count: risky.length,
      amount: r2(risky.reduce((a, v) => a + v.value * v.executedPct, 0)),
      age: oldest(risky.map((v) => v.day), f.today) || undefined,
      tab: "pmVo",
      ...(one ? { title: "title_one", ...(one.title?.trim() ? { detail: "detail_one" } : {}), vars: { no: voNo(one.seq as number), pct: Math.round(one.executedPct * 100), name: one.title?.trim() || "—" } } : {}),
    })
  }
  const voWait = f.variations.filter((v) => v.status === "wait")
  if (voWait.length) out.push({ kind: "vo_waiting", severity: "amber", count: voWait.length, amount: r2(voWait.reduce((a, v) => a + v.value, 0)), age: oldest(voWait.map((v) => v.day), f.today), tab: "pmVo" })

  // The sub-line names the earliest event: its deadline bites first.
  const eventOf = (cs: DecisionFacts["claims"]): Pick<PmDecision, "detail" | "vars"> => {
    const c = cs.reduce((m, x) => (x.eventOn < m.eventOn ? x : m))
    return c.cause?.trim() ? { detail: "detail_event", vars: { cause: c.cause.trim(), date: c.eventOn } } : {}
  }
  const noticeOver = f.claims.filter((c) => noticeLate(c, f.terms, f.today))
  if (noticeOver.length) out.push({ kind: "claim_notice_late", severity: "red", count: noticeOver.length, tab: "pmClaims", ...eventOf(noticeOver) })
  const noticeSoon = f.claims.filter((c) => c.status === "draft" && !noticeLate(c, f.terms, f.today) && days(f.today, noticeDeadline(c.eventOn, f.terms)) <= 7)
  if (noticeSoon.length) out.push({ kind: "claim_notice_due", severity: "amber", count: noticeSoon.length, tab: "pmClaims", ...eventOf(noticeSoon) })
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
  if (others.length) {
    const names = Array.from(new Set(others.map((c) => c.prepName?.trim()).filter((n): n is string => Boolean(n))))
    out.push({
      kind: "cert_internal",
      severity: "red",
      count: others.length,
      amount: r2(others.reduce((a, c) => a + c.net, 0)),
      age: oldest(others.map((c) => c.prepOn ?? f.today), f.today),
      tab: "ipc",
      ...(names.length ? { detail: "detail_by", vars: { name: names.join(" · ") } } : {}),
    })
  }
  if (mine.length) out.push({ kind: "cert_mine", severity: "amber", count: mine.length, amount: r2(mine.reduce((a, c) => a + c.net, 0)), age: oldest(mine.map((c) => c.prepOn ?? f.today), f.today), tab: "ipc" })
  const withConsultant = f.certificates.filter((c) => c.status === "sub")
  if (withConsultant.length) out.push({ kind: "cert_consultant", severity: "blue", count: withConsultant.length, amount: r2(withConsultant.reduce((a, c) => a + c.net, 0)), tab: "ipc" })
  const overdue = f.certificates.filter((c) => (c.status === "appr" || c.status === "part") && c.dueOn && c.dueOn < f.today)
  if (overdue.length) {
    const age = oldest(overdue.map((c) => c.dueOn as string), f.today)
    const payer = f.payer?.trim()
    out.push({
      kind: "collection_overdue",
      severity: age > 30 ? "red" : "amber",
      count: overdue.length,
      age,
      amount: r2(overdue.reduce((a, c) => a + c.net * (1 - Math.min(1, Math.max(0, c.collected ?? 0))), 0)),
      tab: "ipc",
      ...(payer ? { detail: "detail_payer", vars: { payer } } : {}),
    })
  }

  const itemsWithId = f.items.filter((i): i is typeof i & { id: string } => Boolean(i.id)).map((i) => ({ id: i.id, rate: i.rate }))
  const progress = progressOf(f.items)
  const delay = delayAndDamages({
    lifecycle: f.lifecycle,
    startOn: f.startOn,
    effectiveDays: f.durationDays + grantedDays(f.claims),
    progress,
    contractValue: f.baseValue + approvedValue(f.variations),
    damages: f.terms.damages,
    today: f.today,
    curveK: f.curveK,
  })
  if (delay && delay.damages > 0) {
    const overMargin = f.margin != null && delay.damages > f.margin
    out.push({
      kind: "damages",
      severity: overMargin ? "red" : "amber",
      count: delay.delayDays,
      amount: delay.damages,
      tab: "pmProgramme",
      detail: overMargin ? "detail_pace_over" : "detail_pace",
      vars: { points: Math.max(0, Math.round(delay.planned - (progress ?? 0))), rate: r2(f.terms.damages.weeklyRate * 100), cap: r2(f.terms.damages.cap * 100) },
    })
  }
  if (f.lifecycle === "live" && delay && progress !== null && delay.planned - progress > 4) out.push({ kind: "slip", severity: "amber", count: Math.round(delay.planned - progress), tab: "pmProgramme" })

  // The estimate at completion goes stale after 35 days of work (CVR-01).
  if (f.lifecycle === "live" && (!f.eac || days(f.eac.on, f.today) > 35))
    out.push({ kind: "cvr_stale", severity: "amber", count: f.eac ? days(f.eac.on, f.today) : 0, age: f.eac ? days(f.eac.on, f.today) : undefined, tab: "pmCvr" })

  // A re-measurement contract: executed beyond the BOQ quantity by more than 25%
  // opens the right to re-rate the excess (not a variation).
  if (f.terms.basis === "rem") {
    const over = f.items.filter((i) => i.quantity > 0 && i.executed - i.quantity > i.quantity * RERATE_SHARE)
    if (over.length) out.push({ kind: "rerate", severity: "amber", count: over.length, amount: r2(over.reduce((a, i) => a + (i.executed - i.quantity) * i.rate, 0)), tab: "boq" })
  }

  supplyDecisions(f, out)

  // A unit meeting every handover condition is money left on the table; one
  // whose date needs a pace it has never reached is a contract risk.
  if (f.units?.length) {
    const open = { punch: f.punch.filter(isOpenPunch), inspections: (f.inspections ?? []).filter((w) => w.status === "open" || w.status === "fail") }
    const rows = f.units.filter((u) => !unitDone(u)).map((u) => ({ u, f: unitFigures(u, itemsWithId), blocks: unitBlocks(u, itemsWithId, open) }))
    const ready = rows.filter((r) => !r.blocks.length)
    if (ready.length) out.push({ kind: "zone", severity: "red", count: ready.length, amount: r2(ready.reduce((a, r) => a + unitRetention(r.f.contract, f.terms), 0)), tab: "pmUnits" })
    const tight = rows.filter((r) => unitTight(r.u, r.f, f.startOn, f.today))
    if (tight.length) out.push({ kind: "ztight", severity: "amber", count: tight.length, tab: "pmUnits" })
  }

  if (f.lifecycle === "live" && !f.acceptances.prov && progress !== null && progress >= PROVISIONAL_AT) out.push({ kind: "provisional_ready", severity: "blue", tab: "pmClose" })
  if (f.acceptances.prov && !f.acceptances.final) {
    const end = defectsEnd(f.acceptances.prov.on, f.terms.defectsDays)
    if (end < f.today) out.push({ kind: "final_overdue", severity: "red", age: days(end, f.today), tab: "pmClose" })
    else if (!f.punch.some(isOpenPunch)) out.push({ kind: "final_ready", severity: "blue", tab: "pmClose" })
  }

  const h = f.viewer?.has
  const sectionOn = (d: PmDecision) => !f.sections || !SECTION_OF[d.kind] || pmTabVisible(f.sections as readonly SectionId[], SECTION_OF[d.kind] as SectionId, 0)
  return out
    .filter(sectionOn)
    .filter((d) => !f.viewer?.owner || !NOT_FOR_OWNER.has(d.kind))
    .filter((d) => !h || REACHES[d.kind](h))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.amount ?? 0) - (a.amount ?? 0))
}

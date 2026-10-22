// Procurement 2.0 — what a change of package means for the records a company already has (NFR-08, PKG-04, WF-22).
// The admin sees these counts before saving («ما يتغيّر»), and the migration job of a later wave applies the same steps:
// the planner is the one place that decides which record is touched, so the report and the job can never disagree.
//
// The rule of the PRD (eight rules, #7): opening a connector rewrites nothing; closing one lets what is in flight finish
// as it is. So nothing here deletes or hides a record — a step only re-labels what a closed connector can no longer
// answer (a workshop question nobody will reply to, an order that waited for Finance's payment) and never touches a
// closed order or a received line. Pure: the server fills the snapshot, the tests fill it by hand.

import { foldSearchText } from "../search-text"
import { CONNECTORS, offFor, packageOf, type Connector, type PackageFlags } from "./package"
import { advanceState, paidInFull, type PurchaseOrderX } from "./po-extras"
import type { FinancelessFields } from "./payment-mark"
import { teamProgress, teamRequestState, type TeamLinkedRfq, type TeamRequestDoc } from "./team-requests"

/** A company with more projects than this is counted on its first 300 — the report then says «300+». */
export const PROJECT_SCAN_CAP = 300

export const IMPACT_KEYS = [
  "teamRequestsOpen",
  "projectRequestsOpen",
  "projectRequestsInFlight",
  "ordersAwaitingPayment",
  "advancesRequested",
  "buyerPaymentMarks",
  "workshopAsksUnanswered",
  "workshopAnswersWithWorkOrder",
  "sitesToLink",
] as const
export type ImpactKey = (typeof IMPACT_KEYS)[number]
export type ImpactCounts = Record<ImpactKey, number>

export const emptyImpact = (): ImpactCounts => Object.fromEntries(IMPACT_KEYS.map((k) => [k, 0])) as ImpactCounts

/** Which counts a connector's opening / closing is about — the rest of the snapshot is none of its business. */
export const CONNECTOR_IMPACT: Record<Connector, Record<"on" | "off", readonly ImpactKey[]>> = {
  pm: { on: ["teamRequestsOpen", "sitesToLink"], off: ["projectRequestsOpen", "projectRequestsInFlight"] },
  fin: { on: ["buyerPaymentMarks"], off: ["ordersAwaitingPayment", "advancesRequested"] },
  mfg: { on: [], off: ["workshopAsksUnanswered", "workshopAnswersWithWorkOrder"] },
}

export interface SnapshotProjectRequest {
  id?: string
  status?: string | null
  withdrawn?: boolean | null
  rfqId?: string | null
  poId?: string | null
  lineLinks?: Record<string, unknown> | null
  /** A PM 1.0 request's lines — `cl` is set once a line is closed. */
  lines?: Array<{ cl?: unknown } | null> | null
}

export interface SnapshotWorkshopAsk {
  id: string
  status?: string | null
  sourceKind?: string | null
  workOrderId?: string | null
  workOrderIds?: string[] | null
  /** Set by an earlier closing: the question was handed back once and is never revived (`mk.st`). */
  returned?: boolean | null
}

/** A line of a stored incoming request that carries a question to the workshop (`mk`) — Procurement's own state, the one the buyer reads. */
export interface SnapshotWorkshopLine {
  mrKey: string
  no: number
  /** `mk.st`: `ask` waits for the workshop; `make` / `part` are answers; `buy` is a question handed back (it never comes alive again). */
  st: "ask" | "make" | "part" | "buy"
  /** The work order a make / part answer stands on. */
  wo?: string | null
  /** The line is already in an RFQ or an order, received, failed or taken out: a closing connector leaves it alone. */
  busy?: boolean
}

export interface SnapshotSite {
  id: string
  kind?: string | null
  name: string
  projectId?: string | null
  warehouseId?: string | null
}

export type SnapshotOrder = PurchaseOrderX & FinancelessFields & { closeOn?: "receipt" | "payment" | null }

export interface PackageSnapshot {
  teamRequests: TeamRequestDoc[]
  /** The company's RFQs, as far as a team request reads them (`teamProgress`). */
  rfqs: TeamLinkedRfq[]
  projectRequests: SnapshotProjectRequest[]
  projects: Array<{ id: string; name?: string | null }>
  /** True when the company has more projects than were scanned. */
  projectsCapped: boolean
  orders: SnapshotOrder[]
  workshopAsks: SnapshotWorkshopAsk[]
  /** The questions stored on incoming requests' lines — beside the workshop's own request documents above, never the same ask twice. */
  workshopLines?: SnapshotWorkshopLine[]
  sites: SnapshotSite[]
  workshopWarehouses?: Array<{ id: string; name?: string | null }>
}

export const emptySnapshot = (): PackageSnapshot => ({ teamRequests: [], rfqs: [], projectRequests: [], projects: [], projectsCapped: false, orders: [], workshopAsks: [], sites: [] })

const LIVE_ORDER = new Set(["approved", "sent", "accepted"])
const liveOrder = (o: SnapshotOrder): boolean => LIVE_ORDER.has(o.status) && Boolean(o.approvedAt)

const requestOpen = (r: SnapshotProjectRequest): boolean => {
  if (r.withdrawn || (r.status !== "pending" && r.status !== "approved")) return false
  const lines = (r.lines || []).filter(Boolean)
  return lines.length === 0 || lines.some((l) => !l?.cl)
}

const requestInFlight = (r: SnapshotProjectRequest): boolean => Boolean(r.rfqId || r.poId || (r.lineLinks && Object.keys(r.lineLinks).length > 0))

const hasWorkOrder = (a: SnapshotWorkshopAsk): boolean => Boolean(a.workOrderId || (a.workOrderIds && a.workOrderIds.length > 0))

const unansweredAsk = (a: SnapshotWorkshopAsk): boolean => a.status === "new" && !a.returned

const unansweredLine = (l: SnapshotWorkshopLine): boolean => l.st === "ask" && !l.busy

const answeredLine = (l: SnapshotWorkshopLine): boolean => (l.st === "make" || l.st === "part") && Boolean(l.wo)

export const workshopLineId = (l: Pick<SnapshotWorkshopLine, "mrKey" | "no">): string => `${l.mrKey}#${l.no}`

const answeredAsk = (a: SnapshotWorkshopAsk): boolean => (a.status === "accepted" || a.status === "partial") && hasWorkOrder(a)

/** A manual place that carries a project's name but is not tied to it — what opening Project Management links. */
export function sitesToLink(sites: readonly SnapshotSite[], projects: ReadonlyArray<{ id: string; name?: string | null }>): Array<{ siteId: string; projectId: string }> {
  const byName = new Map<string, string>()
  for (const p of projects) {
    const key = foldSearchText(p.name || "")
    if (key && !byName.has(key)) byName.set(key, p.id)
  }
  const taken = new Set(sites.map((s) => s.projectId).filter((id): id is string => Boolean(id)))
  const out: Array<{ siteId: string; projectId: string }> = []
  for (const s of sites) {
    if (s.projectId || s.kind === "project" || s.warehouseId) continue
    const projectId = byName.get(foldSearchText(s.name))
    if (projectId && !taken.has(projectId)) {
      taken.add(projectId)
      out.push({ siteId: s.id, projectId })
    }
  }
  return out
}

export function measureImpact(s: PackageSnapshot): ImpactCounts {
  const impact = emptyImpact()
  impact.teamRequestsOpen = s.teamRequests.filter((doc) => {
    const state = teamRequestState(doc, teamProgress(doc.id, s.rfqs, s.orders))
    return state !== "received" && state !== "declined" && state !== "withdrawn"
  }).length
  const open = s.projectRequests.filter(requestOpen)
  impact.projectRequestsOpen = open.length
  impact.projectRequestsInFlight = open.filter(requestInFlight).length
  impact.ordersAwaitingPayment = s.orders.filter((o) => liveOrder(o) && o.closeOn !== "receipt" && !paidInFull(o)).length
  impact.advancesRequested = s.orders.filter((o) => o.status !== "cancelled" && advanceState(o) === "requested").length
  impact.buyerPaymentMarks = s.orders.filter((o) => o.status !== "cancelled" && Boolean(o.paymentMark || (o.paymentMarks && o.paymentMarks.length > 0))).length
  impact.workshopAsksUnanswered = s.workshopAsks.filter(unansweredAsk).length + (s.workshopLines || []).filter(unansweredLine).length
  impact.workshopAnswersWithWorkOrder = s.workshopAsks.filter(answeredAsk).length + (s.workshopLines || []).filter(answeredLine).length
  impact.sitesToLink = sitesToLink(s.sites, s.projects).length
  return impact
}

export type MigrationStep =
  | { kind: "stamp_close_on"; orderIds: string[]; closeOn: "receipt" | "payment" }
  | { kind: "send_commitments"; orderIds: string[] }
  | { kind: "return_workshop_asks"; requestIds: string[]; reason: "connector_closed" }
  | { kind: "return_workshop_lines"; lines: Array<{ mrKey: string; no: number }>; reason: "connector_closed" }
  | { kind: "keep_workshop_answers"; requestIds: string[] }
  | { kind: "sites_to_ordinary"; siteIds: string[] }
  | { kind: "link_sites"; links: Array<{ siteId: string; projectId: string }> }
  | { kind: "add_workshop_site"; warehouseId: string }

export interface ConnectorPlan {
  conn: Connector
  to: "on" | "off"
  /** The counts that connector's change is about (`CONNECTOR_IMPACT`). */
  impact: Partial<ImpactCounts>
  steps: MigrationStep[]
}

const ids = (xs: ReadonlyArray<{ id: string }>) => xs.map((x) => x.id).sort()

/**
 * What one connector's opening or closing does to the records. A step lists only what still needs it, so planning again
 * after the job ran gives no step (the job is re-runnable), and a closed order or a received line is never listed.
 */
export function planChange(s: PackageSnapshot, conn: Connector, to: "on" | "off"): ConnectorPlan {
  const all = measureImpact(s)
  const impact: Partial<ImpactCounts> = {}
  for (const k of CONNECTOR_IMPACT[conn][to]) impact[k] = all[k]
  const steps: MigrationStep[] = []
  const push = (step: MigrationStep | null) => {
    if (step) steps.push(step)
  }

  if (conn === "pm" && to === "off") {
    const projectSites = s.sites.filter((x) => x.kind === "project")
    push(projectSites.length ? { kind: "sites_to_ordinary", siteIds: ids(projectSites) } : null)
  }
  if (conn === "pm" && to === "on") {
    const links = sitesToLink(s.sites, s.projects)
    push(links.length ? { kind: "link_sites", links } : null)
  }

  if (conn === "fin" && to === "off") {
    const orders = s.orders.filter((o) => liveOrder(o) && o.closeOn !== "receipt")
    push(orders.length ? { kind: "stamp_close_on", orderIds: ids(orders), closeOn: "receipt" } : null)
  }
  if (conn === "fin" && to === "on") {
    const live = s.orders.filter((o) => liveOrder(o))
    const toStamp = live.filter((o) => o.closeOn !== "payment")
    push(toStamp.length ? { kind: "stamp_close_on", orderIds: ids(toStamp), closeOn: "payment" } : null)
    push(live.length ? { kind: "send_commitments", orderIds: ids(live) } : null)
  }

  if (conn === "mfg" && to === "off") {
    const unanswered = s.workshopAsks.filter(unansweredAsk)
    const asked = (s.workshopLines || []).filter(unansweredLine)
    const answered = s.workshopAsks.filter(answeredAsk)
    const answeredOnLines = (s.workshopLines || []).filter(answeredLine)
    push(unanswered.length ? { kind: "return_workshop_asks", requestIds: ids(unanswered), reason: "connector_closed" } : null)
    push(asked.length ? { kind: "return_workshop_lines", lines: asked.map(({ mrKey, no }) => ({ mrKey, no })).sort((a, b) => a.mrKey.localeCompare(b.mrKey) || a.no - b.no), reason: "connector_closed" } : null)
    const kept = [...ids(answered), ...answeredOnLines.map(workshopLineId).sort()]
    push(kept.length ? { kind: "keep_workshop_answers", requestIds: kept } : null)
  }
  if (conn === "mfg" && to === "on") {
    const has = new Set(s.sites.filter((x) => x.kind === "workshop").map((x) => x.warehouseId).filter(Boolean))
    for (const w of s.workshopWarehouses || []) if (!has.has(w.id)) steps.push({ kind: "add_workshop_site", warehouseId: w.id })
  }
  return { conn, to, impact, steps }
}

export interface PackageChangePlan {
  from: PackageFlags
  to: PackageFlags
  changes: ConnectorPlan[]
  /** Closing Finance takes HR with it for a company that has HR on. */
  hrDependent: boolean
  projectsCapped: boolean
  /** True when nothing the admin must read: no connector changes, or none with a count above zero. */
  quiet: boolean
}

/** The change between two stored `off` lists, connector by connector, in the order the admin reads them. */
export function planPackageChange(s: PackageSnapshot, fromOff: readonly string[] | null | undefined, toOff: readonly string[] | null | undefined): PackageChangePlan {
  const from = packageOf(fromOff)
  const to = packageOf(toOff)
  const changes = CONNECTORS.filter((c) => from[c] !== to[c]).map((c) => planChange(s, c, to[c] ? "on" : "off"))
  const hrOn = !(Array.isArray(fromOff) ? fromOff : []).includes("hr")
  const hrDependent = hrOn && from.fin && !to.fin
  const counted = changes.some((c) => Object.values(c.impact).some((n) => (n ?? 0) > 0))
  return { from, to, changes, hrDependent, projectsCapped: s.projectsCapped, quiet: !counted && !hrDependent }
}

/** The list a package change saves: the connectors as asked, every other switch (HR) as it was, dependents added. */
export const savedOff = (to: PackageFlags, current: readonly string[] | null | undefined): string[] => offFor(to, current).sort()

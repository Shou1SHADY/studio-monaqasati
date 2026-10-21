// Every need that reaches Purchasing, in one shape (PRD 3.0 §7.2, the requests
// tab): a work order's material shortfall, a project's internal purchase
// request, and a stock item at or below its minimum. Each keeps its own home
// and its own writes; this file only reads them and says, the same way for
// all three, what state the need is in. Pure.

import { foldSearchText } from "../search-text"
import type { MaterialPick } from "../materials/types"
import type { PurchaseRequestRecord } from "../manufacturing-engine"
import { poStatus } from "./po"
import { materialKey } from "./prices"
import { requestChanges, wholeWithdrawal, type ProjectChange } from "./project-change"
import { lineNeed, rfqNeedSources, type NeedLinkedRfq } from "./rfq-view"
import type { LineKind, IncomingDoc } from "./incoming-state"
import type { PurchaseOrder } from "./types"

export type NeedKind = "mfg" | "project" | "stock" | "team"

/** action = Purchasing's move · waiting = another module's · rfq / order = in
 * hand · done = arrived, sent back or refused. */
export type NeedState = "action" | "waiting" | "rfq" | "order" | "done"
export const NEED_STATES: NeedState[] = ["action", "waiting", "rfq", "order", "done"]

/** The RFQ and order a single line of a project request went into, when it was sourced apart from the rest. */
export interface NeedLineLink {
  rfqId: string | null
  rfqNumber: string | null
  poId: string | null
  poNumber: string | null
}

export interface NeedLine {
  name: string
  unit: string
  quantity: number
  /** Optional, from the source when it says: the purchasing category (buyer scope). */
  category?: string
  /** The line waits on a sample the consultant has not approved yet. */
  samplePending?: boolean
  /** The project's BOQ item the material is for (a project request's line). */
  itemId?: string
  /** Its own need-by date, when it differs from the request's. */
  needBy?: string
  /** The material as picked from the tree (a project request's line): arrives with its category. */
  material?: MaterialPick | null
  /** A PM 1.0 request's line: its index in the request's `lines` (where its own link is written). */
  requestLine?: number
  /** Its own RFQ / order, when part of the request was published without the rest. A line of a stored request (`procIncoming`)
   * that must not be published again — in hand, waiting for a reply, covered, closed — carries one (its ids null when it is not in
   * an RFQ or an order): the editor and the route skip a linked line. */
  link?: NeedLineLink
  /** A stored request's line: the place it is in (G-13), what was asked, and who it waits on. */
  lineKind?: LineKind
  asked?: number
  heldBy?: "stock" | "workshop" | null
  /** What the stores give and the workshop makes, of the quantity asked. */
  give?: number
  make?: number
}

/** What Procurement decided on a project's request without the other module's
 * answer: bought after Inventory's check window lapsed (`proceed_short` =
 * only what the stores do not cover, `proceed_full` = all of it), or bought
 * instead of asking the workshop (`buy`). Written once; `cover` is the stock
 * relied on per line when proceeding short. */
export interface ProcDecision {
  kind: "proceed_short" | "proceed_full" | "buy"
  at: string
  byName: string
  cover?: number[]
}

/** Where a need came from — carried onto the RFQ and the order. A project
 * request's line that is sourced apart from its request (added after the request
 * already had an RFQ or an order) names its index in the request's `lines`. */
export type NeedSource = NonNullable<PurchaseOrder["purchaseSource"]> & { line?: number }

export interface Need {
  key: string
  kind: NeedKind
  state: NeedState
  lines: NeedLine[]
  needBy: string | null
  requestedBy: string
  at: string
  /** The document it came from: WO-2026/012, PR-3F9A2C, or the warehouse. */
  refLabel: string
  /** What it is for: the product, the project, or the item's minimum. */
  context: string
  note: string | null
  rfqId: string | null
  rfqNumber: string | null
  poId: string | null
  poNumber: string | null
  /** Why it ended: the reason it was sent back, or who received it. */
  endNote: string | null
  /** How it ended: arrived, sent back to the workshop, refused by the warehouse. */
  endKind: "arrived" | "sent_back" | "refused" | "withdrawn" | null
  waitingOn: "warehouse" | "workshop" | "project" | null
  projectId: string | null
  projectName: string | null
  /** Carried onto the RFQ and the order, so the need can be closed from them. */
  source: NeedSource
  stock: { onHand: number; min: number } | null
  /** The work order (mfg) or the project (project) it belongs to, for its link. */
  ownerId: string
  /** The manufacturing request a project need was routed to, if any. */
  mfgRequestId: string | null
  decision: ProcDecision | null
  /** The order whose cancelled quantity came back to the desk (`returnedNeeds`). */
  returnedFrom?: string | null
  /** A project request's lines added after it was sourced — each its own need,
   * put on the desk by `returnedNeeds`. */
  added?: Need[]
  /** A team request's delivery site («مواقع التسليم») and the place it names (PUR-10). */
  siteId?: string | null
  place?: { label: string; city: string; district: string } | null
  /** Who approved a project's request technically, and the day. */
  approved?: { name: string; on: string } | null
  /** The project withdrew it after it reached us and before anything was bought: who and the day. */
  withdrawal?: { on: string | null; byName: string | null } | null
  /** What the project withdrew or changed on it after it reached us (PUR-01 p.5). */
  projectChanges?: ProjectChange[]
  /** The stored request (`procIncoming`) this need is read from; absent on a stock gap, which stays computed. */
  incoming?: IncomingDoc
}

const blank = { needBy: null, note: null, rfqId: null, rfqNumber: null, poId: null, poNumber: null, endNote: null, endKind: null, waitingOn: null, projectId: null, projectName: null, stock: null, mfgRequestId: null, decision: null }

export const nameKey = (name: string) => foldSearchText(name)

// ── A work order's shortfall ───────────────────────────────────────────────

export function mfgNeed(order: { id: string; ref: string; context: string; projectId?: string | null; projectName?: string | null }, r: PurchaseRequestRecord): Need {
  const state: NeedState = r.state === "sent" ? "action" : r.state === "ordered" ? (r.poId ? "order" : "rfq") : "done"
  return {
    ...blank,
    key: `mfg:${order.id}:${r.id}`,
    kind: "mfg",
    state,
    lines: [{ name: r.itemName, unit: r.unit, quantity: r.quantity }],
    needBy: r.needBy ? r.needBy.slice(0, 10) : null,
    requestedBy: r.by,
    at: r.at,
    refLabel: order.ref,
    context: order.context,
    note: r.note,
    rfqId: r.rfqId ?? null,
    rfqNumber: r.rfqNumber ?? null,
    poId: r.poId ?? null,
    poNumber: r.poNumber ?? null,
    endNote: r.state === "declined" ? r.declinedReason ?? null : r.state === "arrived" ? r.arrivedBy ?? null : null,
    endKind: r.state === "declined" ? "sent_back" : r.state === "arrived" ? "arrived" : null,
    projectId: order.projectId ?? null,
    projectName: order.projectName ?? null,
    source: { kind: "mfg_purchase", workOrderId: order.id, purchaseRequestId: r.id },
    ownerId: order.id,
  }
}

// ── A project's internal purchase request ───────────────────────────────────

/** A PM 1.0 request's line, as far as the desk reads it. */
export interface ProjectRequestLine {
  name?: string
  unit?: string
  qty?: number
  itemId?: string | null
  /** Inventory's reply: what it issued from stock is not bought. */
  inv?: { k?: string; q?: number | null; kept?: number | null } | null
  chg?: { st?: string | null } | null
  /** Closed by the project or the receiver: how, the day, who, and why (`chg` a rejected change). */
  cl?: { t?: string | null; on?: string | null; byName?: string | null; why?: string | null } | null
  /** Project receipts; `src` says which portion one arrived against (`stk` the store's issue). */
  receipts?: Array<{ q?: number | null; src?: string | null }> | null
  /** Added after the request was sourced: bought on its own. */
  late?: { on?: string | null } | null
}

export interface ProjectRequestDoc {
  id: string
  /** A PM 1.0 request: born `pending` = awaiting the project manager's technical approval. */
  pm?: boolean
  title?: string
  items?: Array<{ name?: string; quantity?: string | number; unit?: string; category?: string | null; samplePending?: boolean | null; needBy?: string | null; itemId?: string | null; material?: MaterialPick | null }>
  /** Optional until Projects' requests carry one (PM 1.0 E-26). */
  needBy?: string | null
  procDecision?: ProcDecision | null
  notes?: string | null
  status?: "pending" | "approved" | "rejected"
  requestedByUserName?: string
  createdAt?: unknown
  mfgRequestId?: string | null
  rfqId?: string | null
  rfqNumber?: string | null
  poId?: string | null
  poNumber?: string | null
  decidedByUserName?: string | null
  approvedByName?: string | null
  approvedOn?: string | null
  /** Taken back by whoever asked, before approval (`status` is then `rejected`). */
  withdrawn?: boolean
  decidedAt?: unknown
  /** A PM 1.0 request's own lines — Inventory's reply on each says what it issued from stock. */
  lines?: ProjectRequestLine[]
  /** A line's own RFQ and order, by its index in `lines`. */
  lineLinks?: Record<string, { rfqId?: string | null; rfqNumber?: string | null; poId?: string | null; poNumber?: string | null }> | null
}

const received = (l: ProjectRequestLine) => (l.receipts || []).reduce((a, x) => a + (Number(x.q) || 0), 0)

/** What a line asks Procurement for. What Inventory issued from stock is not
 * bought: a line it answered «issue» leaves only what it kept (0 for a full
 * issue); «none» leaves the whole line. Once the line was closed it is what
 * arrived — less what arrived from the store, counted as pm/supply.ts counts it
 * (a receipt that names no portion is the store's issue first). */
function toSource(l: ProjectRequestLine): number {
  const issued = l.inv?.k === "issue" ? Math.max(0, Number(l.inv.q) || 0) : 0
  if (!l.cl) return l.inv?.k === "issue" ? Math.max(0, Number(l.inv.kept) || 0) : Number(l.qty) || 0
  const sum = (src: string | null) => (l.receipts || []).filter((x) => (x.src ?? null) === src).reduce((a, x) => a + (Number(x.q) || 0), 0)
  return Math.round((sum("buy") + Math.max(0, sum(null) - Math.max(0, issued - sum("stk")))) * 1000) / 1000
}

/** The request line behind each of `items`, by index, with its place in `lines`. `items` is written from the
 * lines in order (pm/supply.ts `procurementItems`: not a change still held or
 * refused, not one added after sourcing, nothing for a line closed with nothing
 * in) — the same walk reads them back, so two lines of one material on two BOQ
 * items each keep their own reply from Inventory. */
function linesOfItems(pr: ProjectRequestDoc): Array<{ line: ProjectRequestLine; index: number } | null> {
  const lines = (pr.lines || []).map((line, index) => ({ line, index })).filter(({ line: l }) => l.chg?.st !== "wait" && l.chg?.st !== "no" && !l.late && !(l.cl && !(received(l) > 0)))
  let at = 0
  return (pr.items || []).map((i) => {
    const want = materialKey(i.name, i.unit)
    const hit = lines.findIndex(({ line: l }, k) => k >= at && materialKey(l.name, l.unit) === want && (!i.itemId || l.itemId === i.itemId))
    if (hit < 0) return null
    at = hit + 1
    return lines[hit]
  })
}

const iso = (v: unknown): string => {
  if (typeof v === "string") return v
  const t = v as { toDate?: () => Date } | null
  return t && typeof t.toDate === "function" ? t.toDate().toISOString() : ""
}

/** A line of the request added after it was sourced (a change the manager
 * decided late): a new line to buy. It answers to its own RFQ and order
 * (`lineLinks`), never to the request's. */
function addedNeeds(base: Need, pr: ProjectRequestDoc): Need[] {
  if (pr.status !== "approved") return []
  const out: Need[] = []
  ;(pr.lines || []).forEach((l, index) => {
    if (!l.late || l.chg?.st === "wait" || l.chg?.st === "no") return
    const quantity = toSource(l)
    const name = (l.name || "").trim()
    if (!name || !(quantity > 0)) return
    const link = pr.lineLinks?.[String(index)] ?? null
    const line: NeedLine = { name, unit: (l.unit || "").trim(), quantity }
    if (l.itemId) line.itemId = l.itemId
    out.push({
      ...base,
      key: `${base.key}:L${index}`,
      state: link?.poId ? "order" : link?.rfqId ? "rfq" : "action",
      lines: [line],
      at: l.late.on || base.at,
      rfqId: link?.rfqId ?? null,
      rfqNumber: link?.rfqNumber ?? null,
      poId: link?.poId ?? null,
      poNumber: link?.poNumber ?? null,
      endNote: null,
      endKind: null,
      waitingOn: null,
      source: { ...base.source, line: index },
      mfgRequestId: null,
      decision: null,
      withdrawal: null,
      projectChanges: requestChanges(pr, index),
    })
  })
  return out
}

/**
 * What reaches Procurement (PUR-01): a PM 1.0 request only once its project manager approved it
 * technically. Pending, withdrawn or rejected before then, it is the project's business and never
 * shows here (before 20 Oct 2026 a pending one was shown read-only, and a withdrawn one as «أُلغي»).
 * A legacy request (no `pm`) travels as it always did.
 */
export const reachesProcurement = (pr: Pick<ProjectRequestDoc, "pm" | "status">): boolean => !pr.pm || pr.status === "approved"

/** The request's own number, as the project wrote it: «MR 03» for a PM 1.0 request (shown «ط.م 03»,
 * `displayNeedRef`), the older «PR-…» for a legacy one. One number in both modules. */
export const projectRequestRef = (pr: Pick<ProjectRequestDoc, "id" | "pm">, legacyRef: (id: string) => string): string => (pr.pm ? `MR ${pr.id}` : legacyRef(pr.id))

export function projectNeed(project: { id: string; name: string }, pr: ProjectRequestDoc, ref: string): Need {
  // A PM request is born awaiting the project manager's TECHNICAL approval (REQ-02) and reaches
  // Procurement only once approved (`reachesProcurement`): until then it is the project's business.
  const unapproved = Boolean(pr.pm) && pr.status === "pending"
  const behind = linesOfItems(pr)
  const requestLevel = Boolean(pr.rfqId || pr.poId)
  const itemLines = (pr.items || [])
    .map((i, k) => {
      const own = behind[k]
      const l: NeedLine = { name: (i.name || "").trim(), unit: (i.unit || "").trim(), quantity: own?.line.inv?.k === "issue" ? toSource(own.line) : Number(i.quantity) || 0 }
      if (i.category) l.category = i.category
      if (i.samplePending) l.samplePending = true
      if (i.itemId) l.itemId = i.itemId
      if (i.material) l.material = i.material
      if (i.needBy) l.needBy = i.needBy.slice(0, 10)
      if (pr.pm && own) {
        l.requestLine = own.index
        const link = requestLevel ? null : pr.lineLinks?.[String(own.index)]
        if (link && (link.rfqId || link.poId)) l.link = { rfqId: link.rfqId ?? null, rfqNumber: link.rfqNumber ?? null, poId: link.poId ?? null, poNumber: link.poNumber ?? null }
      }
      return l
    })
    .filter((l) => l.name && l.quantity > 0)
  // The project withdrew every line after approval: nothing is left in `items`, so the request is read back from its lines.
  const gone = wholeWithdrawal(pr)
  const inHand = requestLevel || Boolean(pr.mfgRequestId) || Object.entries(pr.lineLinks || {}).some(([i, v]) => !pr.lines?.[Number(i)]?.late && Boolean(v?.rfqId || v?.poId))
  const withdrawnEarly = Boolean(gone) && !inHand
  const lines: NeedLine[] = gone
    ? (pr.lines || []).flatMap((l, index) => (l.late || l.chg?.st === "wait" || l.chg?.st === "no" || !(l.name || "").trim() || !(Number(l.qty) > 0) ? [] : [{ name: (l.name || "").trim(), unit: (l.unit || "").trim(), quantity: Number(l.qty) || 0, ...(l.itemId ? { itemId: l.itemId } : {}), requestLine: index }]))
    : itemLines
  const allLinked = lines.length > 0 && lines.every((l) => l.link)
  const firstLink = lines.find((l) => l.link)?.link ?? null
  const decision = pr.procDecision ?? null
  const proceeded = decision?.kind === "proceed_short" || decision?.kind === "proceed_full"
  let state: NeedState = "action"
  let waitingOn: Need["waitingOn"] = null
  if (withdrawnEarly) state = "done"
  else if (pr.status === "rejected") state = "done"
  else if (unapproved) {
    state = "waiting"
    waitingOn = "project"
  } else if (pr.status !== "approved" && !(proceeded && pr.status === "pending")) {
    state = "waiting"
    waitingOn = "warehouse"
  } else if (pr.poId) state = "order"
  else if (pr.rfqId) state = "rfq"
  else if (allLinked) state = lines.every((l) => l.link?.poId) ? "order" : "rfq"
  else if (pr.mfgRequestId && decision?.kind !== "buy") {
    state = "waiting"
    waitingOn = "workshop"
  }
  const legacyWithdrawn = pr.status === "rejected" && Boolean(pr.withdrawn)
  const withdrawal = withdrawnEarly ? gone : legacyWithdrawn ? { on: iso(pr.decidedAt).slice(0, 10) || null, byName: pr.decidedByUserName ?? null } : null
  const changes = withdrawnEarly ? [] : requestChanges(pr)
  const need: Need = {
    ...blank,
    key: `project:${project.id}:${pr.id}`,
    kind: "project",
    state,
    lines,
    needBy: pr.needBy ? pr.needBy.slice(0, 10) : null,
    requestedBy: pr.requestedByUserName || "",
    at: iso(pr.createdAt),
    refLabel: ref,
    context: pr.title ? `${project.name} · ${pr.title}` : project.name,
    note: pr.notes || null,
    rfqId: pr.rfqId ?? (allLinked ? firstLink?.rfqId ?? null : null),
    rfqNumber: pr.rfqNumber ?? (allLinked ? firstLink?.rfqNumber ?? null : null),
    poId: pr.poId ?? (allLinked ? firstLink?.poId ?? null : null),
    poNumber: pr.poNumber ?? (allLinked ? firstLink?.poNumber ?? null : null),
    endNote: withdrawal ? withdrawal.byName : pr.status === "rejected" ? pr.decidedByUserName ?? null : null,
    endKind: withdrawal ? "withdrawn" : pr.status === "rejected" ? "refused" : null,
    waitingOn,
    projectId: project.id,
    projectName: project.name,
    source: { kind: "project_request", projectId: project.id, purchaseRequestId: pr.id },
    ownerId: project.id,
    mfgRequestId: pr.mfgRequestId ?? null,
    decision,
    approved: pr.pm && pr.status === "approved" ? { name: pr.approvedByName || pr.decidedByUserName || "", on: pr.approvedOn || "" } : null,
    withdrawal,
    ...(changes.length ? { projectChanges: changes } : {}),
  }
  const added = addedNeeds(need, pr)
  return added.length ? { ...need, added } : need
}

/**
 * What comes back to the desk from a project request already in hand.
 *
 * What an order gave back: a project request is `order` while its order lives,
 * but a quantity cancelled on that order — its remainder with the supplier, or
 * rejects the order was reduced by — is owed to the site again («يعود المتبقي
 * إلى «الاحتياج»»). Each such request yields one more `action` need for those
 * quantities, matched to the order's lines by material and unit.
 *
 * And what the project added to it: a line decided after the request was
 * sourced (`Need.added`) is a need of its own, whatever state the request is in.
 */
export function returnedNeeds(needs: Need[], orders: PurchaseOrder[]): Need[] {
  const byId = new Map(orders.map((o) => [o.id, o]))
  const out: Need[] = needs.flatMap((n) => n.added ?? [])
  for (const n of needs) {
    if (n.kind !== "project" || n.state !== "order" || !n.poId) continue
    const po = byId.get(n.poId)
    if (!po) continue
    const lines = n.lines
      .map((l) => {
        const cancelled = po.lines.filter((pl) => nameKey(pl.name) === nameKey(l.name) && (pl.unit || "").trim() === l.unit).reduce((a, pl) => a + (Number(pl.cancelled) || 0), 0)
        return { ...l, quantity: Math.min(l.quantity, Math.round(cancelled * 100) / 100) }
      })
      .filter((l) => l.quantity > 0)
    if (!lines.length) continue
    out.push({ ...n, key: `${n.key}:returned:${po.id}`, state: "action", lines, rfqId: null, rfqNumber: null, poId: null, poNumber: null, returnedFrom: po.docNumber })
  }
  return out
}

// ── The award: which order answers a project's request ─────────────────────

/** The RFQ as the award reads its needs: the links (`rfq-view.ts`), and enough of
 * each line to recognise the material it asks for. */
export interface AwardedRfq extends NeedLinkedRfq {
  products?: Array<(NonNullable<NonNullable<NeedLinkedRfq["products"]>[number]> & { name?: string | null; description?: string | null; unitOfMeasure?: string | null; unit?: string | null }) | null> | null
}

export interface ServedRequest {
  projectId: string
  purchaseRequestId: string
  /** The one line the RFQ answers, when it was sourced apart from its request. */
  line: number | null
}

/** One order of the award, with the RFQ lines it carries (null = all of them). */
export interface AwardedOrder {
  id: string
  docNumber: string
  products: number[] | null
}

/** The project requests an RFQ answers — its own source, the needs picked on
 * the form, a line's own — each once. */
export function rfqProjectRequests(rfq: NeedLinkedRfq): ServedRequest[] {
  const out = new Map<string, ServedRequest>()
  for (const src of rfqNeedSources(rfq)) {
    if (src.kind !== "project_request" || !src.projectId || !src.purchaseRequestId) continue
    const line = (src as NeedSource).line ?? null
    out.set(`${src.projectId}/${src.purchaseRequestId}/${line ?? ""}`, { projectId: src.projectId, purchaseRequestId: src.purchaseRequestId, line })
  }
  return [...out.values()]
}

/**
 * What the award writes on a project request its RFQ answered: the order that
 * now carries it — without which the project's line stays "an RFQ is out" for
 * ever and can never be received. Null when there is nothing to write: the
 * request has moved on (another RFQ answers it, or it already names an order),
 * or none of its lines was awarded.
 *
 * A split award gives one request's lines to several suppliers: the request
 * names the first order, and a line another order carries names its own
 * (`lineLinks`) — recognised by its material, read off the RFQ line's
 * description or name, since an RFQ line does not say which request line it is.
 * A line that cannot be told apart stays under the request's order.
 */
export function awardLinkPatch(rfqId: string, rfq: AwardedRfq, served: ServedRequest, request: ProjectRequestDoc, orders: AwardedOrder[]): Record<string, string> | null {
  const products = rfq.products || []
  const answers = (index: number) => {
    const src = lineNeed(rfq, index)?.source
    return src?.kind === "project_request" && src.projectId === served.projectId && src.purchaseRequestId === served.purchaseRequestId && ((src as NeedSource).line ?? null) === served.line
  }
  const carrying = orders.filter((o) => o.products === null || !products.length || o.products.some(answers))
  if (!carrying.length) return null
  const [first, ...others] = carrying
  if (served.line != null) {
    const own = request.lineLinks?.[String(served.line)]
    if (own?.rfqId !== rfqId || own.poId) return null
    return { [`lineLinks.${served.line}.poId`]: first.id, [`lineLinks.${served.line}.poNumber`]: first.docNumber }
  }
  if (request.rfqId !== rfqId || request.poId) return null
  const patch: Record<string, string> = { poId: first.id, poNumber: first.docNumber }
  const carries = (o: AwardedOrder, l: ProjectRequestLine) =>
    (o.products || []).some((index) => {
      const p = products[index]
      const unit = p?.unitOfMeasure || p?.unit
      const want = materialKey(l.name, l.unit)
      return answers(index) && ((Boolean(p?.description) && materialKey(p?.description, unit) === want) || (Boolean(p?.name) && materialKey(p?.name, unit) === want))
    })
  if (others.length)
    (request.lines || []).forEach((l, index) => {
      if (l.late || carries(first, l)) return
      const other = others.find((o) => carries(o, l))
      if (!other) return
      patch[`lineLinks.${index}.poId`] = other.id
      patch[`lineLinks.${index}.poNumber`] = other.docNumber
    })
  return patch
}

// ── A stock gap ────────────────────────────────────────────────────────────

export interface StockGapRow {
  id: string
  warehouseId: string
  warehouseName: string
  name: string
  unit: string
  quantity: number
  minStockLevel?: number | null
}

export interface OpenBuying {
  rfqs: Array<{ id: string; title?: string; status?: string; products?: Array<{ name?: string }> | null }>
  orders: PurchaseOrder[]
}

/** The quantity that brings the item back to twice its minimum — the gap
 * itself, plus a minimum's worth so it does not fall straight back. */
export const gapQuantity = (onHand: number, min: number) => Math.max(0, Math.ceil(2 * min - onHand))

const OPEN_RFQ = new Set(["New", "Draft"])

/** An item at or below its minimum. Nothing is stored on it: it is `rfq` while
 * an open RFQ names the material, `order` while a live order does. */
export function stockNeeds(rows: StockGapRow[], open: OpenBuying): Need[] {
  const rfqByName = new Map<string, { id: string; title: string }>()
  for (const r of open.rfqs) {
    if (!OPEN_RFQ.has(r.status || "")) continue
    for (const p of r.products || []) if (p.name) rfqByName.set(nameKey(p.name), { id: r.id, title: r.title || "" })
  }
  const poByName = new Map<string, PurchaseOrder>()
  for (const po of open.orders) {
    const st = poStatus(po)
    if (st === "received" || st === "closed" || st === "cancelled") continue
    for (const l of po.lines) poByName.set(nameKey(l.name), po)
  }
  return rows
    .filter((r) => typeof r.minStockLevel === "number" && r.name.trim() && r.quantity <= (r.minStockLevel as number))
    .map((r) => {
      const min = r.minStockLevel as number
      const k = nameKey(r.name)
      const po = poByName.get(k)
      const rfq = po ? undefined : rfqByName.get(k)
      return {
        ...blank,
        key: `stock:${r.warehouseId}:${r.id}`,
        kind: "stock" as const,
        state: po ? ("order" as const) : rfq ? ("rfq" as const) : ("action" as const),
        lines: [{ name: r.name.trim(), unit: r.unit, quantity: gapQuantity(r.quantity, min) }],
        requestedBy: "",
        at: "",
        refLabel: r.warehouseName,
        context: "",
        rfqId: rfq?.id ?? null,
        rfqNumber: rfq?.title ?? null,
        poId: po?.id ?? null,
        poNumber: po?.docNumber ?? null,
        source: { kind: "stock_gap", warehouseId: r.warehouseId, itemId: r.id },
        stock: { onHand: r.quantity, min },
        ownerId: r.warehouseId,
      }
    })
}

/** Soonest need-by first (none last), then oldest request. */
export function sortNeeds(needs: Need[]): Need[] {
  return [...needs].sort((a, b) => (a.needBy || "9999").localeCompare(b.needBy || "9999") || (a.at || "").localeCompare(b.at || ""))
}

export function needCounts(needs: Need[]): Record<NeedState | "all", number> {
  const out = { action: 0, waiting: 0, rfq: 0, order: 0, done: 0, all: needs.length }
  for (const n of needs) out[n.state]++
  return out
}

// ── The `?source=` an RFQ or an order is started with ─────────────────────

/** `prj:<project>:<request>` (`…:L<line>` for a line sourced apart) ·
 * `stock:<warehouse>:<item>` · `<workOrder>:<request>` (the older form, a work
 * order's shortfall). */
export function needSourceParam(s: Need["source"]): string {
  if (s.kind === "project_request") return `prj:${s.projectId}:${s.purchaseRequestId}${s.line == null ? "" : `:L${s.line}`}`
  if (s.kind === "stock_gap") return `stock:${s.warehouseId}:${s.itemId}`
  if (s.kind === "team_request") return `team:${s.purchaseRequestId}`
  return `${s.workOrderId}:${s.purchaseRequestId}`
}

export function parseNeedSource(raw: string | null | undefined): Need["source"] | null {
  const parts = (raw || "").split(":")
  if (parts[0] === "prj" && parts.length === 4 && parts[1] && parts[2] && /^L\d+$/.test(parts[3])) return { kind: "project_request", projectId: parts[1], purchaseRequestId: parts[2], line: Number(parts[3].slice(1)) }
  if (parts[0] === "prj" && parts.length === 3 && parts[1] && parts[2]) return { kind: "project_request", projectId: parts[1], purchaseRequestId: parts[2] }
  if (parts[0] === "stock" && parts.length === 3 && parts[1] && parts[2]) return { kind: "stock_gap", warehouseId: parts[1], itemId: parts[2] }
  if (parts[0] === "team" && parts.length === 2 && parts[1]) return { kind: "team_request", purchaseRequestId: parts[1] }
  if (parts.length === 2 && parts[0] && parts[1]) return { kind: "mfg_purchase", workOrderId: parts[0], purchaseRequestId: parts[1] }
  return null
}

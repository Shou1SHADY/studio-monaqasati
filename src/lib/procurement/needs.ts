// Every need that reaches Purchasing, in one shape (PRD 3.0 §7.2, the requests
// tab): a work order's material shortfall, a project's internal purchase
// request, and a stock item at or below its minimum. Each keeps its own home
// and its own writes; this file only reads them and says, the same way for
// all three, what state the need is in. Pure.

import { foldSearchText } from "../search-text"
import type { PurchaseRequestRecord } from "../manufacturing-engine"
import { poStatus } from "./po"
import type { PurchaseOrder } from "./types"

export type NeedKind = "mfg" | "project" | "stock"

/** action = Purchasing's move · waiting = another module's · rfq / order = in
 * hand · done = arrived, sent back or refused. */
export type NeedState = "action" | "waiting" | "rfq" | "order" | "done"
export const NEED_STATES: NeedState[] = ["action", "waiting", "rfq", "order", "done"]

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
  endKind: "arrived" | "sent_back" | "refused" | null
  waitingOn: "warehouse" | "workshop" | null
  projectId: string | null
  projectName: string | null
  /** Carried onto the RFQ and the order, so the need can be closed from them. */
  source: NonNullable<PurchaseOrder["purchaseSource"]>
  stock: { onHand: number; min: number } | null
  /** The work order (mfg) or the project (project) it belongs to, for its link. */
  ownerId: string
  /** The manufacturing request a project need was routed to, if any. */
  mfgRequestId: string | null
  decision: ProcDecision | null
  /** The order whose cancelled quantity came back to the desk (`returnedNeeds`). */
  returnedFrom?: string | null
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

export interface ProjectRequestDoc {
  id: string
  title?: string
  items?: Array<{ name?: string; quantity?: string | number; unit?: string; category?: string | null; samplePending?: boolean | null; needBy?: string | null; itemId?: string | null }>
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
  /** A PM 1.0 request's own lines — Inventory's reply on each says what it issued from stock. */
  lines?: Array<{ name?: string; unit?: string; inv?: { k?: string; kept?: number | null } | null }>
}

const lineKey = (name: string | undefined, unit: string | undefined) => `${(name || "").trim().toLowerCase()}|${(unit || "").trim().toLowerCase()}`

/** What Inventory issued from stock is not bought: a line it answered «issue» leaves only
 * what it kept (0 for a full issue); «none» leaves the whole line to Procurement. */
function stockAdjusted(pr: ProjectRequestDoc): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of pr.lines || []) {
    if (l.inv?.k === "issue") out.set(lineKey(l.name, l.unit), Math.max(0, Number(l.inv.kept) || 0))
  }
  return out
}

const iso = (v: unknown): string => {
  if (typeof v === "string") return v
  const t = v as { toDate?: () => Date } | null
  return t && typeof t.toDate === "function" ? t.toDate().toISOString() : ""
}

export function projectNeed(project: { id: string; name: string }, pr: ProjectRequestDoc, ref: string): Need {
  const issued = stockAdjusted(pr)
  const lines = (pr.items || [])
    .map((i) => {
      const kept = issued.get(lineKey(i.name, i.unit))
      const l: NeedLine = { name: (i.name || "").trim(), unit: (i.unit || "").trim(), quantity: kept ?? (Number(i.quantity) || 0) }
      if (i.category) l.category = i.category
      if (i.samplePending) l.samplePending = true
      if (i.itemId) l.itemId = i.itemId
      if (i.needBy) l.needBy = i.needBy.slice(0, 10)
      return l
    })
    .filter((l) => l.name && l.quantity > 0)
  const decision = pr.procDecision ?? null
  const proceeded = decision?.kind === "proceed_short" || decision?.kind === "proceed_full"
  let state: NeedState = "action"
  let waitingOn: Need["waitingOn"] = null
  if (pr.status === "rejected") state = "done"
  else if (pr.status !== "approved" && !(proceeded && pr.status === "pending")) {
    state = "waiting"
    waitingOn = "warehouse"
  } else if (pr.poId) state = "order"
  else if (pr.rfqId) state = "rfq"
  else if (pr.mfgRequestId && decision?.kind !== "buy") {
    state = "waiting"
    waitingOn = "workshop"
  }
  return {
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
    rfqId: pr.rfqId ?? null,
    rfqNumber: pr.rfqNumber ?? null,
    poId: pr.poId ?? null,
    poNumber: pr.poNumber ?? null,
    endNote: pr.status === "rejected" ? pr.decidedByUserName ?? null : null,
    endKind: pr.status === "rejected" ? "refused" : null,
    waitingOn,
    projectId: project.id,
    projectName: project.name,
    source: { kind: "project_request", projectId: project.id, purchaseRequestId: pr.id },
    ownerId: project.id,
    mfgRequestId: pr.mfgRequestId ?? null,
    decision,
  }
}

/**
 * What an order gave back: a project request is `order` while its order lives,
 * but a quantity cancelled on that order — its remainder with the supplier, or
 * rejects the order was reduced by — is owed to the site again («يعود المتبقي
 * إلى «الاحتياج»»). Each such request yields one more `action` need for those
 * quantities, matched to the order's lines by material and unit.
 */
export function returnedNeeds(needs: Need[], orders: PurchaseOrder[]): Need[] {
  const byId = new Map(orders.map((o) => [o.id, o]))
  const out: Need[] = []
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

/** `prj:<project>:<request>` · `stock:<warehouse>:<item>` · `<workOrder>:<request>`
 * (the older form, a work order's shortfall). */
export function needSourceParam(s: Need["source"]): string {
  if (s.kind === "project_request") return `prj:${s.projectId}:${s.purchaseRequestId}`
  if (s.kind === "stock_gap") return `stock:${s.warehouseId}:${s.itemId}`
  return `${s.workOrderId}:${s.purchaseRequestId}`
}

export function parseNeedSource(raw: string | null | undefined): Need["source"] | null {
  const parts = (raw || "").split(":")
  if (parts[0] === "prj" && parts.length === 3 && parts[1] && parts[2]) return { kind: "project_request", projectId: parts[1], purchaseRequestId: parts[2] }
  if (parts[0] === "stock" && parts.length === 3 && parts[1] && parts[2]) return { kind: "stock_gap", warehouseId: parts[1], itemId: parts[2] }
  if (parts.length === 2 && parts[0] && parts[1]) return { kind: "mfg_purchase", workOrderId: parts[0], purchaseRequestId: parts[1] }
  return null
}

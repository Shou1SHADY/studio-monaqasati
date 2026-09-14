// Manufacturing screen model — what every Manufacturing screen shows about a
// work order, derived once from the engine.
//
// The engine (manufacturing-engine.ts) answers single questions: how much is in
// this department's hands, is this step blocked, what does it cost. A screen
// needs the same dozen answers for every order at once — its state, where it
// is, whether it will make its date, what it is worth — and the Today queue,
// the orders table, the shop-floor board and the order drawer must never
// disagree about them. So they are computed here, in one pure pass, and each
// screen only formats. No Firestore, no React, no strings: labels are the
// caller's translation keys.

import {
  activeIndexes,
  atSiteQty,
  bottleneck as engineBottleneck,
  brokenUndecided,
  currentIndex,
  daysFrom,
  addDaysISO,
  deliveredQty,
  hoursTotal,
  isDoneV2,
  labourCostOf,
  materialCostOf,
  materialState,
  overheadCostOf,
  pendingAt,
  readyQty,
  rejectedTotal,
  releaseBlocks,
  round2,
  scrapApprovedQty,
  scrapPendingQty,
  shippedQty,
  standardCost,
  stationBlocks,
  wipQty,
  type Block,
  type DeptCapacityFields,
  type MfgNoteSlice,
  type MfgOrderSlice,
  type MfgProduct,
  type MfgSettings,
  type ScheduleInput,
  type ScheduleResult,
  type StationMaterialState,
} from "./manufacturing-engine"
import type { DeliveryNote } from "./delivery-notes"
import { toNoteSlice, toOrderSlice, type WorkOrderV2 } from "./manufacturing-writes"

// ---------------------------------------------------------------------------
// One order
// ---------------------------------------------------------------------------

/** The one-phrase answer to "where is this order?" — in priority order. */
export type OrderStateKey =
  | "cancelled"
  | "done"
  | "blocked"
  | "awaiting_release"
  | "at_department"
  | "awaiting_qc"
  | "in_transit"
  | "breakage"
  | "ready"
  | "idle"

export type OrderSourceKind = "project" | "quotation" | "stock"

export interface OrderView {
  id: string
  order: WorkOrderV2
  product: MfgProduct
  slice: MfgOrderSlice
  notes: DeliveryNote[]
  noteSlices: MfgNoteSlice[]
  number: number
  quantity: number
  unit: string

  released: boolean
  done: boolean
  cancelled: boolean
  /** Open and not yet fully delivered — released or not. */
  live: boolean

  delivered: number
  shipped: number
  ready: number
  wip: number
  rejected: number
  scrapApproved: number
  scrapPending: number
  broken: number
  atSite: number
  shortfall: number
  hours: number

  /** First step holding quantity, -1 when none does. */
  current: number
  /** Every step holding quantity — an order can be in several at once. */
  active: number[]
  state: OrderStateKey
  /** Set when the state is `at_department`. */
  stateDepartmentId: string | null

  releaseBlocks: Block[]
  /** Blocks on the current step. */
  currentBlocks: Block[]
  /** The current step is stopped by a hard gate (drawing, slab). */
  hardBlocked: boolean

  sourceKind: OrderSourceKind
  /** Project name, client name, or empty for stock production. */
  sourceName: string
  quotationNumber: string | null

  neededBy: string | null
  schedule: ScheduleResult | null
  /** ISO date the capacity model says it can be finished, when time is on. */
  possibleDate: string | null
  /** Past its needed date and not done. */
  overdue: boolean
  /** Capacity says it finishes after its needed date. */
  willMiss: boolean
  late: boolean
  /** Days past the needed date (overdue) or days the possible date overshoots it. */
  lateDays: number
  rush: boolean
}

function sourceOf(order: WorkOrderV2): { kind: OrderSourceKind; name: string } {
  if (order.source?.kind === "quotation" || order.source?.quotationId || order.source?.quotationNumber) {
    // A quotation-born order without a client name still names its quote — never "stock".
    return { kind: "quotation", name: order.source?.contactName || order.source?.quotationNumber || "" }
  }
  if (order.projectId || order.projectName) return { kind: "project", name: order.projectName || "" }
  return { kind: "stock", name: "" }
}

export function buildOrderView(
  order: WorkOrderV2,
  product: MfgProduct,
  notes: DeliveryNote[],
  schedule: ScheduleResult | null,
  today: string,
  timeOn: boolean
): OrderView {
  const slice = toOrderSlice(order)
  const noteSlices = notes.map(toNoteSlice)
  const route = product.route
  const released = slice.releasedAt != null
  const cancelled = order.status === "cancelled"
  const done = order.status === "done" || isDoneV2(slice, route, noteSlices)
  const live = !cancelled && !done

  const delivered = deliveredQty(noteSlices)
  const shipped = shippedQty(noteSlices)
  const ready = readyQty(slice, route, noteSlices)
  const wip = wipQty(slice, route)
  const rejected = rejectedTotal(slice)
  const broken = brokenUndecided(slice, noteSlices)
  const current = currentIndex(slice, route, noteSlices)
  const active = activeIndexes(slice, route, noteSlices)
  const rBlocks = released ? [] : releaseBlocks(slice, product)
  const cBlocks = current >= 0 ? stationBlocks(slice, product, route, current) : []

  let state: OrderStateKey
  if (cancelled) state = "cancelled"
  else if (done) state = "done"
  else if (!released) state = rBlocks.length ? "blocked" : "awaiting_release"
  else if (current >= 0) state = "at_department"
  else if (rejected > 0) state = "awaiting_qc"
  else if (shipped > 0) state = "in_transit"
  else if (broken > 0 && ready === 0) state = "breakage"
  else if (ready > 0) state = "ready"
  else state = "idle"

  const src = sourceOf(order)
  const neededBy = slice.neededBy ? slice.neededBy.slice(0, 10) : null
  const possibleDate = timeOn && schedule ? addDaysISO(today, schedule.finishDays) : null
  const overdue = live && released && !!neededBy && neededBy < today
  const willMiss = live && timeOn && !!schedule && !!neededBy && daysFrom(today, neededBy) < schedule.finishDays
  const lateDays = overdue
    ? daysFrom(neededBy!, today)
    : willMiss && possibleDate && neededBy
      ? daysFrom(neededBy, possibleDate)
      : 0

  return {
    id: order.id,
    order,
    product,
    slice,
    notes,
    noteSlices,
    number: order.orderNumber,
    quantity: slice.quantity,
    unit: product.unit,
    released,
    done,
    cancelled,
    live,
    delivered,
    shipped,
    ready,
    wip,
    rejected,
    scrapApproved: scrapApprovedQty(slice),
    scrapPending: scrapPendingQty(slice),
    broken,
    atSite: atSiteQty(slice, route, noteSlices),
    shortfall: slice.shortfall || 0,
    hours: hoursTotal(slice),
    current,
    active,
    state,
    stateDepartmentId: state === "at_department" ? route[current]?.departmentId ?? null : null,
    releaseBlocks: rBlocks,
    currentBlocks: cBlocks,
    hardBlocked: cBlocks.some((b) => b.severity === "hard"),
    sourceKind: src.kind,
    sourceName: src.name,
    quotationNumber: order.source?.quotationNumber ?? null,
    neededBy,
    schedule,
    possibleDate,
    overdue,
    willMiss,
    late: overdue || willMiss,
    lateDays: Math.max(0, lateDays),
    rush: !!slice.rush,
  }
}

export interface OrderViewSource {
  v2Orders: WorkOrderV2[]
  productById: Map<string, MfgProduct>
  notesByOrder: Map<string, DeliveryNote[]>
  schedule: Map<string, ScheduleResult>
  settings: Pick<MfgSettings, "features">
}

export function buildOrderViews(src: OrderViewSource, today: string): OrderView[] {
  const out: OrderView[] = []
  for (const order of src.v2Orders) {
    const product = src.productById.get(order.productId || "")
    if (!product) continue
    out.push(
      buildOrderView(
        order,
        product,
        src.notesByOrder.get(order.id) || [],
        src.schedule.get(order.id) || null,
        today,
        src.settings.features.time
      )
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// Lists: segments, search, ordering
// ---------------------------------------------------------------------------

export type OrderSegment = "live" | "release" | "late" | "done" | "all"
export const ORDER_SEGMENTS: OrderSegment[] = ["live", "release", "late", "done", "all"]

export function inSegment(v: OrderView, segment: OrderSegment): boolean {
  switch (segment) {
    case "live":
      return v.live && v.released
    case "release":
      return v.live && !v.released
    case "late":
      return v.live && v.late
    case "done":
      return v.done
    case "all":
      return !v.cancelled
  }
}

export function segmentCounts(views: OrderView[]): Record<OrderSegment, number> {
  const c: Record<OrderSegment, number> = { live: 0, release: 0, late: 0, done: 0, all: 0 }
  for (const v of views) for (const s of ORDER_SEGMENTS) if (inSegment(v, s)) c[s] += 1
  return c
}

/** Order number (with or without "#"), product, client/project, quote number. */
export function matchesSearch(v: OrderView, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "")
  if (!q) return true
  return [String(v.number), v.product.name, v.sourceName, v.quotationNumber || "", v.order.title || ""]
    .join(" ")
    .toLowerCase()
    .includes(q)
}

/** Rush first, then the earliest need, then the newest order. */
export function compareOrders(a: OrderView, b: OrderView): number {
  if (a.rush !== b.rush) return a.rush ? -1 : 1
  const an = a.neededBy || "9999-12-31"
  const bn = b.neededBy || "9999-12-31"
  if (an !== bn) return an < bn ? -1 : 1
  return b.number - a.number
}

// ---------------------------------------------------------------------------
// Headline figures — three, not five
// ---------------------------------------------------------------------------

export interface MfgKpis {
  liveCount: number
  wipUnits: number
  lateCount: number
  readyUnits: number
  readyOrders: number
  bottleneck: { departmentId: string; days: number } | null
}

export function computeKpis(views: OrderView[], inputs: ScheduleInput[], departments: DeptCapacityFields[], timeOn: boolean): MfgKpis {
  const live = views.filter((v) => v.live && v.released)
  const ready = views.filter((v) => v.ready > 0)
  const bn = timeOn ? engineBottleneck(inputs, departments) : null
  return {
    liveCount: live.length,
    wipUnits: round2(live.reduce((a, v) => a + v.wip, 0)),
    lateCount: views.filter((v) => v.live && v.late).length,
    readyUnits: round2(ready.reduce((a, v) => a + v.ready, 0)),
    readyOrders: ready.length,
    bottleneck: bn && bn.days > 0 ? bn : null,
  }
}

// ---------------------------------------------------------------------------
// The shop floor — what each department holds
// ---------------------------------------------------------------------------

export interface DepartmentCard {
  view: OrderView
  /** Index of the department in the order's route. */
  index: number
  inHand: number
  materialState: StationMaterialState
  hardBlocked: boolean
}

export function cardsAtDepartment(views: OrderView[], departmentId: string): DepartmentCard[] {
  const out: DepartmentCard[] = []
  for (const v of views) {
    if (!v.live || !v.released) continue
    const route = v.product.route
    route.forEach((step, i) => {
      if (step.departmentId !== departmentId) return
      const inHand = pendingAt(v.slice, route, i, v.noteSlices)
      if (inHand <= 0) return
      out.push({
        view: v,
        index: i,
        inHand,
        materialState: materialState(v.slice, v.product, route, i),
        hardBlocked: stationBlocks(v.slice, v.product, route, i).some((b) => b.severity === "hard"),
      })
    })
  }
  return out.sort((a, b) => compareOrders(a.view, b.view))
}

/** Product families that actually have products — the production lines. */
export function productionLines(products: MfgProduct[]): Array<{ family: MfgProduct["family"]; departmentIds: string[] }> {
  const byFamily = new Map<MfgProduct["family"], string[]>()
  for (const p of products) {
    const ids = byFamily.get(p.family) || []
    for (const r of p.route || []) if (!ids.includes(r.departmentId)) ids.push(r.departmentId)
    byFamily.set(p.family, ids)
  }
  return Array.from(byFamily, ([family, departmentIds]) => ({ family, departmentIds }))
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export interface OrderMoney {
  materials: number
  labour: number
  overhead: number
  total: number
  materialsAllPriced: boolean
  standard: number
  /** Sale value for a quotation order, the approved estimate for the rest. */
  value: number | null
  valueKind: "sale" | "estimate" | null
  /** value − total, when a value is known. */
  difference: number | null
  marginPercent: number | null
}

export function orderMoney(v: OrderView, departments: DeptCapacityFields[], settings: MfgSettings): OrderMoney {
  const mat = materialCostOf(v.slice)
  const labour = settings.features.time ? labourCostOf(v.slice, v.product.route, departments, settings) : 0
  const overhead = settings.features.time ? overheadCostOf(v.slice, settings) : 0
  const total = round2(mat.cost + labour + overhead)
  const sale = v.product.salePrice != null ? v.product.salePrice * v.quantity : null
  const estimate = v.product.estimateValue != null ? v.product.estimateValue * v.quantity : null
  const [value, valueKind] =
    v.sourceKind === "quotation" && sale != null ? [sale, "sale" as const] : estimate != null ? [estimate, "estimate" as const] : sale != null ? [sale, "sale" as const] : [null, null]
  return {
    materials: round2(mat.cost),
    labour: round2(labour),
    overhead: round2(overhead),
    total,
    materialsAllPriced: mat.allPriced,
    standard: standardCost(v.product, departments, settings, v.quantity).total,
    value: value == null ? null : round2(value),
    valueKind,
    difference: value == null ? null : round2(value - total),
    marginPercent: value ? Math.round(((value - total) / value) * 100) : null,
  }
}

// ---------------------------------------------------------------------------
// The order drawer: where it came from, what went to Finance, what happened
// ---------------------------------------------------------------------------

export type TrailModule = "projects" | "sales" | "manufacturing" | "inventory" | "finance"

export interface TrailItem {
  kind: "request" | "estimate" | "quotation" | "work_order" | "withdrawal" | "delivery_note" | "finance_project" | "finance_client" | "finance_stock"
  ref: string
  module: TrailModule
  tone: "ok" | "warn" | "muted"
  /** A person or place, shown beside the reference. */
  who?: string | null
  quantity?: number
}

type OrderExtras = { mfgRequestId?: string | null; requestedByName?: string | null; estimateId?: string | null }

export function documentTrail(v: OrderView): TrailItem[] {
  const o = v.order as WorkOrderV2 & OrderExtras
  const items: TrailItem[] = []
  if (o.mfgRequestId || o.requestedByName) {
    items.push({ kind: "request", ref: o.mfgRequestId || "", module: v.sourceKind === "quotation" ? "sales" : "projects", tone: "ok", who: o.requestedByName ?? null })
  }
  if (o.estimateId) items.push({ kind: "estimate", ref: o.estimateId, module: "manufacturing", tone: "ok" })
  if (v.quotationNumber) items.push({ kind: "quotation", ref: v.quotationNumber, module: "sales", tone: v.slice.sourceQuotationWon === false ? "warn" : "ok", who: v.sourceName || null })
  items.push({ kind: "work_order", ref: `#${v.number}`, module: "manufacturing", tone: v.done ? "ok" : "warn", who: o.createdByUserName || null })
  const withdrawals = Array.from(new Set(v.slice.materials.map((m) => m.requestNumber)))
  for (const rn of withdrawals) {
    const rows = v.slice.materials.filter((m) => m.requestNumber === rn)
    items.push({ kind: "withdrawal", ref: rn, module: "inventory", tone: rows.every((m) => m.state === "received") ? "ok" : "warn" })
  }
  for (const n of v.notes) {
    items.push({
      kind: "delivery_note",
      ref: n.noteNumber,
      module: "manufacturing",
      tone: n.status === "received" ? "ok" : n.status === "rejected" ? "muted" : "warn",
      who: n.toWarehouseName,
      quantity: n.item.quantity,
    })
  }
  if (v.delivered > 0) {
    const kind = v.notes.some((n) => n.status === "received" && n.toKind === "project")
      ? "finance_project"
      : v.sourceKind === "quotation"
        ? "finance_client"
        : "finance_stock"
    items.push({ kind, ref: "", module: kind === "finance_project" ? "projects" : "finance", tone: "ok", quantity: v.delivered })
  }
  return items
}

export interface FinanceEvent {
  kind: "materials" | "labour" | "scrap_approved" | "scrap_pending" | "note_in_transit" | "delivery_project" | "delivery_stock" | "breakage"
  value: number
  posted: boolean
  ref?: string
  quantity?: number
  reason?: string
}

/** What this order has sent (or not yet sent) to the ledger — events with
 * values, mirroring the posting rules: materials and hours build WIP, an
 * approved scrap leaves it, a received note moves it on. */
export function financeEvents(v: OrderView, departments: DeptCapacityFields[], settings: MfgSettings): FinanceEvent[] {
  const money = orderMoney(v, departments, settings)
  const out: FinanceEvent[] = []
  if (money.materials > 0) out.push({ kind: "materials", value: money.materials, posted: true })
  if (money.labour + money.overhead > 0) out.push({ kind: "labour", value: round2(money.labour + money.overhead), posted: true, quantity: round2(v.hours) })
  for (const s of v.slice.scrap) {
    out.push({ kind: s.status === "approved" ? "scrap_approved" : "scrap_pending", value: s.value, posted: s.status === "approved", quantity: s.quantity, reason: s.reason })
  }
  for (const n of v.notes) {
    if (n.status === "rejected") continue
    const net = round2(n.item.quantity - (n.brokenQuantity || 0))
    const value = round2((n.item.unitCost ?? 0) * net)
    if (n.status === "in_transit") {
      out.push({ kind: "note_in_transit", value: 0, posted: false, ref: n.noteNumber, quantity: n.item.quantity })
      continue
    }
    out.push({ kind: n.toKind === "project" ? "delivery_project" : "delivery_stock", value, posted: true, ref: n.noteNumber, quantity: net })
    if (n.brokenQuantity) {
      out.push({ kind: "breakage", value: round2((n.item.unitCost ?? 0) * n.brokenQuantity), posted: false, ref: n.noteNumber, quantity: n.brokenQuantity })
    }
  }
  return out
}

export type LogKind =
  | "created"
  | "measured"
  | "drawing_approved"
  | "slab_approved"
  | "released"
  | "rushed"
  | "materials_requested"
  | "materials_released"
  | "materials_received"
  | "scrap_raised"
  | "scrap_approved"
  | "note_shipped"
  | "note_received"
  | "note_rejected"

export interface LogItem {
  kind: LogKind
  at: string
  by: string | null
  tone: "ok" | "bad" | "neutral"
  ref?: string
  quantity?: number
  detail?: string | null
}

/** The order's history, newest first, from the timestamps its facts carry. */
export function orderLog(v: OrderView): LogItem[] {
  const o = v.order
  const items: LogItem[] = []
  const push = (item: LogItem | null) => {
    if (item && item.at) items.push(item)
  }
  push({ kind: "created", at: o.createdAtIso || "", by: o.createdByUserName || null, tone: "neutral", quantity: v.quantity })
  if (o.measurement) push({ kind: "measured", at: o.measurement.at, by: o.measurement.by, tone: "ok", detail: o.measurement.note ?? null })
  if (o.drawingApprovalStatus === "approved") push({ kind: "drawing_approved", at: o.drawingApprovedAt || "", by: o.drawingApprovedBy ?? null, tone: "ok" })
  if (o.slabApproval) push({ kind: "slab_approved", at: o.slabApproval.at, by: o.slabApproval.by, tone: "ok", ref: o.slabApproval.lot })
  if (o.releasedAt) push({ kind: "released", at: o.releasedAt, by: o.releasedByName ?? null, tone: o.riskReason ? "bad" : "ok", detail: o.riskReason ?? null })
  if (o.rush) push({ kind: "rushed", at: o.rush.at, by: o.rush.by, tone: "bad", detail: o.rush.reason })
  const byRequest = new Map<string, typeof v.slice.materials>()
  for (const m of v.slice.materials) byRequest.set(m.requestNumber, [...(byRequest.get(m.requestNumber) || []), m])
  for (const [rn, rows] of byRequest) {
    const first = rows[0]
    push({ kind: "materials_requested", at: first.requestedAt, by: first.requestedByName, tone: "neutral", ref: rn, quantity: rows.length })
    const released = rows.find((m) => m.releasedAt)
    if (released) push({ kind: "materials_released", at: released.releasedAt || "", by: released.releasedByName ?? null, tone: "neutral", ref: rn })
    const received = rows.find((m) => m.receivedAt)
    if (received) push({ kind: "materials_received", at: received.receivedAt || "", by: received.receivedByName ?? null, tone: "ok", ref: rn })
  }
  for (const s of v.slice.scrap) {
    push({ kind: "scrap_raised", at: s.raisedAt, by: s.raisedByName, tone: "bad", quantity: s.quantity, detail: s.reason })
    if (s.status === "approved" && s.approvedAt) push({ kind: "scrap_approved", at: s.approvedAt, by: s.approvedByName ?? null, tone: "bad", quantity: s.quantity })
  }
  for (const n of v.notes) {
    push({ kind: "note_shipped", at: n.sentAt, by: n.sentByUserName, tone: "neutral", ref: n.noteNumber, quantity: n.item.quantity, detail: n.toWarehouseName })
    if (n.status === "received" && n.receivedAt) {
      push({ kind: "note_received", at: n.receivedAt, by: n.receivedByUserName ?? null, tone: n.brokenQuantity ? "bad" : "ok", ref: n.noteNumber, quantity: round2(n.item.quantity - (n.brokenQuantity || 0)) })
    }
    if (n.status === "rejected") push({ kind: "note_rejected", at: n.receivedAt || n.sentAt, by: n.receivedByUserName ?? null, tone: "bad", ref: n.noteNumber, detail: n.rejectedReason ?? null })
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

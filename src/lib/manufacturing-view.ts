// Manufacturing screen model — what every screen shows about the workshop,
// derived once from the engine.
//
// Today (per role), the Workshop list and board, the order panel and every
// form must never disagree about an order's state, its next step, whether it
// is late and why, or what it is worth. So all of it is computed here, in one
// pure pass over the live data, and screens only format. No Firestore, no
// React, no strings — labels are the caller's translation keys.

import {
  allocateStock,
  bottleneck,
  candidates,
  daysFrom,
  addDaysISO,
  deptCapacity,
  drawingStateOf,
  estimateExpired,
  hourVariance,
  itemKey,
  orderCost,
  ownsCandidate,
  queueOrder,
  releaseBlocks,
  round2,
  scheduleOrders,
  severityRank,
  shortages,
  stationBlocks,
  stationGate,
  stationQueueDays,
  whyLate,
  type Actor,
  type Allocation,
  type Block,
  type Candidate,
  type CandidateOwner,
  type DeptCapacityFields,
  type ExternalModule,
  type HourVariance,
  type LateReason,
  type LostHours,
  type MfgCostEstimate,
  type MfgNoteSlice,
  type MfgProduct,
  type MfgSettings,
  type OrderCalc,
  type OrderCost,
  type OrderSource,
  type Persona,
  type ScheduleResult,
  type Severity,
  type ShortLine,
  type Stage,
  type StockIndex,
} from "./manufacturing-engine"
import type { DeliveryNote } from "./delivery-notes"
import type { MfgDepartment } from "./manufacturing"
import type { ManufacturingRequest, SalesOrder } from "./sales-orders"
import { awaitsDownPayment } from "./manufacturing-requests"
import { belongsToSalesOrder, calcOf, salesOrderOfWorkOrder, sourceOf, toNoteSlice, type MfgBlockNotice, type MfgStop, type SalesOrderKey, type WorkOrderV2 } from "./manufacturing-writes"

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export interface TeamMember {
  id: string
  name: string
  manage: boolean
  work: boolean
  qc: boolean
  cost: boolean
  view: boolean
}

export interface MfgWorldInput {
  today: string
  nowMs: number
  settings: MfgSettings
  departments: MfgDepartment[]
  products: Map<string, MfgProduct>
  orders: WorkOrderV2[]
  notesByOrder: Map<string, DeliveryNote[]>
  salesOrders: Map<string, SalesOrder>
  stops: MfgStop[]
  notices: MfgBlockNotice[]
  stock: StockIndex | null
}

export interface OrderView {
  id: string
  order: WorkOrderV2
  product: MfgProduct
  calc: OrderCalc
  notes: DeliveryNote[]
  noteSlices: MfgNoteSlice[]
  number: number
  /** WO-2026/057, or #57 for an order from before the yearly sequence. */
  ref: string
  unit: string
  quantity: number
  source: OrderSource
  sourceName: string
  salesOrderNumber: number | null
  stage: Stage
  released: boolean
  done: boolean
  cancelled: boolean
  live: boolean
  releaseBlocks: Block[]
  currentBlocks: Block[]
  hardBlocked: boolean
  neededBy: string | null
  schedule: ScheduleResult | null
  /** Honest possible date — null while short of materials or with time off. */
  possibleDate: string | null
  overdue: boolean
  atRisk: boolean
  late: boolean
  lateDays: number
  rush: boolean
  candidates: Candidate[]
  shortages: ShortLine[]
  /** Open quality notices on a block this order uses. */
  notices: MfgBlockNotice[]
  cost: OrderCost
  variance: HourVariance | null
  lateReason: LateReason | null
}

export interface MfgWorld {
  views: OrderView[]
  viewById: Map<string, OrderView>
  calcs: OrderCalc[]
  alloc: Allocation | null
  lost: LostHours
  schedule: Map<string, ScheduleResult>
}

export function orderRef(o: Pick<WorkOrderV2, "docNumber" | "orderNumber">): string {
  return o.docNumber || `#${o.orderNumber}`
}

export function lostHoursToday(stops: MfgStop[], today: string): LostHours {
  const lost = new Map<string, number>()
  for (const s of stops) if (s.date === today) lost.set(s.departmentId, round2((lost.get(s.departmentId) || 0) + s.hours))
  return lost
}

function sourceNameOf(o: WorkOrderV2): string {
  const s = sourceOf(o)
  if (s === "project") return o.projectName || ""
  if (s === "client") return o.source?.contactName || (o.salesOrderNumber ? `SO-${o.salesOrderNumber}` : o.source?.quotationNumber || "")
  return ""
}

export function buildWorld(input: MfgWorldInput): MfgWorld {
  const lost = lostHoursToday(input.stops, input.today)
  const rows: Array<{ order: WorkOrderV2; product: MfgProduct; notes: DeliveryNote[]; calc: OrderCalc; salesOrder: SalesOrder | null }> = []
  for (const order of input.orders) {
    const product = input.products.get(order.productId || "")
    if (!product) continue
    const notes = input.notesByOrder.get(order.id) || []
    // Named → one lookup; else the sales order born of the same quotation.
    const salesOrder = (order.salesOrderId ? input.salesOrders.get(order.salesOrderId) : salesOrderOfWorkOrder(order, input.salesOrders.values())) ?? null
    rows.push({ order, product, notes, calc: calcOf(order, product, input.departments, notes.map(toNoteSlice), salesOrder), salesOrder })
  }
  const calcs = rows.map((r) => r.calc)
  const alloc = input.stock ? allocateStock(calcs, input.stock) : null
  const timeOn = input.settings.features.time
  const schedule = timeOn ? scheduleOrders(calcs, input.departments, lost, alloc) : new Map<string, ScheduleResult>()
  const ctx = { settings: input.settings, alloc, today: input.today, nowMs: input.nowMs }

  const views = rows.map(({ order, product, notes, calc, salesOrder }): OrderView => {
    const sched = schedule.get(order.id) || null
    const neededBy = calc.slice.neededBy ? calc.slice.neededBy.slice(0, 10) : null
    const possibleDate = timeOn && sched && sched.finishDays != null ? addDaysISO(input.today, sched.finishDays) : null
    const overdue = calc.live && !!neededBy && neededBy < input.today
    const atRisk = calc.live && !overdue && timeOn && !!possibleDate && !!neededBy && possibleDate > neededBy
    const lateDays = overdue ? daysFrom(neededBy!, input.today) : atRisk ? daysFrom(neededBy!, possibleDate!) : 0
    const lots = new Set([calc.slice.slabApproval?.lot, calc.slice.slabApproval?.alternativeLot?.lot, ...calc.slice.materials.filter((m) => m.state !== "received").map((m) => m.lot)].filter(Boolean) as string[])
    const cBlocks = calc.current >= 0 ? stationBlocks(calc, calc.current) : []
    return {
      id: order.id,
      order,
      product,
      calc,
      notes,
      noteSlices: calc.notes,
      number: order.orderNumber,
      ref: orderRef(order),
      unit: product.unit,
      quantity: calc.slice.quantity,
      source: calc.slice.source,
      sourceName: sourceNameOf(order),
      // The one it names, else the one it was resolved to — so an order held
      // for a down payment always says which sales order it waits on.
      salesOrderNumber: order.salesOrderNumber ?? salesOrder?.orderNumber ?? null,
      stage: calc.stage,
      released: calc.released,
      done: calc.done_,
      cancelled: calc.cancelled,
      live: calc.live,
      releaseBlocks: calc.released ? [] : releaseBlocks(calc),
      currentBlocks: cBlocks,
      hardBlocked: cBlocks.some((b) => b.severity === "hard"),
      neededBy,
      schedule: sched,
      possibleDate,
      overdue,
      atRisk,
      late: overdue || atRisk,
      lateDays: Math.max(0, lateDays),
      rush: !!calc.slice.rush,
      candidates: candidates(calc, ctx),
      shortages: alloc ? shortages(calc, alloc) : [],
      notices: input.notices.filter((n) => !n.closedAt && lots.has(n.lot)),
      cost: orderCost(calc, input.departments, input.settings),
      variance: calc.live && calc.released ? hourVariance(calc, input.settings) : null,
      lateReason: null,
    }
  })
  for (const v of views) if (v.late) v.lateReason = whyLate(v.calc, alloc, v.schedule, input.nowMs)
  return { views, viewById: new Map(views.map((v) => [v.id, v])), calcs, alloc, lost, schedule }
}

// ---------------------------------------------------------------------------
// Who the viewer is — five manufacturing roles (PR-05)
// ---------------------------------------------------------------------------

export const PERSONAS: Persona[] = ["manager", "lead", "qc", "cost", "management"]

export function personasOf(actor: Actor, _departments: DeptCapacityFields[]): Persona[] {
  const out: Persona[] = []
  if (actor.manage) out.push("manager")
  if (actor.work) out.push("lead")
  if (actor.qc) out.push("qc")
  if (actor.cost) out.push("cost")
  if (actor.view) out.push("management")
  return out
}

/** The stations a lead records: the ones assigned to them; a hand with no
 * assignment works the stations nobody leads yet. QC's station is Quality's. */
export function myStations(actor: Actor, departments: DeptCapacityFields[], persona: Persona): string[] {
  if (persona === "qc") return departments.filter((d) => !stationGate(d) && isQc(d)).map((d) => d.id)
  if (persona !== "lead" || !actor.work) return []
  // Order-level stations count too: the design lead submits the drawing.
  const mine = departments.filter((d) => d.leadUserId === actor.uid).map((d) => d.id)
  if (mine.length) return mine
  return departments.filter((d) => !d.leadUserId && !isQc(d) && stationGate(d) !== "slab").map((d) => d.id)
}

const isQc = (d: DeptCapacityFields) => !!d.qcStation || (d.qcStation == null && /فحص|جودة|تغليف|quality|inspect|qc\b|packing/i.test(d.name || ""))

export const seesMoney = (persona: Persona): boolean => persona === "manager" || persona === "cost" || persona === "management"

// ---------------------------------------------------------------------------
// Needs your decision (TD-01)
// ---------------------------------------------------------------------------

export type DecisionItem =
  | { kind: "order"; severity: Severity; view: OrderView; candidate: Candidate }
  | { kind: "request"; severity: Severity; request: ManufacturingRequest; overdue: boolean; ageHours: number }
  | { kind: "estimate_send"; severity: Severity; estimate: MfgCostEstimate }
  | { kind: "estimate_recalc"; severity: Severity; estimate: MfgCostEstimate }
  | { kind: "variance"; severity: Severity; view: OrderView; variance: HourVariance }

export interface DecisionContext {
  world: MfgWorld
  /** For the down payment a Sales request waits on; omit and no request is held. */
  salesOrders?: Map<string, SalesOrder>
  requests: ManufacturingRequest[]
  estimates: MfgCostEstimate[]
  departments: DeptCapacityFields[]
  settings: MfgSettings
  actor: Actor
  persona: Persona
  today: string
  nowMs: number
}

export function buildDecisions(ctx: DecisionContext): DecisionItem[] {
  const out: DecisionItem[] = []
  const { persona, actor } = ctx
  for (const v of ctx.world.views) {
    if (!v.live && !v.cancelled) continue
    for (const c of v.candidates) if (ownsCandidate(c, actor, ctx.departments, ctx.settings, persona)) out.push({ kind: "order", severity: c.severity, view: v, candidate: c })
  }
  if (persona === "manager" && actor.manage) {
    for (const r of ctx.requests) {
      if (r.status !== "new") continue
      const ageHours = r.requestedAt ? Math.max(0, (ctx.nowMs - new Date(r.requestedAt).getTime()) / 3600000) : 0
      // The clock does not run while Finance has yet to confirm the advance (PAY-07).
      const held = awaitsDownPayment(r, r.orderId ? ctx.salesOrders?.get(r.orderId) : null)
      const overdue = !held && ageHours >= ctx.settings.answerWindowHours
      out.push({ kind: "request", severity: overdue ? "r" : "a", request: r, overdue, ageHours })
    }
  }
  if (persona === "cost" && actor.cost) {
    if (ctx.settings.features.estimates) {
      for (const e of ctx.estimates) {
        if (estimateExpired(e, ctx.today, ctx.settings)) out.push({ kind: "estimate_recalc", severity: "a", estimate: e })
        else if (e.state === "draft") out.push({ kind: "estimate_send", severity: "a", estimate: e })
      }
    }
    for (const v of ctx.world.views) if (v.variance) out.push({ kind: "variance", severity: v.variance.percent >= 25 ? "a" : "b", view: v, variance: v.variance })
  }
  return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
}

/** One card per order — the first action and the rest as secondary (TD-01). */
export type DecisionGroup = { kind: "order"; view: OrderView; items: Array<Extract<DecisionItem, { kind: "order" }>> } | { kind: "solo"; item: DecisionItem }

export function groupDecisions(items: DecisionItem[]): DecisionGroup[] {
  const groups: DecisionGroup[] = []
  const byOrder = new Map<string, Extract<DecisionGroup, { kind: "order" }>>()
  for (const d of items) {
    if (d.kind !== "order") {
      groups.push({ kind: "solo", item: d })
      continue
    }
    let g = byOrder.get(d.view.id)
    if (!g) {
      g = { kind: "order", view: d.view, items: [] }
      byOrder.set(d.view.id, g)
      groups.push(g)
    }
    g.items.push(d)
  }
  const sev = (g: DecisionGroup) => severityRank(g.kind === "solo" ? g.item.severity : g.items[0].severity)
  const late = (g: DecisionGroup) => (g.kind === "order" && g.view.late ? 1 : 0)
  for (const g of groups) if (g.kind === "order") g.items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  return groups.sort((a, b) => sev(b) - sev(a) || late(b) - late(a))
}

// ---------------------------------------------------------------------------
// Awaiting our team (TD-07) and other modules (TD-08)
// ---------------------------------------------------------------------------

export interface Holder {
  /** A person's uid, or the role when several (or nobody) hold it. */
  key: string
  name: string | null
  role: Persona
}

export function holderOf(owner: CandidateOwner, team: TeamMember[], departments: DeptCapacityFields[], settings: MfgSettings): Holder[] {
  const people = (role: Persona, pick: (m: TeamMember) => boolean): Holder[] => {
    const hits = team.filter(pick)
    return hits.length ? hits.map((m) => ({ key: m.id, name: m.name, role })) : [{ key: `role:${role}`, name: null, role }]
  }
  switch (owner.kind) {
    case "external":
      return []
    case "manager":
    case "manager_or_qc":
      return people("manager", (m) => m.manage)
    case "qc":
      return people("qc", (m) => m.qc)
    case "scrap":
      return owner.value > settings.scrapApprovalLimit ? people("cost", (m) => m.cost) : people("manager", (m) => m.manage)
    case "station": {
      const d = departments.find((x) => x.id === owner.departmentId)
      if (d && isQc(d)) return people("qc", (m) => m.qc)
      if (d?.leadUserId) return [{ key: d.leadUserId, name: d.leadUserName || team.find((m) => m.id === d.leadUserId)?.name || null, role: "lead" }]
      return people("manager", (m) => m.manage)
    }
  }
}

export interface TeamWait {
  holder: Holder
  items: Array<{ view: OrderView; candidate: Candidate }>
}

/** What each other manufacturing user holds, grouped by person. */
export function waitingTeam(world: MfgWorld, team: TeamMember[], actor: Actor, departments: DeptCapacityFields[], settings: MfgSettings): TeamWait[] {
  const groups = new Map<string, TeamWait>()
  for (const v of world.views) {
    if (!v.live && !v.cancelled) continue
    for (const c of v.candidates) {
      if (c.owner.kind === "external" || ownsCandidate(c, actor, departments, settings)) continue
      const holders = holderOf(c.owner, team, departments, settings)
      const h = holders[0]
      if (!h || h.key === actor.uid) continue
      const g = groups.get(h.key) || { holder: h, items: [] }
      g.items.push({ view: v, candidate: c })
      groups.set(h.key, g)
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.items.length - a.items.length)
}

export interface ModuleWait {
  module: ExternalModule
  items: Array<{ view?: OrderView; candidate?: Candidate; estimate?: MfgCostEstimate }>
}

/** Read-only, scoped by role: leads see their stations only; QC and cost see none. */
export function waitingOthers(world: MfgWorld, persona: Persona, stations: string[], estimates: MfgCostEstimate[], settings: MfgSettings, today: string): ModuleWait[] {
  if (persona === "qc" || persona === "cost") return []
  const groups = new Map<ExternalModule, ModuleWait>()
  const put = (module: ExternalModule, item: ModuleWait["items"][number]) => {
    const g = groups.get(module) || { module, items: [] }
    g.items.push(item)
    groups.set(module, g)
  }
  for (const v of world.views) {
    if (!v.live) continue
    for (const c of v.candidates) {
      if (c.owner.kind !== "external") continue
      if (persona === "lead" && !(c.departmentId && stations.includes(c.departmentId))) continue
      put(c.owner.module, { view: v, candidate: c })
    }
  }
  if (persona !== "lead" && settings.features.estimates) {
    for (const e of estimates) {
      if ((e.state === "sent" || e.state === "quoted") && !estimateExpired(e, today, settings)) put("sales", { estimate: e })
    }
  }
  const order: ExternalModule[] = ["finance", "sales", "procurement", "projects", "inventory"]
  return order.filter((m) => groups.has(m)).map((m) => groups.get(m)!)
}

// ---------------------------------------------------------------------------
// The station queue (TD-05)
// ---------------------------------------------------------------------------

export interface QueueRow {
  view: OrderView
  index: number
  departmentId: string
  inHand: number
  blocks: Block[]
  /** The viewer's action at this station, if any. */
  action: Candidate | null
}

export function stationQueue(world: MfgWorld, stationIds: string[], actor: Actor, departments: DeptCapacityFields[], settings: MfgSettings, persona?: Persona): QueueRow[] {
  const rows: QueueRow[] = []
  for (const v of world.views) {
    if (!v.live) continue
    v.calc.route.forEach((r, i) => {
      if (!stationIds.includes(r.departmentId)) return
      const inHand = v.calc.pend[i] || 0
      const issued = v.calc.slice.materials.some((m) => m.departmentId === r.departmentId && m.state === "released")
      if (inHand <= 0 && !issued) return
      const action = stationAction(v, i, actor, departments, settings, persona)
      rows.push({ view: v, index: i, departmentId: r.departmentId, inHand, blocks: stationBlocks(v.calc, i), action })
    })
  }
  return rows.sort((a, b) => Number(b.view.rush) - Number(a.view.rush) || Number(b.view.late) - Number(a.view.late) || (a.view.neededBy || "9999") .localeCompare(b.view.neededBy || "9999"))
}

/** The viewer's own candidate at one station of one order. */
export function stationAction(v: OrderView, index: number, actor: Actor, departments: DeptCapacityFields[], settings: MfgSettings, persona?: Persona): Candidate | null {
  const deptId = v.calc.route[index]?.departmentId
  return (
    v.candidates.find(
      (c) =>
        ownsCandidate(c, actor, departments, settings, persona) &&
        ((["output", "qc_release", "gate", "request_materials", "confirm_receipt", "submit_drawing"].includes(c.key) && c.departmentId === deptId) ||
          (c.key === "slab" && c.index === index))
    ) || null
  )
}

// ---------------------------------------------------------------------------
// The Workshop list (WS-01..09)
// ---------------------------------------------------------------------------

export type WorkshopFilter = "all" | "pay" | "wait" | "prod" | "close" | "ready" | "transit" | "closed"
export const WORKSHOP_FILTERS: WorkshopFilter[] = ["all", "pay", "wait", "prod", "close", "ready", "transit", "closed"]

export function inFilter(v: OrderView, f: WorkshopFilter): boolean {
  if (f === "all") return true
  if (f === "closed") return v.stage === "done" || v.stage === "cancel"
  return v.stage === f
}

export function filterCounts(views: OrderView[]): Record<WorkshopFilter, number> {
  const c = Object.fromEntries(WORKSHOP_FILTERS.map((f) => [f, 0])) as Record<WorkshopFilter, number>
  for (const v of views) for (const f of WORKSHOP_FILTERS) if (inFilter(v, f)) c[f] += 1
  return c
}

/** Order, docNumber, product, client, project, sales order or block (WS-02). */
export function matchesSearch(v: OrderView, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "")
  if (!q) return true
  const o = v.order
  return [
    String(v.number),
    v.ref,
    v.product.name,
    v.sourceName,
    o.projectName || "",
    v.salesOrderNumber != null ? `so-${v.salesOrderNumber} ${v.salesOrderNumber}` : "",
    o.purchaseRequestRef || "",
    o.pmRequestRef || "",
    o.mfgRequestNumber || "",
    v.calc.slice.slabApproval?.lot || "",
    o.title || "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(q)
}

const STAGE_ORDER: Stage[] = ["pay", "wait", "prod", "close", "ready", "transit", "done", "cancel"]

export function compareWorkshop(hasStep: (v: OrderView) => boolean) {
  return (a: OrderView, b: OrderView): number =>
    Number(hasStep(b)) - Number(hasStep(a)) ||
    Number(b.late) - Number(a.late) ||
    Number(b.rush) - Number(a.rush) ||
    STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) ||
    (a.neededBy || "9999").localeCompare(b.neededBy || "9999") ||
    b.number - a.number
}

export function compareOrders(a: OrderView, b: OrderView): number {
  return queueOrder(a.calc, b.calc) || b.number - a.number
}

// ---------------------------------------------------------------------------
// Headline figures — quantities by unit, one WIP (TD-02, FN-06, UI-06)
// ---------------------------------------------------------------------------

export interface UnitQty {
  unit: string
  qty: number
}

/** Never sum m² with m: one total per unit. */
export function byUnit(pairs: Array<[string, number]>): UnitQty[] {
  const m = new Map<string, number>()
  for (const [unit, qty] of pairs) if (qty > 0) m.set(unit, round2((m.get(unit) || 0) + qty))
  return Array.from(m, ([unit, qty]) => ({ unit, qty }))
}

export function wipTotal(views: OrderView[]): number {
  return round2(views.reduce((a, v) => a + v.cost.wip, 0))
}

export interface DepartmentLoad {
  department: DeptCapacityFields
  days: number
  capacity: number
  lostToday: number
  bottleneck: boolean
}

export function departmentLoads(world: MfgWorld, departments: DeptCapacityFields[]): DepartmentLoad[] {
  const bn = bottleneck(world.calcs, departments, world.lost)
  return departments
    .filter((d) => !stationGate(d))
    .map((d) => ({ department: d, days: stationQueueDays(world.calcs, d, world.lost), capacity: deptCapacity(d), lostToday: world.lost.get(d.id) || 0, bottleneck: bn?.departmentId === d.id }))
}

export interface ReconciliationRow {
  view: OrderView
  cost: number
  delivered: number
  scrap: number
  balance: number
}

/** The cost controller's WIP reconciliation (FN-04). The ledger's WIP carries
 * what was posted — materials received, less deliveries, scrap and remnants.
 * Labour, overhead and custody materials are absorbed into the order's cost
 * but never posted there, so their share still in progress explains that part
 * of the difference; what remains unexplained is worth a look. */
export function wipReconciliation(views: OrderView[]): {
  rows: ReconciliationRow[]
  total: number
  pendingScrap: OrderView[]
  notesOut: OrderView[]
  remnantsPending: OrderView[]
  unposted: { time: number; custody: number }
} {
  const rows = views
    .filter((v) => v.cost.wip > 0.5)
    .map((v) => ({ view: v, cost: v.cost.total, delivered: v.cost.outValue, scrap: v.cost.scrapValue, balance: v.cost.wip }))
    .sort((a, b) => b.balance - a.balance)
  return {
    rows,
    // The same number as every WIP figure — small balances are hidden, not dropped.
    total: wipTotal(views),
    pendingScrap: views.filter((v) => v.live && v.calc.scrapPending > 0),
    notesOut: views.filter((v) => v.calc.shipped > 0),
    remnantsPending: views.filter((v) => v.calc.slice.remnants.some((r) => r.state === "returned")),
    unposted: views.reduce(
      (acc, v) => {
        if (!(v.cost.wip > 0) || !(v.cost.total > 0)) return acc
        const share = v.cost.wip / v.cost.total
        return { time: round2(acc.time + (v.cost.labour + v.cost.overhead) * share), custody: round2(acc.custody + v.cost.custody * share) }
      },
      { time: 0, custody: 0 }
    ),
  }
}

export interface OwnerRow {
  key: string
  source: OrderSource
  name: string
  open: number
  late: OrderView[]
  scrap: number
  wip: number
  short: boolean
  awaitingPayment: boolean
  delivered: UnitQty[]
  target: UnitQty[]
}

/** Management's view: by project and client, in SAR (TD-04). */
export function byProjectAndClient(views: OrderView[]): OwnerRow[] {
  const groups = new Map<string, OrderView[]>()
  for (const v of views) {
    if (v.cancelled) continue
    const key = v.source === "project" ? `p:${v.order.projectId || v.sourceName}` : v.source === "client" ? `c:${v.order.source?.contactId || v.sourceName}` : "s"
    groups.set(key, [...(groups.get(key) || []), v])
  }
  return Array.from(groups, ([key, list]) => ({
    key,
    source: list[0].source,
    name: list[0].sourceName,
    open: list.filter((v) => v.live).length,
    late: list.filter((v) => v.late),
    scrap: round2(list.reduce((a, v) => a + v.calc.slice.scrap.reduce((s, x) => s + x.value, 0), 0)),
    wip: wipTotal(list),
    short: list.some((v) => v.shortages.length > 0),
    awaitingPayment: list.some((v) => v.stage === "pay"),
    delivered: byUnit(list.map((v) => [v.unit, v.calc.delivered])),
    target: byUnit(list.map((v) => [v.unit, v.calc.target])),
  })).sort((a, b) => b.late.length - a.late.length || b.wip - a.wip)
}

// ---------------------------------------------------------------------------
// What goes to Finance (FN-03), the document trail, the log
// ---------------------------------------------------------------------------

export type FinanceEventKind = "materials" | "custody" | "labour" | "overhead" | "remnant" | "scrap" | "frozen" | "note_out" | "delivery_project" | "delivery_stock" | "breakage"

export interface FinanceEvent {
  kind: FinanceEventKind
  value: number
  /** posted · pending (not posted yet) · none (no entry by design). */
  state: "posted" | "pending" | "none"
  ref?: string
  quantity?: number
}

export function financeEvents(v: OrderView, settings: MfgSettings): FinanceEvent[] {
  const c = v.cost
  const out: FinanceEvent[] = []
  if (c.materials) out.push({ kind: "materials", value: c.materials, state: "posted" })
  if (c.custody) out.push({ kind: "custody", value: c.custody, state: "pending" })
  if (c.labour) out.push({ kind: "labour", value: c.labour, state: "pending", quantity: c.hours })
  if (c.overhead) out.push({ kind: "overhead", value: c.overhead, state: "pending", quantity: settings.overheadRatePerHour })
  for (const r of v.calc.slice.remnants) out.push({ kind: "remnant", value: -r.value, state: r.state === "received" ? "posted" : "pending", quantity: r.area })
  for (const s of v.calc.slice.scrap) out.push({ kind: "scrap", value: s.value, state: s.status === "approved" ? "posted" : "pending", quantity: s.quantity })
  if (v.calc.slice.frozenCost) out.push({ kind: "frozen", value: v.calc.slice.frozenCost.cost, state: "none" })
  for (const n of v.notes) {
    if (n.status === "rejected") continue
    const net = round2(n.item.quantity - (n.brokenQuantity || 0))
    if (n.status === "in_transit") {
      out.push({ kind: "note_out", value: 0, state: "none", ref: n.noteNumber, quantity: n.item.quantity })
      continue
    }
    out.push({ kind: n.toKind === "project" ? "delivery_project" : "delivery_stock", value: round2((n.item.unitCost ?? 0) * net), state: "posted", ref: n.noteNumber, quantity: net })
    if (n.brokenQuantity) out.push({ kind: "breakage", value: round2((n.item.unitCost ?? 0) * n.brokenQuantity), state: "none", ref: n.noteNumber, quantity: n.brokenQuantity })
  }
  return out
}

export type TrailModule = "projects" | "procurement" | "sales" | "manufacturing" | "inventory" | "finance"

export interface TrailItem {
  kind: "pm_request" | "purchase_request" | "estimate" | "quote" | "sales_order" | "request" | "work_order" | "withdrawal" | "delivery_note" | "posting"
  ref: string
  module: TrailModule
  detail?: string | null
  done?: boolean
}

export function documentTrail(v: OrderView, estimates: MfgCostEstimate[]): TrailItem[] {
  const o = v.order
  const items: TrailItem[] = []
  if (v.source === "project") {
    if (o.pmRequestRef) items.push({ kind: "pm_request", ref: o.pmRequestRef, module: "projects", detail: o.costItemName || o.projectName || null })
    if (o.purchaseRequestRef) items.push({ kind: "purchase_request", ref: o.purchaseRequestRef, module: "procurement" })
  }
  if (v.source === "client") {
    const est = o.estimateId ? estimates.find((e) => e.id === o.estimateId) : null
    if (est) items.push({ kind: "estimate", ref: est.estimateNumber, module: "manufacturing", detail: est.sentByName || null })
    if (est?.quoteNumber) items.push({ kind: "quote", ref: est.quoteNumber, module: "sales", detail: est.contactName })
    if (v.salesOrderNumber != null) items.push({ kind: "sales_order", ref: `SO-${v.salesOrderNumber}`, module: "sales", done: v.calc.slice.downPayment.confirmed })
  }
  if (o.mfgRequestNumber) items.push({ kind: "request", ref: o.mfgRequestNumber, module: v.source === "client" ? "sales" : "procurement", detail: o.requestedByName || null })
  items.push({ kind: "work_order", ref: v.ref, module: "manufacturing", done: v.done })
  for (const rn of Array.from(new Set(v.calc.slice.materials.map((m) => m.requestNumber)))) {
    const rows = v.calc.slice.materials.filter((m) => m.requestNumber === rn)
    items.push({ kind: "withdrawal", ref: rn, module: "inventory", done: rows.every((m) => m.state === "received") })
  }
  for (const n of v.notes) items.push({ kind: "delivery_note", ref: n.noteNumber, module: n.toKind === "project" ? "projects" : "inventory", detail: n.toWarehouseName, done: n.status === "received" })
  if (v.calc.delivered > 0) items.push({ kind: "posting", ref: "", module: "finance", detail: o.costItemName || null, done: true })
  return items
}

export interface LogItem {
  kind: string
  at: string
  by: string | null
  tone: "ok" | "bad" | "neutral"
  module?: TrailModule | null
  ref?: string | null
  quantity?: number | null
  detail?: string | null
}

/** Every decision in its owner's name, newest first. */
export function orderLog(v: OrderView): LogItem[] {
  const o = v.order
  const s = v.calc.slice
  const items: LogItem[] = []
  const push = (x: LogItem) => {
    if (x.at) items.push(x)
  }
  push({ kind: `created_${v.source}`, at: o.createdAtIso || "", by: o.requestedByName || o.createdByUserName || null, tone: "neutral", module: v.source === "client" ? "sales" : v.source === "project" ? "procurement" : null, quantity: v.quantity, ref: o.mfgRequestNumber || null })
  if (s.survey) push({ kind: "survey", at: s.survey.at, by: s.survey.by, tone: "ok", quantity: s.survey.measuredQuantity ?? null, detail: s.survey.note ?? null })
  if (s.releasedAt) push({ kind: "released", at: s.releasedAt, by: o.releasedByName ?? null, tone: "ok" })
  if (s.drawing?.submittedAt) push({ kind: "drawing_submitted", at: s.drawing.submittedAt, by: s.drawing.submittedBy, tone: "neutral", ref: `rev.${s.drawing.revision}` })
  if (s.drawing?.code && s.drawing.recordedAt) push({ kind: `drawing_${s.drawing.code.toLowerCase()}`, at: s.drawing.recordedAt, by: s.drawing.approverName || s.drawing.recordedBy || null, tone: "ok", module: s.drawing.approverOrg === "client" ? "sales" : "projects", detail: s.drawing.resultNotes ?? null })
  if (s.slabApproval) push({ kind: "slab", at: s.slabApproval.at, by: s.slabApproval.by, tone: "ok", ref: s.slabApproval.lot })
  const groups = new Map<string, typeof s.materials>()
  for (const m of s.materials) groups.set(m.requestNumber, [...(groups.get(m.requestNumber) || []), m])
  for (const [rn, rows] of groups) {
    push({ kind: "materials_requested", at: rows[0].requestedAt, by: rows[0].requestedByName, tone: "neutral", ref: rn, quantity: rows.length })
    const rel = rows.find((m) => m.releasedAt)
    if (rel) push({ kind: "materials_issued", at: rel.releasedAt || "", by: rel.releasedByName ?? null, tone: "neutral", module: "inventory", ref: rn })
    const rec = rows.find((m) => m.receivedAt)
    if (rec) push({ kind: "materials_received", at: rec.receivedAt || "", by: rec.receivedByName ?? null, tone: "ok", ref: rn })
  }
  for (const r of s.rejects) push({ kind: "rejected", at: r.at, by: r.by, tone: "bad", quantity: r.quantity, detail: `${r.defect}|${r.cause}`, ref: r.departmentId })
  for (const q of s.qcReleases) push({ kind: "qc_released", at: q.at, by: q.by, tone: "ok", quantity: q.quantity })
  for (const x of s.scrap) {
    push({ kind: "scrap_raised", at: x.raisedAt, by: x.raisedByName, tone: "bad", quantity: x.quantity, detail: x.reason })
    if (x.status === "approved" && x.approvedAt) push({ kind: "scrap_approved", at: x.approvedAt, by: x.approvedByName ?? null, tone: "bad", quantity: x.quantity, detail: [x.classification, x.bearer].filter(Boolean).join(" · ") })
  }
  for (const r of s.remnants) {
    push({ kind: "remnant_returned", at: r.at, by: r.by, tone: "neutral", quantity: r.area, ref: r.lot })
    if (r.receivedAt) push({ kind: "remnant_received", at: r.receivedAt, by: r.receivedBy ?? null, tone: "ok", module: "inventory", quantity: r.area })
  }
  for (const p of s.purchaseRequests) {
    push({ kind: "purchase_requested", at: p.at, by: p.by, tone: "neutral", quantity: p.quantity, detail: p.itemName })
    if (p.arrivedAt) push({ kind: "purchase_arrived", at: p.arrivedAt, by: null, tone: "ok", module: "procurement", quantity: p.quantity, detail: p.itemName })
  }
  for (const c of s.closures || []) push({ kind: "closed", at: c.at, by: c.by, tone: "ok", quantity: c.quantity })
  for (const n of v.notes) {
    push({ kind: "note_issued", at: n.sentAt, by: n.sentByUserName, tone: "neutral", ref: n.noteNumber, quantity: n.item.quantity, detail: n.toWarehouseName })
    if (n.status === "received" && n.receivedAt)
      push({ kind: n.brokenQuantity ? "note_received_broken" : "note_received", at: n.receivedAt, by: n.receivedByUserName ?? null, tone: n.brokenQuantity ? "bad" : "ok", module: n.toKind === "project" ? "projects" : "inventory", ref: n.noteNumber, quantity: n.brokenQuantity || round2(n.item.quantity) })
  }
  if (s.cancellation) push({ kind: "cancelled", at: s.cancellation.at, by: s.cancellation.by, tone: "bad", detail: s.cancellation.reason })
  // Drawing results and cancellations already come from their records above.
  for (const e of o.log || []) {
    if (e.kind.startsWith("drawing_") || e.kind === "cancelled") continue
    push({ kind: e.kind, at: e.at, by: e.by, tone: e.tone || "neutral", detail: e.detail ?? null })
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

// ---------------------------------------------------------------------------
// Inventory's view of the stock this workshop draws on
// ---------------------------------------------------------------------------

export interface WorkshopGate {
  gate: "measurement" | "approval"
  orderId: string
  ref: string
}

export { belongsToSalesOrder, salesOrderOfWorkOrder, type SalesOrderKey }

/** Where the client stands behind a work order, as Sales names it. */
export function clientRefOf(o: Pick<WorkOrderV2, "salesOrderNumber" | "source">, so?: Pick<SalesOrder, "orderNumber"> | null): string {
  const n = so?.orderNumber ?? o.salesOrderNumber
  return n != null ? `SO-${n}` : o.source?.quotationNumber || ""
}

/** Shop drawings the workshop submitted and the client has not answered — the
 * result is Sales' to record (D11), whether or not the order names a sales
 * order. Oldest first: the workshop is standing still on these. */
export function clientDrawingsDue(orders: WorkOrderV2[], products: Map<string, MfgProduct>): WorkOrderV2[] {
  return orders
    .filter((o) => {
      if (o.status !== "open" || !o.productId || !products.has(o.productId)) return false
      const d = o.drawing
      return !!d?.submittedAt && !d.code && d.approverOrg === "client"
    })
    .sort((a, b) => (a.drawing?.submittedAt || "").localeCompare(b.drawing?.submittedAt || ""))
}

/** The sales order's view of its work orders' gates (T5, T7): a made-to-measure
 * line waits on the order's documented survey, a drawn one on its A/B. The
 * facts live on the work order; Sales reads them and never records a copy. */
export function workshopGatesFor(salesOrder: string | SalesOrderKey, orders: WorkOrderV2[], products: Map<string, MfgProduct>): { gates: WorkshopGate[]; lineKeys: Set<string> } {
  const so: SalesOrderKey = typeof salesOrder === "string" ? { id: salesOrder } : salesOrder
  const gates: WorkshopGate[] = []
  const lineKeys = new Set<string>()
  for (const o of orders) {
    if (!belongsToSalesOrder(o, so) || o.status === "cancelled") continue
    const p = products.get(o.productId || "")
    if (!p) continue
    lineKeys.add(itemKey(o.productName || p.name))
    if (o.status !== "open") continue
    if (p.requiresMeasurement && !(o.survey || o.measurement)) gates.push({ gate: "measurement", orderId: o.id, ref: orderRef(o) })
    // Only a drawing with the client is Sales' to chase; a draft is the workshop's.
    else if (drawingStateOf({ drawing: o.drawing ?? null }, p) === "wait" && o.drawing?.approverOrg === "client") gates.push({ gate: "approval", orderId: o.id, ref: orderRef(o) })
  }
  return { gates, lineKeys }
}

export interface WorkshopHold {
  itemKey: string
  itemName: string
  unit: string
  /** On hand in the stores read (quarantined blocks excluded). */
  onHand: number
  /** Withdrawals requested and not yet issued. */
  requested: number
  /** Reserved by released orders in queue order (MAT-04). */
  reserved: number
  /** Still needed by released orders beyond what the store holds. */
  short: number
  /** What the stores can still promise elsewhere. */
  free: number
  orders: Array<{ id: string; ref: string; quantity: number }>
}

/** What the workshop holds of the stock — the same allocation Manufacturing
 * plans against, for Inventory to keep on the shelf and Sales not to promise
 * twice. Only items the workshop requests appear. */
export function workshopHolds(input: { orders: WorkOrderV2[]; products: Map<string, MfgProduct>; departments: DeptCapacityFields[]; stock: StockIndex }): WorkshopHold[] {
  const calcs: OrderCalc[] = []
  const refs = new Map<string, string>()
  for (const o of input.orders) {
    const p = input.products.get(o.productId || "")
    if (!p) continue
    const c = calcOf(o, p, input.departments, [])
    if (!c.live) continue
    calcs.push(c)
    refs.set(o.id, orderRef(o))
  }
  const alloc = allocateStock(calcs, input.stock)
  const rows = new Map<string, WorkshopHold>()
  const rowFor = (itemName: string, unit: string) => {
    const k = itemKey(itemName)
    let r = rows.get(k)
    if (!r) {
      r = { itemKey: k, itemName, unit, onHand: input.stock.onHand.get(k) || 0, requested: 0, reserved: 0, short: 0, free: Math.max(0, alloc.free.get(k) ?? input.stock.onHand.get(k) ?? 0), orders: [] }
      rows.set(k, r)
    }
    return r
  }
  for (const c of calcs) {
    const mine = new Map<string, number>()
    for (const m of c.slice.materials) {
      if (m.state !== "requested") continue
      const r = rowFor(m.itemName, m.unit)
      r.requested = round2(r.requested + m.quantity)
      mine.set(r.itemKey, round2((mine.get(r.itemKey) || 0) + m.quantity))
    }
    for (const [k, qty] of alloc.reserved.get(c.slice.id) || new Map<string, number>()) {
      const bom = c.product.bom.find((b) => itemKey(b.itemName) === k)
      const r = rowFor(bom?.itemName || k, bom?.unit || "")
      r.reserved = round2(r.reserved + qty)
      mine.set(k, round2((mine.get(k) || 0) + qty))
    }
    for (const s of shortages(c, alloc)) {
      const r = rowFor(s.itemName, s.unit)
      r.short = round2(r.short + s.short)
    }
    for (const [k, qty] of mine) if (qty > 0) rows.get(k)?.orders.push({ id: c.slice.id, ref: refs.get(c.slice.id) || "", quantity: qty })
  }
  return Array.from(rows.values())
    .filter((r) => r.requested > 0 || r.reserved > 0 || r.short > 0)
    .sort((a, b) => b.short - a.short || a.itemName.localeCompare(b.itemName))
}

/** Per item key: what the workshop holds of the stock (requested + reserved). */
export function heldByItem(holds: WorkshopHold[]): Map<string, number> {
  return new Map(holds.map((h) => [h.itemKey, round2(h.requested + h.reserved)]))
}

export function stockIndexFrom(rows: Array<{ name: string; quantity: number; lot?: string | null; remnant?: boolean; isManufactured?: boolean }>, quarantinedLots: Set<string>): StockIndex {
  const onHand = new Map<string, number>()
  const lots: StockIndex["lots"] = []
  for (const r of rows) {
    if (!r.name || r.isManufactured) continue
    if (r.lot && quarantinedLots.has(r.lot)) continue
    onHand.set(itemKey(r.name), round2((onHand.get(itemKey(r.name)) || 0) + (Number(r.quantity) || 0)))
    if (r.lot) lots.push({ itemName: r.name, lot: r.lot, quantity: Number(r.quantity) || 0, remnant: !!r.remnant })
  }
  return { onHand, lots }
}

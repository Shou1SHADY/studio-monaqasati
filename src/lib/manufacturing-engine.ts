// Manufacturing v2 (التصنيع) domain engine — pure math, no Firestore.
//
// The model: a product card carries a ROUTE (ordered departments with a
// standard time), a BOM (what each department consumes, with planned waste)
// and blocking facts (site measurement, shop-drawing approval, client slab
// sign-off). A work order is a QUANTITY travelling that route: the atomic
// event is a department reporting output and handing over — never "moving a
// card". Everything else (where the quantities are, what is blocked, the
// achievable date, the cost so far) is DERIVED here and never stored.

export const MFG_PRODUCTS = "mfgProducts"
export const MFG_COST_ESTIMATES = "mfgCostEstimates"
export const MFG_SETTINGS = "manufacturingSettings"

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

export type MfgFamily = "stone" | "wood" | "aluminium" | "steel" | "other"

export interface MfgRouteStep {
  departmentId: string
  departmentName: string
  hoursPerUnit: number
  /** Site installation happens after goods leave the workshop — the step can
   * only receive what a delivery note has actually landed on site. */
  onSite?: boolean
}

export interface MfgBomLine {
  itemName: string
  unit: string
  qtyPerUnit: number
  /** The department that consumes it — materials are requested per station. */
  departmentId: string
  /** Planned waste applies (the slab is bought by area + waste, not net). */
  withWaste: boolean
  /** Snapshot cost; null means unknown — margins then say so instead of lying. */
  unitCost: number | null
  /** Tracked by block/lot — a different block is a different colour. */
  lotted?: boolean
}

export interface MfgProduct {
  id: string
  organizationId: string
  name: string
  unit: string
  family: MfgFamily
  /** Made to measure — no release before a recorded site survey. */
  requiresMeasurement: boolean
  /** No cutting before the shop drawing is approved. */
  requiresDrawingApproval: boolean
  /** The client signs off the slab (by block) before the saw runs. */
  requiresSlabApproval: boolean
  /** Percent (32 = 32%), applied to withWaste BOM lines and slab needs. */
  wastePercent: number
  salePrice: number | null
  estimateValue: number | null
  /** Last supplier supply-and-install price — the make-or-buy yardstick. */
  referenceBuyPrice: number | null
  route: MfgRouteStep[]
  bom: MfgBomLine[]
  createdAt?: unknown
  updatedAt?: unknown
}

// ---------------------------------------------------------------------------
// Org settings — what the org uses of the module, and Finance's policies
// ---------------------------------------------------------------------------

export interface MfgSettings {
  /** Feature switches: turning one off hides a whole computation, deletes nothing. */
  features: { time: boolean; estimates: boolean; checklists: boolean }
  overheadRatePerHour: number
  /** Percent — quoting below cost/(1-margin) needs a named finance approval. */
  minMarginPercent: number
  /** Scrap value the workshop manager may approve; above it → cost controller. */
  scrapApprovalLimit: number
  answerWindowHours: number
}

export const DEFAULT_MFG_SETTINGS: MfgSettings = {
  features: { time: true, estimates: true, checklists: true },
  overheadRatePerHour: 32,
  minMarginPercent: 18,
  scrapApprovalLimit: 3000,
  answerWindowHours: 24,
}

export function normalizeMfgSettings(raw: Partial<MfgSettings> | null | undefined): MfgSettings {
  return {
    features: { ...DEFAULT_MFG_SETTINGS.features, ...(raw?.features || {}) },
    overheadRatePerHour: raw?.overheadRatePerHour ?? DEFAULT_MFG_SETTINGS.overheadRatePerHour,
    minMarginPercent: raw?.minMarginPercent ?? DEFAULT_MFG_SETTINGS.minMarginPercent,
    scrapApprovalLimit: raw?.scrapApprovalLimit ?? DEFAULT_MFG_SETTINGS.scrapApprovalLimit,
    answerWindowHours: raw?.answerWindowHours ?? DEFAULT_MFG_SETTINGS.answerWindowHours,
  }
}

// ---------------------------------------------------------------------------
// Work order v2 slice — optional fields a product-born order carries
// ---------------------------------------------------------------------------

export interface StageProgress {
  departmentId: string
  /** Good output handed to the next step. */
  done: number
  /** Rejected at this step, waiting for a QC decision. */
  rejected: number
  /** Quantity sent back here for rework (adds to what the step must process). */
  rework: number
  /** Actual labour hours reported — cost is built from these, not from a %. */
  hours: number
}

export type MaterialState = "requested" | "released" | "received"

export interface WorkOrderMaterial {
  id: string
  requestNumber: string
  itemName: string
  unit: string
  quantity: number
  departmentId: string
  lot: string | null
  state: MaterialState
  unitCost: number | null
  warehouseId: string | null
  requestedByUserId: string
  requestedByName: string
  requestedAt: string
  releasedByName?: string | null
  releasedAt?: string | null
  receivedByName?: string | null
  receivedAt?: string | null
}

export interface WorkOrderScrap {
  id: string
  quantity: number
  /** Computed from what the unit had consumed up to its station — never typed. */
  value: number
  reason: string
  departmentId: string
  raisedByUserId: string
  raisedByName: string
  raisedAt: string
  status: "pending" | "approved"
  approvedByName?: string | null
  approvedAt?: string | null
}

export interface MeasurementRecord {
  at: string
  by: string
  note?: string | null
}

export type DrawingApprovalStatus = "na" | "pending" | "approved"

export interface SlabApproval {
  at: string
  by: string
  lot: string
  note?: string | null
}

export interface RushRecord {
  reason: string
  by: string
  at: string
}

export type ChecklistMarks = Record<string, Record<string, { by: string; at: string }>>

/** The structural slice the engine computes from — a Firestore work order with
 * v2 fields, or a plain test fixture. */
export interface MfgOrderSlice {
  id: string
  productId: string
  quantity: number
  neededBy: string | null
  createdAt2: string
  releasedAt: string | null
  riskReason?: string | null
  measurement: MeasurementRecord | null
  drawingApprovalStatus: DrawingApprovalStatus
  drawingApprovedAt?: string | null
  slabApproval: SlabApproval | null
  rush: RushRecord | null
  progress: StageProgress[]
  materials: WorkOrderMaterial[]
  scrap: WorkOrderScrap[]
  checklists?: ChecklistMarks
  /** Broken-in-transit units the order's owner accepted as a declared shortfall. */
  shortfall?: number
  /** Broken-in-transit units already answered (re-made or declared short). */
  brokenResolved?: number
  status: "open" | "done" | "cancelled"
  sourceQuotationId?: string | null
  sourceQuotationWon?: boolean | null
}

/** Delivery-note slice — v2 notes carry a shipped quantity and transit breakage. */
export interface MfgNoteSlice {
  quantity: number
  brokenQuantity: number
  status: "in_transit" | "received" | "rejected"
}

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100
const r1 = (n: number): number => Math.round((Number(n) || 0) * 10) / 10

export function wasteFactor(product: Pick<MfgProduct, "wastePercent">): number {
  return 1 + Math.max(0, Number(product.wastePercent) || 0) / 100
}

export function emptyProgress(route: MfgRouteStep[]): StageProgress[] {
  return route.map((r) => ({ departmentId: r.departmentId, done: 0, rejected: 0, rework: 0, hours: 0 }))
}

// ---------------------------------------------------------------------------
// Quantity calculus — every unit is somewhere, and the sum closes:
// delivered + in transit + ready + WIP + held for QC + scrap = released qty
// ---------------------------------------------------------------------------

export function scrapApprovedQty(o: Pick<MfgOrderSlice, "scrap">): number {
  return o.scrap.filter((s) => s.status === "approved").reduce((a, s) => a + s.quantity, 0)
}
export function scrapPendingQty(o: Pick<MfgOrderSlice, "scrap">): number {
  return o.scrap.filter((s) => s.status === "pending").reduce((a, s) => a + s.quantity, 0)
}
export function rejectedTotal(o: Pick<MfgOrderSlice, "progress">): number {
  return o.progress.reduce((a, p) => a + p.rejected, 0)
}
export function reworkTotal(o: Pick<MfgOrderSlice, "progress">): number {
  return o.progress.reduce((a, p) => a + p.rework, 0)
}
export function hoursTotal(o: Pick<MfgOrderSlice, "progress">): number {
  return o.progress.reduce((a, p) => a + p.hours, 0)
}

export function shippedQty(notes: MfgNoteSlice[]): number {
  return notes.filter((n) => n.status === "in_transit").reduce((a, n) => a + n.quantity, 0)
}
export function deliveredQty(notes: MfgNoteSlice[]): number {
  return notes.filter((n) => n.status === "received").reduce((a, n) => a + n.quantity - (n.brokenQuantity || 0), 0)
}
export function brokenQty(notes: MfgNoteSlice[]): number {
  return notes.reduce((a, n) => a + (n.brokenQuantity || 0), 0)
}
/** Everything that left the workshop on a note (received or still on the road). */
export function outQty(notes: MfgNoteSlice[]): number {
  return notes.filter((n) => n.status !== "rejected").reduce((a, n) => a + n.quantity, 0)
}

/** The workshop's exit: the last non-site step — after it, goods ship on a note. */
export function exitIndex(route: MfgRouteStep[]): number {
  let x = 0
  route.forEach((r, i) => {
    if (!r.onSite) x = i
  })
  return x
}

export function hasSiteStep(route: MfgRouteStep[]): boolean {
  return route.some((r) => r.onSite)
}

export function finishedQty(o: Pick<MfgOrderSlice, "progress">, route: MfgRouteStep[]): number {
  const i = exitIndex(route)
  return o.progress[i]?.done || 0
}

/** Packed in the workshop, not yet on a delivery note. */
export function readyQty(o: Pick<MfgOrderSlice, "progress">, route: MfgRouteStep[], notes: MfgNoteSlice[]): number {
  return Math.max(0, round2(finishedQty(o, route) - outQty(notes)))
}

export function installedQty(o: Pick<MfgOrderSlice, "progress">, route: MfgRouteStep[]): number {
  const i = route.findIndex((r) => r.onSite)
  return i < 0 ? 0 : o.progress[i]?.done || 0
}

export function atSiteQty(o: Pick<MfgOrderSlice, "progress">, route: MfgRouteStep[], notes: MfgNoteSlice[]): number {
  if (!hasSiteStep(route)) return 0
  return Math.max(0, round2(deliveredQty(notes) - installedQty(o, route)))
}

/** What has ENTERED step i: released qty for the first step, the previous
 * step's output for the rest — and for a site step, only what actually landed. */
export function inAt(o: MfgOrderSlice, route: MfgRouteStep[], i: number, notes: MfgNoteSlice[]): number {
  const step = route[i]
  if (!step) return 0
  const rw = o.progress[i]?.rework || 0
  if (step.onSite) return deliveredQty(notes) + rw
  if (i === 0) return (o.releasedAt != null ? o.quantity : 0) + rw
  return (o.progress[i - 1]?.done || 0) + rw
}

/** In the department's hands right now. */
export function pendingAt(o: MfgOrderSlice, route: MfgRouteStep[], i: number, notes: MfgNoteSlice[]): number {
  const p = o.progress[i]
  if (!p) return 0
  return Math.max(0, round2(inAt(o, route, i, notes) - p.done - p.rejected))
}

export function remainAt(o: MfgOrderSlice, i: number): number {
  const p = o.progress[i]
  if (!p) return 0
  return Math.max(0, round2(o.quantity - scrapApprovedQty(o) - (o.shortfall || 0) - p.done))
}

export function wipQty(o: MfgOrderSlice, route: MfgRouteStep[]): number {
  const released = o.releasedAt != null ? o.quantity : 0
  return Math.max(0, round2(released + reworkTotal(o) - finishedQty(o, route) - rejectedTotal(o) - scrapApprovedQty(o) - (o.shortfall || 0)))
}

/** Transit breakage with no decision yet (neither re-made nor declared short). */
export function brokenUndecided(o: Pick<MfgOrderSlice, "brokenResolved">, notes: MfgNoteSlice[]): number {
  return Math.max(0, round2(brokenQty(notes) - (o.brokenResolved || 0)))
}

/** First step with work in hand; -1 means the order waits on a decision or a delivery. */
export function currentIndex(o: MfgOrderSlice, route: MfgRouteStep[], notes: MfgNoteSlice[]): number {
  for (let i = 0; i < route.length; i++) if (pendingAt(o, route, i, notes) > 0) return i
  return -1
}

/** All steps holding quantity — an order can be in several departments at once. */
export function activeIndexes(o: MfgOrderSlice, route: MfgRouteStep[], notes: MfgNoteSlice[]): number[] {
  const out: number[] = []
  route.forEach((_, i) => {
    if (pendingAt(o, route, i, notes) > 0) out.push(i)
  })
  return out
}

export function isDoneV2(o: MfgOrderSlice, route: MfgRouteStep[], notes: MfgNoteSlice[]): boolean {
  if (o.releasedAt == null) return false
  return (
    wipQty(o, route) === 0 &&
    rejectedTotal(o) === 0 &&
    readyQty(o, route, notes) === 0 &&
    shippedQty(notes) === 0 &&
    atSiteQty(o, route, notes) === 0 &&
    brokenUndecided(o, notes) === 0 &&
    deliveredQty(notes) > 0
  )
}

// ---------------------------------------------------------------------------
// Blocking facts — recorded events, not checkboxes
// ---------------------------------------------------------------------------

export type BlockKey = "quote" | "measurement" | "drawing" | "slab" | "materials"

export interface Block {
  key: BlockKey
  severity: "hard" | "soft"
}

/** What stands between this order and release. */
export function releaseBlocks(o: MfgOrderSlice, product: Pick<MfgProduct, "requiresMeasurement">): Block[] {
  const blocks: Block[] = []
  if (o.sourceQuotationId && o.sourceQuotationWon === false) blocks.push({ key: "quote", severity: "hard" })
  if (product.requiresMeasurement && !o.measurement) blocks.push({ key: "measurement", severity: "hard" })
  return blocks
}

/** What stops step i from starting. Approval gates bind from the second step
 * (design can proceed); the saw is where a wrong cut becomes scrap. */
export function stationBlocks(
  o: MfgOrderSlice,
  product: Pick<MfgProduct, "requiresDrawingApproval" | "requiresSlabApproval" | "wastePercent" | "bom">,
  route: MfgRouteStep[],
  i: number
): Block[] {
  const blocks: Block[] = []
  if (product.requiresDrawingApproval && o.drawingApprovalStatus !== "approved" && i >= 1)
    blocks.push({ key: "drawing", severity: "hard" })
  if (product.requiresSlabApproval && !o.slabApproval && i >= 1) blocks.push({ key: "slab", severity: "hard" })
  const ms = materialState(o, product, route, i)
  if (ms !== "none" && ms !== "complete") blocks.push({ key: "materials", severity: "soft" })
  return blocks
}

// ---------------------------------------------------------------------------
// Materials — planned waste is part of the need, not a surprise
// ---------------------------------------------------------------------------

export interface MaterialNeed {
  itemName: string
  unit: string
  withWaste: boolean
  lotted: boolean
  unitCost: number | null
  /** Net consumption for the remaining deliverable quantity. */
  net: number
  /** Net + planned waste — what is actually requested from the store. */
  qty: number
}

export function bomFor(product: Pick<MfgProduct, "bom">, departmentId: string): MfgBomLine[] {
  return (product.bom || []).filter((b) => b.departmentId === departmentId)
}

export function materialNeed(
  o: Pick<MfgOrderSlice, "quantity" | "scrap" | "shortfall">,
  product: Pick<MfgProduct, "bom" | "wastePercent">,
  departmentId: string
): MaterialNeed[] {
  const deliverable = Math.max(0, o.quantity - scrapApprovedQty(o as MfgOrderSlice) - ((o as MfgOrderSlice).shortfall || 0))
  return bomFor(product, departmentId).map((b) => {
    const net = round2(b.qtyPerUnit * deliverable)
    return {
      itemName: b.itemName,
      unit: b.unit,
      withWaste: b.withWaste,
      lotted: !!b.lotted,
      unitCost: b.unitCost,
      net,
      qty: round2(net * (b.withWaste ? wasteFactor(product) : 1)),
    }
  })
}

export function materialReceived(o: Pick<MfgOrderSlice, "materials">, departmentId: string, itemName: string): number {
  return o.materials
    .filter((m) => m.departmentId === departmentId && m.itemName === itemName && m.state === "received")
    .reduce((a, m) => a + m.quantity, 0)
}

export function materialOpen(o: Pick<MfgOrderSlice, "materials">, departmentId: string, itemName: string): number {
  return o.materials
    .filter((m) => m.departmentId === departmentId && m.itemName === itemName && m.state !== "received")
    .reduce((a, m) => a + m.quantity, 0)
}

export type StationMaterialState = "none" | "missing" | "requested" | "released" | "partial" | "complete"

export function materialState(
  o: Pick<MfgOrderSlice, "materials" | "quantity" | "scrap" | "shortfall">,
  product: Pick<MfgProduct, "bom" | "wastePercent">,
  route: MfgRouteStep[],
  i: number
): StationMaterialState {
  const departmentId = route[i]?.departmentId
  if (!departmentId) return "none"
  const need = materialNeed(o, product, departmentId).filter((n) => n.qty > 0)
  if (!need.length) return "none"
  let covered = 0
  let open = false
  for (const n of need) {
    covered += Math.min(materialReceived(o, departmentId, n.itemName), n.qty) / n.qty
    if (materialOpen(o, departmentId, n.itemName) > 0) open = true
  }
  const ratio = covered / need.length
  if (ratio >= 0.999) return "complete"
  if (open)
    return o.materials.some((m) => m.departmentId === departmentId && m.state === "released") ? "released" : "requested"
  return ratio > 0 ? "partial" : "missing"
}

export interface MaterialShortage extends MaterialNeed {
  available: number
  short: number
}

/** Need beyond what the store can issue — the fix is a purchase request. */
export function materialShortages(
  o: Pick<MfgOrderSlice, "materials" | "quantity" | "scrap" | "shortfall">,
  product: Pick<MfgProduct, "bom" | "wastePercent">,
  departmentId: string,
  availability: Map<string, number>
): MaterialShortage[] {
  return materialNeed(o, product, departmentId)
    .map((n) => {
      const available = availability.get(n.itemName.trim().toLowerCase()) || 0
      const got = materialReceived(o, departmentId, n.itemName)
      return { ...n, available, short: Math.max(0, r1(n.qty - got - available)) }
    })
    .filter((x) => x.short > 0)
}

// ---------------------------------------------------------------------------
// Capacity & the achievable date — computed from standard times and queues
// ---------------------------------------------------------------------------

export interface DeptCapacityFields {
  id: string
  workers?: number | null
  hoursPerDay?: number | null
  hourlyRate?: number | null
}

export function deptCapacity(dept: Pick<DeptCapacityFields, "workers" | "hoursPerDay">): number {
  return Math.max(1, Number(dept.workers) || 1) * Math.max(1, Number(dept.hoursPerDay) || 8)
}

export function stepHours(product: Pick<MfgProduct, "route">, departmentId: string): number {
  const r = (product.route || []).find((x) => x.departmentId === departmentId)
  return r ? r.hoursPerUnit : 0
}

export interface ScheduleInput {
  order: MfgOrderSlice
  product: MfgProduct
  notes: MfgNoteSlice[]
}

export interface ScheduleResult {
  /** Working days from now until the order's last remaining step finishes. */
  finishDays: number
  /** The department it waits longest for, if any. */
  waitDepartmentId: string | null
  waitDays: number
  /** Unmet condition the estimate assumes resolved today, if any. */
  condition: "release" | "drawing" | "slab" | null
}

function conditionOf(o: MfgOrderSlice, product: MfgProduct): ScheduleResult["condition"] | "quote" {
  if (o.sourceQuotationId && o.sourceQuotationWon === false && o.releasedAt == null) return "quote"
  if (o.releasedAt == null) return "release"
  if (product.requiresDrawingApproval && o.drawingApprovalStatus !== "approved") return "drawing"
  if (product.requiresSlabApproval && !o.slabApproval) return "slab"
  return null
}

/** Forward-load every live order (rush first, then earliest need) onto the
 * departments' daily capacity. An unwon quote gets no date at all. */
export function scheduleOrders(
  inputs: ScheduleInput[],
  departments: DeptCapacityFields[]
): Map<string, ScheduleResult> {
  const capByDept = new Map(departments.map((d) => [d.id, deptCapacity(d)]))
  const list = inputs
    .filter(({ order, product, notes }) => !isDoneV2(order, product.route, notes) && order.status === "open")
    .filter(({ order, product }) => conditionOf(order, product) !== "quote")
    .sort((a, b) => {
      const rush = Number(!!b.order.rush) - Number(!!a.order.rush)
      if (rush) return rush
      const ad = a.order.neededBy || "9999", bd = b.order.neededBy || "9999"
      if (ad !== bd) return ad < bd ? -1 : 1
      return a.order.createdAt2 < b.order.createdAt2 ? -1 : 1
    })
  const free = new Map<string, number>()
  const out = new Map<string, ScheduleResult>()
  for (const { order, product } of list) {
    let t = 0
    let worst: string | null = null
    let worstWait = 0
    product.route.forEach((r, i) => {
      const rem = remainAt(order, i)
      if (rem <= 0) return
      const cap = capByDept.get(r.departmentId) || 8
      const needDays = (rem * r.hoursPerUnit) / cap
      const start = Math.max(t, free.get(r.departmentId) || 0)
      if (start - t > worstWait) {
        worstWait = start - t
        worst = r.departmentId
      }
      free.set(r.departmentId, start + needDays)
      t = start + needDays
    })
    const cond = conditionOf(order, product)
    out.set(order.id, {
      finishDays: Math.ceil(t),
      waitDepartmentId: worst,
      waitDays: r1(worstWait),
      condition: cond === "quote" ? null : cond,
    })
  }
  return out
}

/** Remaining standard hours queued on one department across live orders. */
export function stationLoadHours(inputs: ScheduleInput[], departmentId: string): number {
  let h = 0
  for (const { order, product, notes } of inputs) {
    if (order.status !== "open" || isDoneV2(order, product.route, notes)) continue
    const i = product.route.findIndex((r) => r.departmentId === departmentId)
    if (i < 0) continue
    h += remainAt(order, i) * product.route[i].hoursPerUnit
  }
  return r1(h)
}

export function stationQueueDays(inputs: ScheduleInput[], dept: DeptCapacityFields): number {
  return r1(stationLoadHours(inputs, dept.id) / deptCapacity(dept))
}

export function bottleneck(
  inputs: ScheduleInput[],
  departments: DeptCapacityFields[]
): { departmentId: string; days: number } | null {
  let best: { departmentId: string; days: number } | null = null
  for (const d of departments) {
    const days = stationQueueDays(inputs, d)
    if (!best || days > best.days) best = { departmentId: d.id, days }
  }
  return best
}

/** Achievable days for a NEW quantity: it joins the back of every queue. */
export function possibleForDays(
  product: MfgProduct,
  quantity: number,
  inputs: ScheduleInput[],
  departments: DeptCapacityFields[]
): number {
  const capByDept = new Map(departments.map((d) => [d.id, deptCapacity(d)]))
  let t = 0
  for (const r of product.route) {
    const dept = departments.find((d) => d.id === r.departmentId)
    const queue = dept ? stationQueueDays(inputs, dept) : stationLoadHours(inputs, r.departmentId) / 8
    t = Math.max(t, queue)
    t += (quantity * r.hoursPerUnit) / (capByDept.get(r.departmentId) || 8)
  }
  return Math.ceil(t)
}

/** Largest quantity deliverable within `days` — binary search over the queue math. */
export function fitQty(
  product: MfgProduct,
  days: number,
  inputs: ScheduleInput[],
  departments: DeptCapacityFields[]
): number {
  if (possibleForDays(product, 1, inputs, departments) > days) return 0
  let lo = 1
  let hi = 99999
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2)
    if (possibleForDays(product, mid, inputs, departments) <= days) lo = mid
    else hi = mid - 1
  }
  return lo
}

// ---------------------------------------------------------------------------
// Costing — built from real movements: issued materials and reported hours
// ---------------------------------------------------------------------------

export interface StdCost {
  materials: number
  labour: number
  overhead: number
  hours: number
  total: number
  /** False when any BOM line's cost is unknown — the total then understates. */
  allPriced: boolean
}

export function standardCost(
  product: Pick<MfgProduct, "bom" | "route" | "wastePercent">,
  departments: DeptCapacityFields[],
  settings: MfgSettings,
  quantity: number
): StdCost {
  const q = quantity || 1
  let materials = 0
  let allPriced = true
  for (const b of product.bom || []) {
    if (b.unitCost == null) {
      allPriced = false
      continue
    }
    materials += b.qtyPerUnit * b.unitCost * (b.withWaste ? wasteFactor(product) : 1)
  }
  if (!settings.features.time) {
    return { materials: round2(materials * q), labour: 0, overhead: 0, hours: 0, total: round2(materials * q), allPriced }
  }
  const rateByDept = new Map(departments.map((d) => [d.id, Number(d.hourlyRate) || 0]))
  let hours = 0
  let labour = 0
  for (const r of product.route || []) {
    hours += r.hoursPerUnit
    labour += r.hoursPerUnit * (rateByDept.get(r.departmentId) || 0)
  }
  const overhead = hours * settings.overheadRatePerHour
  return {
    materials: round2(materials * q),
    labour: round2(labour * q),
    overhead: round2(overhead * q),
    hours: round2(hours * q),
    total: round2((materials + labour + overhead) * q),
    allPriced,
  }
}

export function materialCostOf(o: Pick<MfgOrderSlice, "materials">): { cost: number; allPriced: boolean } {
  let cost = 0
  let allPriced = true
  for (const m of o.materials) {
    if (m.state !== "received") continue
    if (m.unitCost == null) allPriced = false
    else cost += m.quantity * m.unitCost
  }
  return { cost: round2(cost), allPriced }
}

export function labourCostOf(
  o: Pick<MfgOrderSlice, "progress">,
  route: MfgRouteStep[],
  departments: DeptCapacityFields[],
  settings: MfgSettings
): number {
  if (!settings.features.time) return 0
  const rateByDept = new Map(departments.map((d) => [d.id, Number(d.hourlyRate) || 0]))
  return round2(o.progress.reduce((a, p, i) => a + p.hours * (rateByDept.get(route[i]?.departmentId || p.departmentId) || 0), 0))
}

export function overheadCostOf(o: Pick<MfgOrderSlice, "progress">, settings: MfgSettings): number {
  if (!settings.features.time) return 0
  return round2(hoursTotal(o) * settings.overheadRatePerHour)
}

export function orderCost(
  o: Pick<MfgOrderSlice, "materials" | "progress">,
  route: MfgRouteStep[],
  departments: DeptCapacityFields[],
  settings: MfgSettings
): number {
  return round2(materialCostOf(o).cost + labourCostOf(o, route, departments, settings) + overheadCostOf(o, settings))
}

/** What one unit has consumed up to and including step i — the scrap valuation. */
export function unitSunkCost(
  product: Pick<MfgProduct, "bom" | "route" | "wastePercent">,
  departments: DeptCapacityFields[],
  settings: MfgSettings,
  uptoIndex: number
): number {
  const route = (product.route || []).slice(0, uptoIndex + 1)
  const rateByDept = new Map(departments.map((d) => [d.id, Number(d.hourlyRate) || 0]))
  let m = 0
  let l = 0
  for (const r of route) {
    for (const b of bomFor(product, r.departmentId)) {
      if (b.unitCost != null) m += b.qtyPerUnit * b.unitCost * (b.withWaste ? wasteFactor(product) : 1)
    }
    if (settings.features.time) l += r.hoursPerUnit * ((rateByDept.get(r.departmentId) || 0) + settings.overheadRatePerHour)
  }
  return Math.round(m + l)
}

export interface HourVariance {
  index: number
  departmentId: string
  standard: number
  actual: number
  gap: number
  percent: number
}

/** Worst step running past its standard: >15% over AND at least 2h. */
export function hourVariance(
  o: Pick<MfgOrderSlice, "progress">,
  route: MfgRouteStep[],
  settings: MfgSettings
): HourVariance | null {
  if (!settings.features.time) return null
  let worst: HourVariance | null = null
  o.progress.forEach((p, i) => {
    const std = round2(p.done * (route[i]?.hoursPerUnit || 0))
    if (!p.done || !std) return
    if (p.hours > std * 1.15 && p.hours - std >= 2 && (!worst || p.hours - std > worst.gap)) {
      worst = {
        index: i,
        departmentId: route[i].departmentId,
        standard: std,
        actual: p.hours,
        gap: r1(p.hours - std),
        percent: Math.round((p.hours / std - 1) * 100),
      }
    }
  })
  return worst
}

/** The lowest price Finance's minimum margin accepts. */
export function minPriceFor(cost: number, settings: MfgSettings): number {
  const margin = Math.min(0.95, Math.max(0, settings.minMarginPercent / 100))
  return Math.round(cost / (1 - margin))
}

export function marginPercent(price: number, cost: number): number | null {
  if (!price) return null
  return Math.round(((price - cost) / price) * 100)
}

// ---------------------------------------------------------------------------
// Make or buy — the request screening
// ---------------------------------------------------------------------------

export type VerdictKind = "make" | "partial" | "buy_price" | "buy_capacity"

export interface Verdict {
  kind: VerdictKind
  makeQty: number
  possibleDays: number | null
  unitCost: number
  unitMaterialCost: number
  buyPrice: number | null
}

export function verdict(
  product: MfgProduct,
  quantity: number,
  neededInDays: number,
  inputs: ScheduleInput[],
  departments: DeptCapacityFields[],
  settings: MfgSettings
): Verdict {
  const std = standardCost(product, departments, settings, quantity)
  const unitCost = round2(std.total / (quantity || 1))
  const unitMaterialCost = round2(std.materials / (quantity || 1))
  const buy = product.referenceBuyPrice
  const base = { unitCost, unitMaterialCost, buyPrice: buy }
  if (buy != null && buy > 0 && buy < unitCost * 0.97)
    return { kind: "buy_price", makeQty: 0, possibleDays: settings.features.time ? possibleForDays(product, quantity, inputs, departments) : null, ...base }
  if (!settings.features.time) return { kind: "make", makeQty: quantity, possibleDays: null, ...base }
  const poss = possibleForDays(product, quantity, inputs, departments)
  if (poss <= neededInDays) return { kind: "make", makeQty: quantity, possibleDays: poss, ...base }
  const fit = fitQty(product, neededInDays, inputs, departments)
  if (fit > 0) return { kind: "partial", makeQty: Math.min(fit, quantity), possibleDays: poss, ...base }
  return { kind: "buy_capacity", makeQty: 0, possibleDays: poss, ...base }
}

// ---------------------------------------------------------------------------
// Cost estimates — the workshop issues cost and lead time; sales set the price
// ---------------------------------------------------------------------------

export type EstimateState = "draft" | "sent" | "quoted" | "won" | "lost"

export interface MfgEstimateLine {
  productId: string
  productName: string
  quantity: number
  unit: string
  materialCost: number
  labourCost: number
  overheadCost: number
  hours: number
  totalCost: number
}

export interface MfgCostEstimate {
  id: string
  organizationId: string
  estimateNumber: string
  requestId: string | null
  contactId: string | null
  contactName: string | null
  requestedBy: string | null
  neededBy: string | null
  validityDays: number
  note: string | null
  lines: MfgEstimateLine[]
  state: EstimateState
  sentAt?: string | null
  sentByName?: string | null
  quoteNumber?: string | null
  quotedPrice?: number | null
  quotedByName?: string | null
  quotedAt?: string | null
  financeApprovalBy?: string | null
  wonAt?: string | null
  wonConfirmedBy?: string | null
  workOrderIds?: string[]
  createdByUserId?: string
  createdByUserName?: string
  createdAt?: unknown
  updatedAt?: unknown
}

export function buildEstimateLines(
  lines: Array<{ product: MfgProduct; quantity: number }>,
  departments: DeptCapacityFields[],
  settings: MfgSettings
): MfgEstimateLine[] {
  return lines.map(({ product, quantity }) => {
    const std = standardCost(product, departments, settings, quantity)
    return {
      productId: product.id,
      productName: product.name,
      quantity,
      unit: product.unit,
      materialCost: std.materials,
      labourCost: std.labour,
      overheadCost: std.overhead,
      hours: std.hours,
      totalCost: std.total,
    }
  })
}

export function estimateCost(e: Pick<MfgCostEstimate, "lines">): number {
  return round2(e.lines.reduce((a, l) => a + l.totalCost, 0))
}

// ---------------------------------------------------------------------------
// Document numbers
// ---------------------------------------------------------------------------

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
function code(prefix: string): string {
  let suffix = ""
  for (let i = 0; i < 6; i++) suffix += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return `${prefix}-${suffix}`
}

export const generateWithdrawalNumber = (): string => code("MW")
export const generateEstimateNumber = (): string => code("CE")
export const generateMfgRequestNumber = (): string => code("MR")
export const generateScrapId = (): string => code("SC")

// ---------------------------------------------------------------------------
// The day view — what needs a decision, sorted by impact
// ---------------------------------------------------------------------------

export type DecisionKind =
  | "answer_request"
  | "send_estimate"
  | "log_quote"
  | "chase_quote"
  | "release_ready"
  | "release_blocked"
  | "record_slab"
  | "chase_drawing"
  | "materials_missing"
  | "confirm_materials"
  | "qc_decision"
  | "approve_scrap"
  | "issue_note"
  | "confirm_note"
  | "breakage_decision"
  | "hour_variance"
  | "will_miss_date"

export interface Decision {
  kind: DecisionKind
  weight: number
  orderId?: string
  requestId?: string
  estimateId?: string
  departmentId?: string
  noteId?: string
  quantity?: number
  value?: number
}

export interface DecisionContext {
  orders: Array<{ order: MfgOrderSlice; product: MfgProduct; notes: Array<MfgNoteSlice & { id: string }> }>
  requests: Array<{ id: string; state: string; ageHours: number }>
  estimates: Array<Pick<MfgCostEstimate, "id" | "state" | "sentAt" | "quotedAt">>
  schedule: Map<string, ScheduleResult>
  departments: DeptCapacityFields[]
  settings: MfgSettings
  today: string
}

export function buildDecisions(ctx: DecisionContext): Decision[] {
  const D: Decision[] = []
  const { settings } = ctx
  for (const r of ctx.requests) {
    if (r.state !== "new") continue
    const overdue = r.ageHours >= settings.answerWindowHours
    D.push({ kind: "answer_request", requestId: r.id, weight: overdue ? 40 + r.ageHours / 24 : 30 })
  }
  if (settings.features.estimates) {
    for (const e of ctx.estimates) {
      if (e.state === "draft") D.push({ kind: "send_estimate", estimateId: e.id, weight: 27 })
      if (e.state === "sent") D.push({ kind: "log_quote", estimateId: e.id, weight: 20 })
      if (e.state === "quoted") D.push({ kind: "chase_quote", estimateId: e.id, weight: 19 })
    }
  }
  for (const { order, product, notes } of ctx.orders) {
    if (order.status !== "open") continue
    const route = product.route
    if (order.releasedAt == null) {
      const blocks = releaseBlocks(order, product)
      if (!blocks.length) D.push({ kind: "release_ready", orderId: order.id, weight: 24 })
      else D.push({ kind: "release_blocked", orderId: order.id, weight: 35 })
    }
    if (order.releasedAt != null && product.requiresSlabApproval && !order.slabApproval)
      D.push({ kind: "record_slab", orderId: order.id, weight: 29 })
    if (order.releasedAt != null && product.requiresDrawingApproval && order.drawingApprovalStatus === "pending")
      D.push({ kind: "chase_drawing", orderId: order.id, weight: 26 })
    const released = order.materials.filter((m) => m.state === "released")
    if (released.length)
      D.push({ kind: "confirm_materials", orderId: order.id, departmentId: released[0].departmentId, weight: 24 })
    const ci = currentIndex(order, route, notes)
    if (ci >= 0) {
      const ms = materialState(order, product, route, ci)
      if (ms === "missing" || ms === "partial")
        D.push({ kind: "materials_missing", orderId: order.id, departmentId: route[ci].departmentId, weight: 26 })
    }
    order.progress.forEach((p, i) => {
      if (p.rejected > 0)
        D.push({ kind: "qc_decision", orderId: order.id, departmentId: route[i]?.departmentId, quantity: p.rejected, weight: 30 })
    })
    for (const s of order.scrap) {
      if (s.status === "pending") D.push({ kind: "approve_scrap", orderId: order.id, value: s.value, weight: 32 })
    }
    const ready = readyQty(order, route, notes)
    if (ready > 0) D.push({ kind: "issue_note", orderId: order.id, quantity: ready, weight: 22 })
    for (const n of notes) {
      if (n.status === "in_transit") D.push({ kind: "confirm_note", orderId: order.id, noteId: n.id, weight: 25 })
    }
    const broken = brokenUndecided(order, notes)
    if (broken > 0) D.push({ kind: "breakage_decision", orderId: order.id, quantity: broken, weight: 31 })
    const hv = hourVariance(order, route, settings)
    if (hv && order.releasedAt != null && !isDoneV2(order, route, notes))
      D.push({ kind: "hour_variance", orderId: order.id, departmentId: hv.departmentId, weight: hv.percent >= 25 ? 31 : 15 })
    if (order.releasedAt != null && !isDoneV2(order, route, notes) && order.neededBy) {
      const sched = ctx.schedule.get(order.id)
      const overdue = order.neededBy < ctx.today
      const willMiss =
        settings.features.time && sched ? daysFrom(ctx.today, order.neededBy) < sched.finishDays : false
      if (overdue || willMiss) D.push({ kind: "will_miss_date", orderId: order.id, weight: 34 })
    }
  }
  return D.sort((a, b) => b.weight - a.weight)
}

/** Whole days from ISO date a to ISO date b (negative when b is behind a). */
export function daysFrom(a: string, b: string): number {
  const da = new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()
  const db = new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime()
  return Math.round((db - da) / 86400000)
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

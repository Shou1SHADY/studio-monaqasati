// Manufacturing (التصنيع) — the marble line's domain engine. Pure math, no
// Firestore, no strings.
//
// The model (PRD 1.2): a work order is ONE product whose quantity walks the
// product's own route, station to station, by decision. The atomic event is a
// station recording its output and handing over; everything else — where each
// unit is, what blocks it, the honest date, the cost, the next step and who
// owns it — is DERIVED here and never stored.
//
// Manufacturing requests and reads; it never acts for another module. The
// facts other modules own (Finance confirming the down payment, Inventory
// issuing a withdrawal, Projects or the client approving a drawing, the
// destination receiving a note) arrive on the order as facts and show here as
// "awaiting {module}" steps that no manufacturing user can press.

export const MFG_PRODUCTS = "mfgProducts"
export const MFG_COST_ESTIMATES = "mfgCostEstimates"
export const MFG_SETTINGS = "manufacturingSettings"
export const MFG_STOPS = "mfgStops"
export const MFG_BLOCK_NOTICES = "mfgBlockNotices"
export const MFG_COUNTERS = "mfgCounters"

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

export type MfgFamily = "stone" | "wood" | "aluminium" | "steel" | "other"

export interface MfgRouteStep {
  departmentId: string
  departmentName: string
  /** Standard hours per unit. `null` = not estimated: the step is left out of
   * scheduling and it blocks a cost statement (PC-03). */
  hoursPerUnit: number | null
  /** Legacy: installation steps. There is no installation in Manufacturing
   * (D6) — the engine drops these steps from the route it computes on. */
  onSite?: boolean
}

export interface MfgBomLine {
  itemName: string
  unit: string
  qtyPerUnit: number
  /** The station that consumes it — materials are requested per station. */
  departmentId: string
  /** Planned waste applies (the slab is bought by area + waste, not net). */
  withWaste: boolean
  /** Snapshot cost; null means unknown — totals then say so instead of lying. */
  unitCost: number | null
  /** Tracked by block/lot — a different block is a different colour. */
  lotted?: boolean
  /** Consumed from station custody: backflushed at output on everything the
   * station worked, never requested per order and never blocking (MAT-08). */
  custody?: boolean
}

export interface MfgProduct {
  id: string
  organizationId: string
  name: string
  unit: string
  family: MfgFamily
  /** Made to measure — no release before a documented site survey. */
  requiresMeasurement: boolean
  /** No cutting before the shop drawing is approved (A or B). */
  requiresDrawingApproval: boolean
  /** The client signs off the slab (by block) before the saw runs. */
  requiresSlabApproval: boolean
  /** Percent (32 = 32%), applied to withWaste BOM lines. */
  wastePercent: number
  /** Legacy — prices and margins live in Sales and Finance (D10). Never shown. */
  salePrice?: number | null
  estimateValue?: number | null
  /** Procurement's reference supply price — the make-or-buy yardstick (read). */
  referenceBuyPrice: number | null
  route: MfgRouteStep[]
  bom: MfgBomLine[]
  archived?: boolean
  createdAt?: unknown
  updatedAt?: unknown
}

// ---------------------------------------------------------------------------
// Stations (the department registry)
// ---------------------------------------------------------------------------

/** An order-level step closed once by its approval, not counted in units. */
export type GateKind = "drawing" | "slab"

export interface DeptCapacityFields {
  id: string
  name?: string
  workers?: number | null
  hoursPerDay?: number | null
  hourlyRate?: number | null
  /** The lead who records this station's output (FL-13). A lead may own several. */
  leadUserId?: string | null
  leadUserName?: string | null
  /** QC & packing: only Quality records its output — the quality release. */
  qcStation?: boolean | null
  /** Order-level step. `undefined` = never set (read from the name). */
  gate?: GateKind | null
  onSite?: boolean
}

const GATE_NAME: Array<[RegExp, GateKind]> = [
  [/تصميم|مخطط|design|drawing|nesting/i, "drawing"],
  [/فرز|اعتماد العميل|البلاطات|slab/i, "slab"],
]

/** The station's order-level step, if any. Older registries never set one, so
 * the step is read from the station's name until the manager sets it. */
export function stationGate(d: Pick<DeptCapacityFields, "gate" | "name"> | undefined): GateKind | null {
  if (!d) return null
  if (d.gate !== undefined) return d.gate ?? null
  const hit = GATE_NAME.find(([re]) => re.test(d.name || ""))
  return hit ? hit[1] : null
}

export function isQcStation(d: Pick<DeptCapacityFields, "qcStation" | "name"> | undefined): boolean {
  if (!d) return false
  if (d.qcStation != null) return !!d.qcStation
  return /فحص|جودة|تغليف|quality|inspect|qc\b|packing/i.test(d.name || "")
}

export function deptCapacity(dept: Pick<DeptCapacityFields, "workers" | "hoursPerDay">): number {
  return Math.max(1, Number(dept.workers) || 1) * Math.max(1, Number(dept.hoursPerDay) || 8)
}

// ---------------------------------------------------------------------------
// Settings — what the org uses of the module, and Finance's policies
// ---------------------------------------------------------------------------

export interface MfgSettings {
  /** Feature switches: turning one off hides a whole computation, deletes nothing. */
  features: { time: boolean; estimates: boolean; checklists: boolean }
  /** Finance policies — read here, owned (and edited) by Finance (FN-01). */
  overheadRatePerHour: number
  /** Scrap value the workshop manager may approve; above it → cost controller. */
  scrapApprovalLimit: number
  answerWindowHours: number
  /** An unconfirmed delivery note escalates to the manager after this. */
  noteEscalationHours: number
  /** A cost statement sent to Sales holds this many days. */
  estimateValidityDays: number
  /** Returned usable remnants are credited at this percent of the slab price. */
  remnantValuePercent: number
  /** Legacy — the margin floor lives in Sales and Finance (D10). */
  minMarginPercent?: number
}

export const DEFAULT_MFG_SETTINGS: MfgSettings = {
  features: { time: true, estimates: true, checklists: true },
  overheadRatePerHour: 32,
  scrapApprovalLimit: 3000,
  answerWindowHours: 24,
  noteEscalationHours: 48,
  estimateValidityDays: 15,
  remnantValuePercent: 50,
}

export function normalizeMfgSettings(raw: Partial<MfgSettings> | null | undefined): MfgSettings {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
  return {
    features: { ...DEFAULT_MFG_SETTINGS.features, ...(raw?.features || {}) },
    overheadRatePerHour: num(raw?.overheadRatePerHour, DEFAULT_MFG_SETTINGS.overheadRatePerHour),
    scrapApprovalLimit: num(raw?.scrapApprovalLimit, DEFAULT_MFG_SETTINGS.scrapApprovalLimit),
    answerWindowHours: num(raw?.answerWindowHours, DEFAULT_MFG_SETTINGS.answerWindowHours),
    noteEscalationHours: num(raw?.noteEscalationHours, DEFAULT_MFG_SETTINGS.noteEscalationHours),
    estimateValidityDays: num(raw?.estimateValidityDays, DEFAULT_MFG_SETTINGS.estimateValidityDays),
    remnantValuePercent: num(raw?.remnantValuePercent, DEFAULT_MFG_SETTINGS.remnantValuePercent),
  }
}

// ---------------------------------------------------------------------------
// Order records — facts, each signed by whoever recorded it
// ---------------------------------------------------------------------------

export interface StageProgress {
  departmentId: string
  /** Good output handed to the next step. */
  done: number
  /** Rejected here, waiting for a QC decision. */
  rejected: number
  /** Quantity sent back here for rework or re-make (adds to what it must process). */
  rework: number
  /** Actual labour hours reported (optional) — cost is built from these. */
  hours: number
  /** Quantity QC sent from here back to an EARLIER station. It left this
   * station and is not in its hands (the v8 double-count fix). */
  back?: number
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
  /** A block other than the approved one — only with documented client consent. */
  consentNote?: string | null
  releasedByName?: string | null
  releasedAt?: string | null
  receivedByName?: string | null
  receivedAt?: string | null
}

export const DEFECT_KINDS = ["crack", "vein", "stain", "chip", "size", "gloss", "handling", "other"] as const
export type DefectKind = (typeof DEFECT_KINDS)[number]

/** Where a defect came from: a station id, the material (block), or unknown —
 * not where it was found (D17). */
export type DefectCause = string

export const CAUSE_MATERIAL = "material"
export const CAUSE_UNKNOWN = "unknown"

/** A non-conformance record — every reject is typed (FL-10). */
export interface RejectRecord {
  id: string
  index: number
  departmentId: string
  quantity: number
  defect: DefectKind
  cause: DefectCause
  photoAttached: boolean
  note: string | null
  by: string
  byId: string
  at: string
}

export type ScrapStatus = "pending" | "approved" | "returned"
export type ScrapBearer = "workshop" | "supplier" | "carrier" | "client"

export interface WorkOrderScrap {
  id: string
  quantity: number
  /** Computed from what the unit had consumed up to its station — never typed. */
  value: number
  reason: string
  departmentId: string
  /** Station index on the route; older records carry only the department. */
  index?: number
  defect?: DefectKind | null
  cause?: DefectCause | null
  raisedByUserId: string
  raisedByName: string
  raisedAt: string
  status: ScrapStatus
  approvedByName?: string | null
  approvedAt?: string | null
  classification?: "normal" | "abnormal" | null
  bearer?: ScrapBearer | null
  /** Returned for clarification: the approver's question and QC's answer. */
  question?: string | null
  questionBy?: string | null
  clarification?: string | null
  /** Re-make or declared shortfall. `null` = undecided; absent = older record. */
  decision?: "remake" | "shortfall" | null
  decidedBy?: string | null
  decidedAt?: string | null
  /** Downgraded to a usable remnant: the credit already netted off `value`. */
  remnantCredit?: number | null
}

/** A survey is a document, not a date (ORD-10). */
export interface SurveyRecord {
  at: string
  by: string
  byId?: string | null
  note?: string | null
  measuredQuantity?: number | null
  sketchUrl?: string | null
  sketchName?: string | null
}
export type MeasurementRecord = SurveyRecord

/** `workshop`: a stock order has no outside owner — its drawing is ours (D12). */
export type ApproverOrg = "technical_office" | "consultant" | "client" | "workshop"
export type DrawingCode = "A" | "B" | "C"

export interface CutPiece {
  no: string
  length: number
  width: number
  thickness: number | null
  edge: string | null
  cutouts: string | null
}

/** We produce and submit; the approver's module records A/B/C (FL-07). */
export interface DrawingRecord {
  revision: number
  approverOrg: ApproverOrg
  /** Set when submitted; null while in design. */
  submittedAt: string | null
  submittedBy: string | null
  submittedById?: string | null
  note?: string | null
  fileUrl?: string | null
  fileName?: string | null
  cutList?: CutPiece[]
  /** Result for the current revision (recorded in Projects or Sales). */
  code: DrawingCode | null
  resultNotes?: string | null
  approverName?: string | null
  recordedBy?: string | null
  recordedById?: string | null
  recordedAt?: string | null
  /** Notes of the last C — shown while the drawing is revised. */
  previousC?: string | null
  /** The approver's evidence (the client's signed copy, the stamped submittal). */
  resultFileUrl?: string | null
  resultFileName?: string | null
}

export type DrawingApprovalStatus = "na" | "pending" | "approved"

export interface SlabApproval {
  at: string
  by: string
  byId?: string | null
  lot: string
  /** The day the client signed (ISO date) — `at` is when it was recorded. */
  signedOn?: string | null
  /** The slab quantity reserved on the block at sign-off. */
  quantity?: number | null
  slabNumbers?: string | null
  photosAttached?: boolean
  formUrl?: string | null
  formName?: string | null
  note?: string | null
  /** A re-make from another block — documented client consent. */
  alternativeLot?: { lot: string; consent: string; by: string; at: string } | null
}

export interface RushRecord {
  reason: string
  by: string
  at: string
  /** The orders it delays, named before confirming (ORD-09). */
  delays?: number[]
}

export interface QcRelease {
  quantity: number
  by: string
  byId?: string | null
  at: string
  photosAttached?: boolean
}

export interface ClosureRecord {
  quantity: number
  by: string
  byId?: string | null
  at: string
}

export interface FrozenCost {
  cost: number
  at: string
  by: string
}

export interface RemnantRecord {
  id: string
  area: number
  itemName: string
  unit: string
  lot: string | null
  /** Credit at Finance's remnant policy — lands only at Inventory's receipt. */
  value: number
  state: "returned" | "received"
  source: "output" | "qc" | "cancel"
  by: string
  byId?: string | null
  at: string
  receivedBy?: string | null
  receivedAt?: string | null
  warehouseId?: string | null
}

export interface PurchaseRequestRecord {
  id: string
  itemName: string
  unit: string
  quantity: number
  needBy: string | null
  note: string | null
  by: string
  byId?: string | null
  at: string
  state: "sent" | "arrived"
  arrivedAt?: string | null
}

export interface OverrideRecord {
  reason: string
  by: string
  byId?: string | null
  at: string
}

/** An incoming change from the order's owner — applied by the manager (D12). */
export interface ChangeRequest {
  kind: "quantity" | "cancel"
  newQuantity: number | null
  reason: string
  module: "sales" | "procurement" | "projects"
  by: string
  byId?: string | null
  at: string
}

export interface CancellationRecord {
  at: string
  by: string
  reason: string
  wip: "scrap" | "remnant"
  fromModule?: ChangeRequest["module"] | null
}

export type VarianceCause = "genuine" | "unrecorded_rework" | "standard_wrong" | "entry_error"

export interface VarianceReview {
  cause: VarianceCause
  note: string | null
  by: string
  at: string
}

export type ChecklistMarks = Record<string, Record<string, { by: string; at: string }>>

export interface OrderLogEvent {
  kind: string
  at: string
  by: string | null
  detail?: string | null
  tone?: "ok" | "bad" | "neutral"
}

export type OrderSource = "client" | "project" | "stock"

/** The down payment of a client order: Sales reports it, Finance confirms it.
 * We read it and never confirm it (D5). */
export interface DownPaymentState {
  required: boolean
  confirmed: boolean
  percent: number | null
}

export interface MfgOrderSlice {
  id: string
  number: number
  productId: string
  quantity: number
  neededBy: string | null
  createdAt2: string
  releasedAt: string | null
  source: OrderSource
  downPayment: DownPaymentState
  survey: SurveyRecord | null
  drawing: DrawingRecord | null
  slabApproval: SlabApproval | null
  rush: RushRecord | null
  progress: StageProgress[]
  materials: WorkOrderMaterial[]
  scrap: WorkOrderScrap[]
  rejects: RejectRecord[]
  qcReleases: QcRelease[]
  /** `null` = an order from before production close existed: what finished is closed. */
  closures: ClosureRecord[] | null
  frozenCost: FrozenCost | null
  remade: number
  shortfall: number
  brokenResolved: number
  remnants: RemnantRecord[]
  purchaseRequests: PurchaseRequestRecord[]
  overrides: Record<string, OverrideRecord>
  changeRequest: ChangeRequest | null
  cancellation: CancellationRecord | null
  varianceReviews: Record<string, VarianceReview>
  checklists?: ChecklistMarks
  status: "open" | "done" | "cancelled"
}

/** Delivery-note slice — a shipped quantity and its transit breakage. */
export interface MfgNoteSlice {
  id?: string
  number?: string
  quantity: number
  brokenQuantity: number
  status: "in_transit" | "received" | "rejected"
  sentAt?: string | null
  toKind?: string | null
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100
export const r1 = (n: number): number => Math.round((Number(n) || 0) * 10) / 10

const COUNT_UNIT = /^(pc|pcs|piece|pieces|set|sets|crate|crates|pail|pails|box|boxes|unit|units|ea|each|حبة|قطعة|طقم|صندوق|عبوة|وحدة|كرتون)$/i

/** A need is rounded UP — no shortage is created by rounding: fractional units
 * to one decimal, counted units to whole ones. */
export function roundNeed(unit: string, v: number): number {
  if (!(v > 0)) return 0
  return COUNT_UNIT.test((unit || "").trim()) ? Math.ceil(v - 1e-9) : Math.ceil(v * 10 - 1e-6) / 10
}

export function wasteFactor(product: Pick<MfgProduct, "wastePercent">): number {
  return 1 + Math.max(0, Number(product.wastePercent) || 0) / 100
}

export function emptyProgress(route: MfgRouteStep[]): StageProgress[] {
  return route.map((r) => ({ departmentId: r.departmentId, done: 0, rejected: 0, rework: 0, hours: 0, back: 0 }))
}

/** The route the workshop runs: installation steps are not ours (D6). */
export function effectiveRoute(product: Pick<MfgProduct, "route">): MfgRouteStep[] {
  return (product.route || []).filter((r) => !r.onSite)
}

export const itemKey = (name: string): string => (name || "").trim().toLowerCase()

// ---------------------------------------------------------------------------
// The order, computed — every unit in exactly one place
// ---------------------------------------------------------------------------

/** How a route step closes: by a recorded fact (drawing/slab), by a one-off
 * "done" (an order-level step the product has no flag for), or by output. */
export type GateMode = "drawing" | "slab" | "manual" | null

export type Stage = "cancel" | "pay" | "wait" | "prod" | "close" | "ready" | "transit" | "done"
export const STAGES: Stage[] = ["pay", "wait", "prod", "close", "ready", "transit", "done"]

export type DrawingState = "na" | "draft" | "wait" | "ok"

export interface OrderCalc {
  slice: MfgOrderSlice
  product: MfgProduct
  route: MfgRouteStep[]
  stations: Array<DeptCapacityFields | undefined>
  gates: GateMode[]
  notes: MfgNoteSlice[]
  released: boolean
  cancelled: boolean
  inAt: number[]
  done: number[]
  pend: number[]
  scrapAt: number[]
  /** First step counted in units (not an order-level step). */
  firstQ: number
  lastI: number
  finished: number
  closed: number
  toClose: number
  out: number
  shipped: number
  broken: number
  brokenOpen: number
  delivered: number
  ready: number
  rejected: number
  wip: number
  target: number
  scrapAll: number
  scrapApproved: number
  scrapPending: number
  scrapReturned: number
  scrapUndecided: number
  scrapValueApproved: number
  drawingState: DrawingState
  drawingOk: boolean
  prodDone: boolean
  done_: boolean
  live: boolean
  stage: Stage
  current: number
  active: number[]
}

export function drawingStateOf(slice: Pick<MfgOrderSlice, "drawing">, product: Pick<MfgProduct, "requiresDrawingApproval">): DrawingState {
  if (!product.requiresDrawingApproval) return "na"
  const d = slice.drawing
  if (d?.code === "A" || d?.code === "B") return "ok"
  if (d?.submittedAt && !d.code) return "wait"
  return "draft"
}

export function computeOrder(
  slice: MfgOrderSlice,
  product: MfgProduct,
  departments: DeptCapacityFields[],
  notes: MfgNoteSlice[]
): OrderCalc {
  const route = effectiveRoute(product)
  const n = route.length
  const byId = new Map(departments.map((d) => [d.id, d]))
  const stations = route.map((r) => byId.get(r.departmentId))
  const drawingState = drawingStateOf(slice, product)
  const drawingOk = drawingState === "ok" || drawingState === "na"
  const gates: GateMode[] = route.map((r, i) => {
    const g = stationGate(stations[i] || { name: r.departmentName })
    if (g === "drawing") return product.requiresDrawingApproval ? "drawing" : "manual"
    if (g === "slab") return product.requiresSlabApproval ? "slab" : "manual"
    return null
  })
  const released = slice.releasedAt != null
  const cancelled = slice.status === "cancelled"
  const scrapIndex = (s: WorkOrderScrap) => (s.index != null ? s.index : route.findIndex((r) => r.departmentId === s.departmentId))

  const inAt: number[] = []
  const done: number[] = []
  const pend: number[] = []
  const scrapAt: number[] = []
  for (let i = 0; i < n; i++) {
    const p = slice.progress[i]
    const rw = p?.rework || 0
    const base = i === 0 ? (released ? slice.quantity : 0) : done[i - 1]
    inAt[i] = round2(base + rw)
    if (gates[i] === "drawing") done[i] = drawingOk ? inAt[i] : 0
    else if (gates[i] === "slab") done[i] = slice.slabApproval ? inAt[i] : 0
    else done[i] = p?.done || 0
    scrapAt[i] = round2(slice.scrap.filter((s) => scrapIndex(s) === i).reduce((a, s) => a + s.quantity, 0))
    pend[i] = cancelled ? 0 : Math.max(0, round2(inAt[i] - done[i] - (p?.rejected || 0) - scrapAt[i] - (p?.back || 0)))
  }
  const fq = gates.findIndex((g) => g == null)
  const firstQ = fq < 0 ? 0 : fq
  const lastI = Math.max(0, n - 1)
  const finished = n ? done[lastI] : 0
  const closed = slice.closures == null ? finished : round2(slice.closures.reduce((a, c) => a + c.quantity, 0))
  const toClose = cancelled ? 0 : Math.max(0, round2(finished - closed))
  const out = round2(notes.filter((x) => x.status !== "rejected").reduce((a, x) => a + x.quantity, 0))
  const shipped = round2(notes.filter((x) => x.status === "in_transit").reduce((a, x) => a + x.quantity, 0))
  const broken = round2(notes.reduce((a, x) => a + (x.brokenQuantity || 0), 0))
  const brokenOpen = Math.max(0, round2(broken - (slice.brokenResolved || 0)))
  const delivered = round2(notes.filter((x) => x.status === "received").reduce((a, x) => a + x.quantity - (x.brokenQuantity || 0), 0))
  const ready = cancelled ? 0 : Math.max(0, round2(closed - out))
  const rejected = round2(slice.progress.slice(0, n).reduce((a, p) => a + (p?.rejected || 0), 0))
  const wip = round2(pend.reduce((a, x) => a + x, 0))
  const target = round2(slice.quantity - (slice.shortfall || 0))
  const sum = (f: (s: WorkOrderScrap) => boolean) => round2(slice.scrap.filter(f).reduce((a, s) => a + s.quantity, 0))
  const scrapAll = sum(() => true)
  const scrapApproved = sum((s) => s.status === "approved")
  const scrapPending = sum((s) => s.status === "pending")
  const scrapReturned = sum((s) => s.status === "returned")
  const scrapUndecided = sum((s) => s.decision === null && s.status !== "returned")
  const scrapValueApproved = round2(slice.scrap.filter((s) => s.status === "approved").reduce((a, s) => a + s.value, 0))

  const prodDone =
    released && !cancelled && wip === 0 && rejected === 0 && scrapPending === 0 && scrapReturned === 0 && scrapUndecided === 0 && toClose === 0 && closed > 0
  const computedDone = prodDone && ready === 0 && shipped === 0 && brokenOpen === 0 && delivered >= target - 1e-6
  // An order from before production close keeps the "done" it was given.
  const done_ = !cancelled && (computedDone || (slice.closures == null && slice.status === "done"))
  const live = !cancelled && !done_

  let stage: Stage
  if (cancelled) stage = "cancel"
  else if (!slice.downPayment.confirmed && slice.downPayment.required && !released) stage = "pay"
  else if (!released) stage = "wait"
  else if (done_) stage = "done"
  else if (wip > 0 || rejected > 0 || scrapPending > 0 || scrapReturned > 0 || scrapUndecided > 0) stage = "prod"
  else if (toClose > 0) stage = "close"
  else if (ready > 0) stage = "ready"
  else if (shipped > 0 || brokenOpen > 0) stage = "transit"
  else stage = "prod"

  const active: number[] = []
  pend.forEach((q, i) => {
    if (q > 0) active.push(i)
  })

  return {
    slice,
    product,
    route,
    stations,
    gates,
    notes,
    released,
    cancelled,
    inAt,
    done,
    pend,
    scrapAt,
    firstQ,
    lastI,
    finished,
    closed,
    toClose,
    out,
    shipped,
    broken,
    brokenOpen,
    delivered,
    ready,
    rejected,
    wip,
    target,
    scrapAll,
    scrapApproved,
    scrapPending,
    scrapReturned,
    scrapUndecided,
    scrapValueApproved,
    drawingState,
    drawingOk,
    prodDone,
    done_,
    live,
    stage,
    current: active.length ? active[0] : -1,
    active,
  }
}

/** The invariant (every unit in exactly one place): in hand + rejected + scrap +
 * awaiting close + ready + in transit + delivered + broken = released quantity
 * + re-made. Returns the gap — 0 (to 0.01) when the order is consistent. */
export function conservationGap(c: OrderCalc): number {
  if (!c.released || c.cancelled) return 0
  const placed = c.wip + c.rejected + c.scrapAll + c.toClose + c.ready + c.shipped + c.delivered + c.broken
  return round2(placed - (c.slice.quantity + (c.slice.remade || 0)))
}

/** What is still to come through step i (itself included): nothing before
 * release is known, so the whole quantity. */
export function remAt(c: OrderCalc, i: number): number {
  if (c.cancelled) return 0
  if (!c.released) return c.slice.quantity
  let s = 0
  for (let j = 0; j <= i; j++) s += c.pend[j] || 0
  return round2(s)
}

// ---------------------------------------------------------------------------
// Materials — planned waste is part of the need; the slab is requested per
// order, consumables come from station custody
// ---------------------------------------------------------------------------

export interface MaterialNeedLine {
  itemName: string
  unit: string
  withWaste: boolean
  lotted: boolean
  unitCost: number | null
  /** Per unit, waste included. */
  per: number
  /** Net need for the units passing the station. */
  net: number
  /** Net + planned waste — what is requested from the store. */
  qty: number
}

export function bomFor(product: Pick<MfgProduct, "bom">, departmentId: string): MfgBomLine[] {
  return (product.bom || []).filter((b) => b.departmentId === departmentId)
}

/** Lines requested per order (custody consumables are not). */
export function requestedBom(product: Pick<MfgProduct, "bom">, departmentId?: string): MfgBomLine[] {
  return (product.bom || []).filter((b) => !b.custody && (!departmentId || b.departmentId === departmentId))
}

const perUnit = (product: Pick<MfgProduct, "wastePercent">, b: MfgBomLine) => b.qtyPerUnit * (b.withWaste ? wasteFactor(product) : 1)

/** Units passing station i over the order's life: what it finished, what was
 * scrapped there, and everything still before or at it. */
export function unitsThrough(c: OrderCalc, i: number): number {
  return round2((c.done[i] || 0) + (c.scrapAt[i] || 0) + remAt(c, i))
}

export function materialNeed(c: OrderCalc, i: number): MaterialNeedLine[] {
  const step = c.route[i]
  if (!step) return []
  const units = unitsThrough(c, i)
  return requestedBom(c.product, step.departmentId)
    .map((b) => ({
      itemName: b.itemName,
      unit: b.unit,
      withWaste: b.withWaste,
      lotted: !!b.lotted,
      unitCost: b.unitCost,
      per: perUnit(c.product, b),
      net: roundNeed(b.unit, b.qtyPerUnit * units),
      qty: roundNeed(b.unit, perUnit(c.product, b) * units),
    }))
    .filter((x) => x.qty > 0)
}

export function materialReceived(o: Pick<MfgOrderSlice, "materials">, departmentId: string, itemName: string): number {
  return round2(
    o.materials.filter((m) => m.departmentId === departmentId && itemKey(m.itemName) === itemKey(itemName) && m.state === "received").reduce((a, m) => a + m.quantity, 0)
  )
}

/** Requested or issued, not yet received. */
export function materialOpen(o: Pick<MfgOrderSlice, "materials">, departmentId: string, itemName: string): number {
  return round2(
    o.materials.filter((m) => m.departmentId === departmentId && itemKey(m.itemName) === itemKey(itemName) && m.state !== "received").reduce((a, m) => a + m.quantity, 0)
  )
}

/** none: nothing requested here · missing: not requested · requested: at the
 * store · released: issued, confirm receipt · partial · complete. */
export type StationMaterialState = "none" | "missing" | "requested" | "released" | "partial" | "complete"

export function materialState(c: OrderCalc, i: number): StationMaterialState {
  const step = c.route[i]
  if (!step || c.gates[i]) return "none"
  const need = materialNeed(c, i)
  if (!need.length) return "none"
  let full = true
  let any = false
  for (const x of need) {
    const got = materialReceived(c.slice, step.departmentId, x.itemName)
    if (got < x.qty - 0.05) full = false
    if (got > 0) any = true
  }
  if (full) return "complete"
  const rows = c.slice.materials.filter((m) => m.departmentId === step.departmentId)
  if (rows.some((m) => m.state === "released")) return "released"
  if (rows.some((m) => m.state === "requested")) return "requested"
  return any ? "partial" : "missing"
}

/** Units the received materials cover at station i (Infinity when nothing is
 * requested there). */
export function coveredUnits(c: OrderCalc, i: number): number {
  const step = c.route[i]
  if (!step) return Infinity
  const lines = requestedBom(c.product, step.departmentId)
  if (!lines.length) return Infinity
  return Math.min(
    ...lines.map((b) => {
      const per = perUnit(c.product, b)
      return per > 0 ? materialReceived(c.slice, step.departmentId, b.itemName) / per : Infinity
    })
  )
}

/** What may still be recorded at station i without an override (MAT-03). */
export function canDo(c: OrderCalc, i: number): number {
  const cov = coveredUnits(c, i)
  if (cov === Infinity) return Infinity
  const p = c.slice.progress[i]
  return Math.max(0, Math.floor((cov - (c.done[i] || 0) - (p?.rejected || 0) - (c.scrapAt[i] || 0)) * 100 + 1e-6) / 100)
}

/** Items requested per order (custody excluded), once each. */
export function requestedItems(product: Pick<MfgProduct, "bom">): Array<{ itemName: string; unit: string; lotted: boolean }> {
  const seen = new Map<string, { itemName: string; unit: string; lotted: boolean }>()
  for (const b of requestedBom(product)) if (!seen.has(itemKey(b.itemName))) seen.set(itemKey(b.itemName), { itemName: b.itemName, unit: b.unit, lotted: !!b.lotted })
  return Array.from(seen.values())
}

/** The order's main slab: its first waste-bearing line. */
export function mainMaterial(product: Pick<MfgProduct, "bom">): MfgBomLine | null {
  return (product.bom || []).find((b) => b.withWaste && !b.custody) || null
}

/** Still to be requested for an item across the route: need − received − open. */
export function needRemain(c: OrderCalc, itemName: string): number {
  let total = 0
  c.route.forEach((step, i) => {
    if (c.gates[i]) return
    for (const b of requestedBom(c.product, step.departmentId)) {
      if (itemKey(b.itemName) !== itemKey(itemName)) continue
      const qty = roundNeed(b.unit, perUnit(c.product, b) * unitsThrough(c, i))
      total += Math.max(0, qty - materialReceived(c.slice, step.departmentId, b.itemName) - materialOpen(c.slice, step.departmentId, b.itemName))
    }
  })
  return r1(total)
}

// ---------------------------------------------------------------------------
// Stock: availability, reservations and blocks — derived, never double-spent
// ---------------------------------------------------------------------------

export interface StockLot {
  itemName: string
  lot: string
  quantity: number
  /** A usable remnant returned by an earlier order. */
  remnant?: boolean
}

export interface StockIndex {
  /** On-hand quantity by item key (all warehouses). */
  onHand: Map<string, number>
  lots: StockLot[]
}

export interface Allocation {
  /** Per order → per item key → reserved for it. */
  reserved: Map<string, Map<string, number>>
  /** Per item key → free after every open withdrawal and reservation. */
  free: Map<string, number>
}

/** Release reserves the need incl. waste (MAT-04). Reservations are allocated
 * in queue order (rush, need date, age) and never exceed what is on hand; a
 * withdrawal already requested but not issued holds its quantity too. */
export function allocateStock(calcs: OrderCalc[], stock: StockIndex): Allocation {
  const free = new Map(stock.onHand)
  for (const c of calcs) {
    if (!c.live) continue
    for (const m of c.slice.materials) {
      if (m.state !== "requested") continue
      const k = itemKey(m.itemName)
      free.set(k, r1((free.get(k) || 0) - m.quantity))
    }
  }
  const reserved = new Map<string, Map<string, number>>()
  const queue = calcs.filter((c) => c.live && c.released).sort(queueOrder)
  for (const c of queue) {
    const mine = new Map<string, number>()
    for (const it of requestedItems(c.product)) {
      const k = itemKey(it.itemName)
      const want = needRemain(c, it.itemName)
      const got = Math.max(0, Math.min(want, free.get(k) || 0))
      if (got > 0) {
        mine.set(k, r1(got))
        free.set(k, r1((free.get(k) || 0) - got))
      }
    }
    reserved.set(c.slice.id, mine)
  }
  return { reserved, free }
}

export function queueOrder(a: OrderCalc, b: OrderCalc): number {
  const rush = Number(!!b.slice.rush) - Number(!!a.slice.rush)
  if (rush) return rush
  const ad = a.slice.neededBy || "9999-12-31"
  const bd = b.slice.neededBy || "9999-12-31"
  if (ad !== bd) return ad < bd ? -1 : 1
  return a.slice.createdAt2 < b.slice.createdAt2 ? -1 : a.slice.createdAt2 > b.slice.createdAt2 ? 1 : 0
}

export interface ShortLine {
  itemName: string
  unit: string
  short: number
  /** The purchase request already sent for it, if any. */
  requested: PurchaseRequestRecord | null
}

/** Need the store cannot cover — the fix is a purchase request (MAT-05). */
export function shortages(c: OrderCalc, alloc: Allocation): ShortLine[] {
  if (!c.released || !c.live) return []
  const mine = alloc.reserved.get(c.slice.id) || new Map<string, number>()
  return requestedItems(c.product)
    .map((it) => {
      const k = itemKey(it.itemName)
      const short = Math.max(0, r1(needRemain(c, it.itemName) - (mine.get(k) || 0) - Math.max(0, alloc.free.get(k) || 0)))
      const requested = c.slice.purchaseRequests.find((p) => p.state === "sent" && itemKey(p.itemName) === k) || null
      return { itemName: it.itemName, unit: it.unit, short, requested }
    })
    .filter((x) => x.short > 0)
}

/** Slab still to be received on the approved block. */
export function slabOpen(c: OrderCalc): number {
  const s = c.slice.slabApproval
  const main = mainMaterial(c.product)
  if (!s || c.cancelled || !main) return 0
  const got = c.slice.materials
    .filter((m) => itemKey(m.itemName) === itemKey(main.itemName) && m.lot === s.lot && m.state === "received")
    .reduce((a, m) => a + m.quantity, 0)
  return Math.max(0, r1((s.quantity || 0) - got))
}

/** What a block still offers after other live orders' signed-off slabs. */
export function lotFree(stock: StockIndex, itemName: string, lot: string, calcs: OrderCalc[], exceptOrderId?: string): number {
  const L = stock.lots.find((l) => itemKey(l.itemName) === itemKey(itemName) && l.lot === lot)
  if (!L) return 0
  const held = calcs
    .filter((c) => c.slice.id !== exceptOrderId && c.live && c.slice.slabApproval?.lot === lot)
    .reduce((a, c) => a + slabOpen(c), 0)
  return Math.max(0, r1(L.quantity - held))
}

// ---------------------------------------------------------------------------
// Blocks — recorded facts, not checkboxes
// ---------------------------------------------------------------------------

export type BlockKey = "down_payment" | "survey" | "drawing" | "slab" | "materials"

export interface Block {
  key: BlockKey
  severity: "hard" | "soft"
  /** materials: what the received materials cover. */
  covers?: number
}

/** What stands between the order and release (T6). */
export function releaseBlocks(c: OrderCalc): Block[] {
  const b: Block[] = []
  if (c.slice.downPayment.required && !c.slice.downPayment.confirmed) b.push({ key: "down_payment", severity: "hard" })
  if (c.product.requiresMeasurement && !c.slice.survey) b.push({ key: "survey", severity: "hard" })
  return b
}

/** What stops step i. The approvals gate the saw (the first unit step); the
 * materials block beyond what the received materials cover, unless overridden. */
export function stationBlocks(c: OrderCalc, i: number): Block[] {
  const b: Block[] = []
  const step = c.route[i]
  if (!step) return b
  if (i === c.firstQ) {
    if (!c.drawingOk) b.push({ key: "drawing", severity: "hard" })
    if (c.product.requiresSlabApproval && !c.slice.slabApproval) b.push({ key: "slab", severity: "hard" })
  }
  if (!c.gates[i] && c.pend[i] > 0) {
    const ms = materialState(c, i)
    const cd = canDo(c, i)
    if (ms !== "none" && cd < c.pend[i] && !c.slice.overrides[step.departmentId]) b.push({ key: "materials", severity: "soft", covers: cd })
  }
  return b
}

export const hardBlocked = (c: OrderCalc, i: number) => stationBlocks(c, i).some((x) => x.severity === "hard")

// ---------------------------------------------------------------------------
// Capacity & the honest date
// ---------------------------------------------------------------------------

export interface ScheduleResult {
  /** Working days from today until the last remaining step finishes; null when
   * no honest date exists (materials short and not yet arrived — D16). */
  finishDays: number | null
  waitDepartmentId: string | null
  waitDays: number
  /** The condition the date assumes resolved today, if any. */
  condition: "pay" | "release" | "materials" | "drawing" | "slab" | null
}

export function conditionOf(c: OrderCalc, alloc: Allocation | null): ScheduleResult["condition"] {
  if (c.slice.downPayment.required && !c.slice.downPayment.confirmed && !c.released) return "pay"
  if (!c.released) return "release"
  if (alloc && shortages(c, alloc).length) return "materials"
  if (!c.drawingOk) return "drawing"
  if (c.product.requiresSlabApproval && !c.slice.slabApproval) return "slab"
  return null
}

/** Lost hours today shift a station's queue (FL-14). */
export type LostHours = Map<string, number>

/** Forward-load every live released order (rush, need date, age) onto daily
 * capacity after today's stops; unreleased orders join the back of the queue
 * with a conditional date. A shortage has no date until the materials arrive. */
export function scheduleOrders(
  calcs: OrderCalc[],
  departments: DeptCapacityFields[],
  lost: LostHours = new Map(),
  alloc: Allocation | null = null
): Map<string, ScheduleResult> {
  const capBy = new Map(departments.map((d) => [d.id, deptCapacity(d)]))
  const free = new Map<string, number>()
  for (const d of departments) free.set(d.id, (lost.get(d.id) || 0) / Math.max(1, capBy.get(d.id) || 8))
  const out = new Map<string, ScheduleResult>()
  const released = calcs.filter((c) => c.live && c.released).sort(queueOrder)
  for (const c of released) {
    let t = 0
    let worst: string | null = null
    let worstWait = 0
    c.route.forEach((r, i) => {
      if (r.hoursPerUnit == null) return
      const rem = remAt(c, i)
      if (rem <= 0) return
      const cap = capBy.get(r.departmentId) || 8
      const start = Math.max(t, free.get(r.departmentId) || 0)
      if (start - t > worstWait) {
        worstWait = start - t
        worst = r.departmentId
      }
      free.set(r.departmentId, start + (rem * r.hoursPerUnit) / cap)
      t = free.get(r.departmentId) || 0
    })
    const cond = conditionOf(c, alloc)
    out.set(c.slice.id, { finishDays: cond === "materials" ? null : Math.ceil(t), waitDepartmentId: worst, waitDays: r1(worstWait), condition: cond })
  }
  for (const c of calcs) {
    if (!c.live || c.released) continue
    out.set(c.slice.id, { finishDays: afterQueue(c.product, c.slice.quantity, free, capBy), waitDepartmentId: null, waitDays: 0, condition: conditionOf(c, alloc) })
  }
  return out
}

function afterQueue(product: MfgProduct, quantity: number, free: Map<string, number>, capBy: Map<string, number>): number {
  let t = 0
  for (const r of effectiveRoute(product)) {
    if (r.hoursPerUnit == null) continue
    t = Math.max(t, free.get(r.departmentId) || 0)
    t += (quantity * r.hoursPerUnit) / (capBy.get(r.departmentId) || 8)
  }
  return Math.ceil(t)
}

/** Remaining standard hours queued on a station across live released orders. */
export function stationLoadHours(calcs: OrderCalc[], departmentId: string): number {
  let h = 0
  for (const c of calcs) {
    if (!c.live || !c.released) continue
    c.route.forEach((r, i) => {
      if (r.departmentId !== departmentId || r.hoursPerUnit == null) return
      h += remAt(c, i) * r.hoursPerUnit
    })
  }
  return r1(h)
}

/** Queue in days: remaining load plus today's lost hours over daily capacity. */
export function stationQueueDays(calcs: OrderCalc[], dept: DeptCapacityFields, lost: LostHours = new Map()): number {
  return r1((stationLoadHours(calcs, dept.id) + (lost.get(dept.id) || 0)) / deptCapacity(dept))
}

export function bottleneck(calcs: OrderCalc[], departments: DeptCapacityFields[], lost: LostHours = new Map()): { departmentId: string; days: number } | null {
  let best: { departmentId: string; days: number } | null = null
  for (const d of departments) {
    if (stationGate(d)) continue
    const days = stationQueueDays(calcs, d, lost)
    if (!best || days > best.days) best = { departmentId: d.id, days }
  }
  return best && best.days > 0 ? best : null
}

/** Achievable days for a NEW quantity: it joins the back of every queue. */
export function possibleForDays(product: MfgProduct, quantity: number, calcs: OrderCalc[], departments: DeptCapacityFields[], lost: LostHours = new Map()): number {
  let t = 0
  for (const r of effectiveRoute(product)) {
    if (r.hoursPerUnit == null) continue
    const dept = departments.find((d) => d.id === r.departmentId)
    const queue = dept ? stationQueueDays(calcs, dept, lost) : stationLoadHours(calcs, r.departmentId) / 8
    t = Math.max(t, queue)
    t += (quantity * r.hoursPerUnit) / (dept ? deptCapacity(dept) : 8)
  }
  return Math.ceil(t)
}

/** Largest quantity deliverable within `days` — binary search over the queue math. */
export function fitQty(product: MfgProduct, days: number, calcs: OrderCalc[], departments: DeptCapacityFields[], lost: LostHours = new Map()): number {
  if (possibleForDays(product, 1, calcs, departments, lost) > days) return 0
  let lo = 1
  let hi = 99999
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2)
    if (possibleForDays(product, mid, calcs, departments, lost) <= days) lo = mid
    else hi = mid - 1
  }
  return lo
}

// ---------------------------------------------------------------------------
// Cost — built from real movements; one WIP definition (FN-06)
// ---------------------------------------------------------------------------

const rateOf = (departments: DeptCapacityFields[], id: string) => Number(departments.find((d) => d.id === id)?.hourlyRate) || 0

export interface StdCost {
  materials: number
  labour: number
  overhead: number
  hours: number
  total: number
  /** False when any BOM line's cost is unknown — the total then understates. */
  allPriced: boolean
  /** Route steps with no standard time — a cost statement cannot be sent (REQ-09). */
  unestimated: string[]
}

export function standardCost(product: Pick<MfgProduct, "bom" | "route" | "wastePercent">, departments: DeptCapacityFields[], settings: MfgSettings, quantity: number): StdCost {
  const q = quantity || 1
  let materials = 0
  let allPriced = true
  for (const b of product.bom || []) {
    if (b.unitCost == null) {
      allPriced = false
      continue
    }
    materials += perUnit(product, b) * b.unitCost
  }
  const route = effectiveRoute(product)
  const unestimated = route.filter((r) => r.hoursPerUnit == null).map((r) => r.departmentId)
  if (!settings.features.time) {
    return { materials: round2(materials * q), labour: 0, overhead: 0, hours: 0, total: round2(materials * q), allPriced, unestimated: [] }
  }
  let hours = 0
  let labour = 0
  for (const r of route) {
    if (r.hoursPerUnit == null) continue
    hours += r.hoursPerUnit
    labour += r.hoursPerUnit * rateOf(departments, r.departmentId)
  }
  const overhead = hours * settings.overheadRatePerHour
  return {
    materials: round2(materials * q),
    labour: round2(labour * q),
    overhead: round2(overhead * q),
    hours: round2(hours * q),
    total: round2((materials + labour + overhead) * q),
    allPriced,
    unestimated,
  }
}

export interface OrderCost {
  materials: number
  materialsAllPriced: boolean
  custody: number
  labour: number
  overhead: number
  remnantCredit: number
  /** Live total, or the actual cost frozen at the final close. */
  total: number
  frozen: boolean
  hours: number
  scrapValue: number
  /** Cost less approved scrap. */
  good: number
  /** Share already out: good × delivered ÷ target. */
  outValue: number
  /** Work in progress — the same number on every screen. */
  wip: number
  earnedStandard: number
  /** Actual over earned, percent; null before anything is earned. */
  variancePercent: number | null
}

export function orderCost(c: OrderCalc, departments: DeptCapacityFields[], settings: MfgSettings): OrderCost {
  let materials = 0
  let allPriced = true
  for (const m of c.slice.materials) {
    if (m.state !== "received") continue
    if (m.unitCost == null) allPriced = false
    else materials += m.quantity * m.unitCost
  }
  let custody = 0
  c.route.forEach((r, i) => {
    const worked = (c.done[i] || 0) + (c.slice.progress[i]?.rejected || 0) + (c.scrapAt[i] || 0)
    for (const b of bomFor(c.product, r.departmentId)) if (b.custody && b.unitCost != null) custody += b.qtyPerUnit * worked * b.unitCost
  })
  const hours = round2(c.slice.progress.slice(0, c.route.length).reduce((a, p) => a + (p?.hours || 0), 0))
  const labour = settings.features.time ? c.slice.progress.slice(0, c.route.length).reduce((a, p, i) => a + (p?.hours || 0) * rateOf(departments, c.route[i]?.departmentId || p.departmentId), 0) : 0
  const overhead = settings.features.time ? hours * settings.overheadRatePerHour : 0
  const remnantCredit = c.slice.remnants.filter((x) => x.state === "received").reduce((a, x) => a + x.value, 0)
  const live = materials + custody + labour + overhead - remnantCredit
  const total = c.slice.frozenCost ? c.slice.frozenCost.cost : live
  const scrapValue = c.scrapValueApproved
  const good = Math.max(0, total - scrapValue)
  const outValue = (good * c.delivered) / Math.max(1, c.target)
  const wip = !c.released || c.cancelled || c.done_ ? 0 : Math.max(0, good - outValue)
  const earned = earnedStandard(c, departments, settings)
  return {
    materials: round2(materials),
    materialsAllPriced: allPriced,
    custody: round2(custody),
    labour: round2(labour),
    overhead: round2(overhead),
    remnantCredit: round2(remnantCredit),
    total: round2(total),
    frozen: !!c.slice.frozenCost,
    hours,
    scrapValue: round2(scrapValue),
    good: round2(good),
    outValue: round2(outValue),
    wip: round2(wip),
    earnedStandard: round2(earned),
    variancePercent: earned > 0 ? Math.round((total / earned - 1) * 100) : null,
  }
}

/** Standard cost of one unit AT station i (its BOM + its time). */
export function unitStandardAt(product: MfgProduct, departments: DeptCapacityFields[], settings: MfgSettings, departmentId: string, hoursPerUnit: number | null): number {
  let m = 0
  for (const b of bomFor(product, departmentId)) if (b.unitCost != null) m += perUnit(product, b) * b.unitCost
  const h = settings.features.time && hoursPerUnit != null ? hoursPerUnit * (rateOf(departments, departmentId) + settings.overheadRatePerHour) : 0
  return m + h
}

/** The standard of the work actually done (FN-07). */
export function earnedStandard(c: OrderCalc, departments: DeptCapacityFields[], settings: MfgSettings): number {
  return c.route.reduce((a, r, i) => a + (c.done[i] || 0) * unitStandardAt(c.product, departments, settings, r.departmentId, r.hoursPerUnit), 0)
}

/** What one unit has consumed up to and including step i — the scrap value. */
export function unitSunkCost(product: MfgProduct, departments: DeptCapacityFields[], settings: MfgSettings, uptoIndex: number): number {
  const route = effectiveRoute(product).slice(0, uptoIndex + 1)
  return Math.round(route.reduce((a, r) => a + unitStandardAt(product, departments, settings, r.departmentId, r.hoursPerUnit), 0))
}

export interface HourVariance {
  index: number
  departmentId: string
  standard: number
  actual: number
  gap: number
  percent: number
}

/** Worst station running past its standard: >15% over AND at least 2h, not
 * already reviewed (FL-05). */
export function hourVariance(c: OrderCalc, settings: MfgSettings): HourVariance | null {
  if (!settings.features.time) return null
  let worst: HourVariance | null = null
  c.route.forEach((r, i) => {
    if (c.gates[i] || r.hoursPerUnit == null || c.slice.varianceReviews[r.departmentId]) return
    const p = c.slice.progress[i]
    const std = round2((c.done[i] || 0) * r.hoursPerUnit)
    if (!p || !c.done[i] || !std) return
    if (p.hours > std * 1.15 && p.hours - std >= 2 && (!worst || p.hours - std > worst.gap)) {
      worst = { index: i, departmentId: r.departmentId, standard: std, actual: p.hours, gap: r1(p.hours - std), percent: Math.round((p.hours / std - 1) * 100) }
    }
  })
  return worst
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
  calcs: OrderCalc[],
  departments: DeptCapacityFields[],
  settings: MfgSettings,
  lost: LostHours = new Map()
): Verdict {
  const std = standardCost(product, departments, settings, quantity)
  const unitCost = round2(std.total / (quantity || 1))
  const unitMaterialCost = round2(std.materials / (quantity || 1))
  const buy = product.referenceBuyPrice
  const base = { unitCost, unitMaterialCost, buyPrice: buy }
  const poss = settings.features.time ? possibleForDays(product, quantity, calcs, departments, lost) : null
  if (buy != null && buy > 0 && buy < unitCost * 0.97) return { kind: "buy_price", makeQty: 0, possibleDays: poss, ...base }
  if (poss == null || poss <= neededInDays) return { kind: "make", makeQty: quantity, possibleDays: poss, ...base }
  const fit = fitQty(product, neededInDays, calcs, departments, lost)
  if (fit > 0) return { kind: "partial", makeQty: Math.min(fit, quantity), possibleDays: poss, ...base }
  return { kind: "buy_capacity", makeQty: 0, possibleDays: poss, ...base }
}

// ---------------------------------------------------------------------------
// Cost statements — cost, lead time and validity; no price, no margin (D10)
// ---------------------------------------------------------------------------

/** draft → sent (by the cost controller). Sales' quote status is read. */
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
  earliestDays?: number | null
  sentAt?: string | null
  sentByName?: string | null
  /** Written by Sales: its quote and the client's decision (read here). */
  quoteNumber?: string | null
  salesOrderNumber?: number | null
  recalculatedAt?: string | null
  /** Legacy fields from before D10 — never shown. */
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

export function buildEstimateLines(lines: Array<{ product: MfgProduct; quantity: number }>, departments: DeptCapacityFields[], settings: MfgSettings): MfgEstimateLine[] {
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

/** Sent, past its validity, and Sales has not closed it (won/lost). */
export function estimateExpired(e: Pick<MfgCostEstimate, "state" | "sentAt" | "validityDays">, today: string, settings: MfgSettings): boolean {
  if (e.state !== "sent" && e.state !== "quoted") return false
  if (!e.sentAt) return false
  return daysFrom(e.sentAt, today) > (e.validityDays || settings.estimateValidityDays)
}

/** Route steps without standard time, per line — sending is blocked (REQ-09). */
export function estimateIncomplete(e: Pick<MfgCostEstimate, "lines">, products: Map<string, MfgProduct>, settings: MfgSettings): Array<{ productId: string; departmentIds: string[] }> {
  if (!settings.features.time) return []
  return e.lines
    .map((l) => ({ productId: l.productId, departmentIds: effectiveRoute(products.get(l.productId) || { route: [] }).filter((r) => r.hoursPerUnit == null).map((r) => r.departmentId) }))
    .filter((x) => x.departmentIds.length > 0)
}

// ---------------------------------------------------------------------------
// The next step (ORD-04) — candidates in precedence order
// ---------------------------------------------------------------------------

export type ExternalModule = "finance" | "inventory" | "projects" | "sales" | "procurement"

export type CandidateOwner =
  | { kind: "manager" }
  | { kind: "qc" }
  | { kind: "manager_or_qc" }
  /** Scrap review: manager up to the Finance limit, the cost controller above. */
  | { kind: "scrap"; value: number }
  /** A station's lead; the QC station belongs to Quality. */
  | { kind: "station"; departmentId: string }
  | { kind: "external"; module: ExternalModule }

export type CandidateKey =
  | "qc_decision"
  | "scrap_review"
  | "scrap_clarify"
  | "remake_scrap"
  | "remake_breakage"
  | "apply_change"
  | "down_payment"
  | "survey"
  | "release"
  | "shortage"
  | "purchase_wait"
  | "submit_drawing"
  | "drawing_wait"
  | "slab"
  | "gate"
  | "issue_wait"
  | "confirm_receipt"
  | "request_materials"
  | "output"
  | "qc_release"
  | "close"
  | "deliver"
  | "receipt_wait"
  | "remnant_wait"

export type Severity = "r" | "a" | "b"

export interface Candidate {
  key: CandidateKey
  owner: CandidateOwner
  severity: Severity
  index?: number
  departmentId?: string
  quantity?: number
  value?: number
  itemName?: string
  unit?: string
  scrapId?: string
  noteId?: string
  noteNumber?: string
  requestNumber?: string
  /** Days the fact has waited (drawing at approval, note on the road…). */
  ageDays?: number
  /** Delivery-note escalation past the Finance/Governance window. */
  escalated?: boolean
  destination?: "project" | "warehouse"
  approverOrg?: ApproverOrg
  previousC?: string | null
  pctPercent?: number | null
  changeKind?: ChangeRequest["kind"]
  newQuantity?: number | null
  /** Scrap review is running in parallel — shown on the re-make (FL-12). */
  approvalRunning?: boolean
}

export interface CandidateContext {
  settings: MfgSettings
  alloc: Allocation | null
  today: string
  /** Hours since an ISO timestamp — injected so tests stay deterministic. */
  nowMs: number
}

const hoursSince = (iso: string | null | undefined, nowMs: number) => (iso ? Math.max(0, (nowMs - new Date(iso).getTime()) / 3600000) : 0)

export function candidates(c: OrderCalc, ctx: CandidateContext): Candidate[] {
  const C: Candidate[] = []
  if (c.done_) return C
  const s = c.slice
  if (c.cancelled) {
    // A cancelled order's written-off work in hand still needs its approval.
    for (const x of s.scrap) {
      if (x.status === "pending") C.push({ key: "scrap_review", owner: { kind: "scrap", value: x.value }, severity: "a", scrapId: x.id, quantity: x.quantity, value: x.value, ageDays: Math.floor(hoursSince(x.raisedAt, ctx.nowMs) / 24) })
    }
    return C
  }
  const station = (i: number): CandidateOwner => ({ kind: "station", departmentId: c.route[i].departmentId })
  const add = (x: Candidate) => C.push(x)

  c.route.forEach((r, i) => {
    const rej = s.progress[i]?.rejected || 0
    if (rej > 0) add({ key: "qc_decision", owner: { kind: "qc" }, severity: "a", index: i, departmentId: r.departmentId, quantity: rej })
  })
  for (const x of s.scrap) {
    if (x.status === "pending") add({ key: "scrap_review", owner: { kind: "scrap", value: x.value }, severity: "r", scrapId: x.id, quantity: x.quantity, value: x.value, ageDays: Math.floor(hoursSince(x.raisedAt, ctx.nowMs) / 24) })
  }
  for (const x of s.scrap) {
    if (x.status === "returned") add({ key: "scrap_clarify", owner: { kind: "qc" }, severity: "a", scrapId: x.id, quantity: x.quantity })
  }
  if (c.scrapUndecided > 0) add({ key: "remake_scrap", owner: { kind: "manager" }, severity: "r", quantity: c.scrapUndecided, approvalRunning: c.scrapPending > 0 })
  if (c.brokenOpen > 0) add({ key: "remake_breakage", owner: { kind: "manager" }, severity: "r", quantity: c.brokenOpen })
  if (s.changeRequest)
    add({ key: "apply_change", owner: { kind: "manager" }, severity: "r", changeKind: s.changeRequest.kind, newQuantity: s.changeRequest.newQuantity })

  if (s.downPayment.required && !s.downPayment.confirmed && !c.released) {
    add({ key: "down_payment", owner: { kind: "external", module: "finance" }, severity: "a", pctPercent: s.downPayment.percent })
  } else if (!c.released) {
    if (c.product.requiresMeasurement && !s.survey) add({ key: "survey", owner: { kind: "manager" }, severity: "a" })
    else add({ key: "release", owner: { kind: "manager" }, severity: "b" })
  }

  if (c.released) {
    if (ctx.alloc) {
      for (const x of shortages(c, ctx.alloc)) {
        if (x.requested) continue
        add({ key: "shortage", owner: { kind: "manager" }, severity: "r", itemName: x.itemName, unit: x.unit, quantity: x.short })
      }
    }
    for (const p of s.purchaseRequests) {
      if (p.state === "sent") add({ key: "purchase_wait", owner: { kind: "external", module: "procurement" }, severity: "a", itemName: p.itemName, unit: p.unit, quantity: p.quantity })
    }
    const hasGate = (g: GateMode) => c.gates.includes(g)
    const drawingStep = (i: number) => {
      if (c.drawingState === "draft") add({ key: "submit_drawing", owner: station(i), severity: "a", index: i, departmentId: c.route[i].departmentId, previousC: s.drawing?.previousC ?? null })
      else if (c.drawingState === "wait")
        add({
          key: "drawing_wait",
          owner: { kind: "external", module: s.drawing?.approverOrg === "client" ? "sales" : "projects" },
          severity: hoursSince(s.drawing?.submittedAt, ctx.nowMs) > 72 ? "a" : "b",
          approverOrg: s.drawing?.approverOrg,
          ageDays: Math.floor(hoursSince(s.drawing?.submittedAt, ctx.nowMs) / 24),
        })
    }
    c.route.forEach((r, i) => {
      if (c.pend[i] <= 0) return
      const g = c.gates[i]
      if (g === "drawing") drawingStep(i)
      else if (g === "slab") add({ key: "slab", owner: { kind: "manager_or_qc" }, severity: "a", index: i })
      else if (g === "manual") add({ key: "gate", owner: station(i), severity: "b", index: i, departmentId: r.departmentId, quantity: c.pend[i] })
      else if (i === c.firstQ) {
        if (!c.drawingOk && !hasGate("drawing")) drawingStep(i)
        if (c.product.requiresSlabApproval && !s.slabApproval && !hasGate("slab")) add({ key: "slab", owner: { kind: "manager_or_qc" }, severity: "a", index: i })
      }
    })
    c.route.forEach((r, i) => {
      if (c.gates[i]) return
      const rows = s.materials.filter((m) => m.departmentId === r.departmentId)
      for (const rn of Array.from(new Set(rows.filter((m) => m.state === "requested").map((m) => m.requestNumber))))
        add({ key: "issue_wait", owner: { kind: "external", module: "inventory" }, severity: "b", index: i, departmentId: r.departmentId, requestNumber: rn })
      for (const rn of Array.from(new Set(rows.filter((m) => m.state === "released").map((m) => m.requestNumber))))
        add({ key: "confirm_receipt", owner: station(i), severity: "a", index: i, departmentId: r.departmentId, requestNumber: rn })
      if (c.pend[i] <= 0 || hardBlocked(c, i)) return
      const ms = materialState(c, i)
      if ((ms === "missing" || ms === "partial") && !s.overrides[r.departmentId] && canDo(c, i) < c.pend[i])
        add({ key: "request_materials", owner: station(i), severity: "a", index: i, departmentId: r.departmentId, quantity: c.pend[i] })
    })
    c.route.forEach((r, i) => {
      if (c.gates[i] || c.pend[i] <= 0 || hardBlocked(c, i)) return
      if (!s.overrides[r.departmentId] && canDo(c, i) <= 0) return
      const qc = isQcStation(c.stations[i] || { name: r.departmentName })
      add({ key: qc ? "qc_release" : "output", owner: qc ? { kind: "qc" } : station(i), severity: "b", index: i, departmentId: r.departmentId, quantity: c.pend[i] })
    })
  }
  if (c.toClose > 0) add({ key: "close", owner: { kind: "manager" }, severity: "a", quantity: c.toClose })
  if (c.ready > 0) add({ key: "deliver", owner: { kind: "manager" }, severity: "a", quantity: c.ready })
  for (const n of c.notes) {
    if (n.status !== "in_transit") continue
    const hours = hoursSince(n.sentAt, ctx.nowMs)
    const toProject = n.toKind === "project"
    add({
      key: "receipt_wait",
      owner: { kind: "external", module: toProject ? "projects" : "inventory" },
      severity: hours >= ctx.settings.noteEscalationHours ? "r" : "b",
      noteId: n.id,
      noteNumber: n.number,
      quantity: n.quantity,
      escalated: hours >= ctx.settings.noteEscalationHours,
      destination: toProject ? "project" : "warehouse",
      ageDays: Math.floor(hours / 24),
    })
  }
  for (const x of s.remnants) {
    if (x.state === "returned") add({ key: "remnant_wait", owner: { kind: "external", module: "inventory" }, severity: "b", quantity: x.area, itemName: x.itemName, departmentId: c.route[c.firstQ]?.departmentId })
  }
  return C
}

// ---------------------------------------------------------------------------
// Who owns a candidate
// ---------------------------------------------------------------------------

export type Persona = "manager" | "lead" | "qc" | "cost" | "management"

export interface Actor {
  uid: string
  /** The org owner. He passes every permission check on the platform and the
   * security rules know no station lead, so a station that names a lead must
   * not lock HIM out: with the lead away, issued materials would sit "not
   * received" and the order would stall with nobody able to move it. Whatever
   * he records carries his own name. */
  owner?: boolean
  manage: boolean
  work: boolean
  qc: boolean
  cost: boolean
  view: boolean
}

/** Whether a candidate is this person's to act on, under one persona or (when
 * `persona` is omitted) under any role they hold. */
export function ownsCandidate(c: Candidate, actor: Actor, departments: DeptCapacityFields[], settings: MfgSettings, persona?: Persona): boolean {
  const as = (p: Persona) => !persona || persona === p
  const o = c.owner
  switch (o.kind) {
    case "external":
      return false
    case "manager":
      return as("manager") && actor.manage
    case "qc":
      return as("qc") && actor.qc
    case "manager_or_qc":
      return (as("manager") && actor.manage) || (as("qc") && actor.qc)
    case "scrap":
      return (as("cost") && actor.cost) || (as("manager") && actor.manage && o.value <= settings.scrapApprovalLimit)
    case "station": {
      const d = departments.find((x) => x.id === o.departmentId)
      if (isQcStation(d)) return as("qc") && actor.qc
      if (d?.leadUserId) return as("lead") && actor.work && (actor.uid === d.leadUserId || !!actor.owner)
      // No lead assigned yet: the manager records — and the station's hands
      // (manufacturing.work) keep working until the manager assigns one.
      return (as("manager") && actor.manage) || (as("lead") && actor.work)
    }
  }
}

export function nextStep(cands: Candidate[], actor: Actor, departments: DeptCapacityFields[], settings: MfgSettings, persona?: Persona): Candidate | null {
  return cands.find((x) => ownsCandidate(x, actor, departments, settings, persona)) || null
}

/** The first candidate, when it is someone else's — "awaiting …". */
export function waitingOn(cands: Candidate[], actor: Actor, departments: DeptCapacityFields[], settings: MfgSettings, persona?: Persona): Candidate | null {
  const first = cands[0]
  if (!first || ownsCandidate(first, actor, departments, settings, persona)) return null
  return first
}

export const severityRank = (s: Severity): number => (s === "r" ? 3 : s === "a" ? 2 : 1)

// ---------------------------------------------------------------------------
// Late — and why (TD-06)
// ---------------------------------------------------------------------------

export type LateReason =
  | { key: "down_payment" }
  | { key: "survey" }
  | { key: "not_released" }
  | { key: "shortage"; itemName: string; quantity: number; unit: string; requested: boolean }
  | { key: "drawing"; approverOrg: ApproverOrg | null; days: number }
  | { key: "slab" }
  | { key: "materials"; departmentId: string; state: StationMaterialState }
  | { key: "queue"; departmentId: string; days: number }
  | { key: "at_station"; departmentId: string }
  | { key: "qc" }
  | { key: "scrap_pending" }
  | { key: "scrap_decision" }
  | { key: "close" }
  | { key: "ready" }
  | { key: "breakage" }
  | { key: "transit" }

export function whyLate(c: OrderCalc, alloc: Allocation | null, schedule: ScheduleResult | null, nowMs: number): LateReason | null {
  const s = c.slice
  if (c.stage === "pay") return { key: "down_payment" }
  if (c.stage === "wait") return releaseBlocks(c).some((b) => b.key === "survey") ? { key: "survey" } : { key: "not_released" }
  if (alloc) {
    const sh = shortages(c, alloc)
    if (sh.length) return { key: "shortage", itemName: sh[0].itemName, quantity: sh[0].short, unit: sh[0].unit, requested: !!sh[0].requested }
  }
  if (c.stage === "prod") {
    const i = c.current
    if (i >= 0) {
      const hard = stationBlocks(c, i).find((b) => b.severity === "hard")
      if (hard?.key === "drawing") return { key: "drawing", approverOrg: s.drawing?.approverOrg ?? null, days: Math.floor(hoursSince(s.drawing?.submittedAt, nowMs) / 24) }
      if (hard?.key === "slab") return { key: "slab" }
      if (c.gates[i] === "drawing") return { key: "drawing", approverOrg: s.drawing?.approverOrg ?? null, days: Math.floor(hoursSince(s.drawing?.submittedAt, nowMs) / 24) }
      if (c.gates[i] === "slab") return { key: "slab" }
      const ms = materialState(c, i)
      if (!c.gates[i] && ["missing", "requested", "released", "partial"].includes(ms) && canDo(c, i) < c.pend[i]) return { key: "materials", departmentId: c.route[i].departmentId, state: ms }
      if (schedule?.waitDepartmentId && schedule.waitDays >= 0.5) return { key: "queue", departmentId: schedule.waitDepartmentId, days: schedule.waitDays }
      return { key: "at_station", departmentId: c.route[i].departmentId }
    }
    if (c.rejected > 0) return { key: "qc" }
    if (c.scrapPending > 0) return { key: "scrap_pending" }
    return { key: "scrap_decision" }
  }
  if (c.stage === "close") return { key: "close" }
  if (c.stage === "ready") return { key: "ready" }
  if (c.stage === "transit") return c.brokenOpen > 0 && c.shipped === 0 ? { key: "breakage" } : { key: "transit" }
  return null
}

/** Minimum quantity after a change: what already entered production stays (ORD-11). */
export function minQuantity(c: OrderCalc): number {
  let m = c.out
  c.route.forEach((_, i) => {
    if (c.gates[i]) return
    const p = c.slice.progress[i]
    m = Math.max(m, round2((c.done[i] || 0) + (p?.rejected || 0) + (c.scrapAt[i] || 0) - (p?.rework || 0)))
  })
  return Math.max(0, m)
}

// ---------------------------------------------------------------------------
// Dates and numbering
// ---------------------------------------------------------------------------

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

/** Yearly sequence per document type (ORD-07). */
export type DocType = "WO" | "MR" | "WR" | "CE" | "DN"

export function formatDocNumber(type: DocType, year: number, seq: number): string {
  return `${type}-${year}/${String(seq).padStart(3, "0")}`
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
function code(prefix: string): string {
  let suffix = ""
  for (let i = 0; i < 6; i++) suffix += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return `${prefix}-${suffix}`
}

export const generateId = (prefix: string): string => code(prefix)
export const generateWithdrawalNumber = (): string => code("WR")
export const generateEstimateNumber = (): string => code("CE")
export const generateMfgRequestNumber = (): string => code("MR")
export const generateScrapId = (): string => code("SC")

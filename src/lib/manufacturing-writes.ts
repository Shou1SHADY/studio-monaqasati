// Manufacturing write flows — where a workshop decision becomes documents.
//
// Every order decision runs in ONE transaction: it re-reads the order, rebuilds
// the engine's view of it, re-checks the block the form showed (more than in
// hand, beyond material coverage, no final inspection, above the scrap limit…)
// and only then writes. The screen mirrors these checks; this file is where
// they hold. The name on every decision comes from the signed-in actor — there
// is no name field anywhere (D8, ORD-14).
//
// Ownership (D9): the functions a manufacturing user calls live in the first
// half. The second half — issuing a withdrawal, receiving a note or remnants,
// recording a drawing result, requesting a change, routing a need to make — are
// the OTHER modules' acts, called from Inventory, Projects, Sales and
// Procurement screens under their own permissions.

import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Transaction,
} from "firebase/firestore"
import {
  CAUSE_UNKNOWN,
  MFG_BLOCK_NOTICES,
  MFG_COST_ESTIMATES,
  MFG_COUNTERS,
  MFG_PRODUCTS,
  MFG_SETTINGS,
  MFG_STOPS,
  buildEstimateLines,
  canDo,
  computeOrder,
  effectiveRoute,
  emptyProgress,
  estimateExpired,
  formatDocNumber,
  generateId,
  isQcStation,
  itemKey,
  mainMaterial,
  minQuantity,
  orderCost,
  releaseBlocks,
  round2,
  stationBlocks,
  unitSunkCost,
  type ApproverOrg,
  type ChangeRequest,
  type CutPiece,
  type DefectKind,
  type DeptCapacityFields,
  type DocType,
  type DownPaymentState,
  type DrawingCode,
  type DrawingRecord,
  type GateKind,
  type MfgCostEstimate,
  type MfgNoteSlice,
  type MfgOrderSlice,
  type MfgProduct,
  type MfgSettings,
  type OrderCalc,
  type OrderSource,
  type ScrapBearer,
  type StageProgress,
  type VarianceCause,
  type WorkOrderMaterial,
  type WorkOrderScrap,
} from "./manufacturing-engine"
import { WORK_ORDERS, type WorkOrder } from "./manufacturing"
import { DELIVERY_NOTES, type DeliveryNote } from "./delivery-notes"
import { MANUFACTURING_REQUESTS, SALES_ORDERS, type ManufacturingRequest, type MfgRequestLine, type SalesOrder } from "./sales-orders"
import { onMfgMaterialsReceived, onMfgRemnantReceived, onMfgScrapApproved, onWorkOrderDelivered } from "./accounting/hooks"

const nowIso = () => new Date().toISOString()

export interface Actor {
  id: string
  name: string
}

/** A work order as stored — legacy stage-flow fields plus the product-born set. */
export interface WorkOrderV2 extends WorkOrder {
  productId?: string | null
  productName?: string | null
  unit?: string | null
  quantity?: number | null
  neededBy?: string | null
  createdAtIso?: string | null
  /** WO-2026/057 — the yearly server sequence (ORD-07). */
  docNumber?: string | null
  sourceKind?: OrderSource | null
  salesOrderId?: string | null
  salesOrderNumber?: number | null
  costItemName?: string | null
  purchaseRequestRef?: string | null
  pmRequestRef?: string | null
  mfgRequestId?: string | null
  mfgRequestNumber?: string | null
  requestedByName?: string | null
  requestedByUserId?: string | null
  estimateId?: string | null
  releasedAt?: string | null
  releasedByName?: string | null
  releasedById?: string | null
  survey?: MfgOrderSlice["survey"]
  drawing?: DrawingRecord | null
  slabApproval?: MfgOrderSlice["slabApproval"]
  rush?: MfgOrderSlice["rush"]
  progress?: StageProgress[]
  materials?: WorkOrderMaterial[]
  scrapRecords?: WorkOrderScrap[]
  rejects?: MfgOrderSlice["rejects"]
  qcReleases?: MfgOrderSlice["qcReleases"]
  closures?: MfgOrderSlice["closures"]
  frozenCost?: MfgOrderSlice["frozenCost"]
  /** Running total shipped on notes — written with each note (a concurrency guard). */
  shippedQuantity?: number
  remade?: number
  shortfall?: number
  brokenResolved?: number
  remnants?: MfgOrderSlice["remnants"]
  purchaseRequests?: MfgOrderSlice["purchaseRequests"]
  overrides?: MfgOrderSlice["overrides"]
  changeRequest?: ChangeRequest | null
  cancellation?: MfgOrderSlice["cancellation"]
  varianceReviews?: MfgOrderSlice["varianceReviews"]
  checklists?: MfgOrderSlice["checklists"]
  log?: Array<{ kind: string; at: string; by: string | null; detail?: string | null; tone?: "ok" | "bad" | "neutral" }>
  // --- legacy (pre PRD 1.2), read for compatibility only ---
  measurement?: { at: string; by: string; note?: string | null } | null
  drawingApprovalStatus?: "na" | "pending" | "approved"
  drawingApprovedAt?: string | null
  drawingApprovedBy?: string | null
  riskReason?: string | null
  sourceQuotationWon?: boolean | null
}

export const isV2Order = (o: Pick<WorkOrderV2, "productId">): boolean => !!o.productId

export function sourceOf(o: Pick<WorkOrderV2, "sourceKind" | "salesOrderId" | "source" | "projectId">): OrderSource {
  if (o.sourceKind) return o.sourceKind
  if (o.salesOrderId || o.source?.kind === "quotation" || o.source?.quotationId || o.source?.quotationNumber) return "client"
  if (o.projectId) return "project"
  return "stock"
}

/** What a work order needs of a sales order to know it is its own. */
export type SalesOrderKey = Pick<SalesOrder, "id" | "quotationId" | "quotationNumber">

/** A work order belongs to the sales order it names — or, when it names none,
 * to the one born of the same quotation: an order that carries only `Q-…` is
 * still that client's order. Every reader of the relation asks here — the
 * down-payment gate, release, Sales' screens, coverage — so the two modules
 * can never disagree about whose order it is. */
export function belongsToSalesOrder(o: Pick<WorkOrderV2, "salesOrderId" | "source">, so: SalesOrderKey): boolean {
  if (o.salesOrderId) return o.salesOrderId === so.id
  const qid = o.source?.quotationId
  if (qid) return qid === so.quotationId
  const qno = o.source?.quotationNumber
  return !!qno && qno === so.quotationNumber
}

export function salesOrderOfWorkOrder<T extends SalesOrderKey>(o: Pick<WorkOrderV2, "salesOrderId" | "source">, salesOrders: Iterable<T>): T | null {
  if (!o.salesOrderId && !o.source?.quotationId && !o.source?.quotationNumber) return null
  for (const so of salesOrders) if (belongsToSalesOrder(o, so)) return so
  return null
}

/** The down payment is Sales' and Finance's; we read the sales order. An order
 * with no deposit terms is not gated. A pre-1.2 quote-born order whose quote
 * was not won stays gated until it is. */
export function downPaymentOf(o: WorkOrderV2, salesOrder: Pick<SalesOrder, "payment"> | null | undefined): DownPaymentState {
  if (sourceOf(o) !== "client") return { required: false, confirmed: true, percent: null }
  if (salesOrder && salesOrder.payment?.kind === "deposit") {
    return { required: true, confirmed: !!salesOrder.payment.depositPaid, percent: salesOrder.payment.depositPercent ?? null }
  }
  if (o.sourceQuotationWon === false) return { required: true, confirmed: false, percent: null }
  return { required: false, confirmed: true, percent: null }
}

/** The engine's structural view of a stored order. */
export function toOrderSlice(o: WorkOrderV2, salesOrder?: Pick<SalesOrder, "payment"> | null): MfgOrderSlice {
  const source = sourceOf(o)
  const legacyDrawing: DrawingRecord | null =
    o.drawingApprovalStatus === "approved"
      ? {
          revision: 1,
          approverOrg: source === "client" ? "client" : "technical_office",
          submittedAt: o.drawingApprovedAt || null,
          submittedBy: null,
          code: "A",
          recordedBy: o.drawingApprovedBy || null,
          recordedAt: o.drawingApprovedAt || null,
        }
      : null
  return {
    id: o.id,
    number: o.orderNumber,
    productId: o.productId || "",
    quantity: o.quantity || 0,
    neededBy: o.neededBy ?? o.dueDate ?? null,
    createdAt2: o.createdAtIso || "",
    releasedAt: o.releasedAt ?? null,
    source,
    downPayment: downPaymentOf(o, salesOrder),
    survey: o.survey ?? (o.measurement ? { at: o.measurement.at, by: o.measurement.by, note: o.measurement.note ?? null } : null),
    drawing: o.drawing ?? legacyDrawing,
    slabApproval: o.slabApproval ?? null,
    rush: o.rush ?? null,
    progress: o.progress || [],
    materials: o.materials || [],
    scrap: o.scrapRecords || [],
    rejects: o.rejects || [],
    qcReleases: o.qcReleases || [],
    closures: o.closures === undefined ? null : o.closures,
    frozenCost: o.frozenCost ?? null,
    remade: o.remade || 0,
    shortfall: o.shortfall || 0,
    brokenResolved: o.brokenResolved || 0,
    remnants: o.remnants || [],
    purchaseRequests: o.purchaseRequests || [],
    overrides: o.overrides || {},
    changeRequest: o.changeRequest ?? null,
    cancellation: o.cancellation ?? null,
    varianceReviews: o.varianceReviews || {},
    checklists: o.checklists,
    status: o.status,
  }
}

export function toNoteSlice(n: Pick<DeliveryNote, "id" | "noteNumber" | "item" | "brokenQuantity" | "status" | "sentAt" | "toKind">): MfgNoteSlice {
  return {
    id: n.id,
    number: n.noteNumber,
    quantity: n.item.quantity,
    brokenQuantity: n.brokenQuantity || 0,
    status: n.status === "rejected" ? "rejected" : n.status === "received" ? "received" : "in_transit",
    sentAt: n.sentAt,
    toKind: n.toKind,
  }
}

export function calcOf(o: WorkOrderV2, product: MfgProduct, departments: DeptCapacityFields[], notes: MfgNoteSlice[], salesOrder?: Pick<SalesOrder, "payment"> | null): OrderCalc {
  return computeOrder(toOrderSlice(o, salesOrder), product, departments, notes)
}

/** `status` is a cache of the computed state for the screens outside
 * Manufacturing that still filter on it (Sales coverage, post-manufacturing
 * quotes). The engine never trusts it for a product-born order. */
function statusCache(o: WorkOrderV2, product: MfgProduct, departments: DeptCapacityFields[], notes: MfgNoteSlice[] | null): Update {
  if (!notes || o.status === "cancelled") return {}
  const done = calcOf(o, product, departments, notes).done_
  if (done && o.status !== "done") return { status: "done", completedAt: nowIso() }
  if (!done && o.status === "done" && o.closures != null) return { status: "open", completedAt: null }
  return {}
}

// ---------------------------------------------------------------------------
// Plumbing: the order transaction, numbering, notifications
// ---------------------------------------------------------------------------

type Update = Record<string, unknown>

async function mutateOrder(firestore: Firestore, orderId: string, fn: (fresh: WorkOrderV2, tx: Transaction) => Promise<Update> | Update): Promise<WorkOrderV2> {
  return runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, WORK_ORDERS, orderId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("order_missing")
    const fresh = { ...(snap.data() as WorkOrderV2), id: snap.id }
    const update = await fn(fresh, tx)
    tx.update(ref, { ...update, updatedAt: serverTimestamp() })
    return { ...fresh, ...update } as WorkOrderV2
  })
}

const logEntry = (fresh: WorkOrderV2, kind: string, actor: Actor, detail?: string | null, tone: "ok" | "bad" | "neutral" = "neutral") => [
  ...(fresh.log || []),
  { kind, at: nowIso(), by: actor.name, detail: detail ?? null, tone },
]

/** Next number in a yearly sequence per type — read and bumped inside the
 * caller's transaction, so two people can never draw the same number. The
 * sequence starts after the last imported number (`seed`). */
export async function drawDocNumber(
  firestore: Firestore,
  tx: Transaction,
  organizationId: string,
  type: DocType,
  seed = 0,
  year = new Date().getUTCFullYear()
): Promise<{ docNumber: string; seq: number }> {
  const ref = doc(firestore, MFG_COUNTERS, `${organizationId}__${type}__${year}`)
  const snap = await tx.get(ref)
  const last = snap.exists() ? Number(snap.data().last) || 0 : Math.max(0, seed)
  const seq = last + 1
  tx.set(ref, { organizationId, type, year, last: seq, updatedAt: serverTimestamp() })
  return { docNumber: formatDocNumber(type, year, seq), seq }
}

// ---------------------------------------------------------------------------
// Settings — features are the workshop's; policies are Finance's (FN-01)
// ---------------------------------------------------------------------------

export async function saveMfgFeatures(firestore: Firestore, organizationId: string, features: MfgSettings["features"], actor: Actor): Promise<void> {
  await setDoc(doc(firestore, MFG_SETTINGS, organizationId), { organizationId, features, featuresUpdatedBy: actor.name, updatedAt: serverTimestamp() }, { merge: true })
}

export type MfgPolicies = Pick<
  MfgSettings,
  "overheadRatePerHour" | "scrapApprovalLimit" | "answerWindowHours" | "noteEscalationHours" | "estimateValidityDays" | "remnantValuePercent"
>

/** Written from Finance's settings (accounting.close) — read-only in Manufacturing. */
export async function saveMfgPolicies(firestore: Firestore, organizationId: string, policies: MfgPolicies, actor: Actor): Promise<void> {
  await setDoc(
    doc(firestore, MFG_SETTINGS, organizationId),
    { organizationId, ...policies, policiesUpdatedBy: actor.name, policiesUpdatedAt: nowIso(), updatedAt: serverTimestamp() },
    { merge: true }
  )
}

/** @deprecated kept for older callers — writes features only. */
export async function saveMfgSettings(firestore: Firestore, organizationId: string, settings: MfgSettings): Promise<void> {
  await setDoc(doc(firestore, MFG_SETTINGS, organizationId), { organizationId, features: settings.features, updatedAt: serverTimestamp() }, { merge: true })
}

// ---------------------------------------------------------------------------
// Product cards
// ---------------------------------------------------------------------------

type ProductInput = Omit<MfgProduct, "id" | "organizationId">

function cleanProduct(p: ProductInput): ProductInput {
  return {
    ...p,
    route: p.route.map((r) => ({
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      hoursPerUnit: r.hoursPerUnit == null || Number.isNaN(r.hoursPerUnit) ? null : Math.max(0, r.hoursPerUnit),
      // Older cards keep their installation steps flagged so live orders' progress stays aligned.
      ...(r.onSite ? { onSite: true } : {}),
    })),
    bom: p.bom.map((b) => ({ ...b, custody: !!b.custody, withWaste: !!b.withWaste && !b.custody })),
  }
}

export async function createMfgProduct(firestore: Firestore, input: { organizationId: string; product: ProductInput; actor: Actor }): Promise<string> {
  if (!input.product.route.length) throw new Error("route_required")
  if (input.product.bom.some((b) => !input.product.route.some((r) => r.departmentId === b.departmentId))) throw new Error("bom_off_route")
  const ref = doc(collection(firestore, MFG_PRODUCTS))
  await setDoc(ref, {
    ...cleanProduct(input.product),
    organizationId: input.organizationId,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

/** With live orders on the card the route order is locked; times stay editable. */
export async function updateMfgProduct(firestore: Firestore, input: { product: MfgProduct; next: ProductInput; routeLocked: boolean; actor: Actor }): Promise<void> {
  const next = cleanProduct(input.next)
  if (!next.route.length) throw new Error("route_required")
  if (input.routeLocked) {
    const same = next.route.length === input.product.route.length && next.route.every((r, i) => r.departmentId === input.product.route[i].departmentId && !!r.onSite === !!input.product.route[i].onSite)
    // The flags decide which steps are gates, and the unit what a quantity means —
    // changing either under live orders would move units that already moved.
    const p = input.product
    const flags =
      next.requiresDrawingApproval === p.requiresDrawingApproval && next.requiresSlabApproval === p.requiresSlabApproval && next.requiresMeasurement === p.requiresMeasurement && next.unit === p.unit
    if (!same || !flags) throw new Error("route_locked")
  }
  if (next.bom.some((b) => !next.route.some((r) => r.departmentId === b.departmentId))) throw new Error("bom_off_route")
  await updateDoc(doc(firestore, MFG_PRODUCTS, input.product.id), { ...next, updatedByUserName: input.actor.name, updatedAt: serverTimestamp() })
}

// ---------------------------------------------------------------------------
// Work orders — born from an accepted request, or a stock order (ORD-01)
// ---------------------------------------------------------------------------

export interface NewOrderSource {
  kind: OrderSource
  projectId?: string | null
  projectName?: string | null
  salesOrderId?: string | null
  salesOrderNumber?: number | null
  contactId?: string | null
  contactName?: string | null
  costItemName?: string | null
  purchaseRequestRef?: string | null
  pmRequestRef?: string | null
}

function newOrderDoc(input: {
  organizationId: string
  product: MfgProduct
  quantity: number
  neededBy: string | null
  source: NewOrderSource
  orderNumber: number
  docNumber: string
  request?: Pick<ManufacturingRequest, "id" | "requestNumber" | "createdByUserName" | "createdByUserId"> | null
  estimateId?: string | null
  actor: Actor
}) {
  const p = input.product
  const route = effectiveRoute(p)
  const s = input.source
  const title = s.kind === "project" && s.projectName ? `${p.name} — ${s.projectName}` : s.kind === "client" && s.contactName ? `${p.name} — ${s.contactName}` : p.name
  const at = nowIso()
  return {
    organizationId: input.organizationId,
    orderNumber: input.orderNumber,
    docNumber: input.docNumber,
    title,
    items: [{ name: p.name, quantity: input.quantity, unit: p.unit }],
    output: { name: p.name, quantity: input.quantity, unit: p.unit },
    source: { kind: s.kind === "client" ? "quotation" : "manual", contactId: s.contactId ?? null, contactName: s.contactName ?? null, quotationId: null, quotationNumber: null },
    sourceKind: s.kind,
    projectId: s.projectId ?? null,
    projectName: s.projectName ?? null,
    salesOrderId: s.salesOrderId ?? null,
    salesOrderNumber: s.salesOrderNumber ?? null,
    costItemName: s.costItemName ?? null,
    purchaseRequestRef: s.purchaseRequestRef ?? null,
    pmRequestRef: s.pmRequestRef ?? null,
    status: "open",
    currentStageIndex: 0,
    stages: route.map((r, i) => ({ departmentId: r.departmentId, departmentName: r.departmentName, assigneeUserId: null, assigneeName: null, status: i === 0 ? "in_progress" : "pending", startedAt: null, completedAt: null, note: null })),
    dueDate: input.neededBy,
    productId: p.id,
    productName: p.name,
    unit: p.unit,
    quantity: input.quantity,
    neededBy: input.neededBy,
    createdAtIso: at,
    releasedAt: null,
    releasedByName: null,
    survey: null,
    drawing: null,
    slabApproval: null,
    rush: null,
    progress: emptyProgress(route),
    materials: [],
    scrapRecords: [],
    rejects: [],
    qcReleases: [],
    closures: [],
    frozenCost: null,
    remade: 0,
    shortfall: 0,
    brokenResolved: 0,
    remnants: [],
    purchaseRequests: [],
    overrides: {},
    changeRequest: null,
    cancellation: null,
    varianceReviews: {},
    checklists: {},
    log: [],
    mfgRequestId: input.request?.id ?? null,
    mfgRequestNumber: input.request?.requestNumber ?? null,
    requestedByName: input.request?.createdByUserName ?? input.actor.name,
    requestedByUserId: input.request?.createdByUserId ?? input.actor.id,
    estimateId: input.estimateId ?? null,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  }
}

async function orderNumberSeed(firestore: Firestore, organizationId: string): Promise<number> {
  const existing = await getDocs(query(collection(firestore, WORK_ORDERS), where("organizationId", "==", organizationId)))
  return existing.docs.reduce((m, d) => Math.max(m, Number(d.data().orderNumber) || 0), 0)
}

/** The one order the workshop creates itself: production for stock (WS-05). */
export async function createStockWorkOrder(
  firestore: Firestore,
  input: { organizationId: string; product: MfgProduct; quantity: number; neededBy: string | null; actor: Actor }
): Promise<{ id: string; docNumber: string }> {
  if (!(input.quantity > 0)) throw new Error("quantity_required")
  if (!effectiveRoute(input.product).length) throw new Error("route_required")
  const seed = await orderNumberSeed(firestore, input.organizationId)
  const ref = doc(collection(firestore, WORK_ORDERS))
  const docNumber = await runTransaction(firestore, async (tx) => {
    // A transaction reads everything before it writes anything.
    const year = new Date().getUTCFullYear()
    const gRef = doc(firestore, MFG_COUNTERS, `${input.organizationId}__WO__0`)
    const yRef = doc(firestore, MFG_COUNTERS, `${input.organizationId}__WO__${year}`)
    const [g, y] = await Promise.all([tx.get(gRef), tx.get(yRef)])
    // Older creators still number max+1 — never draw a number already used.
    const gSeq = Math.max(g.exists() ? Number(g.data().last) || 0 : 0, seed) + 1
    const ySeq = (y.exists() ? Number(y.data().last) || 0 : 0) + 1
    tx.set(gRef, { organizationId: input.organizationId, type: "WO", year: 0, last: gSeq, updatedAt: serverTimestamp() })
    tx.set(yRef, { organizationId: input.organizationId, type: "WO", year, last: ySeq, updatedAt: serverTimestamp() })
    const yearly = formatDocNumber("WO", year, ySeq)
    tx.set(ref, newOrderDoc({ ...input, source: { kind: "stock" }, orderNumber: gSeq, docNumber: yearly }))
    return yearly
  })
  return { id: ref.id, docNumber }
}

// ---------------------------------------------------------------------------
// Requests — two doors (Sales, Procurement); we answer (REQ-01, REQ-03)
// ---------------------------------------------------------------------------

export interface MakeLine {
  line: MfgRequestLine
  product: MfgProduct | null
  makeQuantity: number
}

export async function answerMakeRequest(
  firestore: Firestore,
  input: { request: ManufacturingRequest; lines: MakeLine[]; note: string | null; actor: Actor }
): Promise<{ workOrderIds: string[]; docNumbers: string[] }> {
  const r = input.request
  const taking = input.lines.filter((l) => l.makeQuantity > 0)
  if (!taking.length) throw new Error("lines_required")
  if (taking.some((l) => !l.product)) throw new Error("product_required")
  if (taking.some((l) => l.makeQuantity > l.line.quantity)) throw new Error("more_than_requested")
  const seed = await orderNumberSeed(firestore, r.organizationId)
  const source: NewOrderSource =
    r.sourceKind === "sales" || (!r.sourceKind && r.orderId)
      ? { kind: "client", salesOrderId: r.orderId ?? null, salesOrderNumber: r.orderNumber ?? null, contactName: r.contactName ?? null }
      : r.projectId
        ? { kind: "project", projectId: r.projectId, projectName: r.projectName ?? null, costItemName: r.costItemName ?? null, purchaseRequestRef: r.purchaseRequestRef ?? null, pmRequestRef: r.pmRequestRef ?? null }
        : { kind: "stock" }
  const refs = taking.map(() => doc(collection(firestore, WORK_ORDERS)))
  const docNumbers = await runTransaction(firestore, async (tx) => {
    const reqRef = doc(firestore, MANUFACTURING_REQUESTS, r.id)
    const fresh = await tx.get(reqRef)
    if (!fresh.exists() || fresh.data().status !== "new") throw new Error("already_answered")
    const numbers: Array<{ global: number; docNumber: string }> = []
    // Counters are read once each and bumped per line inside this transaction.
    const year = new Date().getUTCFullYear()
    const gRef = doc(firestore, MFG_COUNTERS, `${r.organizationId}__WO__0`)
    const yRef = doc(firestore, MFG_COUNTERS, `${r.organizationId}__WO__${year}`)
    const [g, y] = await Promise.all([tx.get(gRef), tx.get(yRef)])
    let gLast = Math.max(g.exists() ? Number(g.data().last) || 0 : 0, seed)
    let yLast = y.exists() ? Number(y.data().last) || 0 : 0
    for (let i = 0; i < taking.length; i++) numbers.push({ global: ++gLast, docNumber: formatDocNumber("WO", year, ++yLast) })
    tx.set(gRef, { organizationId: r.organizationId, type: "WO", year: 0, last: gLast, updatedAt: serverTimestamp() })
    tx.set(yRef, { organizationId: r.organizationId, type: "WO", year, last: yLast, updatedAt: serverTimestamp() })
    taking.forEach((l, i) => {
      tx.set(
        refs[i],
        newOrderDoc({
          organizationId: r.organizationId,
          product: l.product!,
          quantity: l.makeQuantity,
          neededBy: r.neededBy ?? null,
          source,
          orderNumber: numbers[i].global,
          docNumber: numbers[i].docNumber,
          request: r,
          estimateId: r.estimateId ?? null,
          actor: input.actor,
        })
      )
    })
    const allTaken = input.lines.every((l) => l.makeQuantity >= l.line.quantity)
    tx.update(reqRef, {
      status: allTaken ? "accepted" : "partial",
      answerRoute: "make",
      answerNote: input.note,
      workOrderIds: refs.map((x) => x.id),
      workOrderId: refs[0]?.id ?? null,
      workOrderNumber: numbers[0]?.global ?? null,
      workOrderDocNumbers: numbers.map((x) => x.docNumber),
      lines: input.lines.map((l) => ({ ...l.line, productId: l.product?.id ?? l.line.productId ?? null, makeQuantity: l.makeQuantity, returnedQuantity: round2(l.line.quantity - l.makeQuantity) })),
      decidedAt: nowIso(),
      decidedByUserId: input.actor.id,
      decidedByUserName: input.actor.name,
      updatedAt: serverTimestamp(),
    })
    return numbers.map((x) => x.docNumber)
  })
  return { workOrderIds: refs.map((x) => x.id), docNumbers }
}

export async function declineRequest(firestore: Firestore, input: { request: ManufacturingRequest; reason: string; actor: Actor }): Promise<void> {
  if (!input.reason.trim()) throw new Error("reason_required")
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, MANUFACTURING_REQUESTS, input.request.id)
    const fresh = await tx.get(ref)
    if (!fresh.exists() || fresh.data().status !== "new") throw new Error("already_answered")
    tx.update(ref, {
      status: "rejected",
      answerRoute: "decline",
      rejectionReason: input.reason.trim(),
      answerNote: input.reason.trim(),
      decidedAt: nowIso(),
      decidedByUserId: input.actor.id,
      decidedByUserName: input.actor.name,
      updatedAt: serverTimestamp(),
    })
  })
}

/** A costing request becomes a draft cost statement — the cost controller reviews and sends it (REQ-06). */
export async function answerCostingRequest(
  firestore: Firestore,
  input: { request: ManufacturingRequest; lines: Array<{ product: MfgProduct; quantity: number }>; departments: DeptCapacityFields[]; settings: MfgSettings; note: string | null; actor: Actor }
): Promise<string> {
  const r = input.request
  if (!input.lines.length) throw new Error("lines_required")
  const estRef = doc(collection(firestore, MFG_COST_ESTIMATES))
  await runTransaction(firestore, async (tx) => {
    const reqRef = doc(firestore, MANUFACTURING_REQUESTS, r.id)
    const fresh = await tx.get(reqRef)
    if (!fresh.exists() || fresh.data().status !== "new") throw new Error("already_answered")
    const { docNumber } = await drawDocNumber(firestore, tx, r.organizationId, "CE")
    tx.set(estRef, {
      organizationId: r.organizationId,
      estimateNumber: docNumber,
      requestId: r.id,
      contactId: null,
      contactName: r.contactName ?? null,
      requestedBy: r.createdByUserName,
      neededBy: r.neededBy ?? null,
      validityDays: input.settings.estimateValidityDays,
      note: input.note,
      lines: buildEstimateLines(input.lines, input.departments, input.settings),
      state: "draft",
      sentAt: null,
      sentByName: null,
      quoteNumber: null,
      createdByUserId: input.actor.id,
      createdByUserName: input.actor.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    tx.update(reqRef, {
      status: "estimated",
      answerRoute: "estimate",
      estimateId: estRef.id,
      estimateNumber: docNumber,
      answerNote: input.note,
      decidedAt: nowIso(),
      decidedByUserId: input.actor.id,
      decidedByUserName: input.actor.name,
      updatedAt: serverTimestamp(),
    })
  })
  return estRef.id
}

// ---------------------------------------------------------------------------
// Cost statements — the cost controller reviews and sends (REQ-06, REQ-09)
// ---------------------------------------------------------------------------

export async function sendCostStatement(
  firestore: Firestore,
  input: { estimate: MfgCostEstimate; products: Map<string, MfgProduct>; departments: DeptCapacityFields[]; settings: MfgSettings; earliestDays: number | null; note: string | null; actor: Actor }
): Promise<void> {
  const lines = input.estimate.lines.map((l) => {
    const product = input.products.get(l.productId)
    if (!product) throw new Error("product_missing")
    return { product, quantity: l.quantity }
  })
  if (input.settings.features.time && lines.some((l) => effectiveRoute(l.product).some((r) => r.hoursPerUnit == null))) throw new Error("standard_incomplete")
  await updateDoc(doc(firestore, MFG_COST_ESTIMATES, input.estimate.id), {
    lines: buildEstimateLines(lines, input.departments, input.settings),
    state: "sent",
    sentAt: nowIso(),
    sentByName: input.actor.name,
    earliestDays: input.earliestDays,
    validityDays: input.settings.estimateValidityDays,
    note: input.note,
    updatedAt: serverTimestamp(),
  })
}

/** Past validity: back to draft at today's cost, then sent again. */
export async function recalculateCostStatement(
  firestore: Firestore,
  input: { estimate: MfgCostEstimate; products: Map<string, MfgProduct>; departments: DeptCapacityFields[]; settings: MfgSettings; actor: Actor }
): Promise<void> {
  const lines = input.estimate.lines.map((l) => {
    const product = input.products.get(l.productId)
    if (!product) throw new Error("product_missing")
    return { product, quantity: l.quantity }
  })
  await updateDoc(doc(firestore, MFG_COST_ESTIMATES, input.estimate.id), {
    lines: buildEstimateLines(lines, input.departments, input.settings),
    state: "draft",
    sentAt: null,
    sentByName: null,
    quoteNumber: null,
    recalculatedAt: nowIso(),
    recalculatedBy: input.actor.name,
    updatedAt: serverTimestamp(),
  })
}

// ---------------------------------------------------------------------------
// Gates before release: survey (ORD-10) and release (T6, ORD-12)
// ---------------------------------------------------------------------------

export async function recordSurvey(
  firestore: Firestore,
  input: { orderId: string; date: string; measuredQuantity: number | null; note: string | null; sketch: { url: string; name: string } | null; actor: Actor }
): Promise<{ mismatch: boolean }> {
  if (!input.sketch?.url) throw new Error("sketch_required")
  let mismatch = false
  await mutateOrder(firestore, input.orderId, (fresh) => {
    if (fresh.status !== "open") throw new Error("order_closed")
    const q = fresh.quantity || 0
    mismatch = input.measuredQuantity != null && input.measuredQuantity > 0 && q > 0 && Math.abs(input.measuredQuantity - q) / q > 0.02
    return {
      survey: {
        at: input.date || nowIso().slice(0, 10),
        by: input.actor.name,
        byId: input.actor.id,
        note: input.note,
        measuredQuantity: input.measuredQuantity,
        sketchUrl: input.sketch!.url,
        sketchName: input.sketch!.name,
      },
      ...(mismatch
        ? { log: logEntry(fresh, "survey_mismatch", input.actor, `${input.measuredQuantity} / ${q}`, "bad") }
        : {}),
    }
  })
  return { mismatch }
}

/** Release enters the queue and reserves the need incl. waste. Never before the
 * down payment is confirmed, never without a survey for made-to-measure.
 *
 * An order that names no sales order may still have one — born of the same
 * quotation. A transaction cannot query, so the screen passes the id it
 * resolved (`salesOrderId`); it is re-read here and trusted only if the order
 * really belongs to it. */
export async function releaseOrder(
  firestore: Firestore,
  input: { orderId: string; product: MfgProduct; departments: DeptCapacityFields[]; salesOrderId?: string | null; actor: Actor }
): Promise<void> {
  await mutateOrder(firestore, input.orderId, async (fresh, tx) => {
    if (fresh.status !== "open" || fresh.releasedAt) throw new Error("already_released")
    let salesOrder: Pick<SalesOrder, "payment"> | null = null
    const soId = fresh.salesOrderId || input.salesOrderId || null
    if (soId) {
      const so = await tx.get(doc(firestore, SALES_ORDERS, soId))
      const found = so.exists() ? ({ ...(so.data() as SalesOrder), id: so.id } as SalesOrder) : null
      salesOrder = found && belongsToSalesOrder(fresh, found) ? found : null
    }
    const calc = calcOf(fresh, input.product, input.departments, [], salesOrder)
    if (releaseBlocks(calc).length) throw new Error("blocked")
    return { releasedAt: nowIso(), releasedByName: input.actor.name, releasedById: input.actor.id }
  })
}

/** Rushing names its price: the orders it delays travel with the reason. */
export async function rushOrder(firestore: Firestore, input: { orderId: string; reason: string; delays: number[]; actor: Actor }): Promise<void> {
  if (!input.reason.trim()) throw new Error("reason_required")
  await mutateOrder(firestore, input.orderId, (fresh) => ({
    rush: { reason: input.reason.trim(), by: input.actor.name, at: nowIso(), delays: input.delays },
    log: logEntry(fresh, "rushed", input.actor, input.reason.trim(), "bad"),
  }))
}

// ---------------------------------------------------------------------------
// Drawing: we produce and submit; the approver's module records A/B/C
// ---------------------------------------------------------------------------

export async function submitDrawing(
  firestore: Firestore,
  input: {
    orderId: string
    product: MfgProduct
    departments: DeptCapacityFields[]
    approverOrg: ApproverOrg
    note: string | null
    hours: number | null
    file: { url: string; name: string } | null
    cutList: CutPiece[]
    actor: Actor
  }
): Promise<void> {
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const prev = fresh.drawing ?? null
    if (prev?.submittedAt && !prev.code) throw new Error("drawing_at_approval")
    if (prev?.code === "A" || prev?.code === "B") throw new Error("drawing_approved")
    const route = effectiveRoute(input.product)
    const calc = calcOf(fresh, input.product, input.departments, [])
    const gi = calc.gates.findIndex((g) => g === "drawing")
    const progress = (fresh.progress || emptyProgress(route)).map((p, i) => (i === gi && input.hours ? { ...p, hours: round2(p.hours + Math.max(0, input.hours)) } : p))
    const src = sourceOf(fresh)
    // A stock order is the workshop's own: nobody outside approves its drawing,
    // so submitting it is the approval (D12).
    const internal = src === "stock"
    const at = nowIso()
    const drawing: DrawingRecord = {
      revision: (prev?.revision || 0) + 1,
      approverOrg: src === "client" ? "client" : internal ? "workshop" : input.approverOrg,
      submittedAt: at,
      submittedBy: input.actor.name,
      submittedById: input.actor.id,
      note: input.note,
      fileUrl: input.file?.url ?? prev?.fileUrl ?? null,
      fileName: input.file?.name ?? prev?.fileName ?? null,
      cutList: input.cutList.length ? input.cutList : prev?.cutList || [],
      code: internal ? "A" : null,
      resultNotes: null,
      approverName: internal ? input.actor.name : null,
      recordedBy: internal ? input.actor.name : null,
      recordedById: internal ? input.actor.id : null,
      recordedAt: internal ? at : null,
      previousC: prev?.previousC ?? null,
    }
    return { drawing, progress }
  })
}

/** Projects (technical office / consultant) or Sales (the client) records the result. */
export async function recordDrawingResult(
  firestore: Firestore,
  input: { orderId: string; code: DrawingCode; notes: string | null; approverName: string | null; evidence?: { url: string; name: string } | null; actor: Actor }
): Promise<void> {
  if ((input.code === "B" || input.code === "C") && !(input.notes || "").trim()) throw new Error("notes_required")
  const evidence = input.evidence?.url ? { resultFileUrl: input.evidence.url, resultFileName: input.evidence.name } : {}
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const d = fresh.drawing
    if (!d?.submittedAt || d.code) throw new Error("drawing_not_submitted")
    if (input.code === "C") {
      return {
        drawing: { ...d, ...evidence, submittedAt: null, code: null, previousC: input.notes, resultNotes: input.notes, approverName: input.approverName, recordedBy: input.actor.name, recordedById: input.actor.id, recordedAt: nowIso() },
        log: logEntry(fresh, "drawing_c", input.actor, input.notes, "bad"),
      }
    }
    return {
      drawing: { ...d, ...evidence, code: input.code, resultNotes: input.notes, approverName: input.approverName, recordedBy: input.actor.name, recordedById: input.actor.id, recordedAt: nowIso() },
      log: logEntry(fresh, `drawing_${input.code.toLowerCase()}`, input.actor, input.notes, "ok"),
    }
  })
}

// ---------------------------------------------------------------------------
// Slab sign-off (PR-01, T9) and order-level steps
// ---------------------------------------------------------------------------

export async function signOffSlab(
  firestore: Firestore,
  input: {
    orderId: string
    product: MfgProduct
    lot: string
    quantity: number
    /** What the block offers after other orders — computed by the screen from Inventory. */
    blockFree: number
    slabNumbers: string | null
    photosAttached: boolean
    form: { url: string; name: string } | null
    note: string | null
    /** The day the client signed (ISO date); defaults to today. */
    date?: string | null
    actor: Actor
  }
): Promise<void> {
  if (!input.lot.trim()) throw new Error("lot_required")
  if (!input.form?.url) throw new Error("form_required")
  if (input.blockFree < input.quantity - 0.05) throw new Error("block_short")
  const main = mainMaterial(input.product)
  await mutateOrder(firestore, input.orderId, (fresh) => {
    if (fresh.slabApproval) throw new Error("already_signed")
    const materials = (fresh.materials || []).map((m) => (main && itemKey(m.itemName) === itemKey(main.itemName) && m.state !== "received" ? { ...m, lot: input.lot.trim() } : m))
    return {
      slabApproval: {
        at: nowIso(),
        by: input.actor.name,
        byId: input.actor.id,
        lot: input.lot.trim(),
        signedOn: input.date || nowIso().slice(0, 10),
        quantity: round2(input.quantity),
        slabNumbers: input.slabNumbers,
        photosAttached: input.photosAttached,
        formUrl: input.form!.url,
        formName: input.form!.name,
        note: input.note,
        alternativeLot: null,
      },
      materials,
    }
  })
}

export async function completeOrderStep(
  firestore: Firestore,
  input: { orderId: string; product: MfgProduct; departments: DeptCapacityFields[]; index: number; hours: number | null; actor: Actor }
): Promise<void> {
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const calc = calcOf(fresh, input.product, input.departments, [])
    if (calc.gates[input.index] !== "manual") throw new Error("not_a_step")
    const q = calc.pend[input.index]
    if (q <= 0) throw new Error("nothing_in_hand")
    const progress = calc.slice.progress.map((p, i) => (i === input.index ? { ...p, done: round2(p.done + q), hours: round2(p.hours + Math.max(0, input.hours || 0)) } : p))
    return { progress }
  })
}

// ---------------------------------------------------------------------------
// Materials: request (ours) → issue (Inventory's) → receipt (ours)
// ---------------------------------------------------------------------------

export async function requestStationMaterials(
  firestore: Firestore,
  input: {
    orderId: string
    organizationId: string
    departmentId: string
    lines: Array<{ itemName: string; unit: string; quantity: number; lot: string | null }>
    consentNote: string | null
    actor: Actor
  }
): Promise<string> {
  const lines = input.lines.filter((l) => l.quantity > 0)
  if (!lines.length) throw new Error("quantity_required")
  let number = ""
  await mutateOrder(firestore, input.orderId, async (fresh, tx) => {
    if (!fresh.releasedAt || fresh.status !== "open") throw new Error("not_released")
    const approved = fresh.slabApproval?.lot || null
    const otherBlock = approved && lines.some((l) => l.lot && l.lot !== approved && l.lot !== fresh.slabApproval?.alternativeLot?.lot)
    if (otherBlock && !(input.consentNote || "").trim()) throw new Error("consent_required")
    const { docNumber } = await drawDocNumber(firestore, tx, input.organizationId, "WR")
    number = docNumber
    const at = nowIso()
    const rows: WorkOrderMaterial[] = lines.map((l, i) => ({
      id: `${docNumber}_${i}`,
      requestNumber: docNumber,
      itemName: l.itemName,
      unit: l.unit,
      quantity: round2(l.quantity),
      departmentId: input.departmentId,
      lot: l.lot,
      state: "requested",
      unitCost: null,
      warehouseId: null,
      requestedByUserId: input.actor.id,
      requestedByName: input.actor.name,
      requestedAt: at,
      consentNote: otherBlock ? (input.consentNote || "").trim() : null,
      releasedByName: null,
      releasedAt: null,
      receivedByName: null,
      receivedAt: null,
    }))
    return { materials: [...(fresh.materials || []), ...rows] }
  })
  return number
}

/** The station confirms receipt — HERE the value lands on the order (MAT-02). */
export async function confirmMaterialReceipt(
  firestore: Firestore,
  input: { orderId: string; requestNumber: string; note: string | null; actor: Actor; organizationId: string }
): Promise<void> {
  let value = 0
  let order: WorkOrderV2 | null = null
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const rows = fresh.materials || []
    const target = rows.filter((m) => m.requestNumber === input.requestNumber && m.state === "released")
    if (!target.length) throw new Error("nothing_to_confirm")
    value = round2(target.reduce((a, m) => a + (m.unitCost == null ? 0 : m.quantity * m.unitCost), 0))
    order = fresh
    const at = nowIso()
    const materials = rows.map((m) => (m.requestNumber === input.requestNumber && m.state === "released" ? { ...m, state: "received" as const, receivedByName: input.actor.name, receivedAt: at } : m))
    const materialCost = round2(materials.filter((m) => m.state === "received").reduce((a, m) => a + (m.unitCost == null ? 0 : m.quantity * m.unitCost), 0))
    return { materials, materialCost, ...(input.note ? { log: logEntry(fresh, "materials_note", input.actor, `${input.requestNumber}: ${input.note}`) } : {}) }
  })
  const o = order as WorkOrderV2 | null
  if (o) {
    onMfgMaterialsReceived(
      firestore,
      { organizationId: input.organizationId, userId: input.actor.id, userName: input.actor.name },
      { workOrderId: o.id, orderNumber: o.orderNumber, requestNumber: input.requestNumber, value, projectId: o.projectId ?? null, projectName: o.projectName ?? null }
    )
  }
}

/** A logged exception: output beyond what the received materials cover (MAT-03). */
export async function overrideMaterials(firestore: Firestore, input: { orderId: string; departmentId: string; reason: string; actor: Actor }): Promise<void> {
  if (!input.reason.trim()) throw new Error("reason_required")
  await mutateOrder(firestore, input.orderId, (fresh) => ({
    overrides: { ...(fresh.overrides || {}), [input.departmentId]: { reason: input.reason.trim(), by: input.actor.name, byId: input.actor.id, at: nowIso() } },
    log: logEntry(fresh, "materials_override", input.actor, input.reason.trim(), "bad"),
  }))
}

/** Our material shortfall goes to Procurement; the date waits for the arrival (MAT-05, ORD-16). */
export async function requestPurchase(
  firestore: Firestore,
  input: { orderId: string; itemName: string; unit: string; quantity: number; needBy: string | null; note: string | null; actor: Actor }
): Promise<void> {
  if (!(input.quantity > 0)) throw new Error("quantity_required")
  await mutateOrder(firestore, input.orderId, (fresh) => ({
    purchaseRequests: [
      ...(fresh.purchaseRequests || []),
      { id: generateId("PR"), itemName: input.itemName, unit: input.unit, quantity: round2(input.quantity), needBy: input.needBy, note: input.note, by: input.actor.name, byId: input.actor.id, at: nowIso(), state: "sent" as const, arrivedAt: null },
    ],
  }))
}

// ---------------------------------------------------------------------------
// The atomic event: record output & hand over (T13) / quality release (T13a)
// ---------------------------------------------------------------------------

export interface OutputInput {
  orderId: string
  product: MfgProduct
  departments: DeptCapacityFields[]
  settings: MfgSettings
  index: number
  good: number
  rejected: number
  defect: DefectKind | null
  cause: string | null
  photoAttached: boolean
  hours: number | null
  remnantArea: number | null
  /** QC & packing only: the final inspection passed. */
  finalInspection: boolean
  photosBeforePacking: boolean
  /** The actor holds manufacturing.qc (the QC station's recorder). */
  actorIsQc: boolean
  actor: Actor
}

export async function recordOutput(firestore: Firestore, input: OutputInput): Promise<void> {
  const good = round2(Math.max(0, input.good || 0))
  const rej = round2(Math.max(0, input.rejected || 0))
  if (good + rej <= 0) throw new Error("quantity_required")
  if (rej > 0 && !input.defect) throw new Error("defect_required")
  await mutateOrder(firestore, input.orderId, (fresh) => {
    if (fresh.status !== "open") throw new Error("order_closed")
    const calc = calcOf(fresh, input.product, input.departments, [])
    const i = input.index
    const step = calc.route[i]
    if (!step || calc.gates[i]) throw new Error("not_a_station")
    if (good + rej > calc.pend[i] + 1e-9) throw new Error("more_than_in_hand")
    const blocks = stationBlocks(calc, i)
    if (blocks.some((b) => b.severity === "hard")) throw new Error("blocked")
    if (!calc.slice.overrides[step.departmentId] && good + rej > canDo(calc, i) + 1e-9) throw new Error("beyond_materials")
    const qc = isQcStation(calc.stations[i] || { name: step.departmentName })
    if (qc && !input.actorIsQc) throw new Error("qc_only")
    if (qc && good > 0 && !input.finalInspection) throw new Error("final_inspection_required")
    const at = nowIso()
    const progress = calc.slice.progress.map((p, j) =>
      j === i ? { ...p, done: round2(p.done + good), rejected: round2(p.rejected + rej), hours: round2(p.hours + Math.max(0, input.hours || 0)) } : p
    )
    const update: Update = { progress }
    if (rej > 0) {
      update.rejects = [
        ...(fresh.rejects || []),
        { id: generateId("NC"), index: i, departmentId: step.departmentId, quantity: rej, defect: input.defect!, cause: input.cause || step.departmentId, photoAttached: input.photoAttached, note: null, by: input.actor.name, byId: input.actor.id, at },
      ]
    }
    const main = mainMaterial(input.product)
    if (input.remnantArea && input.remnantArea > 0 && main) {
      const value = Math.round(input.remnantArea * (main.unitCost || 0) * (input.settings.remnantValuePercent / 100))
      update.remnants = [
        ...(fresh.remnants || []),
        { id: generateId("RM"), area: round2(input.remnantArea), itemName: main.itemName, unit: main.unit, lot: fresh.slabApproval?.lot || null, value, state: "returned", source: "output", by: input.actor.name, byId: input.actor.id, at },
      ]
    }
    if (qc && good > 0) {
      update.qcReleases = [...(fresh.qcReleases || []), { quantity: good, by: input.actor.name, byId: input.actor.id, at, photosAttached: input.photosBeforePacking }]
    }
    update.stages = (fresh.stages || []).map((s, j) => (j === i ? { ...s, status: "in_progress", startedAt: s.startedAt || at } : s))
    return update
  })
}

// ---------------------------------------------------------------------------
// QC decision — rework · concession · remnant · scrap (FL-03, T14)
// ---------------------------------------------------------------------------

export interface QcDecisionInput {
  orderId: string
  product: MfgProduct
  departments: DeptCapacityFields[]
  settings: MfgSettings
  index: number
  kind: "rework" | "concession" | "remnant" | "scrap"
  quantity: number
  defect: DefectKind
  cause: string
  toIndex: number | null
  consent: string | null
  remnantArea: number | null
  reason: string
  actor: Actor
}

export async function qcDecide(firestore: Firestore, input: QcDecisionInput): Promise<{ scrapValue: number }> {
  if (!input.defect) throw new Error("defect_required")
  if (input.kind === "concession" && !(input.consent || "").trim()) throw new Error("consent_required")
  if ((input.kind === "scrap" || input.kind === "remnant") && !input.reason.trim()) throw new Error("reason_required")
  if (input.kind === "remnant" && !(input.remnantArea && input.remnantArea > 0)) throw new Error("remnant_area_required")
  let scrapValue = 0
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const calc = calcOf(fresh, input.product, input.departments, [])
    const i = input.index
    const p = calc.slice.progress[i]
    const q = round2(input.quantity)
    if (!p || q <= 0 || q > p.rejected + 1e-9) throw new Error("more_than_rejected")
    const at = nowIso()
    const progress = calc.slice.progress.map((x) => ({ ...x }))
    progress[i].rejected = round2(progress[i].rejected - q)
    const update: Update = { progress }
    const tag = `${input.defect} · ${input.cause || CAUSE_UNKNOWN}${input.reason ? ` — ${input.reason}` : ""}`
    if (input.kind === "rework") {
      const to = input.toIndex ?? i
      if (to > i || calc.gates[to]) throw new Error("rework_forward")
      if (to < i) {
        progress[i].back = round2((progress[i].back || 0) + q)
        progress[to].rework = round2(progress[to].rework + q)
      }
      update.log = logEntry(fresh, "qc_rework", input.actor, tag)
      return update
    }
    if (input.kind === "concession") {
      progress[i].done = round2(progress[i].done + q)
      update.log = logEntry(fresh, "qc_concession", input.actor, `${tag} · ${(input.consent || "").trim()}`)
      // Accepted at QC & packing is released by Quality — on its documented concession.
      if (isQcStation(calc.stations[i] || { name: calc.route[i]?.departmentName })) {
        update.qcReleases = [...(fresh.qcReleases || []), { quantity: q, by: input.actor.name, byId: input.actor.id, at, photosAttached: false }]
      }
      return update
    }
    const main = mainMaterial(input.product)
    const credit = input.kind === "remnant" && main ? Math.round((input.remnantArea || 0) * (main.unitCost || 0) * (input.settings.remnantValuePercent / 100)) : 0
    scrapValue = Math.max(0, Math.round(unitSunkCost(input.product, input.departments, input.settings, i) * q - credit))
    const scrap: WorkOrderScrap = {
      id: generateId("SC"),
      quantity: q,
      value: scrapValue,
      reason: input.reason.trim(),
      departmentId: calc.route[i].departmentId,
      index: i,
      defect: input.defect,
      cause: input.cause,
      raisedByUserId: input.actor.id,
      raisedByName: input.actor.name,
      raisedAt: at,
      status: "pending",
      approvedByName: null,
      approvedAt: null,
      classification: null,
      bearer: null,
      question: null,
      clarification: null,
      decision: null,
      remnantCredit: credit || null,
    }
    update.scrapRecords = [...(fresh.scrapRecords || []), scrap]
    if (input.kind === "remnant" && main) {
      update.remnants = [
        ...(fresh.remnants || []),
        { id: generateId("RM"), area: round2(input.remnantArea || 0), itemName: main.itemName, unit: main.unit, lot: fresh.slabApproval?.lot || null, value: credit, state: "returned", source: "qc", by: input.actor.name, byId: input.actor.id, at },
      ]
    }
    return update
  })
  return { scrapValue }
}

/** Approve with classification and bearer, or return for clarification (FN-08, T15). */
export async function reviewScrap(
  firestore: Firestore,
  input: {
    orderId: string
    scrapId: string
    decision: "approve" | "return"
    classification: "normal" | "abnormal"
    bearer: ScrapBearer
    question: string | null
    settings: MfgSettings
    canApproveAny: boolean
    actor: Actor
    organizationId: string
    /** The order's card, stations and notes: an approval may be the last thing
     * an already-delivered order waited on, so its status is refreshed. */
    product?: MfgProduct
    departments?: DeptCapacityFields[]
    notes?: MfgNoteSlice[]
  }
): Promise<void> {
  let approved: { order: WorkOrderV2; scrap: WorkOrderScrap } | null = null
  if (input.decision === "return" && !(input.question || "").trim()) throw new Error("question_required")
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const rows = fresh.scrapRecords || []
    const target = rows.find((s) => s.id === input.scrapId && s.status === "pending")
    if (!target) throw new Error("nothing_pending")
    if (input.decision === "return") {
      return {
        scrapRecords: rows.map((s) => (s.id === input.scrapId ? { ...s, status: "returned" as const, question: (input.question || "").trim(), questionBy: input.actor.name } : s)),
      }
    }
    if (!input.canApproveAny && target.value > input.settings.scrapApprovalLimit) throw new Error("above_limit")
    const next = { ...target, status: "approved" as const, approvedByName: input.actor.name, approvedAt: nowIso(), classification: input.classification, bearer: input.bearer }
    approved = { order: fresh, scrap: next }
    const update: Update = { scrapRecords: rows.map((s) => (s.id === input.scrapId ? next : s)) }
    if (input.bearer === "supplier" || input.bearer === "client") update.log = logEntry(fresh, `scrap_claim_${input.bearer}`, input.actor, `${target.value}`)
    if (input.product && input.departments) Object.assign(update, statusCache({ ...fresh, ...update } as WorkOrderV2, input.product, input.departments, input.notes || null))
    return update
  })
  const a = approved as { order: WorkOrderV2; scrap: WorkOrderScrap } | null
  if (a) {
    onMfgScrapApproved(
      firestore,
      { organizationId: input.organizationId, userId: input.actor.id, userName: input.actor.name },
      { workOrderId: a.order.id, orderNumber: a.order.orderNumber, scrapId: a.scrap.id, value: a.scrap.value, reason: a.scrap.reason, projectId: a.order.projectId ?? null, projectName: a.order.projectName ?? null }
    )
  }
}

export async function clarifyScrap(firestore: Firestore, input: { orderId: string; scrapId: string; defect: DefectKind; cause: string; answer: string; actor: Actor }): Promise<void> {
  if (!input.answer.trim()) throw new Error("answer_required")
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const rows = fresh.scrapRecords || []
    if (!rows.some((s) => s.id === input.scrapId && s.status === "returned")) throw new Error("nothing_returned")
    return {
      scrapRecords: rows.map((s) => (s.id === input.scrapId ? { ...s, status: "pending" as const, defect: input.defect, cause: input.cause, clarification: input.answer.trim() } : s)),
      log: logEntry(fresh, "scrap_clarified", input.actor, input.answer.trim()),
    }
  })
}

/** Re-make or declared shortfall — available once classified; approval runs in
 * parallel (FL-12). Another block only with documented consent (FL-08). */
export async function decideRemake(
  firestore: Firestore,
  input: {
    orderId: string
    product: MfgProduct
    departments: DeptCapacityFields[]
    source: "scrap" | "breakage"
    kind: "remake" | "shortfall"
    quantity: number
    reason: string
    alternativeLot: { lot: string; consent: string } | null
    /** The order's delivery notes — a declared shortfall may be what closes it. */
    notes?: MfgNoteSlice[]
    actor: Actor
  }
): Promise<void> {
  if (!input.reason.trim()) throw new Error("reason_required")
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const calc = calcOf(fresh, input.product, input.departments, input.notes || [])
    const q = input.source === "breakage" ? round2(input.quantity) : calc.scrapUndecided
    if (!(q > 0)) throw new Error("quantity_required")
    // A second tab (or a second manager) must not re-make the same breakage twice.
    if (input.source === "breakage" && input.notes && q > calc.brokenOpen + 1e-9) throw new Error("more_than_broken")
    const at = nowIso()
    const update: Update = {}
    if (input.source === "breakage") update.brokenResolved = round2((fresh.brokenResolved || 0) + q)
    else update.scrapRecords = (fresh.scrapRecords || []).map((s) => (s.decision === null && s.status !== "returned" ? { ...s, decision: input.kind, decidedBy: input.actor.name, decidedAt: at } : s))
    if (input.kind === "remake") {
      const progress = calc.slice.progress.map((p) => ({ ...p }))
      progress[calc.firstQ].rework = round2(progress[calc.firstQ].rework + q)
      update.progress = progress
      update.remade = round2((fresh.remade || 0) + q)
      if (input.alternativeLot && fresh.slabApproval) {
        if (!input.alternativeLot.consent.trim()) throw new Error("consent_required")
        update.slabApproval = { ...fresh.slabApproval, alternativeLot: { lot: input.alternativeLot.lot, consent: input.alternativeLot.consent.trim(), by: input.actor.name, at } }
      }
    } else {
      update.shortfall = round2((fresh.shortfall || 0) + q)
    }
    update.log = logEntry(fresh, `${input.kind}_${input.source}`, input.actor, `${q} — ${input.reason.trim()}`, "bad")
    Object.assign(update, statusCache({ ...fresh, ...update } as WorkOrderV2, input.product, input.departments, input.notes || null))
    return update
  })
}

// ---------------------------------------------------------------------------
// Close production (ORD-13, T17) and the delivery note (T18)
// ---------------------------------------------------------------------------

export async function closeProduction(
  firestore: Firestore,
  input: { orderId: string; product: MfgProduct; departments: DeptCapacityFields[]; settings: MfgSettings; notes: MfgNoteSlice[]; quantity: number; actor: Actor }
): Promise<{ final: boolean }> {
  let final = false
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const calc = calcOf(fresh, input.product, input.departments, input.notes)
    const q = round2(input.quantity)
    if (!(q > 0)) throw new Error("quantity_required")
    if (q > calc.toClose + 1e-9) throw new Error("more_than_released")
    // Nothing closes before Quality released it (FL-09): when the route ends at
    // QC & packing, the closed total may not pass the released total.
    const last = calc.route[calc.lastI]
    if (last && isQcStation(calc.stations[calc.lastI] || { name: last.departmentName })) {
      const released = round2((fresh.qcReleases || []).reduce((a, r) => a + r.quantity, 0))
      if (calc.closed + q > released + 1e-9) throw new Error("not_qc_released")
    }
    const closures = [...(fresh.closures || []), { quantity: q, by: input.actor.name, byId: input.actor.id, at: nowIso() }]
    const after = calcOf({ ...fresh, closures }, input.product, input.departments, input.notes)
    const update: Update = { closures }
    if (after.prodDone) {
      final = true
      update.frozenCost = { cost: orderCost(after, input.departments, input.settings).total, at: nowIso(), by: input.actor.name }
    }
    return update
  })
  return { final }
}

export async function issueDeliveryNote(
  firestore: Firestore,
  input: {
    orderId: string
    organizationId: string
    product: MfgProduct
    departments: DeptCapacityFields[]
    settings: MfgSettings
    notes: MfgNoteSlice[]
    quantity: number
    destination: { warehouseId: string; warehouseName: string; kind: "project" | "central"; projectId: string | null }
    pieces: number | null
    crates: number | null
    vehicle: { id: string; label: string; driverName: string; plate: string | null }
    note: string | null
    actor: Actor
  }
): Promise<{ noteId: string; noteNumber: string }> {
  if (!input.vehicle?.id) throw new Error("vehicle_required")
  const noteRef = doc(collection(firestore, DELIVERY_NOTES))
  let noteNumber = ""
  await mutateOrder(firestore, input.orderId, async (fresh, tx) => {
    const calc = calcOf(fresh, input.product, input.departments, input.notes)
    const q = round2(input.quantity)
    // `shippedQuantity` is kept on the order inside this transaction, so two
    // notes issued at once cannot both pass on the same stale list of notes.
    const shippedBefore = Math.max(calc.out, Number(fresh.shippedQuantity) || 0)
    if (!(q > 0) || q > calc.ready + 1e-9 || q > round2(calc.closed - shippedBefore) + 1e-9) throw new Error("more_than_ready")
    const { docNumber } = await drawDocNumber(firestore, tx, input.organizationId, "DN")
    noteNumber = docNumber
    const cost = orderCost(calc, input.departments, input.settings)
    const unitCost = calc.target > 0 ? round2(cost.good / calc.target) : null
    tx.set(noteRef, {
      organizationId: input.organizationId,
      noteNumber: docNumber,
      source: { kind: "manufacturing", workOrderId: fresh.id, workOrderNumber: fresh.orderNumber, workOrderDocNumber: fresh.docNumber ?? null, title: fresh.title },
      item: { name: input.product.name, quantity: q, unit: input.product.unit, unitCost },
      toWarehouseId: input.destination.warehouseId,
      toWarehouseName: input.destination.warehouseName,
      toKind: input.destination.kind,
      toProjectId: input.destination.projectId,
      status: "in_transit",
      sentByUserId: input.actor.id,
      sentByUserName: input.actor.name,
      sentAt: nowIso(),
      receivedByUserId: null,
      receivedByUserName: null,
      receivedAt: null,
      sentNote: input.note,
      receivedNote: null,
      rejectedReason: null,
      brokenQuantity: 0,
      pieces: input.pieces,
      crates: input.crates,
      vehicleId: input.vehicle.id,
      vehicleLabel: input.vehicle.label,
      driverName: input.vehicle.driverName,
      vehiclePlate: input.vehicle.plate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return { deliveryNoteId: noteRef.id, deliveryNoteNumber: docNumber, shippedQuantity: round2(shippedBefore + q) }
  })
  return { noteId: noteRef.id, noteNumber }
}

// ---------------------------------------------------------------------------
// Changes (T20, ORD-11), variance review (FL-05), checklists, stops, notices
// ---------------------------------------------------------------------------

export async function applyOrderChange(
  firestore: Firestore,
  input: {
    orderId: string
    product: MfgProduct
    departments: DeptCapacityFields[]
    notes: MfgNoteSlice[]
    kind: "quantity" | "cancel"
    quantity: number | null
    reason: string
    wip: "scrap" | "remnant"
    /** Cancel with usable remnants: their area. */
    remnantArea?: number | null
    settings?: MfgSettings
    actor: Actor
  }
): Promise<{ applied: number | null }> {
  let applied: number | null = null
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const calc = calcOf(fresh, input.product, input.departments, input.notes)
    if (!calc.live) throw new Error("order_closed")
    const incoming = fresh.changeRequest ?? null
    if (!incoming && sourceOf(fresh) !== "stock") throw new Error("owner_changes_only")
    const reason = (incoming?.reason || input.reason || "").trim()
    if (!reason) throw new Error("reason_required")
    const at = nowIso()
    if (input.kind === "cancel") {
      if (calc.delivered >= calc.target) throw new Error("fully_delivered")
      const settings = input.settings
      const scrap: WorkOrderScrap[] = []
      const remnants = [...(fresh.remnants || [])]
      const main = mainMaterial(input.product)
      // The work in hand is the manager's call (edge case "cancelling with work
      // in hand"): written off at its sunk value for approval, or returned as
      // usable remnants credited at Finance's policy.
      if (settings && calc.released) {
        // Never write off more than the order actually holds: units waiting at
        // a station were not worked there yet (nor was its slab issued), and a
        // remnant credit is part of the same work in hand, not on top of it.
        const held = Math.max(0, orderCost(calc, input.departments, settings).wip)
        const main0 = mainMaterial(input.product)
        const credit = input.wip === "remnant" && main0 && (input.remnantArea || 0) > 0 ? Math.min(held, Math.round((input.remnantArea || 0) * (main0.unitCost || 0) * (settings.remnantValuePercent / 100))) : 0
        const standard = calc.route.map((_, i) => (calc.pend[i] > 0 && !calc.gates[i] ? unitSunkCost(input.product, input.departments, settings, i) * calc.pend[i] : 0))
        const standardTotal = standard.reduce((a, v) => a + v, 0)
        const writeOff = Math.max(0, Math.min(standardTotal, held) - credit)
        const scale = standardTotal > 0 ? writeOff / standardTotal : 0
        calc.route.forEach((r, i) => {
          const q = calc.pend[i]
          if (!(q > 0) || calc.gates[i]) return
          scrap.push({
            id: generateId("SC"),
            quantity: q,
            value: Math.round(standard[i] * scale),
            reason: `${input.wip === "remnant" ? "remnant" : "cancelled"} — ${reason}`,
            departmentId: r.departmentId,
            index: i,
            defect: null,
            cause: null,
            raisedByUserId: input.actor.id,
            raisedByName: input.actor.name,
            raisedAt: at,
            status: "pending",
            decision: "shortfall",
          })
        })
        if (input.wip === "remnant" && main && (input.remnantArea || 0) > 0) {
          remnants.push({ id: generateId("RM"), area: round2(input.remnantArea || 0), itemName: main.itemName, unit: main.unit, lot: fresh.slabApproval?.lot || null, value: credit, state: "returned", source: "cancel", by: input.actor.name, byId: input.actor.id, at })
        }
      }
      return {
        status: "cancelled",
        changeRequest: null,
        cancellation: { at, by: input.actor.name, reason, wip: input.wip, fromModule: incoming?.module ?? null },
        materials: (fresh.materials || []).filter((m) => m.state !== "requested"),
        ...(scrap.length ? { scrapRecords: [...(fresh.scrapRecords || []), ...scrap] } : {}),
        ...(remnants.length !== (fresh.remnants || []).length ? { remnants } : {}),
        log: logEntry(fresh, "cancelled", input.actor, reason, "bad"),
      }
    }
    const min = minQuantity(calc)
    const wanted = round2(incoming?.newQuantity ?? input.quantity ?? 0)
    if (!(wanted > 0)) throw new Error("quantity_required")
    if (!incoming && wanted < min) throw new Error("below_minimum")
    applied = Math.max(wanted, min)
    const delta = round2(applied - (fresh.quantity || 0))
    const progress = calc.slice.progress.map((p, i) => (calc.gates[i] === "manual" && p.done > 0 && i < calc.firstQ ? { ...p, done: Math.max(0, round2(p.done + delta)) } : p))
    return {
      quantity: applied,
      items: [{ name: input.product.name, quantity: applied, unit: input.product.unit }],
      output: { name: input.product.name, quantity: applied, unit: input.product.unit },
      progress,
      changeRequest: null,
      log: logEntry(fresh, "quantity_changed", input.actor, `${fresh.quantity} → ${applied}${incoming && wanted < min ? ` (min ${min})` : ""} — ${reason}`),
    }
  })
  return { applied }
}

export async function reviewVariance(firestore: Firestore, input: { orderId: string; departmentId: string; cause: VarianceCause; note: string | null; actor: Actor }): Promise<void> {
  await mutateOrder(firestore, input.orderId, (fresh) => ({
    varianceReviews: { ...(fresh.varianceReviews || {}), [input.departmentId]: { cause: input.cause, note: input.note, by: input.actor.name, at: nowIso() } },
    log: logEntry(fresh, "variance_reviewed", input.actor, `${input.cause}${input.note ? ` — ${input.note}` : ""}`),
  }))
}

export async function toggleChecklistItem(firestore: Firestore, input: { orderId: string; departmentId: string; itemKey: string; actor: Actor }): Promise<void> {
  await mutateOrder(firestore, input.orderId, (fresh) => {
    const checklists = { ...(fresh.checklists || {}) }
    const dept = { ...(checklists[input.departmentId] || {}) }
    if (dept[input.itemKey]) delete dept[input.itemKey]
    else dept[input.itemKey] = { by: input.actor.name, at: nowIso() }
    checklists[input.departmentId] = dept
    return { checklists }
  })
}

export const STOP_KINDS = ["machine", "power", "absence", "maintenance"] as const
export type StopKind = (typeof STOP_KINDS)[number]

export interface MfgStop {
  id: string
  organizationId: string
  departmentId: string
  date: string
  hours: number
  kind: StopKind
  note: string | null
  by: string
  byId: string
  at: string
}

/** Hours lost today at a station — they move every possible date through it (FL-14). */
export async function recordStop(
  firestore: Firestore,
  input: { organizationId: string; department: DeptCapacityFields; hours: number; alreadyLost: number; kind: StopKind; note: string | null; actor: Actor }
): Promise<void> {
  const cap = Math.max(1, Number(input.department.workers) || 1) * Math.max(1, Number(input.department.hoursPerDay) || 8)
  if (!(input.hours > 0) || input.hours + input.alreadyLost > cap + 1e-9) throw new Error("hours_beyond_capacity")
  await addDoc(collection(firestore, MFG_STOPS), {
    organizationId: input.organizationId,
    departmentId: input.department.id,
    date: nowIso().slice(0, 10),
    hours: round2(input.hours),
    kind: input.kind,
    note: input.note,
    by: input.actor.name,
    byId: input.actor.id,
    at: nowIso(),
    createdAt: serverTimestamp(),
  })
}

export interface MfgBlockNotice {
  id: string
  organizationId: string
  lot: string
  itemName: string | null
  defect: DefectKind
  note: string
  photosAttached: boolean
  orderIds: string[]
  by: string
  byId: string
  at: string
  /** Inventory's act: the block is quarantined. */
  quarantinedAt?: string | null
  quarantinedBy?: string | null
  /** Procurement's act: the supplier claim is raised. */
  claimRaisedAt?: string | null
  claimRaisedBy?: string | null
  closedAt?: string | null
}

/** A defect in a stone batch, shown on every order using it; asks Inventory to
 * quarantine and Procurement to claim (FL-11, T25). */
export async function raiseBlockNotice(
  firestore: Firestore,
  input: { organizationId: string; lot: string; itemName: string | null; defect: DefectKind; note: string; photosAttached: boolean; orderIds: string[]; actor: Actor }
): Promise<string> {
  if (!input.lot.trim()) throw new Error("lot_required")
  if (!input.note.trim()) throw new Error("note_required")
  const ref = await addDoc(collection(firestore, MFG_BLOCK_NOTICES), {
    organizationId: input.organizationId,
    lot: input.lot.trim(),
    itemName: input.itemName,
    defect: input.defect,
    note: input.note.trim(),
    photosAttached: input.photosAttached,
    orderIds: input.orderIds,
    by: input.actor.name,
    byId: input.actor.id,
    at: nowIso(),
    quarantinedAt: null,
    claimRaisedAt: null,
    closedAt: null,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

// ===========================================================================
// OTHER MODULES' ACTS — called from their own screens, under their permissions
// ===========================================================================

/** Inventory issues a withdrawal: stock leaves the shelf now, in the same
 * batch, with each line's cost snapshotted (T11). */
export async function issueWithdrawal(
  firestore: Firestore,
  input: {
    orderId: string
    requestNumber: string
    warehouseId: string
    stockRows: Array<{ id: string; name: string; quantity: number; unitCost?: number | null; lot?: string | null }>
    /** The stock row the storekeeper chose for each material line (by line id). */
    rowFor?: Record<string, string>
    /** Blocks under an open, quarantined quality notice — never issued. */
    quarantinedLots?: string[]
    actor: Actor
  }
): Promise<void> {
  const quarantined = new Set(input.quarantinedLots || [])
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, WORK_ORDERS, input.orderId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("order_missing")
    const fresh = { ...(snap.data() as WorkOrderV2), id: snap.id }
    const rows = fresh.materials || []
    const target = rows.filter((m) => m.requestNumber === input.requestNumber && m.state === "requested")
    if (!target.length) throw new Error("nothing_to_release")
    const pick = (m: WorkOrderMaterial) => {
      const chosen = input.rowFor?.[m.id]
      if (chosen) return input.stockRows.find((r) => r.id === chosen)
      return (
        input.stockRows.find((r) => itemKey(r.name) === itemKey(m.itemName) && !!m.lot && r.lot === m.lot) ||
        input.stockRows.find((r) => itemKey(r.name) === itemKey(m.itemName) && !m.lot)
      )
    }
    // One stock row may serve several lines: check the row's total draw.
    const draw = new Map<string, { row: (typeof input.stockRows)[number]; qty: number }>()
    for (const m of target) {
      const row = pick(m)
      if (!row || itemKey(row.name) !== itemKey(m.itemName)) throw new Error("insufficient_stock")
      if ((row.lot && quarantined.has(row.lot)) || (m.lot && quarantined.has(m.lot))) throw new Error("block_quarantined")
      const cur = draw.get(row.id) || { row, qty: 0 }
      cur.qty = round2(cur.qty + m.quantity)
      draw.set(row.id, cur)
    }
    const fresh_ = await Promise.all(
      Array.from(draw.values()).map(async ({ row, qty }) => {
        const s = await tx.get(doc(firestore, "warehouses", input.warehouseId, "inventoryItems", row.id))
        const onHand = s.exists() ? Number(s.data().quantity) || 0 : 0
        if (onHand + 1e-9 < qty) throw new Error("insufficient_stock")
        return { row, qty }
      })
    )
    const at = nowIso()
    for (const { row, qty } of fresh_) {
      tx.update(doc(firestore, "warehouses", input.warehouseId, "inventoryItems", row.id), { quantity: increment(-qty), updatedAt: serverTimestamp() })
    }
    const materials = rows.map((m) => {
      if (m.requestNumber !== input.requestNumber || m.state !== "requested") return m
      const row = pick(m)
      return { ...m, state: "released" as const, unitCost: row?.unitCost ?? null, warehouseId: input.warehouseId, lot: m.lot || row?.lot || null, releasedByName: input.actor.name, releasedAt: at }
    })
    tx.update(ref, { materials, updatedAt: serverTimestamp() })
  })
}

/** Receipt at the destination (T19): the net lands and its cost moves; transit
 * breakage is recorded on the note and opens the re-make decision. */
export async function receiveDeliveryNote(
  firestore: Firestore,
  input: { note: DeliveryNote; brokenQuantity: number; receivedNote: string | null; actor: Actor }
): Promise<void> {
  const broken = Math.max(0, round2(input.brokenQuantity || 0))
  if (broken > input.note.item.quantity) throw new Error("more_than_shipped")
  const net = round2(input.note.item.quantity - broken)
  const receivedAt = nowIso()
  const orgId = input.note.organizationId
  // Read outside the transaction (queries cannot run inside one): the order's
  // other notes and the station registry, so the receipt that completes the
  // order can mark it done for the modules that filter on `status`.
  const [otherNotes, departments] = await Promise.all([
    getDocs(query(collection(firestore, DELIVERY_NOTES), where("organizationId", "==", orgId), where("source.workOrderId", "==", input.note.source.workOrderId)))
      .then((q) => q.docs.map((d) => ({ ...(d.data() as DeliveryNote), id: d.id })))
      .catch(() => null),
    getDocs(query(collection(firestore, "manufacturingDepartments"), where("organizationId", "==", orgId)))
      .then((q) => q.docs.map((d) => ({ ...(d.data() as DeptCapacityFields), id: d.id })))
      .catch(() => [] as DeptCapacityFields[]),
  ])
  await runTransaction(firestore, async (tx) => {
    const noteRef = doc(firestore, DELIVERY_NOTES, input.note.id)
    const orderRef = doc(firestore, WORK_ORDERS, input.note.source.workOrderId)
    const [snap, orderSnap] = await Promise.all([tx.get(noteRef), tx.get(orderRef)])
    if (!snap.exists() || snap.data().status !== "in_transit") throw new Error("not_in_transit")
    const order = orderSnap.exists() ? ({ ...(orderSnap.data() as WorkOrderV2), id: orderSnap.id }) : null
    const productSnap = order?.productId ? await tx.get(doc(firestore, MFG_PRODUCTS, order.productId)) : null
    const product = productSnap?.exists() ? ({ ...(productSnap.data() as MfgProduct), id: productSnap.id }) : null
    tx.update(noteRef, {
      status: "received",
      brokenQuantity: broken,
      receivedByUserId: input.actor.id,
      receivedByUserName: input.actor.name,
      receivedAt,
      receivedNote: input.receivedNote,
      updatedAt: serverTimestamp(),
    })
    if (net > 0) {
      tx.set(doc(collection(firestore, "warehouses", input.note.toWarehouseId, "inventoryItems")), {
        organizationId: input.note.organizationId,
        warehouseId: input.note.toWarehouseId,
        name: input.note.item.name,
        quantity: net,
        unit: input.note.item.unit,
        unitCost: input.note.item.unitCost,
        isManufactured: true,
        sourceWorkOrderId: input.note.source.workOrderId,
        sourceWorkOrderNumber: input.note.source.workOrderNumber,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
    let cache: Update = {}
    if (order && product && otherNotes) {
      const after = otherNotes.map((n) => (n.id === input.note.id ? { ...n, status: "received" as const, brokenQuantity: broken } : n)).map(toNoteSlice)
      cache = statusCache(order, product, departments, after)
    }
    tx.update(orderRef, { receivedAt, receivedByUserId: input.actor.id, receivedByUserName: input.actor.name, ...cache, updatedAt: serverTimestamp() })
  })
  onWorkOrderDelivered(
    firestore,
    { organizationId: input.note.organizationId, userId: input.actor.id, userName: input.actor.name },
    {
      workOrderId: input.note.source.workOrderId,
      orderNumber: input.note.source.workOrderNumber,
      deliveryNoteId: input.note.id,
      value: round2((input.note.item.unitCost ?? 0) * net),
      warehouseName: input.note.toWarehouseName,
      projectId: input.note.toProjectId ?? null,
      toProject: input.note.toKind === "project",
    }
  )
}

/** Inventory receives returned remnants into stock at the policy value (T26). */
export async function receiveRemnant(
  firestore: Firestore,
  input: { orderId: string; remnantId: string; warehouseId: string; organizationId: string; actor: Actor }
): Promise<void> {
  const received = await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, WORK_ORDERS, input.orderId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("order_missing")
    const fresh = { ...(snap.data() as WorkOrderV2), id: snap.id }
    const rows = fresh.remnants || []
    const r = rows.find((x) => x.id === input.remnantId && x.state === "returned")
    if (!r) throw new Error("nothing_to_receive")
    const at = nowIso()
    tx.set(doc(collection(firestore, "warehouses", input.warehouseId, "inventoryItems")), {
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      name: r.itemName,
      quantity: r.area,
      unit: r.unit,
      unitCost: r.area > 0 ? round2(r.value / r.area) : null,
      lot: `REM-${(r.lot || fresh.docNumber || fresh.orderNumber || "").toString().replace(/^BLK-/, "")}-${rows.indexOf(r) + 1}`,
      remnant: true,
      sourceWorkOrderId: fresh.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    tx.update(ref, { remnants: rows.map((x) => (x.id === r.id ? { ...x, state: "received" as const, receivedBy: input.actor.name, receivedAt: at, warehouseId: input.warehouseId } : x)), updatedAt: serverTimestamp() })
    return { order: fresh, remnant: r }
  })
  // The credit reaches the books only at receipt (INV-06): WIP → materials.
  onMfgRemnantReceived(
    firestore,
    { organizationId: input.organizationId, userId: input.actor.id, userName: input.actor.name },
    {
      workOrderId: received.order.id,
      orderNumber: received.order.orderNumber,
      remnantId: received.remnant.id,
      value: received.remnant.value,
      itemName: received.remnant.itemName,
      projectId: received.order.projectId ?? null,
      projectName: received.order.projectName ?? null,
    }
  )
}

/** Procurement (or Inventory at receipt) marks our purchase request arrived (T23). */
export async function markPurchaseArrived(firestore: Firestore, input: { orderId: string; purchaseRequestId: string; actor: Actor }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, WORK_ORDERS, input.orderId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error("order_missing")
    const rows = ((snap.data() as WorkOrderV2).purchaseRequests || []).map((p) => (p.id === input.purchaseRequestId && p.state === "sent" ? { ...p, state: "arrived" as const, arrivedAt: nowIso() } : p))
    tx.update(ref, { purchaseRequests: rows, updatedAt: serverTimestamp() })
  })
}

/** The order's owner asks for a quantity change or a cancellation (T20). */
export async function requestOrderChange(
  firestore: Firestore,
  input: { orderId: string; kind: ChangeRequest["kind"]; newQuantity: number | null; reason: string; module: ChangeRequest["module"]; actor: Actor }
): Promise<void> {
  if (!input.reason.trim()) throw new Error("reason_required")
  if (input.kind === "quantity" && !(input.newQuantity && input.newQuantity > 0)) throw new Error("quantity_required")
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, WORK_ORDERS, input.orderId)
    const snap = await tx.get(ref)
    if (!snap.exists() || snap.data().status !== "open") throw new Error("order_closed")
    if (snap.data().changeRequest) throw new Error("change_pending")
    tx.update(ref, {
      changeRequest: { kind: input.kind, newQuantity: input.kind === "quantity" ? input.newQuantity : null, reason: input.reason.trim(), module: input.module, by: input.actor.name, byId: input.actor.id, at: nowIso() },
      updatedAt: serverTimestamp(),
    })
  })
}

export async function markBlockQuarantined(firestore: Firestore, input: { noticeId: string; actor: Actor }): Promise<void> {
  await updateDoc(doc(firestore, MFG_BLOCK_NOTICES, input.noticeId), { quarantinedAt: nowIso(), quarantinedBy: input.actor.name, updatedAt: serverTimestamp() })
}

export async function markBlockClaimRaised(firestore: Firestore, input: { noticeId: string; actor: Actor }): Promise<void> {
  await updateDoc(doc(firestore, MFG_BLOCK_NOTICES, input.noticeId), { claimRaisedAt: nowIso(), claimRaisedBy: input.actor.name, updatedAt: serverTimestamp() })
}

/** Sales asks for cost and lead time on a non-standard line (sales.cost_request.created). */
export async function createCostingRequest(
  firestore: Firestore,
  input: { organizationId: string; contactName: string | null; rfqRef: string | null; neededBy: string | null; lines: MfgRequestLine[]; note: string | null; actor: Actor }
): Promise<string> {
  const lines = input.lines.filter((l) => l.quantity > 0 && l.productId)
  if (!lines.length) throw new Error("lines_required")
  const ref = doc(collection(firestore, MANUFACTURING_REQUESTS))
  await runTransaction(firestore, async (tx) => {
    const { docNumber } = await drawDocNumber(firestore, tx, input.organizationId, "MR")
    tx.set(ref, {
      organizationId: input.organizationId,
      requestNumber: docNumber,
      kind: "cost",
      sourceKind: "sales",
      orderId: null,
      orderNumber: null,
      contactName: input.contactName,
      rfqRef: input.rfqRef,
      itemName: lines[0].itemName,
      unit: lines[0].unit,
      quantity: lines[0].quantity,
      lines,
      neededBy: input.neededBy,
      note: input.note,
      status: "new",
      createdByUserId: input.actor.id,
      createdByUserName: input.actor.name,
      requestedAt: nowIso(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
  return ref.id
}

/** Procurement routes a project need to make — with the PM's material request and cost item. */
export async function routeNeedToManufacturing(
  firestore: Firestore,
  input: {
    organizationId: string
    projectId: string
    projectName: string
    purchaseRequestRef: string
    pmRequestRef: string | null
    costItemName: string | null
    neededBy: string | null
    lines: MfgRequestLine[]
    note: string | null
    actor: Actor
  }
): Promise<string> {
  const lines = input.lines.filter((l) => l.quantity > 0 && l.productId)
  if (!lines.length) throw new Error("lines_required")
  const ref = doc(collection(firestore, MANUFACTURING_REQUESTS))
  await runTransaction(firestore, async (tx) => {
    const { docNumber } = await drawDocNumber(firestore, tx, input.organizationId, "MR")
    tx.set(ref, {
      organizationId: input.organizationId,
      requestNumber: docNumber,
      kind: "make",
      sourceKind: "procurement",
      orderId: null,
      orderNumber: null,
      contactName: null,
      projectId: input.projectId,
      projectName: input.projectName,
      purchaseRequestRef: input.purchaseRequestRef,
      pmRequestRef: input.pmRequestRef,
      costItemName: input.costItemName,
      itemName: lines[0].itemName,
      unit: lines[0].unit,
      quantity: lines[0].quantity,
      lines,
      neededBy: input.neededBy,
      note: input.note,
      status: "new",
      createdByUserId: input.actor.id,
      createdByUserName: input.actor.name,
      requestedAt: nowIso(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
  return ref.id
}

/** After the answer window the requester may move to purchase in their module (REQ-07). */
export async function moveRequestToPurchase(firestore: Firestore, input: { request: ManufacturingRequest; actor: Actor }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, MANUFACTURING_REQUESTS, input.request.id)
    const snap = await tx.get(ref)
    if (!snap.exists() || snap.data().status !== "new") throw new Error("already_answered")
    tx.update(ref, { status: "moved", answerNote: null, decidedAt: nowIso(), decidedByUserId: input.actor.id, decidedByUserName: input.actor.name, movedToPurchase: true, updatedAt: serverTimestamp() })
  })
}

/** Sales records what became of a quote built on our cost (REQ-08). */
export async function recordQuoteStatus(
  firestore: Firestore,
  input: { estimate: MfgCostEstimate; state: "quoted" | "won" | "lost"; quoteNumber: string | null; salesOrderNumber: number | null; actor: Actor; settings?: MfgSettings; today?: string }
): Promise<void> {
  if (input.state === "quoted" && !(input.quoteNumber || "").trim()) throw new Error("quote_required")
  const from = input.estimate.state
  const allowed = input.state === "quoted" ? from === "sent" || from === "quoted" : from === "sent" || from === "quoted"
  if (!allowed) throw new Error("invalid_transition")
  if (input.settings && input.today && input.state === "quoted" && estimateExpired(input.estimate, input.today, input.settings)) throw new Error("expired")
  await updateDoc(doc(firestore, MFG_COST_ESTIMATES, input.estimate.id), {
    state: input.state,
    quoteNumber: (input.quoteNumber || input.estimate.quoteNumber || "").trim() || null,
    salesOrderNumber: input.salesOrderNumber ?? input.estimate.salesOrderNumber ?? null,
    salesStatusBy: input.actor.name,
    salesStatusAt: nowIso(),
    updatedAt: serverTimestamp(),
  })
}

// ---------------------------------------------------------------------------
// Fleet (HR) — the driver comes from a list, never typed (ORD-14)
// ---------------------------------------------------------------------------

export const FLEET_VEHICLES = "fleetVehicles"

export interface FleetVehicle {
  id: string
  organizationId: string
  driverName: string
  plate: string | null
  kind: "truck" | "lorry" | "van" | "carrier"
  active: boolean
}

export async function saveFleetVehicle(firestore: Firestore, input: { organizationId: string; vehicle: Omit<FleetVehicle, "id" | "organizationId"> & { id?: string }; actor: Actor }): Promise<void> {
  if (!input.vehicle.driverName.trim()) throw new Error("driver_required")
  const data = { organizationId: input.organizationId, driverName: input.vehicle.driverName.trim(), plate: input.vehicle.plate?.trim() || null, kind: input.vehicle.kind, active: input.vehicle.active, updatedBy: input.actor.name, updatedAt: serverTimestamp() }
  if (input.vehicle.id) await updateDoc(doc(firestore, FLEET_VEHICLES, input.vehicle.id), data)
  else await addDoc(collection(firestore, FLEET_VEHICLES), { ...data, createdAt: serverTimestamp() })
}

// ---------------------------------------------------------------------------
// Station registry helpers
// ---------------------------------------------------------------------------

export async function updateStation(
  firestore: Firestore,
  departmentId: string,
  patch: Partial<{ workers: number; hoursPerDay: number; hourlyRate: number; leadUserId: string | null; leadUserName: string | null; qcStation: boolean; gate: GateKind | null; name: string; checklist: Array<{ key: string; label: string }> }>
): Promise<void> {
  await updateDoc(doc(firestore, "manufacturingDepartments", departmentId), { ...patch, updatedAt: serverTimestamp() })
}

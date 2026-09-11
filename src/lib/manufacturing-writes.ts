// Manufacturing v2 write flows — where a workshop decision becomes documents.
//
// Same shape as sales-order-writes: each flow writes ONE batch so the business
// fact and its side effects land together (a released withdrawal also empties
// the shelf; a confirmed note also lands the stock). Accounting entries ride
// the safe hooks after commit — the ledger mirrors the documents, never gates
// them. Validation THROWS here so the UI can only show what the data allows.

import {
  collection,
  doc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore"
import {
  MFG_COST_ESTIMATES,
  MFG_PRODUCTS,
  MFG_SETTINGS,
  buildEstimateLines,
  emptyProgress,
  estimateCost,
  generateEstimateNumber,
  generateScrapId,
  generateWithdrawalNumber,
  isDoneV2,
  materialCostOf,
  minPriceFor,
  orderCost,
  pendingAt,
  releaseBlocks,
  remainAt,
  round2,
  unitSunkCost,
  type DeptCapacityFields,
  type MeasurementRecord,
  type MfgCostEstimate,
  type MfgNoteSlice,
  type MfgOrderSlice,
  type MfgProduct,
  type MfgSettings,
  type StageProgress,
  type WorkOrderMaterial,
  type WorkOrderScrap,
} from "./manufacturing-engine"
import { WORK_ORDERS, nextWorkOrderNumber, type WorkOrder, type WorkOrderStage } from "./manufacturing"
import { DELIVERY_NOTES, generateDeliveryNoteNumber, type DeliveryNote } from "./delivery-notes"
import { MANUFACTURING_REQUESTS, generateMfgRequestNumber, type ManufacturingRequest, type MfgRequestLine } from "./sales-orders"
import { onMfgMaterialsReceived, onMfgScrapApproved, onWorkOrderDelivered } from "./accounting/hooks"

const nowIso = () => new Date().toISOString()

export interface Actor {
  id: string
  name: string
}

/** A work order carrying the v2 (product-born) fields. */
export interface WorkOrderV2 extends WorkOrder {
  productId?: string | null
  productName?: string | null
  unit?: string | null
  quantity?: number | null
  neededBy?: string | null
  createdAtIso?: string | null
  releasedAt?: string | null
  releasedByName?: string | null
  riskReason?: string | null
  measurement?: MeasurementRecord | null
  drawingApprovalStatus?: "na" | "pending" | "approved"
  drawingApprovedAt?: string | null
  drawingApprovedBy?: string | null
  slabApproval?: { at: string; by: string; lot: string; note?: string | null } | null
  rush?: { reason: string; by: string; at: string } | null
  progress?: StageProgress[]
  materials?: WorkOrderMaterial[]
  scrapRecords?: WorkOrderScrap[]
  checklists?: Record<string, Record<string, { by: string; at: string }>>
  shortfall?: number
  brokenResolved?: number
  sourceQuotationWon?: boolean | null
}

export const isV2Order = (o: Pick<WorkOrderV2, "productId">): boolean => !!o.productId

/** The engine's structural view of a v2 doc. */
export function toOrderSlice(o: WorkOrderV2): MfgOrderSlice {
  return {
    id: o.id,
    productId: o.productId || "",
    quantity: o.quantity || 0,
    neededBy: o.neededBy ?? o.dueDate ?? null,
    createdAt2: o.createdAtIso || "",
    releasedAt: o.releasedAt ?? null,
    riskReason: o.riskReason ?? null,
    measurement: o.measurement ?? null,
    drawingApprovalStatus: o.drawingApprovalStatus || "na",
    drawingApprovedAt: o.drawingApprovedAt ?? null,
    slabApproval: o.slabApproval ?? null,
    rush: o.rush ?? null,
    progress: o.progress || [],
    materials: o.materials || [],
    scrap: o.scrapRecords || [],
    checklists: o.checklists,
    shortfall: o.shortfall || 0,
    brokenResolved: o.brokenResolved || 0,
    status: o.status,
    sourceQuotationId: o.source?.quotationId ?? null,
    sourceQuotationWon: o.sourceQuotationWon ?? null,
  }
}

export function toNoteSlice(n: Pick<DeliveryNote, "item" | "brokenQuantity" | "status">): MfgNoteSlice {
  return {
    quantity: n.item.quantity,
    brokenQuantity: n.brokenQuantity || 0,
    status: n.status === "rejected" ? "rejected" : n.status === "received" ? "received" : "in_transit",
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveMfgSettings(firestore: Firestore, organizationId: string, settings: MfgSettings): Promise<void> {
  await setDoc(
    doc(firestore, MFG_SETTINGS, organizationId),
    { ...settings, organizationId, updatedAt: serverTimestamp() },
    { merge: true }
  )
}

// ---------------------------------------------------------------------------
// Product cards
// ---------------------------------------------------------------------------

export async function createMfgProduct(
  firestore: Firestore,
  input: { organizationId: string; product: Omit<MfgProduct, "id" | "organizationId">; actor: Actor }
): Promise<string> {
  if (!input.product.route.length) throw new Error("route_required")
  const ref = doc(collection(firestore, MFG_PRODUCTS))
  await setDoc(ref, {
    ...input.product,
    organizationId: input.organizationId,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

// ---------------------------------------------------------------------------
// Work orders — born from a product card
// ---------------------------------------------------------------------------

export interface WorkOrderSource {
  kind: "project" | "quotation" | "stock"
  projectId?: string | null
  projectName?: string | null
  quotationId?: string | null
  quotationNumber?: string | null
  quotationWon?: boolean | null
  contactId?: string | null
  contactName?: string | null
}

function stagesFromRoute(product: MfgProduct): WorkOrderStage[] {
  return product.route.map((r, i) => ({
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    assigneeUserId: null,
    assigneeName: null,
    status: i === 0 ? "in_progress" : "pending",
    startedAt: i === 0 ? nowIso() : null,
    completedAt: null,
    note: null,
  }))
}

export async function createWorkOrderFromProduct(
  firestore: Firestore,
  input: {
    organizationId: string
    product: MfgProduct
    quantity: number
    neededBy: string | null
    source: WorkOrderSource
    requestId?: string | null
    requestedBy?: string | null
    estimateId?: string | null
    actor: Actor
  }
): Promise<{ id: string; orderNumber: number }> {
  if (!(input.quantity > 0)) throw new Error("quantity_required")
  const existing = await getDocs(
    query(collection(firestore, WORK_ORDERS), where("organizationId", "==", input.organizationId))
  )
  const orderNumber = nextWorkOrderNumber(existing.docs.map((d) => d.data()))
  const p = input.product
  const title =
    input.source.kind === "project" && input.source.projectName
      ? `${p.name} — ${input.source.projectName}`
      : input.source.kind === "quotation" && input.source.contactName
        ? `${p.name} — ${input.source.contactName}`
        : p.name
  const ref = doc(collection(firestore, WORK_ORDERS))
  await setDoc(ref, {
    organizationId: input.organizationId,
    orderNumber,
    title,
    items: [{ name: p.name, quantity: input.quantity, unit: p.unit }],
    output: { name: p.name, quantity: input.quantity, unit: p.unit },
    source: {
      kind: input.source.kind === "quotation" ? "quotation" : "manual",
      quotationId: input.source.quotationId ?? null,
      quotationNumber: input.source.quotationNumber ?? null,
      contactId: input.source.contactId ?? null,
      contactName: input.source.contactName ?? null,
    },
    projectId: input.source.projectId ?? null,
    projectName: input.source.projectName ?? null,
    status: "open",
    currentStageIndex: 0,
    stages: stagesFromRoute(p),
    dueDate: input.neededBy,
    // --- v2 ---
    productId: p.id,
    productName: p.name,
    unit: p.unit,
    quantity: input.quantity,
    neededBy: input.neededBy,
    createdAtIso: nowIso(),
    releasedAt: null,
    releasedByName: null,
    riskReason: null,
    measurement: null,
    drawingApprovalStatus: p.requiresDrawingApproval ? "pending" : "na",
    drawingApprovedAt: null,
    drawingApprovedBy: null,
    slabApproval: null,
    rush: null,
    progress: emptyProgress(p.route),
    materials: [],
    scrapRecords: [],
    checklists: {},
    shortfall: 0,
    brokenResolved: 0,
    sourceQuotationWon: input.source.kind === "quotation" ? (input.source.quotationWon ?? null) : null,
    mfgRequestId: input.requestId ?? null,
    requestedByName: input.requestedBy ?? null,
    estimateId: input.estimateId ?? null,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  })
  return { id: ref.id, orderNumber }
}

// ---------------------------------------------------------------------------
// Blocking facts — each is a recorded event with a name and a date
// ---------------------------------------------------------------------------

export async function recordMeasurementV2(
  firestore: Firestore,
  input: { orderId: string; by: string; note?: string | null }
): Promise<void> {
  if (!input.by.trim()) throw new Error("by_required")
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, WORK_ORDERS, input.orderId), {
    measurement: { at: nowIso(), by: input.by.trim(), note: input.note ?? null },
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

export async function recordDrawingApprovalV2(
  firestore: Firestore,
  input: { orderId: string; approved: boolean; by: string }
): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(
    doc(firestore, WORK_ORDERS, input.orderId),
    input.approved
      ? { drawingApprovalStatus: "approved", drawingApprovedAt: nowIso(), drawingApprovedBy: input.by, updatedAt: serverTimestamp() }
      : { drawingApprovalStatus: "pending", updatedAt: serverTimestamp() }
  )
  await batch.commit()
}

export async function recordSlabApprovalV2(
  firestore: Firestore,
  input: { orderId: string; by: string; lot: string; note?: string | null }
): Promise<void> {
  if (!input.by.trim()) throw new Error("by_required")
  if (!input.lot.trim()) throw new Error("lot_required")
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, WORK_ORDERS, input.orderId), {
    slabApproval: { at: nowIso(), by: input.by.trim(), lot: input.lot.trim(), note: input.note ?? null },
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/** Release enters the queue. A blocked order releases only with a documented
 * risk reason (the cost controller's call) — logged in the releaser's name. */
export async function releaseWorkOrderV2(
  firestore: Firestore,
  input: { order: WorkOrderV2; product: MfgProduct; riskReason?: string | null; actor: Actor }
): Promise<void> {
  const blocks = releaseBlocks(toOrderSlice(input.order), input.product)
  if (blocks.length && !(input.riskReason || "").trim()) throw new Error("blocked")
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), {
    releasedAt: nowIso(),
    releasedByName: input.actor.name,
    riskReason: (input.riskReason || "").trim() || null,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/** Rushing has a price the rest of the queue pays — the reason travels with it. */
export async function rushWorkOrderV2(
  firestore: Firestore,
  input: { orderId: string; reason: string; actor: Actor }
): Promise<void> {
  if (!input.reason.trim()) throw new Error("reason_required")
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, WORK_ORDERS, input.orderId), {
    rush: { reason: input.reason.trim(), by: input.actor.name, at: nowIso() },
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

// ---------------------------------------------------------------------------
// The atomic event: a department reports output and hands over
// ---------------------------------------------------------------------------

export async function reportStageOutput(
  firestore: Firestore,
  input: {
    order: WorkOrderV2
    product: MfgProduct
    notes: MfgNoteSlice[]
    index: number
    done: number
    rejected: number
    hours: number
    actor: Actor
  }
): Promise<void> {
  const slice = toOrderSlice(input.order)
  const route = input.product.route
  const inHand = pendingAt(slice, route, input.index, input.notes)
  const done = Math.max(0, input.done || 0)
  const rejected = Math.max(0, input.rejected || 0)
  if (done + rejected <= 0) throw new Error("quantity_required")
  if (round2(done + rejected) > round2(inHand)) throw new Error("more_than_in_hand")

  const progress = slice.progress.map((p, i) =>
    i === input.index
      ? { ...p, done: round2(p.done + done), rejected: round2(p.rejected + rejected), hours: round2(p.hours + Math.max(0, input.hours || 0)) }
      : p
  )
  const after: MfgOrderSlice = { ...slice, progress }
  const stages = (input.order.stages || []).map((s, i) => {
    if (i !== input.index) return s
    const finished = remainAt(after, i) <= 0
    return {
      ...s,
      status: finished ? ("done" as const) : ("in_progress" as const),
      startedAt: s.startedAt || nowIso(),
      completedAt: finished ? nowIso() : null,
    }
  })
  const orderDone = isDoneV2(after, route, input.notes)
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), {
    progress,
    stages,
    currentStageIndex: Math.min(input.index + (remainAt(after, input.index) <= 0 ? 1 : 0), route.length - 1),
    status: orderDone ? "done" : "open",
    completedAt: orderDone ? nowIso() : (input.order.completedAt ?? null),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

// ---------------------------------------------------------------------------
// Materials — request → release (stock leaves) → receipt (cost lands)
// ---------------------------------------------------------------------------

export async function requestStageMaterials(
  firestore: Firestore,
  input: {
    order: WorkOrderV2
    departmentId: string
    warehouseId: string | null
    lines: Array<{ itemName: string; unit: string; quantity: number; lot?: string | null }>
    actor: Actor
  }
): Promise<string> {
  const lines = input.lines.filter((l) => l.quantity > 0)
  if (!lines.length) throw new Error("quantity_required")
  const requestNumber = generateWithdrawalNumber()
  const at = nowIso()
  const rows: WorkOrderMaterial[] = lines.map((l, i) => ({
    id: `${requestNumber}_${i}`,
    requestNumber,
    itemName: l.itemName,
    unit: l.unit,
    quantity: round2(l.quantity),
    departmentId: input.departmentId,
    lot: l.lot ?? null,
    state: "requested",
    unitCost: null,
    warehouseId: input.warehouseId,
    requestedByUserId: input.actor.id,
    requestedByName: input.actor.name,
    requestedAt: at,
    releasedByName: null,
    releasedAt: null,
    receivedByName: null,
    receivedAt: null,
  }))
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), {
    materials: [...(input.order.materials || []), ...rows],
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return requestNumber
}

/** The storekeeper releases: stock leaves the shelf NOW, in the same batch,
 * with each line's cost snapshotted from the shelf it left. */
export async function releaseStageMaterials(
  firestore: Firestore,
  input: {
    order: WorkOrderV2
    requestNumber: string
    warehouseId: string
    stockRows: Array<{ id: string; name: string; quantity: number; unitCost?: number | null }>
    actor: Actor
  }
): Promise<void> {
  const at = nowIso()
  const rows = input.order.materials || []
  const target = rows.filter((m) => m.requestNumber === input.requestNumber && m.state === "requested")
  if (!target.length) throw new Error("nothing_to_release")
  for (const m of target) {
    const row = input.stockRows.find((r) => r.name.trim().toLowerCase() === m.itemName.trim().toLowerCase())
    if (!row || row.quantity < m.quantity) throw new Error("insufficient_stock")
  }
  const materials = rows.map((m) => {
    if (m.requestNumber !== input.requestNumber || m.state !== "requested") return m
    const row = input.stockRows.find((r) => r.name.trim().toLowerCase() === m.itemName.trim().toLowerCase())
    return {
      ...m,
      state: "released" as const,
      unitCost: row?.unitCost ?? null,
      warehouseId: input.warehouseId,
      releasedByName: input.actor.name,
      releasedAt: at,
    }
  })
  const batch = writeBatch(firestore)
  for (const m of target) {
    const row = input.stockRows.find((r) => r.name.trim().toLowerCase() === m.itemName.trim().toLowerCase())
    if (row) {
      batch.update(doc(firestore, "warehouses", input.warehouseId, "inventoryItems", row.id), {
        quantity: increment(-m.quantity),
        updatedAt: serverTimestamp(),
      })
    }
  }
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), { materials, updatedAt: serverTimestamp() })
  await batch.commit()
}

/** The station confirms receipt — HERE the value lands on the order and the
 * ledger moves it from raw materials into work in progress. */
export async function confirmStageMaterials(
  firestore: Firestore,
  input: { order: WorkOrderV2; requestNumber: string; actor: Actor; organizationId: string }
): Promise<void> {
  const at = nowIso()
  const rows = input.order.materials || []
  const target = rows.filter((m) => m.requestNumber === input.requestNumber && m.state === "released")
  if (!target.length) throw new Error("nothing_to_confirm")
  const materials = rows.map((m) =>
    m.requestNumber === input.requestNumber && m.state === "released"
      ? { ...m, state: "received" as const, receivedByName: input.actor.name, receivedAt: at }
      : m
  )
  const materialCost = materialCostOf({ materials }).cost
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), {
    materials,
    materialCost,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  const value = round2(target.reduce((a, m) => a + (m.unitCost == null ? 0 : m.quantity * m.unitCost), 0))
  onMfgMaterialsReceived(
    firestore,
    { organizationId: input.organizationId, userId: input.actor.id, userName: input.actor.name },
    {
      workOrderId: input.order.id,
      orderNumber: input.order.orderNumber,
      requestNumber: input.requestNumber,
      value,
      projectId: (input.order as { projectId?: string | null }).projectId ?? null,
      projectName: (input.order as { projectName?: string | null }).projectName ?? null,
    }
  )
}

// ---------------------------------------------------------------------------
// QC — a reject either returns for rework or is written off at its sunk value
// ---------------------------------------------------------------------------

export async function qcDecision(
  firestore: Firestore,
  input: {
    order: WorkOrderV2
    product: MfgProduct
    departments: DeptCapacityFields[]
    settings: MfgSettings
    index: number
    kind: "rework" | "scrap"
    quantity: number
    /** Rework only: the earlier step it returns to. */
    toIndex?: number
    reason: string
    /** True when the actor may approve any scrap value (cost controller). */
    canApproveAny: boolean
    actor: Actor
    organizationId: string
  }
): Promise<{ scrapStatus?: "pending" | "approved" }> {
  if (!input.reason.trim()) throw new Error("reason_required")
  const slice = toOrderSlice(input.order)
  const p = slice.progress[input.index]
  if (!p || input.quantity <= 0 || input.quantity > p.rejected) throw new Error("more_than_rejected")

  const progress = slice.progress.map((x, i) =>
    i === input.index ? { ...x, rejected: round2(x.rejected - input.quantity) } : x
  )
  const batch = writeBatch(firestore)

  if (input.kind === "rework") {
    const to = input.toIndex ?? Math.max(0, input.index - 1)
    if (to > input.index) throw new Error("rework_forward")
    progress[to] = { ...progress[to], rework: round2(progress[to].rework + input.quantity) }
    batch.update(doc(firestore, WORK_ORDERS, input.order.id), { progress, updatedAt: serverTimestamp() })
    await batch.commit()
    return {}
  }

  const unitValue = unitSunkCost(input.product, input.departments, input.settings, input.index)
  const value = round2(unitValue * input.quantity)
  const withinLimit = value <= input.settings.scrapApprovalLimit
  const status: "pending" | "approved" = input.canApproveAny || withinLimit ? "approved" : "pending"
  const scrap: WorkOrderScrap = {
    id: generateScrapId(),
    quantity: input.quantity,
    value,
    reason: input.reason.trim(),
    departmentId: input.product.route[input.index]?.departmentId || "",
    raisedByUserId: input.actor.id,
    raisedByName: input.actor.name,
    raisedAt: nowIso(),
    status,
    approvedByName: status === "approved" ? input.actor.name : null,
    approvedAt: status === "approved" ? nowIso() : null,
  }
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), {
    progress,
    scrapRecords: [...(input.order.scrapRecords || []), scrap],
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  if (status === "approved") {
    onMfgScrapApproved(
      firestore,
      { organizationId: input.organizationId, userId: input.actor.id, userName: input.actor.name },
      {
        workOrderId: input.order.id,
        orderNumber: input.order.orderNumber,
        scrapId: scrap.id,
        value,
        reason: scrap.reason,
        projectId: (input.order as { projectId?: string | null }).projectId ?? null,
        projectName: (input.order as { projectName?: string | null }).projectName ?? null,
      }
    )
  }
  return { scrapStatus: status }
}

export async function approveScrapV2(
  firestore: Firestore,
  input: { order: WorkOrderV2; scrapId: string; actor: Actor; organizationId: string }
): Promise<void> {
  const rows = input.order.scrapRecords || []
  const target = rows.find((s) => s.id === input.scrapId && s.status === "pending")
  if (!target) throw new Error("nothing_pending")
  const scrapRecords = rows.map((s) =>
    s.id === input.scrapId ? { ...s, status: "approved" as const, approvedByName: input.actor.name, approvedAt: nowIso() } : s
  )
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), { scrapRecords, updatedAt: serverTimestamp() })
  await batch.commit()
  onMfgScrapApproved(
    firestore,
    { organizationId: input.organizationId, userId: input.actor.id, userName: input.actor.name },
    {
      workOrderId: input.order.id,
      orderNumber: input.order.orderNumber,
      scrapId: target.id,
      value: target.value,
      reason: target.reason,
      projectId: (input.order as { projectId?: string | null }).projectId ?? null,
      projectName: (input.order as { projectName?: string | null }).projectName ?? null,
    }
  )
}

// ---------------------------------------------------------------------------
// Delivery notes — goods leave the workshop; cost moves only at receipt
// ---------------------------------------------------------------------------

export async function issueWorkOrderNoteV2(
  firestore: Firestore,
  input: {
    order: WorkOrderV2
    product: MfgProduct
    departments: DeptCapacityFields[]
    settings: MfgSettings
    allNotes: MfgNoteSlice[]
    quantity: number
    destination: { warehouseId: string; warehouseName: string; kind: "project" | "central" | "outbound"; projectId?: string | null }
    pieces?: number | null
    crates?: number | null
    driverName: string
    vehiclePlate?: string | null
    note?: string | null
    expectedReceiver?: { id: string; name: string } | null
    actor: Actor
  }
): Promise<{ noteId: string; autoReceived: boolean }> {
  if (!input.driverName.trim()) throw new Error("driver_required")
  const slice = toOrderSlice(input.order)
  const route = input.product.route
  const ready = Math.max(
    0,
    round2((slice.progress[routeExit(route)]?.done || 0) - input.allNotes.filter((n) => n.status !== "rejected").reduce((a, n) => a + n.quantity, 0))
  )
  if (!(input.quantity > 0) || round2(input.quantity) > ready) throw new Error("more_than_ready")

  const totalCost = orderCost(slice, route, input.departments, input.settings)
  const unitCost = slice.quantity > 0 ? round2(totalCost / slice.quantity) : null
  const sentAt = nowIso()
  const autoReceived = input.destination.kind === "outbound"
  const noteRef = doc(collection(firestore, DELIVERY_NOTES))
  const noteDoc = {
    organizationId: input.order.organizationId,
    noteNumber: generateDeliveryNoteNumber(),
    source: {
      kind: "manufacturing" as const,
      workOrderId: input.order.id,
      workOrderNumber: input.order.orderNumber,
      title: input.order.title,
    },
    item: { name: input.product.name, quantity: round2(input.quantity), unit: input.product.unit, unitCost },
    toWarehouseId: input.destination.warehouseId,
    toWarehouseName: input.destination.warehouseName,
    toKind: input.destination.kind,
    toProjectId: input.destination.projectId ?? null,
    status: autoReceived ? ("received" as const) : ("in_transit" as const),
    sentByUserId: input.actor.id,
    sentByUserName: input.actor.name,
    sentAt,
    expectedReceiverUserId: input.expectedReceiver?.id ?? null,
    expectedReceiverName: input.expectedReceiver?.name ?? null,
    receivedByUserId: autoReceived ? input.actor.id : null,
    receivedByUserName: autoReceived ? input.actor.name : null,
    receivedAt: autoReceived ? sentAt : null,
    receivedNote: input.note ?? null,
    rejectedReason: null,
    brokenQuantity: 0,
    pieces: input.pieces ?? null,
    crates: input.crates ?? null,
    driverName: input.driverName.trim(),
    vehiclePlate: input.vehiclePlate ?? null,
  }
  const batch = writeBatch(firestore)
  batch.set(noteRef, { ...noteDoc, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  if (autoReceived) {
    const itemRef = doc(collection(firestore, "warehouses", input.destination.warehouseId, "inventoryItems"))
    batch.set(itemRef, {
      organizationId: input.order.organizationId,
      warehouseId: input.destination.warehouseId,
      name: input.product.name,
      quantity: round2(input.quantity),
      unit: input.product.unit,
      unitCost,
      isManufactured: true,
      sourceWorkOrderId: input.order.id,
      sourceWorkOrderNumber: input.order.orderNumber,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), {
    deliveryNoteId: noteRef.id,
    deliveryNoteNumber: noteDoc.noteNumber,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  if (autoReceived) {
    onWorkOrderDelivered(
      firestore,
      { organizationId: input.order.organizationId, userId: input.actor.id, userName: input.actor.name },
      {
        workOrderId: input.order.id,
        orderNumber: input.order.orderNumber,
        deliveryNoteId: noteRef.id,
        value: round2((unitCost ?? 0) * input.quantity),
        warehouseName: input.destination.warehouseName,
        projectId: input.destination.projectId ?? null,
        toProject: input.destination.kind === "project",
      }
    )
  }
  return { noteId: noteRef.id, autoReceived }
}

function routeExit(route: MfgProduct["route"]): number {
  let x = 0
  route.forEach((r, i) => {
    if (!r.onSite) x = i
  })
  return x
}

/** Receipt is the event: the net quantity lands and its cost moves; what broke
 * in transit is recorded on the note and waits for its own decision. */
export async function confirmWorkOrderNoteV2(
  firestore: Firestore,
  input: {
    note: DeliveryNote
    order: WorkOrderV2
    product: MfgProduct
    allNotes: Array<MfgNoteSlice & { id: string }>
    brokenQuantity: number
    receivedNote?: string | null
    actor: Actor
  }
): Promise<void> {
  if (input.note.status !== "in_transit") throw new Error("not_in_transit")
  const broken = Math.max(0, round2(input.brokenQuantity || 0))
  if (broken > input.note.item.quantity) throw new Error("more_than_shipped")
  const net = round2(input.note.item.quantity - broken)
  const receivedAt = nowIso()

  const batch = writeBatch(firestore)
  batch.update(doc(firestore, DELIVERY_NOTES, input.note.id), {
    status: "received",
    brokenQuantity: broken,
    receivedByUserId: input.actor.id,
    receivedByUserName: input.actor.name,
    receivedAt,
    receivedNote: input.receivedNote ?? null,
    updatedAt: serverTimestamp(),
  })
  if (net > 0) {
    const itemRef = doc(collection(firestore, "warehouses", input.note.toWarehouseId, "inventoryItems"))
    batch.set(itemRef, {
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
  const notesAfter = input.allNotes.map((n) =>
    n.id === input.note.id ? { ...n, status: "received" as const, brokenQuantity: broken } : n
  )
  const done = isDoneV2(toOrderSlice(input.order), input.product.route, notesAfter)
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), {
    receivedAt,
    receivedByUserId: input.actor.id,
    receivedByUserName: input.actor.name,
    status: done ? "done" : "open",
    completedAt: done ? receivedAt : (input.order.completedAt ?? null),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
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

/** Broken in transit is neither cancelled nor forgotten: a replacement re-enters
 * the first department, or the order closes short with the owner's consent. */
export async function decideBreakage(
  firestore: Firestore,
  input: {
    order: WorkOrderV2
    product: MfgProduct
    allNotes: MfgNoteSlice[]
    kind: "remake" | "shortfall"
    quantity: number
    reason: string
    actor: Actor
  }
): Promise<void> {
  if (!input.reason.trim()) throw new Error("reason_required")
  if (!(input.quantity > 0)) throw new Error("quantity_required")
  const progress = [...(input.order.progress || [])]
  const prior = ((input.order as unknown as { breakageDecisions?: unknown[] }).breakageDecisions || [])
  const base = {
    brokenResolved: round2((input.order.brokenResolved || 0) + input.quantity),
    breakageDecisions: [
      ...prior,
      { kind: input.kind, quantity: input.quantity, reason: input.reason.trim(), by: input.actor.name, at: nowIso() },
    ],
    updatedAt: serverTimestamp(),
  }
  const batch = writeBatch(firestore)
  if (input.kind === "remake") {
    if (!progress.length) throw new Error("no_progress")
    progress[0] = { ...progress[0], rework: round2(progress[0].rework + input.quantity) }
    batch.update(doc(firestore, WORK_ORDERS, input.order.id), { ...base, progress, status: "open" })
  } else {
    // Declaring the last broken unit short may be the order's final open fact.
    const shortfall = round2((input.order.shortfall || 0) + input.quantity)
    const after: MfgOrderSlice = {
      ...toOrderSlice(input.order),
      shortfall,
      brokenResolved: round2((input.order.brokenResolved || 0) + input.quantity),
    }
    const done = isDoneV2(after, input.product.route, input.allNotes)
    batch.update(doc(firestore, WORK_ORDERS, input.order.id), {
      ...base,
      shortfall,
      status: done ? "done" : input.order.status,
      completedAt: done ? nowIso() : (input.order.completedAt ?? null),
    })
  }
  await batch.commit()
}

// ---------------------------------------------------------------------------
// Checklists — signed and timed, never blocking
// ---------------------------------------------------------------------------

export async function toggleChecklistItem(
  firestore: Firestore,
  input: { order: WorkOrderV2; departmentId: string; itemKey: string; actor: Actor }
): Promise<void> {
  const checklists = { ...(input.order.checklists || {}) }
  const dept = { ...(checklists[input.departmentId] || {}) }
  if (dept[input.itemKey]) delete dept[input.itemKey]
  else dept[input.itemKey] = { by: input.actor.name, at: nowIso() }
  checklists[input.departmentId] = dept
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, WORK_ORDERS, input.order.id), { checklists, updatedAt: serverTimestamp() })
  await batch.commit()
}

// ---------------------------------------------------------------------------
// Manufacturing requests v2 — projects and procurement ask too
// ---------------------------------------------------------------------------

export async function createMfgRequestV2(
  firestore: Firestore,
  input: {
    organizationId: string
    sourceKind: "project" | "procurement"
    projectId?: string | null
    projectName?: string | null
    neededBy: string | null
    lines: MfgRequestLine[]
    note?: string | null
    actor: Actor
  }
): Promise<string> {
  const lines = input.lines.filter((l) => l.quantity > 0)
  if (!lines.length) throw new Error("lines_required")
  const ref = doc(collection(firestore, MANUFACTURING_REQUESTS))
  await setDoc(ref, {
    organizationId: input.organizationId,
    requestNumber: generateMfgRequestNumber(),
    orderId: null,
    orderNumber: null,
    contactName: null,
    itemName: lines[0].itemName,
    unit: lines[0].unit,
    quantity: lines[0].quantity,
    status: "new",
    sourceKind: input.sourceKind,
    projectId: input.projectId ?? null,
    projectName: input.projectName ?? null,
    neededBy: input.neededBy,
    lines,
    note: input.note ?? null,
    answerRoute: null,
    answerNote: null,
    estimateId: null,
    workOrderIds: [],
    workOrderId: null,
    workOrderNumber: null,
    rejectionReason: null,
    decidedAt: null,
    decidedByUserId: null,
    decidedByUserName: null,
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    requestedAt: nowIso(),
  })
  return ref.id
}

/** The workshop's answer routes the request — to work orders, to a cost
 * estimate, or back to procurement — and never closes it silently. */
export async function answerMfgRequestV2(
  firestore: Firestore,
  input: {
    request: ManufacturingRequest
    route: "make" | "estimate" | "buy"
    /** For "make": how much of each line the workshop takes on. */
    makeLines?: Array<{ line: MfgRequestLine; makeQuantity: number; product: MfgProduct | null }>
    /** For "estimate": the products to cost. */
    estimateLines?: Array<{ product: MfgProduct; quantity: number }>
    departments: DeptCapacityFields[]
    settings: MfgSettings
    note?: string | null
    contactId?: string | null
    actor: Actor
  }
): Promise<{ workOrderIds: string[]; estimateId: string | null }> {
  const r = input.request
  const decided = {
    decidedAt: nowIso(),
    decidedByUserId: input.actor.id,
    decidedByUserName: input.actor.name,
    answerNote: input.note ?? null,
    updatedAt: serverTimestamp(),
  }

  if (input.route === "buy") {
    if (!(input.note || "").trim()) throw new Error("reason_required")
    const batch = writeBatch(firestore)
    batch.update(doc(firestore, MANUFACTURING_REQUESTS, r.id), {
      ...decided,
      status: "rejected",
      answerRoute: "buy",
      rejectionReason: input.note?.trim(),
    })
    await batch.commit()
    return { workOrderIds: [], estimateId: null }
  }

  if (input.route === "estimate") {
    const lines = input.estimateLines || []
    if (!lines.length) throw new Error("lines_required")
    const estimateRef = doc(collection(firestore, MFG_COST_ESTIMATES))
    await setDoc(estimateRef, {
      organizationId: r.organizationId,
      estimateNumber: generateEstimateNumber(),
      requestId: r.id,
      contactId: input.contactId ?? null,
      contactName: r.contactName ?? null,
      requestedBy: r.createdByUserName,
      neededBy: r.neededBy ?? null,
      validityDays: 15,
      note: input.note ?? null,
      lines: buildEstimateLines(lines, input.departments, input.settings),
      state: "draft",
      sentAt: null,
      sentByName: null,
      quoteNumber: null,
      quotedPrice: null,
      quotedByName: null,
      quotedAt: null,
      financeApprovalBy: null,
      wonAt: null,
      wonConfirmedBy: null,
      workOrderIds: [],
      createdByUserId: input.actor.id,
      createdByUserName: input.actor.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    const batch = writeBatch(firestore)
    batch.update(doc(firestore, MANUFACTURING_REQUESTS, r.id), {
      ...decided,
      status: "estimated",
      answerRoute: "estimate",
      estimateId: estimateRef.id,
    })
    await batch.commit()
    return { workOrderIds: [], estimateId: estimateRef.id }
  }

  // make — a work order per line the workshop takes on
  const makeLines = (input.makeLines || []).filter((l) => l.makeQuantity > 0)
  if (!makeLines.length) throw new Error("lines_required")
  const workOrderIds: string[] = []
  let firstNumber: number | null = null
  for (const l of makeLines) {
    if (!l.product) throw new Error("product_required")
    const created = await createWorkOrderFromProduct(firestore, {
      organizationId: r.organizationId,
      product: l.product,
      quantity: Math.min(l.makeQuantity, l.line.quantity),
      neededBy: r.neededBy ?? null,
      source: r.projectId
        ? { kind: "project", projectId: r.projectId, projectName: r.projectName ?? null }
        : { kind: "stock" },
      requestId: r.id,
      requestedBy: r.createdByUserName,
      actor: input.actor,
    })
    workOrderIds.push(created.id)
    if (firstNumber == null) firstNumber = created.orderNumber
  }
  const allTaken = (input.makeLines || []).every((l) => l.makeQuantity >= l.line.quantity)
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, MANUFACTURING_REQUESTS, r.id), {
    ...decided,
    status: allTaken ? "accepted" : "partial",
    answerRoute: "make",
    workOrderIds,
    workOrderId: workOrderIds[0] ?? null,
    workOrderNumber: firstNumber,
    lines: (r.lines || []).map((line) => {
      const m = (input.makeLines || []).find((x) => x.line.itemName === line.itemName && x.line.quantity === line.quantity)
      return m ? { ...line, makeQuantity: m.makeQuantity } : line
    }),
  })
  await batch.commit()
  return { workOrderIds, estimateId: null }
}

// ---------------------------------------------------------------------------
// Cost estimates — the workshop owns cost and lead time, never the price
// ---------------------------------------------------------------------------

export async function createCostEstimate(
  firestore: Firestore,
  input: {
    organizationId: string
    contactId?: string | null
    contactName?: string | null
    requestedBy?: string | null
    neededBy: string | null
    lines: Array<{ product: MfgProduct; quantity: number }>
    note?: string | null
    departments: DeptCapacityFields[]
    settings: MfgSettings
    actor: Actor
  }
): Promise<string> {
  if (!input.lines.length) throw new Error("lines_required")
  const ref = doc(collection(firestore, MFG_COST_ESTIMATES))
  await setDoc(ref, {
    organizationId: input.organizationId,
    estimateNumber: generateEstimateNumber(),
    requestId: null,
    contactId: input.contactId ?? null,
    contactName: input.contactName ?? null,
    requestedBy: input.requestedBy ?? null,
    neededBy: input.neededBy,
    validityDays: 15,
    note: input.note ?? null,
    lines: buildEstimateLines(input.lines, input.departments, input.settings),
    state: "draft",
    sentAt: null,
    sentByName: null,
    quoteNumber: null,
    quotedPrice: null,
    quotedByName: null,
    quotedAt: null,
    financeApprovalBy: null,
    wonAt: null,
    wonConfirmedBy: null,
    workOrderIds: [],
    createdByUserId: input.actor.id,
    createdByUserName: input.actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function sendCostEstimate(
  firestore: Firestore,
  input: { estimateId: string; validityDays: number; note?: string | null; actor: Actor }
): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, MFG_COST_ESTIMATES, input.estimateId), {
    state: "sent",
    sentAt: nowIso(),
    sentByName: input.actor.name,
    validityDays: input.validityDays || 15,
    note: input.note ?? null,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/** The price is sales' decision — we record it to know our margin. Below the
 * finance floor it only records with a NAMED finance approval. */
export async function logEstimateQuote(
  firestore: Firestore,
  input: {
    estimate: MfgCostEstimate
    quoteNumber: string
    quotedPrice: number
    quotedByName: string
    financeApprovalBy?: string | null
    settings: MfgSettings
  }
): Promise<void> {
  if (!input.quoteNumber.trim()) throw new Error("quote_required")
  if (!(input.quotedPrice > 0)) throw new Error("price_required")
  const floor = minPriceFor(estimateCost(input.estimate), input.settings)
  if (input.quotedPrice < floor && !(input.financeApprovalBy || "").trim()) throw new Error("below_floor")
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, MFG_COST_ESTIMATES, input.estimate.id), {
    state: "quoted",
    quoteNumber: input.quoteNumber.trim(),
    quotedPrice: input.quotedPrice,
    quotedByName: input.quotedByName,
    quotedAt: nowIso(),
    financeApprovalBy: (input.financeApprovalBy || "").trim() || null,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/** The award happens in CRM; here it becomes work — one order per line. */
export async function markEstimateWon(
  firestore: Firestore,
  input: {
    estimate: MfgCostEstimate
    confirmedBy: string
    products: MfgProduct[]
    actor: Actor
  }
): Promise<string[]> {
  if (!input.confirmedBy.trim()) throw new Error("by_required")
  const workOrderIds: string[] = []
  for (const line of input.estimate.lines) {
    const product = input.products.find((p) => p.id === line.productId)
    if (!product) throw new Error("product_missing")
    const created = await createWorkOrderFromProduct(firestore, {
      organizationId: input.estimate.organizationId,
      product,
      quantity: line.quantity,
      neededBy: input.estimate.neededBy ?? null,
      source: {
        kind: "quotation",
        quotationNumber: input.estimate.quoteNumber ?? null,
        quotationWon: true,
        contactId: input.estimate.contactId ?? null,
        contactName: input.estimate.contactName ?? null,
      },
      estimateId: input.estimate.id,
      requestedBy: input.estimate.requestedBy ?? null,
      actor: input.actor,
    })
    workOrderIds.push(created.id)
  }
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, MFG_COST_ESTIMATES, input.estimate.id), {
    state: "won",
    wonAt: nowIso(),
    wonConfirmedBy: input.confirmedBy.trim(),
    workOrderIds,
    updatedAt: serverTimestamp(),
  })
  if (input.estimate.requestId) {
    batch.update(doc(firestore, MANUFACTURING_REQUESTS, input.estimate.requestId), {
      status: "accepted",
      workOrderIds,
      updatedAt: serverTimestamp(),
    })
  }
  await batch.commit()
  return workOrderIds
}

export async function markEstimateLost(firestore: Firestore, estimateId: string): Promise<void> {
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, MFG_COST_ESTIMATES, estimateId), { state: "lost", updatedAt: serverTimestamp() })
  await batch.commit()
}

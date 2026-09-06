// Manufacturing (تصنيع) domain — work orders that travel through the org's
// ordered department chain, each stage assigned to a member and handed to the
// next (كل قسم يسلّم للتالي). Shared by both portals. Orders are born from an
// accepted CRM quotation (when the goods aren't already in stock) or manually.

import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  query,
  where,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore"

export const MFG_DEPARTMENTS = "manufacturingDepartments"
export const WORK_ORDERS = "workOrders"

export interface MfgDepartment {
  id: string
  organizationId: string
  name: string
  order: number
}

export type StageStatus = "pending" | "in_progress" | "done"
export type WorkOrderStatus = "open" | "done" | "cancelled"

export interface WorkOrderStage {
  departmentId: string
  departmentName: string
  assigneeUserId: string | null
  assigneeName: string | null
  status: StageStatus
  startedAt: string | null
  completedAt: string | null
  note: string | null
}

export interface WorkOrderItem {
  name: string
  quantity: number
  unit: string
  /** True when the acceptance-time stock check found it already available. */
  inStock?: boolean
  /** When stock covered only part of a request: what was asked for, and how
   * much the warehouses already held. `quantity` is then the split's share. */
  requestedQuantity?: number
  coveredByStock?: number
}

/** A raw material drawn from a warehouse into the order — deducted from
 * stock at creation, its cost snapshotted so the finished item can carry it. */
export interface WorkOrderInputItem {
  inventoryItemId: string
  name: string
  quantity: number
  unit: string
  unitCost: number | null
}

export interface WorkOrderOutput {
  name: string
  quantity: number
  unit: string
}

export interface WorkOrderDelivery {
  warehouseId: string
  warehouseName: string
  kind: "project" | "central" | "outbound"
}

export interface WorkOrder {
  id: string
  organizationId: string
  orderNumber: number
  title: string
  items: WorkOrderItem[]
  /** Raw materials consumed from stock. Older/quotation-born orders have none. */
  inputs?: WorkOrderInputItem[]
  sourceWarehouseId?: string | null
  sourceWarehouseName?: string | null
  /** Sum of input quantity × cost — the inventory value now inside the order.
   * It converts to a finished item's unitCost at delivery, never to expense. */
  materialCost?: number | null
  output?: WorkOrderOutput | null
  projectId?: string | null
  projectName?: string | null
  deliveredTo?: WorkOrderDelivery | null
  deliveredAt?: string | null
  /** The delivery note the handover wrote (see delivery-notes.ts). The
   * receipt fields fill when the receiving warehouse signs; orders delivered
   * before notes existed have `deliveredTo` and none of these. */
  deliveryNoteId?: string | null
  deliveryNoteNumber?: string | null
  receivedAt?: string | null
  receivedByUserId?: string | null
  receivedByUserName?: string | null
  source: {
    kind: "quotation" | "manual"
    quotationId?: string | null
    quotationNumber?: string | null
    contactId?: string | null
    contactName?: string | null
    opportunityId?: string | null
  }
  status: WorkOrderStatus
  currentStageIndex: number
  stages: WorkOrderStage[]
  dueDate?: string | null
  createdByUserId: string
  createdByUserName: string
  createdAt?: unknown
  updatedAt?: unknown
  completedAt?: string | null
}

export function buildStagesFromDepartments(departments: MfgDepartment[]): WorkOrderStage[] {
  return [...departments]
    .sort((a, b) => a.order - b.order)
    .map((d, i) => ({
      departmentId: d.id,
      departmentName: d.name,
      assigneeUserId: null,
      assigneeName: null,
      status: i === 0 ? "in_progress" : "pending",
      startedAt: i === 0 ? new Date().toISOString() : null,
      completedAt: null,
      note: null,
    }))
}

export function nextWorkOrderNumber(orders: Array<{ orderNumber?: number }>): number {
  return orders.reduce((max, o) => Math.max(max, Number(o.orderNumber) || 0), 0) + 1
}

/**
 * Hand the current stage to the next department. Returns the new stage array,
 * the new current index, and whether the whole order is now complete.
 */
export function advanceStages(
  stages: WorkOrderStage[],
  currentIndex: number
): { stages: WorkOrderStage[]; currentStageIndex: number; completed: boolean } {
  const now = new Date().toISOString()
  const next = stages.map((s, i) =>
    i === currentIndex
      ? { ...s, status: "done" as const, completedAt: now }
      : i === currentIndex + 1
        ? { ...s, status: "in_progress" as const, startedAt: now }
        : s
  )
  const completed = currentIndex + 1 >= stages.length
  return { stages: next, currentStageIndex: completed ? currentIndex : currentIndex + 1, completed }
}

export function computeMaterialCost(inputs: WorkOrderInputItem[]): { cost: number; allPriced: boolean } {
  let cost = 0
  let allPriced = true
  for (const i of inputs) {
    if (i.unitCost == null) allPriced = false
    else cost += i.quantity * i.unitCost
  }
  return { cost: Math.round(cost * 100) / 100, allPriced }
}

/** Rows whose requested draw exceeds what the source warehouse holds. */
export function overdrawnInputs(
  inputs: WorkOrderInputItem[],
  stock: Array<{ id: string; quantity: number }>
): WorkOrderInputItem[] {
  const byId = new Map(stock.map((s) => [s.id, Number(s.quantity) || 0]))
  return inputs.filter((i) => i.quantity > (byId.get(i.inventoryItemId) ?? 0))
}

/** What a finished order delivers — explicit output, else the first requested
 * item (quotation-born orders), else one unit named after the order. */
export function effectiveOutput(order: Pick<WorkOrder, "output" | "items" | "title">): WorkOrderOutput {
  if (order.output?.name) return order.output
  const first = order.items?.[0]
  if (first?.name) return { name: first.name, quantity: first.quantity || 1, unit: first.unit || "" }
  return { name: order.title, quantity: 1, unit: "" }
}

/** The org's virtual distribution warehouse — finished goods awaiting a
 * destination live here. Created on first use, reused after. */
export async function ensureOutboundWarehouse(
  firestore: Firestore,
  organizationId: string
): Promise<{ id: string; name: string }> {
  const snap = await getDocs(
    query(collection(firestore, "warehouses"), where("organizationId", "==", organizationId), where("isOutbound", "==", true))
  )
  if (!snap.empty) return { id: snap.docs[0].id, name: snap.docs[0].data().name as string }
  const ref = await addDoc(collection(firestore, "warehouses"), {
    organizationId,
    name: "مستودع التوزيع (افتراضي)",
    location: null,
    description: "مستودع افتراضي للمنتجات المصنّعة بانتظار التسليم",
    isOutbound: true,
    virtual: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id: ref.id, name: "مستودع التوزيع (افتراضي)" }
}

/**
 * Name-matched stock check: which requested items the org's inventory already
 * covers. Only the SHORTFALL goes to manufacturing — a request for 200 with
 * 120 on the shelf manufactures 80 and draws 120 from stock.
 */
export function splitByStock(
  items: WorkOrderItem[],
  inventory: Array<{ name: string; quantity: number }>
): { toManufacture: WorkOrderItem[]; inStock: WorkOrderItem[] } {
  const stockByName = new Map<string, number>()
  for (const i of inventory) {
    const key = i.name.trim().toLowerCase()
    stockByName.set(key, (stockByName.get(key) || 0) + (Number(i.quantity) || 0))
  }
  const toManufacture: WorkOrderItem[] = []
  const inStock: WorkOrderItem[] = []
  for (const item of items) {
    const available = stockByName.get(item.name.trim().toLowerCase()) || 0
    if (item.quantity <= 0) {
      toManufacture.push(item)
    } else if (available >= item.quantity) {
      inStock.push({ ...item, inStock: true })
    } else if (available > 0) {
      inStock.push({ ...item, quantity: available, inStock: true, requestedQuantity: item.quantity, coveredByStock: available })
      toManufacture.push({ ...item, quantity: item.quantity - available, requestedQuantity: item.quantity, coveredByStock: available })
    } else {
      toManufacture.push(item)
    }
  }
  return { toManufacture, inStock }
}

// Handing a finished order to a warehouse lives in delivery-notes.ts: the
// output travels on a delivery note and lands — with the order's material
// cost as its unitCost — only when the receiving warehouse signs for it.

/**
 * Auto-create a work order when a quotation is accepted. Skips quietly when
 * the org has no department chain configured (nothing to route through), and
 * when every requested item is already in stock. Returns the new order id, or
 * null when nothing was created.
 */
export async function createWorkOrderFromQuotation(
  firestore: Firestore,
  input: {
    organizationId: string
    quotationId: string
    quotationNumber: string
    amount: number
    contactId: string
    contactName?: string | null
    opportunityId?: string | null
    items?: WorkOrderItem[]
    userId: string
    userName: string
  }
): Promise<string | null> {
  const deptSnap = await getDocs(
    query(collection(firestore, MFG_DEPARTMENTS), where("organizationId", "==", input.organizationId))
  )
  const departments = deptSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as MfgDepartment)
  if (departments.length === 0) return null

  let items = input.items || []
  if (items.length > 0) {
    // Only goods NOT already sitting in a warehouse get manufactured.
    const whSnap = await getDocs(
      query(collection(firestore, "warehouses"), where("organizationId", "==", input.organizationId))
    )
    const inventory: Array<{ name: string; quantity: number }> = []
    for (const wh of whSnap.docs) {
      const inv = await getDocs(collection(firestore, "warehouses", wh.id, "inventoryItems"))
      inv.forEach((i) => inventory.push({ name: (i.data().name as string) || "", quantity: Number(i.data().quantity) || 0 }))
    }
    const { toManufacture } = splitByStock(items, inventory)
    if (toManufacture.length === 0) return null
    items = toManufacture
  }

  const existingSnap = await getDocs(
    query(collection(firestore, WORK_ORDERS), where("organizationId", "==", input.organizationId))
  )
  const orderNumber = nextWorkOrderNumber(existingSnap.docs.map((d) => d.data()))

  const ref = await addDoc(collection(firestore, WORK_ORDERS), {
    organizationId: input.organizationId,
    orderNumber,
    title: input.contactName
      ? `${input.contactName} — ${input.quotationNumber}`
      : input.quotationNumber,
    items,
    source: {
      kind: "quotation",
      quotationId: input.quotationId,
      quotationNumber: input.quotationNumber,
      contactId: input.contactId,
      contactName: input.contactName ?? null,
      opportunityId: input.opportunityId ?? null,
    },
    quotationAmount: input.amount,
    status: "open",
    currentStageIndex: 0,
    stages: buildStagesFromDepartments(departments),
    dueDate: null,
    createdByUserId: input.userId,
    createdByUserName: input.userName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  })
  // Stamp the quotation so a later re-save while accepted can't spawn a twin.
  await updateDoc(doc(firestore, "crmQuotations", input.quotationId), { workOrderId: ref.id })
  return ref.id
}

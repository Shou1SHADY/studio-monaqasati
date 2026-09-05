import {
  Firestore,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore"
import { validateTransfer, itemMergeKey, type TransferItemState, type TransferValidationError } from "./warehouse-transfer"

// Nothing leaves a warehouse silently: a request is raised, someone with
// warehouses.manage on the source side releases it (stock leaves the source
// immediately — it's now "in transit"), and the receiver on the destination
// side confirms pickup before the destination is credited. Each step is its
// own transaction so the request doc's status is always the single source of
// truth for where the stock physically is.

export type WarehouseRequestStatus = "pending" | "released" | "received" | "cancelled"

export interface WarehouseRequestDoc {
  requestNumber: string
  organizationId: string
  itemId: string
  itemName: string
  unit: string
  /** Item-type section snapshot — so the stock lands in the same section at the destination. */
  typeId?: string | null
  /** The originally requested amount — never changed after creation, for audit. */
  quantity: number
  /** What actually left the source at release time — defaults to `quantity`,
   * but the releaser can adjust it down for a partial fulfillment. This is
   * what credits the destination on confirm, not the original `quantity`. */
  releasedQuantity?: number | null
  fromWarehouseId: string
  toWarehouseId: string
  toProjectId?: string | null
  toProjectName?: string | null
  status: WarehouseRequestStatus
  requestedByUserId: string
  requestedByName: string
  requestedAt: Timestamp
  /** Who's expected to receive and confirm this — named at request time for accountability. */
  expectedReceiverName: string
  releasedByUserId?: string | null
  releasedByName?: string | null
  releasedAt?: Timestamp | null
  receivedByUserId?: string | null
  receivedByName?: string | null
  receivedAt?: Timestamp | null
  receivedNote?: string | null
  cancelledReason?: string | null
}

function generateRequestNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I ambiguity
  let suffix = ""
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
  return `WR-${suffix}`
}

export { validateTransfer as validateRequest, itemMergeKey }
export type { TransferItemState, TransferValidationError }

export interface CreateRequestParams {
  firestore: Firestore
  /** The company's central warehouse — requests always live here (like the old
   * transfers log), regardless of which direction the stock is moving. */
  centralWarehouseId: string
  fromWarehouseId: string
  toWarehouseId: string
  itemId: string
  sourceItem: TransferItemState
  quantity: number
  organizationId: string
  byUserId: string
  byUserName: string
  expectedReceiverName: string
  toProjectId?: string | null
  toProjectName?: string | null
}

/** Raises a pending request. No stock moves yet. */
export async function createWarehouseRequest(params: CreateRequestParams): Promise<string> {
  const { firestore, centralWarehouseId, fromWarehouseId, toWarehouseId, itemId, sourceItem, quantity, organizationId, byUserId, byUserName, expectedReceiverName, toProjectId, toProjectName } = params

  const error = validateTransfer({ sourceItem, quantity, fromWarehouseId, toWarehouseId })
  if (error) throw new Error(error)

  const requestRef = doc(collection(firestore, "warehouses", centralWarehouseId, "requests"))
  await runTransaction(firestore, async (tx) => {
    const itemRef = doc(firestore, "warehouses", fromWarehouseId, "inventoryItems", itemId)
    const itemSnap = await tx.get(itemRef)
    if (!itemSnap.exists()) throw new Error("insufficient_stock")
    const item = itemSnap.data() as TransferItemState & { name: string; unit: string; typeId?: string | null }
    const revalidated = validateTransfer({ sourceItem: item, quantity, fromWarehouseId, toWarehouseId })
    if (revalidated) throw new Error(revalidated)

    tx.set(requestRef, {
      requestNumber: generateRequestNumber(),
      organizationId,
      itemId,
      itemName: item.name,
      unit: item.unit,
      typeId: item.typeId ?? null,
      quantity,
      fromWarehouseId,
      toWarehouseId,
      toProjectId: toProjectId ?? null,
      toProjectName: toProjectName ?? null,
      status: "pending",
      requestedByUserId: byUserId,
      requestedByName: byUserName,
      requestedAt: serverTimestamp(),
      expectedReceiverName,
      releasedByUserId: null,
      releasedByName: null,
      releasedAt: null,
      receivedByUserId: null,
      receivedByName: null,
      receivedAt: null,
      receivedNote: null,
    })
  })
  return requestRef.id
}

/** Releases a pending request — decrements the source now; destination is credited only on confirm.
 * `releasedQuantity` defaults to the originally requested amount but the releaser can lower it for
 * a partial fulfillment (e.g. the source doesn't actually have the full amount on the shelf). */
export async function releaseWarehouseRequest(params: {
  firestore: Firestore
  centralWarehouseId: string
  requestId: string
  byUserId: string
  byUserName: string
  releasedQuantity?: number
}): Promise<void> {
  const { firestore, centralWarehouseId, requestId, byUserId, byUserName, releasedQuantity } = params
  const requestRef = doc(firestore, "warehouses", centralWarehouseId, "requests", requestId)

  await runTransaction(firestore, async (tx) => {
    const reqSnap = await tx.get(requestRef)
    if (!reqSnap.exists()) throw new Error("not_found")
    const request = reqSnap.data() as WarehouseRequestDoc
    if (request.status !== "pending") throw new Error("not_pending")

    const finalQuantity = releasedQuantity ?? request.quantity
    if (!Number.isFinite(finalQuantity) || finalQuantity <= 0) throw new Error("invalid_quantity")
    if (finalQuantity > request.quantity) throw new Error("invalid_quantity")

    const sourceRef = doc(firestore, "warehouses", request.fromWarehouseId, "inventoryItems", request.itemId)
    const sourceSnap = await tx.get(sourceRef)
    if (!sourceSnap.exists()) throw new Error("insufficient_stock")
    const source = sourceSnap.data() as TransferItemState
    if (source.quantity < finalQuantity) throw new Error("insufficient_stock")

    tx.update(sourceRef, { quantity: source.quantity - finalQuantity, updatedAt: serverTimestamp() })
    tx.update(requestRef, {
      status: "released",
      releasedQuantity: finalQuantity,
      releasedByUserId: byUserId,
      releasedByName: byUserName,
      releasedAt: serverTimestamp(),
    })
  })
}

/** Confirms receipt of a released request — credits the destination and closes the loop. */
export async function confirmWarehouseRequestReceipt(params: {
  firestore: Firestore
  centralWarehouseId: string
  requestId: string
  byUserId: string
  byUserName: string
  note?: string | null
  /** Existing destination item with the same merge key, if the caller found one. */
  existingDestItemId?: string | null
}): Promise<void> {
  const { firestore, centralWarehouseId, requestId, byUserId, byUserName, note, existingDestItemId } = params
  const requestRef = doc(firestore, "warehouses", centralWarehouseId, "requests", requestId)

  await runTransaction(firestore, async (tx) => {
    const reqSnap = await tx.get(requestRef)
    if (!reqSnap.exists()) throw new Error("not_found")
    const request = reqSnap.data() as WarehouseRequestDoc
    if (request.status !== "released") throw new Error("not_released")
    const creditedQuantity = request.releasedQuantity ?? request.quantity

    const destRef = existingDestItemId
      ? doc(firestore, "warehouses", request.toWarehouseId, "inventoryItems", existingDestItemId)
      : doc(collection(firestore, "warehouses", request.toWarehouseId, "inventoryItems"))
    const destSnap = existingDestItemId ? await tx.get(destRef) : null

    if (destSnap?.exists()) {
      tx.update(destRef, { quantity: (destSnap.data().quantity || 0) + creditedQuantity, updatedAt: serverTimestamp() })
    } else {
      tx.set(destRef, {
        name: request.itemName,
        sku: null,
        quantity: creditedQuantity,
        unit: request.unit,
        minStockLevel: null,
        trackingMode: null,
        typeId: request.typeId ?? null,
        organizationId: request.organizationId,
        warehouseId: request.toWarehouseId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }

    tx.update(requestRef, {
      status: "received",
      receivedByUserId: byUserId,
      receivedByName: byUserName,
      receivedAt: serverTimestamp(),
      receivedNote: note ?? null,
    })
  })
}

/** Cancels a still-pending request — no stock has moved yet, so this is just a status
 * flip, but a reason is required so the audit trail explains why it never went out. */
export async function cancelWarehouseRequest(params: {
  firestore: Firestore
  centralWarehouseId: string
  requestId: string
  reason: string
}): Promise<void> {
  const { firestore, centralWarehouseId, requestId, reason } = params
  if (!reason.trim()) throw new Error("reason_required")
  const requestRef = doc(firestore, "warehouses", centralWarehouseId, "requests", requestId)
  await runTransaction(firestore, async (tx) => {
    const reqSnap = await tx.get(requestRef)
    if (!reqSnap.exists()) throw new Error("not_found")
    const request = reqSnap.data() as WarehouseRequestDoc
    if (request.status !== "pending") throw new Error("not_pending")
    tx.update(requestRef, { status: "cancelled", cancelledReason: reason.trim() })
  })
}

import {
  Firestore,
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore"

// Central-warehouse stock movement. All project-warehouse stock originates in
// the company's single central warehouse and moves through here — a Firestore
// transaction keeps the two item quantities and the movement log in lockstep,
// so the central view is always the source of truth.

export interface TransferItemState {
  quantity: number
  trackingMode?: "unit" | null
}

export type TransferValidationError =
  | "invalid_quantity"
  | "insufficient_stock"
  | "unit_tracked"
  | "same_warehouse"

export function validateTransfer(params: {
  sourceItem: TransferItemState | null | undefined
  quantity: number
  fromWarehouseId: string
  toWarehouseId: string
}): TransferValidationError | null {
  const { sourceItem, quantity, fromWarehouseId, toWarehouseId } = params
  if (fromWarehouseId === toWarehouseId) return "same_warehouse"
  if (!Number.isFinite(quantity) || quantity <= 0) return "invalid_quantity"
  if (sourceItem?.trackingMode === "unit") return "unit_tracked"
  if (!sourceItem || sourceItem.quantity < quantity) return "insufficient_stock"
  return null
}

/** Merge key: the same material in two warehouses is matched by name + unit,
 * so repeated transfers top up one row instead of piling up duplicates. */
export function itemMergeKey(item: { name: string; unit: string }): string {
  return `${item.name.trim()}|${item.unit.trim().toLowerCase()}`
}

export interface RunTransferParams {
  firestore: Firestore
  fromWarehouseId: string
  toWarehouseId: string
  itemId: string
  quantity: number
  organizationId: string
  byUserId: string
  byUserName: string
  /** The central warehouse's id — the transfers log always lives there,
   * whichever direction the stock moves. */
  centralWarehouseId: string
  toProjectId?: string | null
  toProjectName?: string | null
  /** Existing destination item with the same merge key, if the caller found one. */
  existingDestItemId?: string | null
}

export async function runTransfer(params: RunTransferParams): Promise<void> {
  const {
    firestore, fromWarehouseId, toWarehouseId, itemId, quantity,
    organizationId, byUserId, byUserName, centralWarehouseId,
    toProjectId, toProjectName, existingDestItemId,
  } = params

  const sourceRef = doc(firestore, "warehouses", fromWarehouseId, "inventoryItems", itemId)
  const destRef = existingDestItemId
    ? doc(firestore, "warehouses", toWarehouseId, "inventoryItems", existingDestItemId)
    : doc(collection(firestore, "warehouses", toWarehouseId, "inventoryItems"))
  const logRef = doc(collection(firestore, "warehouses", centralWarehouseId, "transfers"))

  await runTransaction(firestore, async (tx) => {
    const sourceSnap = await tx.get(sourceRef)
    const source = sourceSnap.exists() ? (sourceSnap.data() as TransferItemState & { name: string; sku?: string | null; unit: string; minStockLevel?: number | null }) : null
    const error = validateTransfer({ sourceItem: source, quantity, fromWarehouseId, toWarehouseId })
    if (error) throw new Error(error)

    const destSnap = existingDestItemId ? await tx.get(destRef) : null

    tx.update(sourceRef, { quantity: source!.quantity - quantity, updatedAt: serverTimestamp() })

    if (destSnap?.exists()) {
      tx.update(destRef, { quantity: (destSnap.data().quantity || 0) + quantity, updatedAt: serverTimestamp() })
    } else {
      tx.set(destRef, {
        name: source!.name,
        sku: source!.sku ?? null,
        quantity,
        unit: source!.unit,
        minStockLevel: source!.minStockLevel ?? null,
        trackingMode: null,
        organizationId,
        warehouseId: toWarehouseId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }

    tx.set(logRef, {
      organizationId,
      itemName: source!.name,
      unit: source!.unit,
      quantity,
      fromWarehouseId,
      toWarehouseId,
      toProjectId: toProjectId ?? null,
      toProjectName: toProjectName ?? null,
      direction: fromWarehouseId === centralWarehouseId ? "out" : "in",
      byUserId,
      byUserName,
      createdAt: serverTimestamp(),
    })
  })
}

export interface ReceiveDeliveryItem {
  name: string
  unit: string
  quantity: number
}

export interface ReceiveDeliveryParams {
  firestore: Firestore
  warehouseId: string
  items: ReceiveDeliveryItem[]
  organizationId: string
}

/**
 * Goods-receipt stock movement: confirming a delivery adds stock straight into
 * a warehouse (the project's, or the org's central one), matched by name+unit
 * the same way transfers are — a new item is created only when nothing matches.
 * Unit-tracked items are skipped; barcode assignment for those stays a manual
 * step in the warehouse UI, same as everywhere else in this file.
 */
export async function receiveDelivery(params: ReceiveDeliveryParams): Promise<void> {
  const { firestore, warehouseId, items, organizationId } = params
  const itemsColRef = collection(firestore, "warehouses", warehouseId, "inventoryItems")
  const existingSnap = await getDocs(itemsColRef)
  const byMergeKey = new Map<string, string>()
  existingSnap.docs.forEach((d) => {
    const data = d.data() as { name?: string; unit?: string; trackingMode?: string | null }
    if (data.name && data.unit && data.trackingMode !== "unit") {
      byMergeKey.set(itemMergeKey({ name: data.name, unit: data.unit }), d.id)
    }
  })

  for (const item of items) {
    const name = item.name?.trim()
    const unit = item.unit?.trim()
    const quantity = Number(item.quantity)
    if (!name || !unit || !Number.isFinite(quantity) || quantity <= 0) continue

    const matchId = byMergeKey.get(itemMergeKey({ name, unit }))
    const destRef = matchId
      ? doc(firestore, "warehouses", warehouseId, "inventoryItems", matchId)
      : doc(itemsColRef)

    await runTransaction(firestore, async (tx) => {
      const destSnap = matchId ? await tx.get(destRef) : null
      if (destSnap?.exists()) {
        tx.update(destRef, { quantity: (destSnap.data().quantity || 0) + quantity, updatedAt: serverTimestamp() })
      } else {
        tx.set(destRef, {
          name,
          sku: null,
          quantity,
          unit,
          minStockLevel: null,
          trackingMode: null,
          organizationId,
          warehouseId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
    })
  }
}

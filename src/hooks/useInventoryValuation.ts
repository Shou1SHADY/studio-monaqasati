"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { collection, getDocs, query, where } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { WORK_ORDERS } from "@/lib/manufacturing"
import { DELIVERY_NOTES } from "@/lib/delivery-notes"
import {
  valueInventory,
  type InventoryValuation,
  type ValuationDeliveryNote,
  type ValuationStockRow,
  type ValuationWarehouse,
  type ValuationWorkOrder,
} from "@/lib/inventory-valuation"

/** An inventory row as read by the fan-out — enough for valuation and the
 * dashboard's low-stock count. */
export type InventoryStockRow = ValuationStockRow & {
  id: string
  name?: string
  minStockLevel?: number | null
}

interface Snapshot {
  stock: InventoryStockRow[]
  orders: ValuationWorkOrder[]
  notes: ValuationDeliveryNote[]
  /** Some read failed — the figures that did load are shown, flagged partial. */
  partial: boolean
}

/**
 * The org's inventory value — materials, work in progress, finished goods —
 * from ONE set of one-time reads taken together: every warehouse's
 * inventoryItems (the same fan-out the dashboard's low-stock tile needs, so
 * callers take `stock` from here instead of reading it again), plus the org's
 * work orders and delivery notes. Reading all three at the same moment keeps
 * the total consistent: a live note subscription next to a one-time stock read
 * would show goods leaving WIP before their finished-goods row appears.
 *
 * `warehouses` comes from the caller (useCentralWarehouse on the contractor
 * side, the page's own query on the supplier side) so this hook never has the
 * side effect of creating a central warehouse.
 */
export function useInventoryValuation(
  orgId: string | undefined,
  warehouses: ValuationWarehouse[],
  warehousesLoading: boolean
) {
  const firestore = useFirestore()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [fetching, setFetching] = useState(true)

  const warehouseIds = warehouses.map((w) => w.id).join(",")
  // Names and kinds only feed the per-warehouse breakdown; the latest list is
  // read through a ref so a re-render with an equal list doesn't refetch.
  const warehousesRef = useRef(warehouses)
  warehousesRef.current = warehouses
  const warehousesKey = warehouses
    .map((w) => `${w.id}:${w.name ?? ""}:${w.isCentral ? 1 : 0}${w.isOutbound ? 1 : 0}:${w.projectId ?? ""}`)
    .join("|")

  useEffect(() => {
    if (!firestore || !orgId || warehousesLoading) return
    let cancelled = false
    setFetching(true)
    const ids = warehouseIds ? warehouseIds.split(",") : []

    const stockRead = Promise.all(
      ids.map((warehouseId) =>
        getDocs(collection(firestore, "warehouses", warehouseId, "inventoryItems")).then((snap) =>
          snap.docs.map((d) => ({ ...(d.data() as Omit<InventoryStockRow, "id" | "warehouseId">), id: d.id, warehouseId }))
        )
      )
    ).then((perWarehouse) => perWarehouse.flat())
    const ordersRead = getDocs(query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId))).then(
      (snap) => snap.docs.map((d) => ({ ...(d.data() as Omit<ValuationWorkOrder, "id">), id: d.id }))
    )
    const notesRead = getDocs(query(collection(firestore, DELIVERY_NOTES), where("organizationId", "==", orgId))).then(
      (snap) => snap.docs.map((d) => d.data() as ValuationDeliveryNote)
    )

    Promise.allSettled([stockRead, ordersRead, notesRead])
      .then(([stock, orders, notes]) => {
        if (cancelled) return
        for (const r of [stock, orders, notes]) {
          if (r.status === "rejected") console.warn("inventory valuation read failed:", (r.reason as { code?: string })?.code)
        }
        setSnapshot({
          stock: stock.status === "fulfilled" ? stock.value : [],
          orders: orders.status === "fulfilled" ? orders.value : [],
          notes: notes.status === "fulfilled" ? notes.value : [],
          partial: [stock, orders, notes].some((r) => r.status === "rejected"),
        })
      })
      .finally(() => {
        if (!cancelled) setFetching(false)
      })
    return () => {
      cancelled = true
    }
  }, [firestore, orgId, warehousesLoading, warehouseIds])

  const valuation: InventoryValuation | null = useMemo(() => {
    if (!snapshot) return null
    return valueInventory({
      stock: snapshot.stock,
      warehouses: warehousesRef.current,
      orders: snapshot.orders,
      notes: snapshot.notes,
    })
    // warehousesKey stands in for the list's content (read via the ref).
  }, [snapshot, warehousesKey])

  const noOrg = !orgId
  return {
    stock: snapshot?.stock ?? [],
    valuation,
    partial: snapshot?.partial ?? false,
    isLoading: !noOrg && (warehousesLoading || fetching || !snapshot),
  }
}

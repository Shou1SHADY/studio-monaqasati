"use client"

import { useEffect, useState } from "react"
import { collection, getDocs, orderBy, query, limit } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useCentralWarehouse } from "@/hooks/useCentralWarehouse"

/** Powers the Warehouses component's dashboard tiles: total warehouses
 * (free, already fetched by useCentralWarehouse), a live count of recent
 * transfers (the transfers log always lives under the central warehouse
 * doc), and a one-time fan-out low-stock count across every warehouse's
 * inventoryItems subcollection — not a live collectionGroup query, since no
 * such Firestore rule exists for one and this stays cheap at the realistic
 * warehouse counts one org will have. */
export function useWarehouseDashboardStats(orgId: string | undefined) {
  const firestore = useFirestore()
  const { central, allWarehouses, isLoading: warehousesLoading } = useCentralWarehouse(orgId)

  const transfersQuery = useMemoFirebase(() => {
    if (!firestore || !central) return null
    return query(collection(firestore, "warehouses", central.id, "transfers"), orderBy("createdAt", "desc"), limit(10))
  }, [firestore, central?.id])
  const { data: recentTransfers, isLoading: transfersLoading } = useCollection(transfersQuery)

  const [lowStockCount, setLowStockCount] = useState(0)
  const [lowStockLoading, setLowStockLoading] = useState(true)
  const warehouseIds = allWarehouses.map((w) => w.id).join(",")

  useEffect(() => {
    if (!firestore || warehousesLoading || allWarehouses.length === 0) {
      setLowStockLoading(false)
      return
    }
    let cancelled = false
    setLowStockLoading(true)
    Promise.all(
      allWarehouses.map((w) => getDocs(collection(firestore, "warehouses", w.id, "inventoryItems")))
    )
      .then((snapshots) => {
        if (cancelled) return
        let count = 0
        for (const snap of snapshots) {
          snap.forEach((docSnap) => {
            const data = docSnap.data() as { quantity?: number; minStockLevel?: number | null }
            if (typeof data.minStockLevel === "number" && (data.quantity ?? 0) <= data.minStockLevel) count += 1
          })
        }
        setLowStockCount(count)
      })
      .catch((err) => console.warn("low-stock scan failed:", err?.code))
      .finally(() => { if (!cancelled) setLowStockLoading(false) })
    return () => { cancelled = true }
  }, [firestore, warehousesLoading, warehouseIds])

  return {
    totalWarehouses: allWarehouses.length,
    recentTransferCount: recentTransfers?.length || 0,
    lowStockCount,
    isLoading: warehousesLoading || transfersLoading || lowStockLoading,
  }
}

"use client"

import { useEffect, useState } from "react"
import { collection, getDocs } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { useCentralWarehouse } from "@/hooks/useCentralWarehouse"

/** Powers the Warehouses component's dashboard tiles: total warehouses
 * (free, already fetched by useCentralWarehouse), a one-time fan-out count
 * of recently-completed withdrawal requests across every central warehouse
 * (a company can have more than one — one per city — so this can't just read
 * a single central's subcollection), and a one-time fan-out low-stock count
 * across every warehouse's inventoryItems subcollection. Both fan-outs are
 * one-time reads, not live collectionGroup queries, since no such Firestore
 * rule exists for one and this stays cheap at realistic warehouse counts. */
export function useWarehouseDashboardStats(orgId: string | undefined) {
  const firestore = useFirestore()
  const { centrals, allWarehouses, isLoading: warehousesLoading } = useCentralWarehouse(orgId)

  const [recentRequestCount, setRecentRequestCount] = useState(0)
  const [requestsLoading, setRequestsLoading] = useState(true)
  const centralIds = centrals.map((c) => c.id).join(",")

  useEffect(() => {
    if (!firestore || warehousesLoading || centrals.length === 0) {
      setRequestsLoading(false)
      return
    }
    let cancelled = false
    setRequestsLoading(true)
    Promise.all(
      centrals.map((c) => getDocs(collection(firestore, "warehouses", c.id, "requests")))
    )
      .then((snapshots) => {
        if (cancelled) return
        let count = 0
        for (const snap of snapshots) {
          snap.forEach((docSnap) => {
            const data = docSnap.data() as { status?: string }
            if (data.status === "received") count += 1
          })
        }
        setRecentRequestCount(count)
      })
      .catch((err) => console.warn("recent-requests scan failed:", err?.code))
      .finally(() => { if (!cancelled) setRequestsLoading(false) })
    return () => { cancelled = true }
  }, [firestore, warehousesLoading, centralIds])

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
    recentTransferCount: recentRequestCount,
    lowStockCount,
    isLoading: warehousesLoading || requestsLoading || lowStockLoading,
  }
}

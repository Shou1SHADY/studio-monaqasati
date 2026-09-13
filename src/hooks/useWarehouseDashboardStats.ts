"use client"

import { useEffect, useState } from "react"
import { collection, getDocs } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { useCentralWarehouse } from "@/hooks/useCentralWarehouse"
import { useInventoryValuation } from "@/hooks/useInventoryValuation"

/** Powers the Warehouses component's dashboard tiles: total warehouses
 * (free, already fetched by useCentralWarehouse), a one-time fan-out count
 * of recently-completed withdrawal requests across every central warehouse
 * (a company can have more than one — one per city — so this can't just read
 * a single central's subcollection), a low-stock count, and the org's
 * inventory valuation (materials / work in progress / finished goods).
 * Low stock and valuation share ONE one-time fan-out across every warehouse's
 * inventoryItems subcollection (useInventoryValuation). The fan-outs are
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

  const {
    stock,
    valuation,
    partial: valuationPartial,
    isLoading: stockLoading,
  } = useInventoryValuation(orgId, allWarehouses, warehousesLoading)
  const lowStockCount = stock.filter(
    (row) => typeof row.minStockLevel === "number" && (row.quantity ?? 0) <= row.minStockLevel
  ).length

  return {
    totalWarehouses: allWarehouses.length,
    recentTransferCount: recentRequestCount,
    lowStockCount,
    valuation,
    valuationPartial,
    valuationLoading: stockLoading,
    isLoading: warehousesLoading || requestsLoading || stockLoading,
  }
}

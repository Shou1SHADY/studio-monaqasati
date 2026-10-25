"use client"

// «قادمة» (INC-06): what will reach Incoming soon — the project requests awaiting technical approval and the stock items close above
// their minimum — and which of them the signed-in member watches («نبّهني حين يصل»). Read before it arrives; never bought from here.

import { useCallback, useEffect, useMemo, useState } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { useOrgStock } from "@/hooks/useOrgStock"
import { useProjectPurchaseRequests } from "@/hooks/useProjectPurchaseRequests"
import { fetchWatched, setWatched } from "@/lib/procurement/upcoming-client"
import { sortUpcoming, upcomingFromProjects, upcomingFromStock, type UpcomingItem } from "@/lib/procurement/upcoming"

export interface Upcoming {
  loading: boolean
  items: UpcomingItem[]
  watched: ReadonlySet<string>
  /** Puts the watch on or takes it off; false when the server refused it. */
  watch: (key: string, on: boolean) => Promise<boolean>
}

export function useUpcoming(orgId: string | null): Upcoming {
  const firestore = useFirestore()
  const { on } = useModules()
  const projects = useProjectPurchaseRequests(orgId, on("project-management"))
  const whQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: whData } = useCollection(whQ)
  const warehouses = useMemo(() => (whData || []) as Array<{ id: string; name?: string; isOutbound?: boolean }>, [whData])
  const stock = useOrgStock(warehouses, warehouses.length > 0)
  const [watched, setWatchedKeys] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    let live = true
    void fetchWatched().then((keys) => {
      if (live && keys) setWatchedKeys(new Set(keys))
    })
    return () => {
      live = false
    }
  }, [orgId])

  const items = useMemo(() => {
    const names = new Map(warehouses.map((w) => [w.id, w.name || ""]))
    const rows = Array.from(stock.byWarehouse.entries()).flatMap(([warehouseId, list]) => list.filter((r) => !r.isManufactured).map((r) => ({ ...r, warehouseId, warehouseName: names.get(warehouseId) || "" })))
    return sortUpcoming([...upcomingFromProjects(projects.rows), ...upcomingFromStock(rows)])
  }, [projects.rows, stock.byWarehouse, warehouses])

  const watch = useCallback(async (key: string, onOrOff: boolean) => {
    const ok = await setWatched(key, onOrOff)
    if (ok)
      setWatchedKeys((prev) => {
        const next = new Set(prev)
        if (onOrOff) next.add(key)
        else next.delete(key)
        return next
      })
    return ok
  }, [])

  return { loading: projects.loading || stock.loading, items, watched, watch }
}

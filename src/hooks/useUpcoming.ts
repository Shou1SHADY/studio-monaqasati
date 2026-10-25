"use client"

// «قادمة» (INC-06): what will reach Incoming soon — the project requests awaiting technical approval (with Projects), the team's
// requests awaiting approval before Procurement (without Projects, when the policy is on), the planned work orders the stores cannot
// cover (with Manufacturing), and the stock items close above their minimum or lasting only days at the current issue rate — and
// which of them the signed-in member watches («نبّهني حين يصل»). Read before it arrives; never bought from here.

import { useCallback, useEffect, useMemo, useState } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { useOrgStock } from "@/hooks/useOrgStock"
import { useProjectPurchaseRequests } from "@/hooks/useProjectPurchaseRequests"
import { useTeamApprovals } from "@/hooks/useTeamApprovals"
import { MFG_DEPARTMENTS, WORK_ORDERS } from "@/lib/manufacturing"
import { MFG_PRODUCTS, type DeptCapacityFields, type MfgProduct } from "@/lib/manufacturing-engine"
import { stockIndexFrom } from "@/lib/manufacturing-view"
import type { WorkOrderV2 } from "@/lib/manufacturing-writes"
import { issueKey } from "@/lib/procurement/issue-rate"
import { fetchUpcomingFacts, setWatched } from "@/lib/procurement/upcoming-client"
import { upcomingFromWorkOrders } from "@/lib/procurement/upcoming-mfg"
import { upcomingFromTeamApprovals } from "@/lib/procurement/upcoming-team"
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
  const mfg = on("manufacturing")
  const projects = useProjectPurchaseRequests(orgId, on("project-management"))
  const whQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: whData } = useCollection(whQ)
  const warehouses = useMemo(() => (whData || []) as Array<{ id: string; name?: string; isOutbound?: boolean }>, [whData])
  const stock = useOrgStock(warehouses, warehouses.length > 0)
  const { approvals } = useTeamApprovals()
  // The workshop's planned orders (Manufacturing in the package).
  const woQ = useMemoFirebase(() => (firestore && orgId && mfg ? query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId)) : null), [firestore, orgId, mfg])
  const { data: woData } = useCollection(woQ)
  const productsQ = useMemoFirebase(() => (firestore && orgId && mfg ? query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId)) : null), [firestore, orgId, mfg])
  const { data: productsData } = useCollection(productsQ)
  const deptQ = useMemoFirebase(() => (firestore && orgId && mfg ? query(collection(firestore, MFG_DEPARTMENTS), where("organizationId", "==", orgId)) : null), [firestore, orgId, mfg])
  const { data: deptData } = useCollection(deptQ)
  const [watched, setWatchedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [rates, setRates] = useState<Record<string, number>>({})

  useEffect(() => {
    let live = true
    void fetchUpcomingFacts().then((facts) => {
      if (!live || !facts) return
      setWatchedKeys(new Set(facts.keys))
      setRates(facts.rates)
    })
    return () => {
      live = false
    }
  }, [orgId])

  const items = useMemo(() => {
    const names = new Map(warehouses.map((w) => [w.id, w.name || ""]))
    const allRows = Array.from(stock.byWarehouse.entries()).flatMap(([warehouseId, list]) => list.map((r) => ({ ...r, warehouseId, warehouseName: names.get(warehouseId) || "" })))
    const rows = allRows.filter((r) => !r.isManufactured)
    const rateOf = (warehouseId: string, name: string) => rates[issueKey(warehouseId, name)] ?? null
    const workOrders = mfg
      ? upcomingFromWorkOrders({
          orders: (woData || []) as WorkOrderV2[],
          products: new Map(((productsData || []) as MfgProduct[]).filter((p) => !p.archived).map((p) => [p.id, p])),
          departments: (deptData || []) as DeptCapacityFields[],
          stock: stockIndexFrom(allRows, new Set()),
        })
      : []
    return sortUpcoming([...upcomingFromProjects(projects.rows), ...upcomingFromTeamApprovals(approvals), ...workOrders, ...upcomingFromStock(rows, rateOf)])
  }, [projects.rows, stock.byWarehouse, warehouses, rates, approvals, mfg, woData, productsData, deptData])

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

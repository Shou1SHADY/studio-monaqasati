"use client"

// The org's open needs in one list (R-19, the RFQ form's «من الاحتياج المفتوح»):
// a work order's shortfall, a project's approved request, a stock item at or
// below its minimum — the same assembly the needs desk makes, read once for
// the form's picker. Off (`enabled` false) it reads nothing.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { useOrgStock } from "@/hooks/useOrgStock"
import { useProjectPurchaseRequests } from "@/hooks/useProjectPurchaseRequests"
import type { ProcurementWorld } from "@/hooks/useProcurementWorld"
import { WORK_ORDERS } from "@/lib/manufacturing"
import { MFG_PRODUCTS, type MfgProduct } from "@/lib/manufacturing-engine"
import { isV2Order, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { orderRef } from "@/lib/manufacturing-view"
import { purchaseRequestRef } from "@/lib/mfg-outside"
import { mfgNeed, needsForModules, projectNeed, returnedNeeds, sortNeeds, stockNeeds, type Need } from "@/lib/procurement/needs"

export function useOpenNeeds(world: Pick<ProcurementWorld, "orgId" | "rfqs" | "orders">, enabled: boolean): Need[] {
  const firestore = useFirestore()
  const { on } = useModules()
  const pmOn = on("project-management")
  const mfgOn = on("manufacturing")
  const orgId = enabled ? world.orgId : ""
  const ordersQ = useMemoFirebase(() => (firestore && orgId && mfgOn ? query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId)) : null), [firestore, orgId, mfgOn])
  const { data: ordersData } = useCollection(ordersQ)
  const productsQ = useMemoFirebase(() => (firestore && orgId && mfgOn ? query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId)) : null), [firestore, orgId, mfgOn])
  const { data: productsData } = useCollection(productsQ)
  const warehousesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: warehousesData } = useCollection(warehousesQ)
  const warehouses = useMemo(() => (warehousesData || []) as Array<{ id: string; name?: string }>, [warehousesData])
  const stock = useOrgStock(warehouses, warehouses.length > 0)
  const projectRequests = useProjectPurchaseRequests(orgId || null, pmOn)

  return useMemo(() => {
    if (!enabled) return []
    const products = new Map(((productsData || []) as MfgProduct[]).map((p) => [p.id, p]))
    const out: Need[] = []
    for (const o of ((ordersData || []) as WorkOrderV2[]).filter(isV2Order)) {
      const p = products.get(o.productId || "")
      for (const r of o.purchaseRequests || []) out.push(mfgNeed({ id: o.id, ref: orderRef(o), context: o.productName || p?.name || o.projectName || "", projectId: o.projectId ?? null, projectName: o.projectName ?? null }, r))
    }
    for (const { project, requests } of projectRequests.rows) for (const pr of requests) out.push(projectNeed(project, pr, purchaseRequestRef(pr.id)))
    out.push(...returnedNeeds(out, world.orders))
    const names = new Map(warehouses.map((w) => [w.id, w.name || ""]))
    const rows = Array.from(stock.byWarehouse.entries()).flatMap(([warehouseId, items]) => items.filter((r) => !r.isManufactured).map((r) => ({ ...r, warehouseId, warehouseName: names.get(warehouseId) || "" })))
    out.push(...stockNeeds(rows, { rfqs: world.rfqs, orders: world.orders }))
    return sortNeeds(needsForModules(out, { projects: pmOn, workshop: mfgOn }).filter((n) => n.state === "action" && n.lines.length > 0))
  }, [enabled, pmOn, mfgOn, ordersData, productsData, projectRequests.rows, stock.byWarehouse, warehouses, world.rfqs, world.orders])
}

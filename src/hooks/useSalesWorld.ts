"use client"

// Everything Today and Reports read, loaded once and scoped to the viewer
// (Sales PRD D10, INV-04, INV-08): the documents as they are, supply computed
// by the same coverage engine the Orders page uses, the work orders' gates,
// and — for cost roles only — where actual cost ran past standard. A rep's
// world holds only his own clients; cost never enters it.

import { useEffect, useMemo, useState } from "react"
import { collection, doc, getDocs, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useCrmData } from "@/hooks/useCrmData"
import { useSalesScope } from "@/hooks/useSalesScope"
import { usePermissions } from "@/hooks/usePermissions"
import { MFG_DEPARTMENTS, effectiveOutput } from "@/lib/manufacturing"
import { MFG_PRODUCTS, MFG_SETTINGS, itemKey, normalizeMfgSettings, type DeptCapacityFields, type MfgProduct, type MfgSettings } from "@/lib/manufacturing-engine"
import { isV2Order, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { heldByItem, salesOrderOfWorkOrder, workshopGatesFor, workshopHolds } from "@/lib/manufacturing-view"
import { SALES_PRICE_ITEMS, type SalesPriceItem } from "@/lib/sales"
import {
  MANUFACTURING_REQUESTS,
  SALES_DELIVERY_NOTES,
  SALES_ORDERS,
  SALES_RETURNS,
  allocateCoverage,
  orderLineProgress,
  type ManufacturingRequest,
  type SalesDeliveryNote,
  type SalesOrder,
  type SalesReturn,
} from "@/lib/sales-orders"
import { SALES_QUOTE_REQUESTS, SALES_TRANSFER_NOTICES, type QuoteRequest, type TransferNotice } from "@/lib/sales-transfers"
import { costDriftsOf, type SalesWorld, type TodayViewer } from "@/lib/sales-today"

export function useSalesWorld(): {
  world: SalesWorld
  viewer: TodayViewer
  orgId: string
  userId: string
  teamMembers: ReturnType<typeof useCrmData>["teamMembers"]
  contacts: ReturnType<typeof useCrmData>["contacts"]
  /** The price list — empty for a viewer without cost access (INV-08). */
  priceItems: SalesPriceItem[]
  isLoading: boolean
} {
  const firestore = useFirestore()
  const { can, isOrgOwner } = usePermissions()
  const { orgId, quotations: allQuotations, contacts, teamMembers, isLoading: crmLoading } = useCrmData({ quotations: true })
  const scope = useSalesScope(contacts)

  const orgQuery = (name: string) => (firestore && orgId ? query(collection(firestore, name), where("organizationId", "==", orgId)) : null)
  const requestsQ = useMemoFirebase(() => orgQuery(SALES_QUOTE_REQUESTS), [firestore, orgId])
  const noticesQ = useMemoFirebase(() => orgQuery(SALES_TRANSFER_NOTICES), [firestore, orgId])
  const ordersQ = useMemoFirebase(() => orgQuery(SALES_ORDERS), [firestore, orgId])
  const notesQ = useMemoFirebase(() => orgQuery(SALES_DELIVERY_NOTES), [firestore, orgId])
  const returnsQ = useMemoFirebase(() => orgQuery(SALES_RETURNS), [firestore, orgId])
  const mfgRequestsQ = useMemoFirebase(() => orgQuery(MANUFACTURING_REQUESTS), [firestore, orgId])
  const workOrdersQ = useMemoFirebase(() => orgQuery("workOrders"), [firestore, orgId])
  const productsQ = useMemoFirebase(() => orgQuery(MFG_PRODUCTS), [firestore, orgId])
  const departmentsQ = useMemoFirebase(() => orgQuery(MFG_DEPARTMENTS), [firestore, orgId])
  const warehousesQ = useMemoFirebase(() => orgQuery("warehouses"), [firestore, orgId])
  // Cost is read only by those who may see it — it never reaches a rep's browser from here.
  const priceItemsQ = useMemoFirebase(() => (scope.seesCost ? orgQuery(SALES_PRICE_ITEMS) : null), [firestore, orgId, scope.seesCost])
  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, MFG_SETTINGS, orgId) : null), [firestore, orgId])

  const { data: requestsData } = useCollection(requestsQ)
  const { data: noticesData } = useCollection(noticesQ)
  const { data: ordersData, isLoading: ordersLoading } = useCollection(ordersQ)
  const { data: notesData } = useCollection(notesQ)
  const { data: returnsData } = useCollection(returnsQ)
  const { data: mfgRequestsData } = useCollection(mfgRequestsQ)
  const { data: workOrdersData } = useCollection(workOrdersQ)
  const { data: productsData } = useCollection(productsQ)
  const { data: departmentsData } = useCollection(departmentsQ)
  const { data: warehousesData } = useCollection(warehousesQ)
  const { data: priceItemsData } = useCollection(priceItemsQ)
  const { data: settingsData } = useDoc(settingsRef)

  // Stock by item name — a one-shot read, as on the Orders page: supply is
  // advisory, and a listener per shelf would cost more than the freshness.
  const warehouseIds = useMemo(() => ((warehousesData || []) as Array<{ id: string }>).map((w) => w.id).sort().join(","), [warehousesData])
  const [stockByName, setStockByName] = useState<Array<{ name: string; available: number }>>([])
  useEffect(() => {
    if (!firestore || !warehouseIds) return
    let cancelled = false
    ;(async () => {
      const byName = new Map<string, number>()
      for (const id of warehouseIds.split(",")) {
        try {
          const snap = await getDocs(collection(firestore, "warehouses", id, "inventoryItems"))
          snap.forEach((d) => {
            const name = ((d.data().name as string) || "").trim()
            if (name) byName.set(name, (byName.get(name) || 0) + (Number(d.data().quantity) || 0))
          })
        } catch (err) {
          console.error("Stock read failed:", err)
        }
      }
      if (!cancelled) setStockByName(Array.from(byName, ([name, available]) => ({ name, available })))
    })()
    return () => {
      cancelled = true
    }
  }, [firestore, warehouseIds])

  const mine = scope.mine
  const world = useMemo<SalesWorld>(() => {
    const today = new Date().toISOString().slice(0, 10)
    const orders = ((ordersData || []) as SalesOrder[]).filter(mine)
    const orderIds = new Set(orders.map((o) => o.id))
    const notes = ((notesData || []) as SalesDeliveryNote[]).filter((n) => orderIds.has(n.orderId))
    const workOrders = (workOrdersData || []) as WorkOrderV2[]
    const products = new Map(((productsData || []) as MfgProduct[]).map((p) => [p.id, p]))

    const onHand = new Map<string, number>()
    for (const s of stockByName) onHand.set(itemKey(s.name), (onHand.get(itemKey(s.name)) || 0) + Math.max(0, s.available))
    const held =
      stockByName.length && workOrders.length
        ? heldByItem(workshopHolds({ orders: workOrders.filter(isV2Order), products, departments: (departmentsData || []) as DeptCapacityFields[], stock: { onHand, lots: [] } }))
        : undefined
    const openWorkOrders = workOrders
      .filter((w) => w.status === "open")
      .map((w) => {
        const out = effectiveOutput(w)
        const remainingQty = isV2Order(w) ? Math.max(0, (w.quantity ?? out.quantity) - (Number(w.shippedQuantity) || 0)) : out.quantity
        return { id: w.id, outputName: w.productName || out.name, remainingQty, salesOrderId: salesOrderOfWorkOrder(w, orders)?.id ?? w.salesOrderId ?? null }
      })
    const prioritised = orders
      .filter((o) => o.status === "running" || o.status === "awaiting_deposit")
      .sort((a, b) => (a.status === b.status ? ((a.promiseDate || "9999") < (b.promiseDate || "9999") ? -1 : 1) : a.status === "running" ? -1 : 1))
      .map((order) => ({ order, lines: orderLineProgress(order, notes) }))

    const gates = new Map<string, "measurement" | "approval">()
    for (const o of orders) {
      const first = workshopGatesFor(o, workOrders, products).gates[0]
      if (first) gates.set(o.id, first.gate)
    }

    return {
      today,
      nowMs: Date.now(),
      quotations: allQuotations.filter(mine),
      requests: ((requestsData || []) as QuoteRequest[]).filter(mine),
      orders,
      notes,
      returns: ((returnsData || []) as SalesReturn[]).filter((r) => orderIds.has(r.orderId)),
      notices: ((noticesData || []) as TransferNotice[]).filter(mine),
      mfgRequests: ((mfgRequestsData || []) as ManufacturingRequest[]).filter((r) => !r.orderId || orderIds.has(r.orderId)),
      coverage: allocateCoverage(prioritised, stockByName, openWorkOrders, held),
      gates,
      answerWindowHours: normalizeMfgSettings(settingsData as Partial<MfgSettings> | null).answerWindowHours,
      costDrifts: scope.seesCost ? costDriftsOf((priceItemsData || []) as SalesPriceItem[], workOrders.filter((w) => w.status === "done")) : [],
    }
  }, [allQuotations, requestsData, noticesData, ordersData, notesData, returnsData, mfgRequestsData, workOrdersData, productsData, departmentsData, priceItemsData, settingsData, stockByName, mine, scope.seesCost])

  const viewer = useMemo<TodayViewer>(
    () => ({ canSell: can("sales.manage"), canDecideReturns: isOrgOwner || can("sales.approve"), seesCost: scope.seesCost }),
    [can, isOrgOwner, scope.seesCost]
  )

  const priceItems = useMemo(() => (scope.seesCost ? ((priceItemsData || []) as SalesPriceItem[]) : []), [priceItemsData, scope.seesCost])

  return { world, viewer, orgId, userId: scope.viewer.userId, teamMembers, contacts, priceItems, isLoading: crmLoading || ordersLoading || scope.isLoading }
}

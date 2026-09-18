"use client"

// One subscription set for every Manufacturing page: the station registry,
// product cards, work orders, delivery notes, requests, cost statements and
// settings — plus the facts other modules own that the workshop reads (the
// sales orders' down payments, Inventory's stock and blocks, the HR fleet, the
// team and its roles), so every tab computes from the same world.

import { useMemo } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { useOrgStock } from "@/hooks/useOrgStock"
import { MFG_DEPARTMENTS, WORK_ORDERS, type MfgDepartment } from "@/lib/manufacturing"
import { DELIVERY_NOTES, type DeliveryNote } from "@/lib/delivery-notes"
import { MANUFACTURING_REQUESTS, SALES_ORDERS, type ManufacturingRequest, type SalesOrder } from "@/lib/sales-orders"
import { ALL_PERMISSION, type TeamGroup } from "@/lib/permissions"
import {
  MFG_BLOCK_NOTICES,
  MFG_COST_ESTIMATES,
  MFG_PRODUCTS,
  MFG_SETTINGS,
  MFG_STOPS,
  normalizeMfgSettings,
  type Actor as EngineActor,
  type MfgCostEstimate,
  type MfgProduct,
  type MfgSettings,
  type StockIndex,
} from "@/lib/manufacturing-engine"
import { FLEET_VEHICLES, isV2Order, type FleetVehicle, type MfgBlockNotice, type MfgStop, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { stockIndexFrom, type TeamMember } from "@/lib/manufacturing-view"
import type { StockRow } from "@/hooks/useOrgStock"

export interface MfgWarehouse {
  id: string
  name: string
  projectId?: string | null
  isCentral?: boolean
  isOutbound?: boolean
  virtual?: boolean
}

export interface MfgData {
  orgId: string
  actor: { id: string; name: string }
  /** The engine's view of who is looking (five roles). */
  engineActor: EngineActor
  ready: boolean
  canManage: boolean
  canWork: boolean
  canQc: boolean
  canCost: boolean
  canView: boolean
  /** Cost visible: manager, cost controller, management. */
  seesMoney: boolean
  departments: MfgDepartment[]
  products: MfgProduct[]
  productById: Map<string, MfgProduct>
  orders: WorkOrderV2[]
  v2Orders: WorkOrderV2[]
  notes: DeliveryNote[]
  notesByOrder: Map<string, DeliveryNote[]>
  requests: ManufacturingRequest[]
  estimates: MfgCostEstimate[]
  settings: MfgSettings
  salesOrders: Map<string, SalesOrder>
  stops: MfgStop[]
  notices: MfgBlockNotice[]
  fleet: FleetVehicle[]
  team: TeamMember[]
  stock: StockIndex | null
  stockRows: Map<string, StockRow[]>
  stockLoading: boolean
  warehouses: MfgWarehouse[]
  projects: Array<{ id: string; name: string }>
}

/** A live org-scoped collection. */
function useOrgCollection(name: string, orgId: string) {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, name), where("organizationId", "==", orgId)) : null), [firestore, name, orgId])
  return useCollection(q)
}

export function useMfgData(): MfgData {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { can, groups, isOrgOwner } = usePermissions()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const actorName = (profile as { name?: string } | null)?.name || user?.email || ""

  const { data: departmentsData } = useOrgCollection(MFG_DEPARTMENTS, orgId)
  const departments = useMemo(() => ((departmentsData || []) as MfgDepartment[]).slice().sort((a, b) => a.order - b.order), [departmentsData])

  const { data: productsData } = useOrgCollection(MFG_PRODUCTS, orgId)
  const products = useMemo(() => ((productsData || []) as MfgProduct[]).slice().sort((a, b) => a.name.localeCompare(b.name, "ar")), [productsData])
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const { data: ordersData, isLoading: ordersLoading } = useOrgCollection(WORK_ORDERS, orgId)
  const orders = useMemo(() => ((ordersData || []) as WorkOrderV2[]).slice().sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0)), [ordersData])
  const v2Orders = useMemo(() => orders.filter((o) => isV2Order(o) && productById.has(o.productId || "")), [orders, productById])

  const { data: notesData } = useOrgCollection(DELIVERY_NOTES, orgId)
  const notes = useMemo(() => (notesData || []) as DeliveryNote[], [notesData])
  const notesByOrder = useMemo(() => {
    const map = new Map<string, DeliveryNote[]>()
    for (const n of notes) {
      const key = n.source?.workOrderId
      if (key) map.set(key, [...(map.get(key) || []), n])
    }
    return map
  }, [notes])

  const { data: requestsData } = useOrgCollection(MANUFACTURING_REQUESTS, orgId)
  const requests = useMemo(() => ((requestsData || []) as ManufacturingRequest[]).slice().sort((a, b) => ((a.requestedAt || "") < (b.requestedAt || "") ? 1 : -1)), [requestsData])

  const { data: estimatesData } = useOrgCollection(MFG_COST_ESTIMATES, orgId)
  const estimates = useMemo(() => ((estimatesData || []) as MfgCostEstimate[]).slice().sort((a, b) => ((a.sentAt || "") < (b.sentAt || "") ? 1 : -1)), [estimatesData])

  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, MFG_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settingsData } = useDoc(settingsRef)
  const settings = useMemo(() => normalizeMfgSettings(settingsData as Partial<MfgSettings> | null), [settingsData])

  const { data: salesOrdersData } = useOrgCollection(SALES_ORDERS, orgId)
  const salesOrders = useMemo(() => new Map(((salesOrdersData || []) as SalesOrder[]).map((s) => [s.id, s])), [salesOrdersData])

  const { data: stopsData } = useOrgCollection(MFG_STOPS, orgId)
  const stops = useMemo(() => (stopsData || []) as MfgStop[], [stopsData])

  const { data: noticesData } = useOrgCollection(MFG_BLOCK_NOTICES, orgId)
  const notices = useMemo(() => ((noticesData || []) as MfgBlockNotice[]).slice().sort((a, b) => (a.at < b.at ? 1 : -1)), [noticesData])

  const { data: fleetData } = useOrgCollection(FLEET_VEHICLES, orgId)
  const fleet = useMemo(() => ((fleetData || []) as FleetVehicle[]).filter((v) => v.active !== false), [fleetData])

  const { data: warehousesData } = useOrgCollection("warehouses", orgId)
  const warehouses = useMemo(() => (warehousesData || []) as MfgWarehouse[], [warehousesData])

  const { data: projectsData } = useOrgCollection("projects", orgId)
  const projects = useMemo(() => (projectsData || []) as Array<{ id: string; name: string }>, [projectsData])

  const { data: membersData } = useOrgCollection("users", orgId)
  const team = useMemo<TeamMember[]>(() => {
    const byId = new Map((groups || []).map((g: TeamGroup) => [g.id, g]))
    const grant = (groupId: string | null | undefined, p: string) => {
      const g = groupId ? byId.get(groupId) : undefined
      return !!g && (g.permissions.includes(ALL_PERMISSION) || (g.permissions as string[]).includes(p))
    }
    const members = ((membersData || []) as Array<{ id: string; name?: string; email?: string; defaultGroupId?: string | null; organizationRole?: string }>).map((m) => {
      const owner = m.organizationRole === "owner" || m.id === orgId
      const has = (p: string) => owner || grant(m.defaultGroupId, p)
      return { id: m.id, name: m.name || m.email || "", manage: has("manufacturing.manage"), work: has("manufacturing.work"), qc: has("manufacturing.qc"), cost: has("manufacturing.cost"), view: has("manufacturing.view") }
    })
    return members.filter((m) => m.manage || m.work || m.qc || m.cost || m.view)
  }, [membersData, groups, orgId])

  // Stock is read once and re-read whenever a withdrawal or a note changes state.
  const stockVersion = useMemo(
    () => v2Orders.reduce((a, o) => a + (o.materials || []).filter((m) => m.state !== "requested").length + (o.remnants || []).filter((r) => r.state === "received").length, 0) + notes.filter((n) => n.status === "received").length,
    [v2Orders, notes]
  )
  const stockRead = useOrgStock(warehouses, !!orgId && (v2Orders.length > 0 || products.length > 0), stockVersion)
  const stock = useMemo(() => {
    if (stockRead.loading && stockRead.byWarehouse.size === 0) return null
    const quarantined = new Set(notices.filter((n) => n.quarantinedAt && !n.closedAt).map((n) => n.lot))
    return stockIndexFrom(Array.from(stockRead.byWarehouse.values()).flat(), quarantined)
  }, [stockRead, notices])

  const canManage = can("manufacturing.manage")
  const canCost = can("manufacturing.cost")
  const canQc = can("manufacturing.qc")
  const canWork = can("manufacturing.work")
  const canView = can("manufacturing.view")
  const engineActor = useMemo<EngineActor>(
    () => ({ uid: user?.uid || "", owner: isOrgOwner, manage: canManage, work: canWork, qc: canQc, cost: canCost, view: canView }),
    [user?.uid, isOrgOwner, canManage, canWork, canQc, canCost, canView]
  )

  return {
    orgId,
    actor: { id: user?.uid || "", name: actorName },
    engineActor,
    ready: !!orgId && !ordersLoading,
    canManage,
    canWork,
    canQc,
    canCost,
    canView,
    seesMoney: canManage || canCost || canView,
    departments,
    products,
    productById,
    orders,
    v2Orders,
    notes,
    notesByOrder,
    requests,
    estimates,
    settings,
    salesOrders,
    stops,
    notices,
    fleet,
    team,
    stock,
    stockRows: stockRead.byWarehouse,
    stockLoading: stockRead.loading,
    warehouses,
    projects,
  }
}

"use client"

// One subscription set for every Manufacturing v2 page: the org's departments,
// product cards, work orders, delivery notes, requests, estimates and settings
// — plus the engine's derived schedule, so every tab shows the same dates.

import { useMemo } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { MFG_DEPARTMENTS, WORK_ORDERS, type MfgDepartment } from "@/lib/manufacturing"
import { DELIVERY_NOTES, type DeliveryNote } from "@/lib/delivery-notes"
import { MANUFACTURING_REQUESTS, type ManufacturingRequest } from "@/lib/sales-orders"
import {
  MFG_COST_ESTIMATES,
  MFG_PRODUCTS,
  MFG_SETTINGS,
  normalizeMfgSettings,
  scheduleOrders,
  type MfgCostEstimate,
  type MfgProduct,
  type MfgSettings,
  type ScheduleInput,
  type ScheduleResult,
} from "@/lib/manufacturing-engine"
import { isV2Order, toNoteSlice, toOrderSlice, type WorkOrderV2 } from "@/lib/manufacturing-writes"

export interface MfgData {
  orgId: string
  actor: { id: string; name: string }
  ready: boolean
  canManage: boolean
  canWork: boolean
  canQc: boolean
  canCost: boolean
  /** Cost and margin visibility. */
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
  schedule: Map<string, ScheduleResult>
  scheduleInputs: ScheduleInput[]
  warehouses: Array<{ id: string; name: string; projectId?: string | null; isCentral?: boolean; isOutbound?: boolean; virtual?: boolean }>
  projects: Array<{ id: string; name: string }>
}

export function useMfgData(): MfgData {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { can } = usePermissions()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const actorName = (profile as { name?: string } | null)?.name || user?.email || ""

  const departmentsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, MFG_DEPARTMENTS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: departmentsData } = useCollection(departmentsQuery)
  const departments = useMemo(
    () => ((departmentsData || []) as MfgDepartment[]).sort((a, b) => a.order - b.order),
    [departmentsData]
  )

  const productsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: productsData } = useCollection(productsQuery)
  const products = useMemo(
    () => ((productsData || []) as MfgProduct[]).sort((a, b) => a.name.localeCompare(b.name, "ar")),
    [productsData]
  )
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: ordersData, isLoading: ordersLoading } = useCollection(ordersQuery)
  const orders = useMemo(
    () => ((ordersData || []) as WorkOrderV2[]).sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0)),
    [ordersData]
  )
  const v2Orders = useMemo(() => orders.filter((o) => isV2Order(o) && productById.has(o.productId || "")), [orders, productById])

  const notesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, DELIVERY_NOTES), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: notesData } = useCollection(notesQuery)
  const notes = useMemo(() => (notesData || []) as DeliveryNote[], [notesData])
  const notesByOrder = useMemo(() => {
    const map = new Map<string, DeliveryNote[]>()
    for (const n of notes) {
      const key = n.source?.workOrderId
      if (!key) continue
      map.set(key, [...(map.get(key) || []), n])
    }
    return map
  }, [notes])

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, MANUFACTURING_REQUESTS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: requestsData } = useCollection(requestsQuery)
  const requests = useMemo(
    () =>
      ((requestsData || []) as ManufacturingRequest[]).sort((a, b) =>
        (a.requestedAt || "") < (b.requestedAt || "") ? 1 : -1
      ),
    [requestsData]
  )

  const estimatesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, MFG_COST_ESTIMATES), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: estimatesData } = useCollection(estimatesQuery)
  const estimates = useMemo(
    () => ((estimatesData || []) as MfgCostEstimate[]).sort((a, b) => ((a.sentAt || "") < (b.sentAt || "") ? 1 : -1)),
    [estimatesData]
  )

  const settingsRef = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return doc(firestore, MFG_SETTINGS, orgId)
  }, [firestore, orgId])
  const { data: settingsData } = useDoc(settingsRef)
  const settings = useMemo(() => normalizeMfgSettings(settingsData as Partial<MfgSettings> | null), [settingsData])

  const warehousesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "warehouses"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: warehousesData } = useCollection(warehousesQuery)
  const warehouses = (warehousesData || []) as MfgData["warehouses"]

  const projectsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "projects"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: projectsData } = useCollection(projectsQuery)
  const projects = (projectsData || []) as Array<{ id: string; name: string }>

  const scheduleInputs = useMemo<ScheduleInput[]>(
    () =>
      v2Orders.map((o) => ({
        order: toOrderSlice(o),
        product: productById.get(o.productId || "") as MfgProduct,
        notes: (notesByOrder.get(o.id) || []).map(toNoteSlice),
      })),
    [v2Orders, productById, notesByOrder]
  )
  const schedule = useMemo(
    () => (settings.features.time ? scheduleOrders(scheduleInputs, departments) : new Map<string, ScheduleResult>()),
    [scheduleInputs, departments, settings.features.time]
  )

  const canManage = can("manufacturing.manage")
  const canCost = can("manufacturing.cost")
  return {
    orgId,
    actor: { id: user?.uid || "", name: actorName },
    ready: !!orgId && !ordersLoading,
    canManage,
    canWork: can("manufacturing.work") || canManage,
    canQc: can("manufacturing.qc") || canManage || canCost,
    canCost,
    seesMoney: canCost || canManage || can("accounting.view") || can("invoices.manage"),
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
    schedule,
    scheduleInputs,
    warehouses,
    projects,
  }
}

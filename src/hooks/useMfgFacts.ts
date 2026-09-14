"use client"

// The workshop's facts as another module reads them — Inventory's
// manufacturing desk, a project's workshop panel, Procurement's routing of a
// purchase request. A lean subset of useMfgData: no stock, no team roles, no
// sales orders — only what those screens show and act on. Manufacturing's own
// screens keep using useMfgData.

import { useMemo } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { MFG_DEPARTMENTS, WORK_ORDERS, type MfgDepartment } from "@/lib/manufacturing"
import { DELIVERY_NOTES } from "@/lib/delivery-notes"
import { MANUFACTURING_REQUESTS, type ManufacturingRequest } from "@/lib/sales-orders"
import {
  MFG_BLOCK_NOTICES,
  MFG_PRODUCTS,
  MFG_SETTINGS,
  normalizeMfgSettings,
  type DeptCapacityFields,
  type MfgProduct,
  type MfgSettings,
} from "@/lib/manufacturing-engine"
import { isV2Order, type Actor, type MfgBlockNotice, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import type { MfgDeliveryNote } from "@/lib/mfg-outside"

export interface MfgFactsWarehouse {
  id: string
  name: string
  projectId?: string | null
  isCentral?: boolean
  isOutbound?: boolean
  virtual?: boolean
}

export type MfgFactsDepartment = MfgDepartment & DeptCapacityFields

export interface MfgFacts {
  orgId: string
  actor: Actor
  ready: boolean
  products: MfgProduct[]
  productById: Map<string, MfgProduct>
  departments: MfgFactsDepartment[]
  /** Product-born orders only (the legacy stage flow has no workshop facts). */
  orders: WorkOrderV2[]
  notes: MfgDeliveryNote[]
  notesByOrder: Map<string, MfgDeliveryNote[]>
  notices: MfgBlockNotice[]
  warehouses: MfgFactsWarehouse[]
  settings: MfgSettings
  requests: ManufacturingRequest[]
}

export interface MfgFactsScope {
  /** Only this project's orders and requests. */
  projectId?: string | null
  orders?: boolean
  notes?: boolean
  notices?: boolean
  warehouses?: boolean
  requests?: boolean
}

export function useMfgFacts(scope: MfgFactsScope = {}): MfgFacts {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const userDocRef = useMemoFirebase(() => (isUserLoading || !user || !firestore ? null : doc(firestore, "users", user.uid)), [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const actorName = (profile as { name?: string } | null)?.name || user?.email || ""
  const projectId = scope.projectId || null

  const orgQuery = (name: string, on: boolean, byProject = false) =>
    firestore && orgId && on
      ? byProject && projectId
        ? query(collection(firestore, name), where("organizationId", "==", orgId), where("projectId", "==", projectId))
        : query(collection(firestore, name), where("organizationId", "==", orgId))
      : null

  const productsQ = useMemoFirebase(() => orgQuery(MFG_PRODUCTS, true), [firestore, orgId])
  const { data: productsData } = useCollection(productsQ)
  const products = useMemo(() => ((productsData || []) as MfgProduct[]).slice().sort((a, b) => a.name.localeCompare(b.name, "ar")), [productsData])
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const departmentsQ = useMemoFirebase(() => orgQuery(MFG_DEPARTMENTS, true), [firestore, orgId])
  const { data: departmentsData } = useCollection(departmentsQ)
  const departments = useMemo(() => ((departmentsData || []) as MfgFactsDepartment[]).slice().sort((a, b) => (a.order || 0) - (b.order || 0)), [departmentsData])

  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, MFG_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settingsData } = useDoc(settingsRef)
  const settings = useMemo(() => normalizeMfgSettings(settingsData as Partial<MfgSettings> | null), [settingsData])

  const ordersQ = useMemoFirebase(() => orgQuery(WORK_ORDERS, !!scope.orders, true), [firestore, orgId, scope.orders, projectId])
  const { data: ordersData, isLoading: ordersLoading } = useCollection(ordersQ)
  const orders = useMemo(
    () => ((ordersData || []) as WorkOrderV2[]).filter((o) => isV2Order(o)).sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0)),
    [ordersData]
  )

  const notesQ = useMemoFirebase(() => orgQuery(DELIVERY_NOTES, !!scope.notes), [firestore, orgId, scope.notes])
  const { data: notesData, isLoading: notesLoading } = useCollection(notesQ)
  const notes = useMemo(() => ((notesData || []) as MfgDeliveryNote[]).slice().sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || "")), [notesData])
  const notesByOrder = useMemo(() => {
    const map = new Map<string, MfgDeliveryNote[]>()
    for (const n of notes) {
      const key = n.source?.workOrderId
      if (key) map.set(key, [...(map.get(key) || []), n])
    }
    return map
  }, [notes])

  const noticesQ = useMemoFirebase(() => orgQuery(MFG_BLOCK_NOTICES, !!scope.notices), [firestore, orgId, scope.notices])
  const { data: noticesData } = useCollection(noticesQ)
  const notices = useMemo(() => ((noticesData || []) as MfgBlockNotice[]).slice().sort((a, b) => (a.at < b.at ? 1 : -1)), [noticesData])

  const warehousesQ = useMemoFirebase(() => orgQuery("warehouses", !!scope.warehouses), [firestore, orgId, scope.warehouses])
  const { data: warehousesData } = useCollection(warehousesQ)
  const warehouses = useMemo(() => ((warehousesData || []) as MfgFactsWarehouse[]).slice().sort((a, b) => Number(!!b.isCentral) - Number(!!a.isCentral) || a.name.localeCompare(b.name, "ar")), [warehousesData])

  const requestsQ = useMemoFirebase(() => orgQuery(MANUFACTURING_REQUESTS, !!scope.requests, true), [firestore, orgId, scope.requests, projectId])
  const { data: requestsData } = useCollection(requestsQ)
  const requests = useMemo(() => ((requestsData || []) as ManufacturingRequest[]).slice().sort((a, b) => ((a.requestedAt || "") < (b.requestedAt || "") ? 1 : -1)), [requestsData])

  return {
    orgId,
    actor: { id: user?.uid || "", name: actorName },
    ready: !!orgId && !(scope.orders && ordersLoading) && !(scope.notes && notesLoading),
    products,
    productById,
    departments,
    orders,
    notes,
    notesByOrder,
    notices,
    warehouses,
    settings,
    requests,
  }
}

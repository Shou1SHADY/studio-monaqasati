"use client"

// «مواقع التسليم» as the company has them: the stored ones, its warehouses and, with Project Management,
// its projects. One reader for the settings, the orders list and the reports (PUR-10).

import { useMemo } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { deliverySites, storedSites, type DeliverySite } from "@/lib/procurement/delivery-sites"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"

export function useDeliverySiteList(orgId: string | null | undefined, pmOn: boolean, enabled = true): { sites: DeliverySite[]; stored: DeliverySite[] } {
  const firestore = useFirestore()
  const settingsRef = useMemoFirebase(() => (firestore && orgId && enabled ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId, enabled])
  const { data: settingsDoc } = useDoc(settingsRef)
  const warehousesQ = useMemoFirebase(() => (firestore && orgId && enabled ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId, enabled])
  const { data: warehouseDocs } = useCollection<{ name?: string; location?: string | null; projectId?: string | null }>(warehousesQ)
  const projectsQ = useMemoFirebase(() => (firestore && orgId && enabled && pmOn ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId, enabled, pmOn])
  const { data: projectDocs } = useCollection<{ name?: string; location?: string | null }>(projectsQ)
  const stored = useMemo(() => storedSites((settingsDoc as { deliverySites?: unknown } | null)?.deliverySites), [settingsDoc])
  const sites = useMemo(() => deliverySites({ stored, warehouses: warehouseDocs || [], projects: projectDocs || [], pmOn }), [stored, warehouseDocs, projectDocs, pmOn])
  return { sites, stored }
}

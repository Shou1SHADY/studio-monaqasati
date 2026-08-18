"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { collection, doc, query, setDoc, serverTimestamp, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"

export type OrgWarehouse = {
  id: string
  name: string
  location: string
  description?: string | null
  organizationId: string
  projectId?: string | null
  projectName?: string | null
  isCentral?: boolean
}

/**
 * Every company has exactly ONE central warehouse — the master stock that all
 * project warehouses draw from. It's created lazily the first time any screen
 * needs it, under the deterministic id `central_{orgId}`, so concurrent tabs
 * can never produce duplicates (they all write the same doc).
 */
export function useCentralWarehouse(orgId: string | undefined) {
  const firestore = useFirestore()
  const t = useTranslations("Portal.Contractor")
  const attempted = useRef(false)

  const warehousesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "warehouses"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data, isLoading } = useCollection(warehousesQuery)
  const warehouses = (data || []) as OrgWarehouse[]

  const central = warehouses.find((w) => w.isCentral) || null
  const projectWarehouses = warehouses.filter((w) => !w.isCentral)

  useEffect(() => {
    if (isLoading || central || !firestore || !orgId || attempted.current) return
    attempted.current = true
    setDoc(doc(firestore, "warehouses", `central_${orgId}`), {
      name: t("wh_central_name"),
      location: t("wh_central_location"),
      description: t("wh_central_desc"),
      organizationId: orgId,
      isCentral: true,
      projectId: null,
      projectName: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((err) => console.error("central warehouse creation failed:", err))
  }, [isLoading, central, firestore, orgId, t])

  return { central, projectWarehouses, allWarehouses: warehouses, isLoading }
}

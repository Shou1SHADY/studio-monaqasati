"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { addDoc, collection, doc, query, setDoc, serverTimestamp, where } from "firebase/firestore"
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
  /** Central warehouses only — the city/region this central serves. */
  city?: string | null
  /** Project warehouses only — which central they draw from and return to. */
  centralWarehouseId?: string | null
}

/**
 * A company can have more than one central warehouse — typically one per city,
 * each feeding the project warehouses in that region. The first central is
 * still created lazily (deterministic id `central_{orgId}`, so concurrent tabs
 * can't duplicate it) to keep zero-setup UX for single-city companies; a
 * second+ central is created explicitly via `createCentralWarehouse` since it
 * needs a city picked.
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

  const centrals = warehouses.filter((w) => w.isCentral)
  // Back-compat singular accessor for callers that only ever dealt with one central.
  const central = centrals[0] || null
  const projectWarehouses = warehouses.filter((w) => !w.isCentral)

  useEffect(() => {
    if (isLoading || centrals.length > 0 || !firestore || !orgId || attempted.current) return
    attempted.current = true
    setDoc(doc(firestore, "warehouses", `central_${orgId}`), {
      name: t("wh_central_name"),
      location: t("wh_central_location"),
      description: t("wh_central_desc"),
      organizationId: orgId,
      isCentral: true,
      city: null,
      projectId: null,
      projectName: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((err) => console.error("central warehouse creation failed:", err))
  }, [isLoading, centrals.length, firestore, orgId, t])

  return { central, centrals, projectWarehouses, allWarehouses: warehouses, isLoading }
}

/** Explicit creation for a second (or later) central warehouse — requires a city. */
export async function createCentralWarehouse(params: {
  firestore: import("firebase/firestore").Firestore
  organizationId: string
  name: string
  city: string
}): Promise<string> {
  const ref = await addDoc(collection(params.firestore, "warehouses"), {
    name: params.name,
    location: params.city,
    description: null,
    organizationId: params.organizationId,
    isCentral: true,
    city: params.city,
    projectId: null,
    projectName: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Which central should a project (in the given region) draw from? A single
 * central serves everyone regardless of city (today's common case); with
 * multiple centrals, match by city — ambiguous cases (no match) return null
 * and the caller should ask rather than guess.
 */
export function resolveCentralForRegion(centrals: OrgWarehouse[], region: string | null | undefined): OrgWarehouse | null {
  if (centrals.length === 0) return null
  if (centrals.length === 1) return centrals[0]
  return centrals.find((c) => c.city === region) || null
}

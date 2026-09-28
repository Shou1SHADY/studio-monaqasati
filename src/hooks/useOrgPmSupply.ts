"use client"

// Inventory's view of the org's PM projects: their store ledgers (returns
// waiting on a main warehouse) and their material requests (lines waiting on
// Inventory's reply). Both live under each project and carry no org-wide
// query, so there is one listener per open PM project and collection.

import { useEffect, useMemo, useState } from "react"
import { collection, onSnapshot, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { projectArchived, type DeskProject } from "@/lib/inventory/project-supply"
import { PM_STORE, storeLineOf, type PmStoreLine } from "@/lib/pm/store"
import { PURCHASE_REQUESTS, requestOf, type PmMaterialRequest } from "@/lib/pm/supply"

type ProjectDoc = { id: string; name?: string; pm?: { no?: string | null; lifecycle?: string | null } | null }

export interface OrgPmSupply {
  loading: boolean
  projects: DeskProject[]
  stores: Record<string, PmStoreLine[]>
  requests: Record<string, PmMaterialRequest[]>
}

export function useOrgPmSupply(orgId: string | null, want: { stores?: boolean; requests?: boolean }): OrgPmSupply {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data, isLoading } = useCollection(q)
  const projects = useMemo(
    () =>
      ((data || []) as ProjectDoc[])
        .filter((p) => p.pm && !projectArchived(p))
        .map((p) => ({ id: p.id, name: p.name || "", no: p.pm?.no ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data]
  )
  const ids = projects.map((p) => p.id).join(",")
  const [stores, setStores] = useState<Record<string, PmStoreLine[]>>({})
  const [requests, setRequests] = useState<Record<string, PmMaterialRequest[]>>({})

  useEffect(() => {
    if (!firestore || !ids || !want.stores) return
    const unsubs = ids.split(",").map((id) =>
      onSnapshot(
        collection(firestore, "projects", id, PM_STORE),
        (snap) => setStores((prev) => ({ ...prev, [id]: snap.docs.map((d) => storeLineOf(d.id, d.data() as Partial<PmStoreLine>)) })),
        (err) => console.warn("project store read failed:", id, err.code)
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [firestore, ids, want.stores])

  useEffect(() => {
    if (!firestore || !ids || !want.requests) return
    const unsubs = ids.split(",").map((id) =>
      onSnapshot(
        query(collection(firestore, "projects", id, PURCHASE_REQUESTS), where("pm", "==", true)),
        (snap) => setRequests((prev) => ({ ...prev, [id]: snap.docs.map((d) => requestOf({ id: d.id, ...(d.data() as Record<string, unknown>) })) })),
        (err) => console.warn("project requests read failed:", id, err.code)
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [firestore, ids, want.requests])

  return { loading: isLoading, projects, stores, requests }
}

"use client"

// What a PM project's Supply screens read: its material requests (the same
// `purchaseRequests` documents Procurement's needs desk reads), its store
// ledger, its programme activities, and the organisation's price history — the
// cost the "where the materials went" figures and change estimates use.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { PM_ACTIVITIES, type PmActivity } from "@/lib/pm/programme"
import { PM_STORE, storeLineOf, type PmStoreLine } from "@/lib/pm/store"
import { PURCHASE_REQUESTS, requestOf, type PmMaterialRequest } from "@/lib/pm/supply"
import { lastPaid, PRICE_HISTORY, type PriceHistoryEntry } from "@/lib/procurement/prices"

export interface SupplyWorld {
  requests: PmMaterialRequest[]
  stores: PmStoreLine[]
  activities: PmActivity[]
  history: PriceHistoryEntry[]
  costOf: (x: Pick<PmStoreLine, "name" | "unit">) => number | null
  loading: boolean
}

export function useSupplyWorld(projectId: string, orgId: string | null | undefined): SupplyWorld {
  const firestore = useFirestore()
  const rq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PURCHASE_REQUESTS) : null), [firestore, projectId])
  const sq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_STORE) : null), [firestore, projectId])
  const aq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ACTIVITIES) : null), [firestore, projectId])
  const hq = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PRICE_HISTORY), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: rData, isLoading: rl } = useCollection(rq)
  const { data: sData, isLoading: sl } = useCollection(sq)
  const { data: aData } = useCollection(aq)
  const { data: hData } = useCollection(hq)

  return useMemo(() => {
    const requests = ((rData ?? []) as Array<Record<string, unknown> & { id: string }>).map(requestOf).sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "") || (b.seq ?? 0) - (a.seq ?? 0))
    const stores = ((sData ?? []) as Array<Partial<PmStoreLine> & { id: string }>).map((d) => storeLineOf(d.id, d))
    const activities = (aData ?? []) as unknown as PmActivity[]
    const history = (hData ?? []) as unknown as PriceHistoryEntry[]
    const costOf = (x: Pick<PmStoreLine, "name" | "unit">) => lastPaid(history, x.name, x.unit)?.price ?? null
    return { requests, stores, activities, history, costOf, loading: rl || sl }
  }, [rData, sData, aData, hData, rl, sl])
}

"use client"

import { collection, query, where, type Firestore } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { PROCUREMENT_RECEIVERS, type ProcReceiver } from "@/lib/procurement/receivers"

/**
 * The org's receiver register (PRD §4 `RCVR`).
 *
 * Read by the forward dialog, which offers the people named for the delivery's
 * place, and by Procurement settings, which keeps it. Small by nature — a
 * handful of store keepers and site receivers — so it loads whole and every
 * screen filters it itself.
 */
export function useProcReceivers(organizationId: string | null | undefined): { receivers: ProcReceiver[]; ready: boolean } {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore as Firestore, PROCUREMENT_RECEIVERS), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data, isLoading } = useCollection<Omit<ProcReceiver, "id">>(q)
  return { receivers: ((data || []) as ProcReceiver[]).filter((r) => r && r.name), ready: Boolean(organizationId) && !isLoading }
}

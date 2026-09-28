"use client"

// The org's PM boundary events Procurement reads from the projects' outbox
// (`pmEvents` SRET · NOPO · EQH), with the project's name filled in where the
// event carries only its number.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { PM_EVENTS } from "@/lib/pm/events"
import { PM_BOUNDARY_KINDS, type PmBoundaryFact } from "@/lib/procurement/today"

export function usePmBoundaryEvents(orgId: string | null | undefined): PmBoundaryFact[] {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PM_EVENTS), where("organizationId", "==", orgId), where("kind", "in", [...PM_BOUNDARY_KINDS])) : null), [firestore, orgId])
  const { data } = useCollection(q)
  const pq = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: projects } = useCollection(pq)
  return useMemo(() => {
    const names = new Map(((projects || []) as Array<{ id: string; name?: string }>).map((p) => [p.id, p.name || ""]))
    return ((data || []) as unknown as PmBoundaryFact[]).map((e) => ({ ...e, params: { ...(e.params || {}), project: (e.params?.project as string) || names.get(e.projectId) || "" } }))
  }, [data, projects])
}

"use client"

// Every project's internal purchase requests, live, for Procurement's incoming
// needs. They live under each project (`projects/{id}/purchaseRequests`) and
// carry no organisation id, so there is no one query across them: one listener
// per project of the organisation.

import { useEffect, useMemo, useState } from "react"
import { collection, onSnapshot, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { ProjectRequestDoc } from "@/lib/procurement/needs"

export interface ProjectRequests {
  project: { id: string; name: string }
  requests: ProjectRequestDoc[]
}

export function useProjectPurchaseRequests(orgId: string | null, enabled = true): { rows: ProjectRequests[]; loading: boolean } {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId && enabled ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId, enabled])
  const { data, isLoading } = useCollection(q)
  const projects = useMemo(() => ((data || []) as Array<{ id: string; name?: string }>).map((p) => ({ id: p.id, name: p.name || "" })), [data])
  const ids = projects.map((p) => p.id).join(",")
  const [byProject, setByProject] = useState<Record<string, ProjectRequestDoc[]>>({})

  useEffect(() => {
    if (!firestore || !ids) return
    const unsubs = ids.split(",").map((id) =>
      onSnapshot(
        collection(firestore, "projects", id, "purchaseRequests"),
        (snap) => setByProject((prev) => ({ ...prev, [id]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProjectRequestDoc, "id">) })) })),
        (err) => console.warn("project requests read failed:", id, err.code)
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [firestore, ids])

  const rows = useMemo(() => projects.map((project) => ({ project, requests: byProject[project.id] || [] })), [projects, byProject])
  return { rows, loading: isLoading }
}

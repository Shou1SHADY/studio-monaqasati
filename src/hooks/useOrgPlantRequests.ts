"use client"

// The equipment desk's view of the company's PM projects: every approved
// equipment request (`projects/{id}/pmPlantRequests`, status `go`), waiting for
// an answer or answered. The requests carry no company-wide query, so there is
// one listener per open PM project — the same fan-out Inventory's material-
// request desk uses (useOrgPmSupply).

import { useEffect, useMemo, useState } from "react"
import { collection, onSnapshot, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { projectArchived, type DeskProject } from "@/lib/inventory/project-supply"
import type { DeskRequest } from "@/lib/pm/plant-desk"
import { PM_PLANT, type PmPlantRequest } from "@/lib/pm/supply"

type ProjectDoc = { id: string; name?: string; pm?: { no?: string | null; lifecycle?: string | null } | null }

export interface OrgPlantRequests {
  loading: boolean
  projects: DeskProject[]
  rows: DeskRequest[]
}

export function useOrgPlantRequests(orgId: string | null): OrgPlantRequests {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data, isLoading } = useCollection(q)
  const projects = useMemo<DeskProject[]>(
    () =>
      ((data || []) as ProjectDoc[])
        .filter((p) => p.pm && !projectArchived(p))
        .map((p) => ({ id: p.id, name: p.name || "", no: p.pm?.no ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data]
  )
  const ids = projects.map((p) => p.id).join(",")
  const [byProject, setByProject] = useState<Record<string, PmPlantRequest[]>>({})
  const [settled, setSettled] = useState<Record<string, true>>({})

  useEffect(() => {
    if (!firestore || !ids) return
    const unsubs = ids.split(",").map((id) =>
      onSnapshot(
        query(collection(firestore, "projects", id, PM_PLANT), where("status", "==", "go")),
        (snap) => {
          setByProject((prev) => ({ ...prev, [id]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PmPlantRequest, "id">) })) }))
          setSettled((prev) => ({ ...prev, [id]: true }))
        },
        (err) => {
          console.warn("project equipment requests read failed:", id, err.code)
          setSettled((prev) => ({ ...prev, [id]: true }))
        }
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [firestore, ids])

  const rows = useMemo<DeskRequest[]>(
    () => projects.flatMap((p) => (byProject[p.id] ?? []).map((r) => ({ ...r, projectId: p.id, projectName: p.name, projectNo: p.no }))),
    [projects, byProject]
  )
  const loading = isLoading || (projects.length > 0 && projects.some((p) => !settled[p.id]))
  return { loading, projects, rows }
}

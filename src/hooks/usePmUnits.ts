"use client"

import { useMemo } from "react"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { PM_UNITS, type PmUnit } from "@/lib/pm/units"

/** The project's delivery units, in their order. */
export function usePmUnits(projectId: string, enabled: boolean): { units: PmUnit[]; isLoading: boolean } {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && enabled ? collection(firestore, "projects", projectId, PM_UNITS) : null), [firestore, projectId, enabled])
  const { data, isLoading } = useCollection(q)
  const units = useMemo(
    () =>
      ((data ?? []) as unknown as Array<Omit<PmUnit, "id"> & { id: string }>)
        .map((u) => ({ id: u.id, seq: u.seq, name: u.name, plan: u.plan ?? null, ho: u.ho ?? null, lines: u.lines ?? {} }))
        .sort((a, b) => a.seq - b.seq),
    [data]
  )
  return { units, isLoading: enabled && isLoading }
}

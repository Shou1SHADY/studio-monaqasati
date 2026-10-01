"use client"

import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"

/** The project's PJ number (`pm.no`, «PJ-2026/014») that Execution records carry in their shown number. */
export function usePmProjectNo(projectId: string): string | null {
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore ? doc(firestore, "projects", projectId) : null), [firestore, projectId])
  const { data } = useDoc<{ pm?: { no?: string | null } | null }>(ref)
  return data?.pm?.no ?? null
}

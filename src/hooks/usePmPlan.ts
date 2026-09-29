"use client"

// The project's planned line, the same on every screen (the prototype's pPlan):
// the current baseline — the duration plus the extensions granted — shaped by
// the programme's S-curve (programmeK), linear when there are no activities.
// The head, the Pulse's penalty note, Claims and the decisions all read it, so
// "points behind" is one number wherever it shows.

import { useMemo } from "react"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { grantedDays, PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { todayDay } from "@/lib/pm/format"
import { PM_ACTIVITIES, programmeK, type PmActivity } from "@/lib/pm/programme"

export interface PmPlan {
  /** Duration + granted extensions, in days. */
  effectiveDays: number
  /** The S-curve's shape (1 = linear). */
  curveK: number
  granted: number
}

export function usePmPlan(
  projectId: string,
  project: { pm?: { startedAt?: string | null; durationDays?: number } | null } | null,
  items: Array<{ id: string; quantity: number; rate: number }>
): PmPlan {
  const firestore = useFirestore()
  const on = Boolean(project?.pm)
  const claimQ = useMemoFirebase(() => (firestore && on ? collection(firestore, "projects", projectId, PM_CLAIMS) : null), [firestore, projectId, on])
  const actQ = useMemoFirebase(() => (firestore && on ? collection(firestore, "projects", projectId, PM_ACTIVITIES) : null), [firestore, projectId, on])
  const { data: claims } = useCollection(claimQ)
  const { data: acts } = useCollection(actQ)
  return useMemo(() => {
    const granted = grantedDays((claims ?? []) as unknown as PmClaim[])
    const durationDays = project?.pm?.durationDays ?? 0
    const effectiveDays = durationDays + granted
    const curveK = programmeK({ acts: (acts ?? []) as unknown as PmActivity[], items, startOn: project?.pm?.startedAt ?? null, durationDays: effectiveDays, today: todayDay() })
    return { effectiveDays, curveK, granted }
  }, [claims, acts, items, project])
}

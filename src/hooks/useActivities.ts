"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { ACTIVITIES, activityFromDoc, countsOf, groupMine, type Activity, type ActivityCounts, type ActivityGroups } from "@/lib/activities"
import { todayDay } from "@/lib/pm/format"

export interface ActivitiesState {
  loading: boolean
  activities: Activity[]
}

/** Every activity of the company — the list, the per-document panel and the badge all read from it. */
export function useActivities(organizationId: string | null | undefined): ActivitiesState {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && organizationId ? query(collection(firestore, ACTIVITIES), where("organizationId", "==", organizationId)) : null), [firestore, organizationId])
  const { data, isLoading } = useCollection(q)
  const activities = useMemo(() => ((data || []) as Array<{ id: string } & Record<string, unknown>>).map(({ id, ...rest }) => activityFromDoc(id, rest)), [data])
  return { loading: isLoading, activities }
}

export interface MyActivities extends ActivitiesState {
  groups: ActivityGroups
  counts: ActivityCounts
}

export function useMyActivities(organizationId: string | null | undefined, uid: string | null | undefined): MyActivities {
  const { loading, activities } = useActivities(organizationId)
  const today = todayDay()
  const groups = useMemo(() => groupMine(activities, uid ?? "", today), [activities, uid, today])
  return { loading, activities, groups, counts: countsOf(groups) }
}

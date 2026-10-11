"use client"

import { useMyActivities } from "@/hooks/useActivities"
import { useQueueTasks } from "@/hooks/useQueueTasks"
import type { ActivityCounts } from "@/lib/activities"
import type { ActivityPortal } from "@/lib/activity-writes"
import { todoCounts } from "@/lib/work-queue-tasks"

/** My open activities plus the derived queue tasks, bucketed. The queue is best-effort: `loading` follows the activities only. */
export function useMyTodoCounts(organizationId: string | null | undefined, uid: string | null | undefined, portal: ActivityPortal): { loading: boolean; counts: ActivityCounts } {
  const { loading, groups } = useMyActivities(organizationId, uid)
  const { tasks } = useQueueTasks(organizationId, uid, portal)
  return { loading, counts: todoCounts(groups, tasks) }
}

"use client"

import { useMemo } from "react"
import { useWorkQueue } from "@/hooks/useWorkQueue"
import { useModules } from "@/hooks/useCompanyModules"
import { usePermissions } from "@/hooks/usePermissions"
import type { ActivityPortal } from "@/lib/activity-writes"
import { applyModuleSwitches } from "@/lib/company-modules"
import { riyadhDay } from "@/lib/hr/format"
import { CONTRACTOR_COMPONENTS } from "@/lib/portal-components"
import { queueTasks, type QueueTask } from "@/lib/work-queue-tasks"

export interface QueueTasksState {
  loading: boolean
  tasks: QueueTask[]
}

/** The home page's "needs your action" queue as to-dos, derived live from the records. Contractors only: the supplier portal has no queue. */
export function useQueueTasks(organizationId: string | null | undefined, uid: string | null | undefined, portal: ActivityPortal): QueueTasksState {
  const contractor = portal === "contractor"
  const { can, isOrgOwner } = usePermissions()
  const modules = useModules()
  const { items, isLoading } = useWorkQueue(contractor ? organizationId : null, contractor ? uid : null, { isOrgOwner, manufacturing: modules.on("manufacturing") })
  const components = useMemo(() => applyModuleSwitches(CONTRACTOR_COMPONENTS, modules.off, "contractor"), [modules.off])
  if (!contractor) return { loading: false, tasks: [] }
  return { loading: isLoading, tasks: queueTasks(items, { can, modules, components, today: riyadhDay() }) }
}

"use client"

// The team requests still before Procurement that the signed-in member may read (REQ-05): read from the server
// (/api/procurement/team-requests), which alone reads `procTeamApprovals`. Off with Projects (the project manager approves there).

import { useCallback, useEffect, useState } from "react"
import { useUser } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { fetchTeamApprovals } from "@/lib/procurement/team-approval-client"
import type { TeamApprovalView } from "@/lib/procurement/team-approval"

export function useTeamApprovals(refreshKey: number | string = 0): { approvals: TeamApprovalView[]; loading: boolean; reload: () => Promise<void> } {
  const { user } = useUser()
  const { on, loading: modulesLoading } = useModules()
  const enabled = !!user && !modulesLoading && !on("project-management")
  const [approvals, setApprovals] = useState<TeamApprovalView[]>([])
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    if (!enabled) {
      setApprovals([])
      setLoading(false)
      return
    }
    const list = await fetchTeamApprovals()
    setApprovals(list || [])
    setLoading(false)
  }, [enabled])
  useEffect(() => {
    void reload()
  }, [reload, refreshKey])
  return { approvals, loading, reload }
}

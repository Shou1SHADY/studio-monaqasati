"use client"

// Who works Procurement in this company, read once: the buyers with the
// categories each buys (`users/{uid}.procurementCategories`, edited on the team
// page), whether the owner has a procurement team (then he reads and approves
// what is routed to him — the prototype's owner), and the viewer's own
// categories when he is a buyer. Light: members and groups only, so the
// suppliers page and the header need not load the whole needs desk.

import { useMemo } from "react"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { usePermissions } from "@/hooks/usePermissions"
import { can as resolveCan, type TeamGroup } from "@/lib/permissions"
import { procTeam, type ProcTeam } from "@/lib/procurement/team"
import type { ProcActor } from "@/lib/procurement/types"

export function useProcTeam(orgId: string | null | undefined, actor: Pick<ProcActor, "isOwner" | "canApprove" | "canPrepare">): ProcTeam & { loading: boolean } {
  const { profile, groups, isLoading } = usePermissions()
  const { orgMembers, isLoading: membersLoading } = useOrgMembers(orgId || null)
  const team = useMemo(
    () =>
      procTeam(
        orgMembers.map((m) => ({
          id: m.id,
          name: (m.name as string) || (m.email as string) || "",
          procurementCategories: m.procurementCategories,
          can: (p) => resolveCan(p, { organizationRole: (m.organizationRole as string | null | undefined) ?? null, defaultGroupId: (m.defaultGroupId as string | undefined) || null, groups: groups as TeamGroup[] }),
          isOwner: m.id === orgId || m.organizationRole === "owner",
        })),
        actor,
        (profile as Record<string, unknown> | null)?.procurementCategories
      ),
    [orgMembers, groups, orgId, actor, profile]
  )
  return { ...team, loading: isLoading || membersLoading }
}

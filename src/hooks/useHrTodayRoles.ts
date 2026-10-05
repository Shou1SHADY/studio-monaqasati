"use client"

// HR 1.0 — which HR roles the company's members hold (read from each member's
// DEFAULT group, as access.ts reads the viewer's): the build path counts the
// team, "what turned out missing" names the empty roles, and government
// relations' rows and tab fall to the HR manager when nobody holds that role.
// `on: false` reads nothing (the members list is the HR manager's to read).

import { useMemo } from "react"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { usePermissions } from "@/hooks/usePermissions"
import { hrRolesOf, type HrRole } from "@/lib/hr/access"

export interface HeldRoles {
  held: Set<HrRole>
  /** Members (the owner aside) holding any HR role. */
  members: number
  isLoading: boolean
}

export function useHrTodayRoles(access: Pick<HrAccess, "orgId">, on: boolean): HeldRoles {
  const { groups } = usePermissions()
  const { orgMembers, isLoading } = useOrgMembers(on ? access.orgId : null)
  return useMemo(() => {
    const held = new Set<HrRole>()
    let members = 0
    for (const m of orgMembers) {
      if (m.id === access.orgId || m.organizationRole === "owner") continue
      const g = groups.find((x) => x.id === (m.defaultGroupId as string | undefined))
      const r = hrRolesOf({ owner: false, permissions: (g?.permissions as string[] | undefined) ?? [] })
      if (r.size) members++
      r.forEach((x) => held.add(x))
    }
    return { held, members, isLoading: on && isLoading }
  }, [orgMembers, groups, access.orgId, on, isLoading])
}

"use client"

// PM 1.0 — who is looking at this project, in the guard's terms (PRD §3–4).
// The ceiling is the company's (the default group's system role, never a
// project-level group), the seat is this project's `members/{uid}` doc, and an
// archived project is read-only for everyone. Screens ask `allowed(action)`;
// every write asks `assertPm` again with what it just read — the button is a
// convenience, the write and the rules are the guard (RL-02).

import { useMemo } from "react"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import {
  effectiveDuties,
  pmCan,
  pmCeiling,
  pmRefusal,
  seatActive,
  seatFromMember,
  type PmAction,
  type PmContext,
  type PmKey,
} from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"

export interface PmAccess {
  ctx: PmContext
  uid: string | null
  isLoading: boolean
  /** The duties this person holds here (null when not on the team). */
  duties: ReturnType<typeof effectiveDuties>
  allowed: (action: PmAction) => boolean
  refusal: (action: PmAction) => ReturnType<typeof pmRefusal>
  has: (key: PmKey) => boolean
}

/** The PM context for a stored project: archived = its lifecycle is `closed`. */
export function pmArchived(project: { pm?: { lifecycle?: string | null } | null; status?: string | null } | null | undefined): boolean {
  return Boolean(project?.pm) && lifecycleOf(project ?? {}) === "closed"
}

type PmProjectLike = { pm?: { lifecycle?: string | null } | null; status?: string | null; projectManagerId?: string | null }

export function usePmAccess(projectId: string | undefined, project: PmProjectLike | null | undefined): PmAccess {
  const { user } = useUser()
  const { isOrgOwner, profile, groups, projectMember, isLoading } = usePermissions(projectId)
  const defaultGroupId = (profile?.defaultGroupId as string | undefined) ?? null
  const archived = pmArchived(project)
  const managerless = Boolean(project?.pm) && !project?.projectManagerId

  return useMemo(() => {
    const group = groups.find((g) => g.id === defaultGroupId)
    const ceiling = pmCeiling({ owner: isOrgOwner, permissions: group?.permissions ?? [] })
    const seat = seatFromMember(projectMember, user?.uid)
    const live = seat && seatActive(seat, todayDay()) ? seat : null
    const ctx: PmContext = { ceiling, seat: live, archived, managerless }
    return {
      ctx,
      uid: user?.uid ?? null,
      isLoading,
      duties: effectiveDuties(ceiling, live),
      allowed: (action) => pmRefusal(ctx, action) === null,
      refusal: (action) => pmRefusal(ctx, action),
      has: (key) => pmCan(ctx, key),
    }
  }, [groups, defaultGroupId, isOrgOwner, projectMember, user?.uid, archived, managerless, isLoading])
}

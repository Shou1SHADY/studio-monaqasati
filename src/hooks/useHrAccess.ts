"use client"

// HR 1.0 — who is looking, in the guard's terms (PRD §3–4). Roles come from the
// caller's DEFAULT group (the company's word, never a project assignment); the
// caller's own employee record gives "My file"; the workplaces he supervises
// scope a supervisor's actions. Screens ask `allowed(action)`; every write asks
// the guard again, and the rules enforce the pay boundary.

import { useMemo } from "react"
import { collection, doc, limit, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { hrAllowed, hrRolesOf, hrTabs, seesPay, type HrAction, type HrContext, type HrTab } from "@/lib/hr/access"
import { HR_EMPLOYEES, HR_SITES } from "@/lib/hr/collections"
import { featureSet, HR_SETTINGS, normalizeHrSettings, type HrSettings } from "@/lib/hr/settings"

export interface HrAccess {
  ctx: HrContext
  orgId: string | null
  settings: HrSettings
  settingsDocExists: boolean
  tabs: HrTab[]
  isLoading: boolean
  allowed: (action: HrAction, scope?: { site?: string | null }) => boolean
  seesPay: (employeeId?: string | null) => boolean
}

export function useHrAccess(): HrAccess {
  const firestore = useFirestore()
  const { user } = useUser()
  const { isOrgOwner, profile, groups, isLoading: permLoading } = usePermissions()
  const orgId = ((profile?.organizationId as string | undefined) || (isOrgOwner ? user?.uid : undefined)) ?? null
  const defaultGroupId = (profile?.defaultGroupId as string | undefined) ?? null

  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, HR_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settingsDoc, isLoading: settingsLoading } = useDoc(settingsRef)

  const meQuery = useMemoFirebase(
    () => (firestore && orgId && user ? query(collection(firestore, HR_EMPLOYEES), where("organizationId", "==", orgId), where("userId", "==", user.uid), limit(1)) : null),
    [firestore, orgId, user]
  )
  const { data: me, isLoading: meLoading } = useCollection(meQuery)

  const sitesQuery = useMemoFirebase(
    () => (firestore && orgId && user ? query(collection(firestore, HR_SITES), where("organizationId", "==", orgId), where("supervisorUserId", "==", user.uid)) : null),
    [firestore, orgId, user]
  )
  const { data: mySites } = useCollection(sitesQuery)

  return useMemo(() => {
    const group = groups.find((g) => g.id === defaultGroupId)
    const settings = normalizeHrSettings(settingsDoc as Partial<HrSettings> | null)
    const ctx: HrContext = {
      uid: user?.uid ?? "",
      owner: isOrgOwner,
      roles: hrRolesOf({ owner: isOrgOwner, permissions: (group?.permissions as string[] | undefined) ?? [] }),
      employeeId: me?.[0]?.id ?? null,
      sites: (mySites ?? []).map((s) => s.id),
    }
    return {
      ctx,
      orgId,
      settings,
      settingsDocExists: Boolean(settingsDoc),
      tabs: hrTabs(ctx, featureSet(settings)),
      isLoading: permLoading || settingsLoading || meLoading,
      allowed: (action, scope) => hrAllowed(ctx, action, scope),
      seesPay: (employeeId) => seesPay(ctx, employeeId),
    }
  }, [groups, defaultGroupId, settingsDoc, user?.uid, isOrgOwner, me, mySites, orgId, permLoading, settingsLoading, meLoading])
}

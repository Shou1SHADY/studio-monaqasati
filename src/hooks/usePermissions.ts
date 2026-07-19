"use client"

// Resolves the current user's team permissions, optionally scoped to a
// project (a project-level group assignment overrides the default group).
// UI-gating only — real enforcement lives in firestore.rules.

import { useMemo } from "react"
import { doc, collection, query, where } from "firebase/firestore"
import { useUser, useFirestore, useDoc, useCollection, useMemoFirebase } from "@/firebase"
import { can as resolveCan, type PermissionId, type TeamGroup } from "@/lib/permissions"

export function usePermissions(projectId?: string) {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile, isLoading: profileLoading } = useDoc(userDocRef)

  const orgId = profile?.organizationId as string | undefined

  const groupsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "teamGroups"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: groups, isLoading: groupsLoading } = useCollection(groupsQuery)

  const projectMemberRef = useMemoFirebase(() => {
    if (!firestore || !user || !projectId) return null
    return doc(firestore, "projects", projectId, "members", user.uid)
  }, [firestore, user, projectId])
  const { data: projectMember, isLoading: projectMemberLoading } = useDoc(projectMemberRef)

  const isLoading =
    isUserLoading || profileLoading || groupsLoading || (projectId ? projectMemberLoading : false)

  const can = useMemo(() => {
    const ctx = {
      organizationRole: (profile?.organizationRole as string) || null,
      defaultGroupId: (profile?.defaultGroupId as string) || null,
      groups: (groups || []) as TeamGroup[],
      projectGroupId: projectId ? ((projectMember?.groupId as string) ?? null) : undefined,
    }
    return (permission: PermissionId) => resolveCan(permission, ctx)
  }, [profile, groups, projectMember, projectId])

  return {
    can,
    isLoading,
    isOrgOwner: profile?.organizationRole === "owner",
    profile,
    groups: (groups || []) as TeamGroup[],
  }
}

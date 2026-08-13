"use client"

import { useFirestore, useCollection, useMemoFirebase } from "@/firebase"
import { collection, query, where } from "firebase/firestore"

export interface OrgMember {
  id: string
  name?: string
  email?: string
  organizationRole?: string
  [key: string]: unknown
}

/** All users belonging to an organization — the pool a project's team can be staffed from. */
export function useOrgMembers(organizationId: string | undefined | null) {
  const firestore = useFirestore()

  const membersQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "users"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data, isLoading } = useCollection(membersQuery)

  return { orgMembers: (data || []) as OrgMember[], isLoading }
}

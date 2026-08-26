"use client"

import { useMemo } from "react"
import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useUser } from "@/firebase"
import { CRM_ORG_PROFILE, type CrmOrgProfile } from "@/lib/crm"

/**
 * The company's classification grades and annual capacity — the two facts that
 * decide whether a deal is worth bidding at all.
 *
 * Stored at `crmOrgProfile/{organizationId}`: a deterministic id, so there is
 * exactly one profile per org and a concurrent first-save cannot create two.
 * It lives in its own CRM-owned collection rather than on the organization or
 * user document, which keeps this module from writing into records other parts
 * of the platform own.
 *
 * Absent is a valid state — a profile nobody has filled in makes eligibility
 * "unknown", never "failed".
 */
export function useCrmOrgProfile() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { organizationId, isLoading: isProfileLoading } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const orgId = organizationId || ""

  const ref = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return doc(firestore, CRM_ORG_PROFILE, orgId)
  }, [firestore, orgId])
  const { data, isLoading } = useDoc(ref)

  const profile = useMemo<CrmOrgProfile | null>(() => {
    if (!data || !orgId) return null
    return { ...(data as Omit<CrmOrgProfile, "id">), id: orgId }
  }, [data, orgId])

  return {
    orgId,
    profile,
    isLoading: isUserLoading || isProfileLoading || isLoading,
  }
}

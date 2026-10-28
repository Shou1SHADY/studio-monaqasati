"use client"

import { useMemo } from "react"
import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { COMPANY_MODULES, type ModulePortal } from "@/lib/company-modules"
import { subscriptionStateOf, type SubscriptionState } from "@/lib/subscription-status"
import { useNow } from "@/hooks/useNow"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"

/** Where the signed-in company stands in its trial. The clock is re-read every minute, so a portal left open locks when the last day ends. */
export function useCompanyTrial(portal: ModulePortal | null): { state: SubscriptionState; loading: boolean } {
  const firestore = useFirestore()
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const ref = useMemoFirebase(() => (firestore && organizationId && portal ? doc(firestore, COMPANY_MODULES, organizationId) : null), [firestore, organizationId, portal])
  const { data, isLoading } = useDoc(ref)
  const now = useNow()
  const state = useMemo(() => subscriptionStateOf(data as { subscription?: unknown; trialEndsAt?: unknown } | null, now), [data, now])
  return { state, loading: Boolean(portal) && (isLoading || (!ref && Boolean(user))) }
}

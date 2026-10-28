"use client"

import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useNow } from "@/hooks/useNow"
import { COMPANY_PLANS, planOf, planTrialOf, type PlanDoc, type SupplierPlan } from "@/lib/supplier-plan"
import type { TrialClock } from "@/lib/subscription-status"

/**
 * Which journey this supplier company is on. `loading` until the plan document has settled, so a page never
 * flashes the wrong one. Anyone who is not a signed-in supplier reads "full": those pages keep doing what they
 * always did (including sending a visitor to the login). `trial` is the paid trial of a «full» company — its plan turns
 * «free» by itself when the days run out, even in a portal left open.
 */
const NO_TRIAL: TrialClock = { phase: "none", endsAt: null, daysLeft: null }

export function useSupplierPlan(): { plan: SupplierPlan; loading: boolean; orgId: string | null; trial: TrialClock } {
  const now = useNow()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { profile, organizationId, isLoading: profileLoading } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const orgId = organizationId || user?.uid || null
  const isSupplier = (profile as { role?: string } | null)?.role === "Supplier"
  const ref = useMemoFirebase(() => (firestore && orgId && isSupplier ? doc(firestore, COMPANY_PLANS, orgId) : null), [firestore, orgId, isSupplier])
  const { data, isLoading } = useDoc(ref)
  if (isUserLoading) return { plan: "full", loading: true, orgId, trial: NO_TRIAL }
  if (!user || user.isAnonymous) return { plan: "full", loading: false, orgId: null, trial: NO_TRIAL }
  if (profileLoading || !profile) return { plan: "full", loading: true, orgId, trial: NO_TRIAL }
  if (!isSupplier) return { plan: "full", loading: false, orgId, trial: NO_TRIAL }
  return { plan: planOf(data as PlanDoc | null, now), loading: isLoading, orgId, trial: planTrialOf(data as PlanDoc | null, now) }
}

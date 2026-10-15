"use client"

import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { COMPANY_PLANS, planOf, type SupplierPlan } from "@/lib/supplier-plan"

/**
 * Which journey this supplier company is on. `loading` until the plan document has settled, so a page never
 * flashes the wrong one. Anyone who is not a signed-in supplier reads "full": those pages keep doing what they
 * always did (including sending a visitor to the login).
 */
export function useSupplierPlan(): { plan: SupplierPlan; loading: boolean; orgId: string | null } {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { profile, organizationId, isLoading: profileLoading } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const orgId = organizationId || user?.uid || null
  const isSupplier = (profile as { role?: string } | null)?.role === "Supplier"
  const ref = useMemoFirebase(() => (firestore && orgId && isSupplier ? doc(firestore, COMPANY_PLANS, orgId) : null), [firestore, orgId, isSupplier])
  const { data, isLoading } = useDoc(ref)
  if (isUserLoading) return { plan: "full", loading: true, orgId }
  if (!user || user.isAnonymous) return { plan: "full", loading: false, orgId: null }
  if (profileLoading || !profile) return { plan: "full", loading: true, orgId }
  if (!isSupplier) return { plan: "full", loading: false, orgId }
  return { plan: planOf(data as { supplierPlan?: unknown } | null), loading: isLoading, orgId }
}

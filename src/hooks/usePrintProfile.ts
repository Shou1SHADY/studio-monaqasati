"use client"

import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { COMPANY_PRINT_PROFILE, type CompanyPrintProfile } from "@/lib/company-print-profile"

/** The active company's print profile: what the owner chose to show on documents the team issues. */
export function usePrintProfile() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { organizationId } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const ref = useMemoFirebase(() => (firestore && organizationId ? doc(firestore, COMPANY_PRINT_PROFILE, organizationId) : null), [firestore, organizationId])
  const { data, isLoading } = useDoc<CompanyPrintProfile>(ref)
  return { orgId: organizationId, crNumber: data?.crNumber ?? "", taxNumber: data?.taxNumber ?? "", isLoading }
}

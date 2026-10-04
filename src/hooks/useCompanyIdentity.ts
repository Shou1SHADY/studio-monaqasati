"use client"

import { useMemo } from "react"
import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { COMPANY_IDENTITY, resolveIdentity, type CompanyIdentity } from "@/lib/company-identity"

/**
 * The company's sensitive identity. Pass `enabled: false` for anyone who is not
 * allowed to read it (a team member) — the rules would refuse, and a refused
 * read is a noisy error, not a quiet blank. Until the move is finished the old
 * profile fields fill any gap.
 */
export function useCompanyIdentity(orgId: string | null | undefined, enabled: boolean, legacyProfile?: Record<string, unknown> | null) {
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore && orgId && enabled ? doc(firestore, COMPANY_IDENTITY, orgId) : null), [firestore, orgId, enabled])
  const { data, isLoading } = useDoc<CompanyIdentity>(ref)
  const identity = useMemo<CompanyIdentity>(() => (enabled ? resolveIdentity(data, legacyProfile) : {}), [enabled, data, legacyProfile])
  return { identity, isLoading: enabled && isLoading }
}

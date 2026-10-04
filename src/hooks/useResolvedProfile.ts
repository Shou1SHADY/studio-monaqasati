"use client"

import { doc } from "firebase/firestore"
import { useFirestore, useDoc, useMemoFirebase } from "@/firebase"
import { identityDocRef, isSecondaryOrg } from "@/lib/org-identity"
import { stripIdentityFields, withCompanyStanding } from "@/lib/identity-fields"

/**
 * Resolves the signed-in user's profile with identity fields (name,
 * companyName, phone, city, CR/tax numbers, legal documents, certificates,
 * specializations, ...) scoped to their ACTIVE organization — so a secondary
 * company added via the company-switcher never shows the primary company's
 * data (or vice versa). Non-identity fields (role, orgMemberships,
 * twoFactorEnabled, email, ...) always come from the signed-in user's own
 * `users/{uid}` doc, which is also where they get written back to on save.
 *
 * Returns `organizationId`/`isSecondary` too, since callers that WRITE
 * identity fields need to know which doc to target.
 */
export function useResolvedProfile(uid: string | undefined | null) {
  const firestore = useFirestore()
  const baseRef = useMemoFirebase(() => {
    if (!firestore || !uid) return null
    return doc(firestore, "users", uid)
  }, [firestore, uid])
  const { data: base, isLoading: baseLoading } = useDoc(baseRef)

  const baseData = base as { organizationId?: string; organizationRole?: string } | null
  const organizationId = baseData?.organizationId
  const organizationRole = baseData?.organizationRole
  const secondary = isSecondaryOrg(organizationId, uid, organizationRole)

  const identityRef = useMemoFirebase(() => {
    if (!firestore || !secondary || !organizationId) return null
    return identityDocRef(firestore, organizationId)
  }, [firestore, secondary, organizationId])
  const { data: identity, isLoading: identityLoading } = useDoc(identityRef)

  // A team member: the company's standing (verified, completed) is the
  // company's — a secondary company keeps it on its organizations/{id} doc, a
  // primary one on the owner's users/{id}. Its legal documents stay the owner's.
  const member = !!organizationId && !!uid && organizationId !== uid && organizationRole === "member"
  const companyOrgRef = useMemoFirebase(() => (firestore && member && organizationId ? identityDocRef(firestore, organizationId) : null), [firestore, member, organizationId])
  const companyUserRef = useMemoFirebase(() => (firestore && member && organizationId ? doc(firestore, "users", organizationId) : null), [firestore, member, organizationId])
  const { data: companyOrg, isLoading: companyOrgLoading } = useDoc(companyOrgRef)
  const { data: companyUser, isLoading: companyUserLoading } = useDoc(companyUserRef)

  const isLoading = baseLoading || (secondary && identityLoading) || (member && (companyOrgLoading || companyUserLoading))
  // Withhold `profile` entirely until BOTH docs have settled for a secondary
  // org — returning the base doc alone the instant it loads (before the
  // overlay listener has fired) would hand callers the WRONG company's data
  // for one render, which is exactly the bug this hook exists to prevent.
  // Consumers with a "sync once into local state" effect (`if (userData &&
  // !localState.name) ...`) would otherwise latch onto that transient,
  // unmerged snapshot and never re-sync once the real data arrives.
  const profile = !base || isLoading
    ? null
    : secondary
      ? { ...stripIdentityFields(base), ...(identity || {}) }
      : member
        ? withCompanyStanding(base, (companyOrg as Record<string, unknown> | null) ?? (companyUser as Record<string, unknown> | null))
        : base

  return {
    profile,
    isLoading,
    organizationId: organizationId || uid || "",
    isSecondary: secondary,
  }
}

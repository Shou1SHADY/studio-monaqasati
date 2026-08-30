"use client"

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore"
import type { OrgMembership } from "@/hooks/useActiveCompanyName"

export type CompanyRole = "Contractor" | "Supplier"

/** The portal a company of this role operates in. */
export function companyPortalPath(role: string | undefined, locale: string): string {
  const portal = role === "Supplier" ? "/supplier" : "/contractor"
  // localePrefix is "as-needed": Arabic (default) has no prefix, others do.
  return (locale === "ar" ? "" : `/${locale}`) + portal
}

export interface SwitchProfile {
  organizationId?: string
  role?: CompanyRole
  primaryRole?: CompanyRole
}

/**
 * The role the account must carry while `targetOrgId` is the active company.
 *
 * This MUST mirror the multi-company-switch branch of the `users/{userId}`
 * update rule in firestore.rules exactly, because that rule re-derives the
 * role from the SAME two sources and rejects the write on any disagreement:
 *
 *   primary org (id == uid)  ->  primaryRole, else the current role
 *   secondary org            ->  organizations/{id}.role, else the current role
 *
 * The membership entry's own `role` is deliberately NOT consulted: the rules
 * never see `orgMemberships`, so trusting it here is what made switching fail
 * with permission-denied whenever the two had drifted apart (a legacy company
 * whose organizations doc predates the role field, or a role-less doc reached
 * from a company that is not the primary one).
 */
export function switchTargetRole(args: {
  targetOrgId: string
  uid: string
  currentRole: CompanyRole
  primaryRole?: CompanyRole
  orgRole?: CompanyRole
}): CompanyRole {
  const { targetOrgId, uid, currentRole, primaryRole, orgRole } = args
  if (targetOrgId === uid) return primaryRole || currentRole
  return orgRole || currentRole
}

export class CompanySwitchError extends Error {
  constructor(
    message: string,
    /** Machine-readable cause, surfaced to the user alongside the toast. */
    readonly code: string
  ) {
    super(message)
    this.name = "CompanySwitchError"
  }
}

/**
 * The machine-readable cause of a failed switch, shown under the generic error
 * toast. Untranslated on purpose: it is a diagnostic handle ("permission-denied",
 * "not-company-owner", ...), not a sentence, and a switch that fails silently is
 * exactly what left this bug undiagnosable from a user report.
 */
export function switchErrorCode(err: unknown): string | undefined {
  if (err instanceof CompanySwitchError) return err.code
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === "string" ? code : undefined
}

/**
 * Point the account's active organization at `membership` and align its role.
 *
 * Returns the role the account now carries, so the caller can navigate to the
 * matching portal. Throws CompanySwitchError when the target company cannot be
 * switched into; every other throw is the raw Firestore error.
 */
export async function switchActiveCompany(args: {
  firestore: Firestore
  uid: string
  membership: OrgMembership
  profile: SwitchProfile | null | undefined
}): Promise<CompanyRole> {
  const { firestore, uid, membership, profile } = args
  const currentRole: CompanyRole = profile?.role || "Contractor"
  const primaryRole: CompanyRole | undefined = profile?.primaryRole
  const targetOrgId = membership.organizationId

  let orgRole: CompanyRole | undefined
  if (targetOrgId !== uid) {
    const orgRef = doc(firestore, "organizations", targetOrgId)
    const orgSnap = await getDoc(orgRef)
    if (!orgSnap.exists()) {
      // A membership whose organizations doc never landed (an interrupted
      // add-company) can otherwise never be switched into again: the rules
      // read ownerUserId off that doc. The account owns this company by its
      // own membership list, so restore the record it should already have.
      orgRole = membership.role || primaryRole || currentRole
      await setDoc(orgRef, {
        name: membership.companyName,
        ownerUserId: uid,
        role: orgRole,
        createdAt: serverTimestamp(),
      })
    } else {
      const orgData = orgSnap.data() as { ownerUserId?: string; role?: CompanyRole }
      if (orgData.ownerUserId !== uid) {
        throw new CompanySwitchError(
          `organizations/${targetOrgId} is owned by ${orgData.ownerUserId ?? "no one"}, not ${uid}`,
          "not-company-owner"
        )
      }
      orgRole = orgData.role
    }
  }

  const targetRole = switchTargetRole({ targetOrgId, uid, currentRole, primaryRole, orgRole })

  await updateDoc(doc(firestore, "users", uid), {
    organizationId: targetOrgId,
    role: targetRole,
    updatedAt: serverTimestamp(),
  })

  return targetRole
}

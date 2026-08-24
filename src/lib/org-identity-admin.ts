// Server-only (Admin SDK) counterpart to src/lib/org-identity.ts — same
// "secondary company" resolution, for API routes that read a user's identity
// fields (companyName, phone, etc.) via firebase-admin instead of the client SDK.

import type { Firestore } from "firebase-admin/firestore"
import { stripIdentityFields } from "@/lib/identity-fields"

export function isSecondaryOrgAdmin(
  organizationId: string | null | undefined,
  uid: string | null | undefined,
  organizationRole?: string | null
): boolean {
  return !!organizationId && !!uid && organizationId !== uid && organizationRole !== "member"
}

/** Resolves a user's identity fields (name, companyName, phone, ...) merged
 * with their ACTIVE organization's overlay when it's a secondary company
 * added via the company-switcher — mirrors useResolvedProfile.ts client-side.
 * `base` is the raw `users/{uid}` doc data the caller already fetched. */
export async function resolveIdentityAdmin(
  db: Firestore,
  uid: string,
  base: Record<string, unknown> | null | undefined
): Promise<Record<string, unknown> | null> {
  if (!base) return null
  const organizationId = base.organizationId as string | undefined
  const organizationRole = base.organizationRole as string | undefined
  if (!isSecondaryOrgAdmin(organizationId, uid, organizationRole)) return base
  const orgSnap = await db.collection("organizations").doc(organizationId as string).get()
  const overlay = orgSnap.data()
  return overlay ? { ...stripIdentityFields(base), ...overlay } : base
}

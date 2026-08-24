"use client"

import { doc, type DocumentReference, type Firestore } from "firebase/firestore"

// A signed-in account's `organizationId` can point at three different kinds
// of doc depending on context — company-identity fields (name/companyName,
// phone, city, CR/tax numbers, legal documents, specializations, ...) must
// resolve to the right one or they bleed between an owner's companies:
//
//  - its own uid (the primary/solo company created at signup)
//      → identity lives on users/{uid} itself
//  - a secondary company added via the company-switcher (organizationRole
//    stays "owner", organizationId is a generated `organizations` doc id —
//    see company-switcher-page.tsx's handleAddCompany)
//      → identity lives on organizations/{organizationId}
//  - the OWNER's uid, for a team member (organizationRole === "member" —
//    see useActiveCompanyName.ts, which already handles this case for the
//    display name specifically)
//      → identity lives on the owner's own users/{organizationId} doc
//
// This module only concerns itself with the SECOND case (secondary
// companies) — that's the one whose identity fields were, until this fix,
// incorrectly stored on the signed-in user's own doc and so bled into every
// other company that same account owns. Team-member resolution is left to
// useActiveCompanyName.ts / useCompanyNameFor, unchanged.

/** True only when `organizationId` refers to a secondary company this
 * account owns via the company-switcher — never true for the primary/solo
 * org, and never true for a team member (whose organizationId points at
 * their owner's uid, not at an `organizations` doc). */
export function isSecondaryOrg(
  organizationId: string | null | undefined,
  uid: string | null | undefined,
  organizationRole?: string | null
): boolean {
  return !!organizationId && !!uid && organizationId !== uid && organizationRole !== "member"
}

/** The doc holding a secondary company's identity fields. Only call this
 * when `isSecondaryOrg(...)` is true — the doc is guaranteed to already
 * exist by then (created by company-switcher-page.tsx at add-company time). */
export function identityDocRef(firestore: Firestore, organizationId: string): DocumentReference {
  return doc(firestore, "organizations", organizationId)
}

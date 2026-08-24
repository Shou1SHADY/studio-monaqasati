"use client"

// The display name of the org a user is currently switched into.
//
// Owners: their own profile's companyName/name, or an orgMemberships entry
// once they've used the multi-company switcher (see company-switcher-page.tsx).
// Members: their OWN profile has no company info at all — the invite-accept
// flow only ever writes organizationId/organizationRole/defaultGroupId onto a
// member's doc, never a companyName. A member's organizationId points at the
// owner's uid, so we fetch that owner's profile doc to read the real name.

import { collection, doc, documentId, query, where } from "firebase/firestore"
import { useFirestore, useDoc, useCollection, useMemoFirebase } from "@/firebase"

export interface OrgMembership {
  organizationId: string
  companyName: string
  isPrimary?: boolean
  // Which portal this company operates in. Legacy entries (created before
  // cross-role companies existed) have no role — treat as the account's role.
  role?: "Contractor" | "Supplier"
}

interface ActiveCompanyProfile {
  organizationId?: string
  organizationRole?: string
  companyName?: string
  name?: string
  orgMemberships?: OrgMembership[]
}

/** Pure, no-fetch resolution — correct for owners, falls back to the member's
 * own (irrelevant) name if used for a member. Prefer useActiveCompanyName. */
export function resolveActiveCompanyName(profile: ActiveCompanyProfile | null | undefined, fallbackOrgId?: string): string | undefined {
  const activeOrgId = profile?.organizationId || fallbackOrgId
  const memberships = profile?.orgMemberships || []
  return memberships.find((m) => m.organizationId === activeOrgId)?.companyName
    || profile?.companyName
    || profile?.name
}

/** Hook version — also correct for members, by fetching the owner's profile when needed. */
export function useActiveCompanyName(profile: ActiveCompanyProfile | null | undefined, userUid: string | undefined): string | undefined {
  const firestore = useFirestore()
  const activeOrgId = profile?.organizationId || userUid
  const isMember = profile?.organizationRole === "member" && !!activeOrgId && activeOrgId !== userUid
  // A secondary company (added via the company-switcher, not a team
  // membership) has its own `organizations/{id}` doc — its `name` there is
  // the live source of truth, since the `orgMemberships` entry below is only
  // a snapshot taken when the company was added and goes stale if renamed.
  const isSecondary = !isMember && !!activeOrgId && !!userUid && activeOrgId !== userUid

  const ownerDocRef = useMemoFirebase(() => {
    if (!firestore || !isMember || !activeOrgId) return null
    return doc(firestore, "users", activeOrgId)
  }, [firestore, isMember, activeOrgId])
  const { data: ownerProfile } = useDoc(ownerDocRef)

  const orgDocRef = useMemoFirebase(() => {
    if (!firestore || !isSecondary || !activeOrgId) return null
    return doc(firestore, "organizations", activeOrgId)
  }, [firestore, isSecondary, activeOrgId])
  const { data: orgProfile } = useDoc(orgDocRef)

  const membershipMatch = (profile?.orgMemberships || []).find((m) => m.organizationId === activeOrgId)?.companyName

  if (isSecondary) {
    const org = orgProfile as { name?: string } | null
    return org?.name || membershipMatch || profile?.companyName || profile?.name
  }

  if (membershipMatch) return membershipMatch

  if (isMember) {
    const owner = ownerProfile as { companyName?: string; name?: string } | null
    return owner?.companyName || owner?.name || profile?.companyName || profile?.name
  }

  return profile?.companyName || profile?.name
}

// --- Resolving names for OTHER users' docs (not the signed-in user) ---
//
// The same "a member's own doc has no companyName" problem shows up whenever
// the app displays someone else's identity from a raw `users/{uid}` doc — a
// supplier's profile page, a directory listing, "who posted this RFQ" — and
// that uid happens to belong to a team member rather than the org owner. The
// fix is the same: if the doc says organizationRole "member", the real name
// lives on the owner's doc at organizationId, not on this one.

interface OtherUserProfile {
  id: string
  organizationId?: string
  organizationRole?: string
  companyName?: string
  name?: string
}

/** Single-profile version — e.g. a "view supplier/contractor profile" page. */
export function useCompanyNameFor(otherProfile: OtherUserProfile | null | undefined): string | undefined {
  const firestore = useFirestore()
  const isMember = otherProfile?.organizationRole === "member"
    && !!otherProfile?.organizationId
    && otherProfile.organizationId !== otherProfile.id

  const ownerDocRef = useMemoFirebase(() => {
    if (!firestore || !isMember || !otherProfile?.organizationId) return null
    return doc(firestore, "users", otherProfile.organizationId)
  }, [firestore, isMember, otherProfile?.organizationId])
  const { data: ownerProfile } = useDoc(ownerDocRef)

  if (isMember) {
    const owner = ownerProfile as { companyName?: string; name?: string } | null
    return owner?.companyName || owner?.name || otherProfile?.companyName || otherProfile?.name
  }
  return otherProfile?.companyName || otherProfile?.name
}

/**
 * Batch version for lists (a supplier/contractor directory, a connections
 * list) — hooks can't run inside `.map()`, so this resolves every member's
 * owner name in one query instead of one hook call per row. Returns a map
 * from each member-profile's id to its resolved company name; owners aren't
 * included (read their own companyName/name directly, no lookup needed).
 *
 * Firestore's `in` operator caps at 30 values — if a screen has more than 30
 * distinct member-owned orgs on it at once, the excess falls back to each
 * member's own name rather than issuing multiple queries.
 */
export function useCompanyNamesForMembers(profiles: OtherUserProfile[]): Map<string, string> {
  const firestore = useFirestore()

  const memberOwnerIds = Array.from(new Set(
    profiles
      .filter((p) => p.organizationRole === "member" && p.organizationId && p.organizationId !== p.id)
      .map((p) => p.organizationId as string)
  )).slice(0, 30)
  const memberOwnerIdsKey = memberOwnerIds.join(",")

  const ownersQuery = useMemoFirebase(() => {
    if (!firestore || memberOwnerIds.length === 0) return null
    return query(collection(firestore, "users"), where(documentId(), "in", memberOwnerIds))
    // memberOwnerIdsKey (not memberOwnerIds) is the real dependency — same ids, same query.
  }, [firestore, memberOwnerIdsKey])
  const { data: owners } = useCollection(ownersQuery)

  const ownerNameById = new Map<string, string>()
  ;(owners || []).forEach((o: any) => {
    ownerNameById.set(o.id, o.companyName || o.name || "")
  })

  const result = new Map<string, string>()
  profiles.forEach((p) => {
    if (p.organizationRole === "member" && p.organizationId && p.organizationId !== p.id) {
      const ownerName = ownerNameById.get(p.organizationId)
      result.set(p.id, ownerName || p.companyName || p.name || "")
    }
  })
  return result
}

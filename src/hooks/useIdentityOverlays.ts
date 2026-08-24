"use client"

import { collection, documentId, query, where } from "firebase/firestore"
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase"
import { isSecondaryOrg } from "@/lib/org-identity"

interface RowLike {
  id: string
  organizationId?: string | null
  organizationRole?: string | null
}

/**
 * Batch-resolves identity overlays for a LIST of `users` docs — a supplier
 * directory, an admin panel — so a secondary company (added via the
 * company-switcher) shows ITS OWN identity fields instead of whichever
 * company its owner happens to be currently switched into. Hooks can't run
 * inside `.map()`, so this issues one batched query for every row's
 * `organizations/{id}` doc instead of one lookup per row.
 *
 * Returns a map from each row's own id to its organization overlay (only
 * rows that are secondary orgs get an entry) — merge it onto the row
 * yourself: `{ ...row, ...(overlays.get(row.id) || {}) }`.
 *
 * Firestore's `in` operator caps at 30 values — secondary companies beyond
 * that per screen fall back to the row's own (possibly stale) fields.
 */
export function useIdentityOverlays<T extends RowLike>(rows: T[]): Map<string, Record<string, unknown>> {
  const firestore = useFirestore()

  const secondaryOrgIds = Array.from(new Set(
    rows
      .filter((r) => isSecondaryOrg(r.organizationId, r.id, r.organizationRole))
      .map((r) => r.organizationId as string)
  )).slice(0, 30)
  const secondaryOrgIdsKey = secondaryOrgIds.join(",")

  const orgsQuery = useMemoFirebase(() => {
    if (!firestore || secondaryOrgIds.length === 0) return null
    return query(collection(firestore, "organizations"), where(documentId(), "in", secondaryOrgIds))
    // secondaryOrgIdsKey (not secondaryOrgIds) is the real dependency — same ids, same query.
  }, [firestore, secondaryOrgIdsKey])
  const { data: orgs } = useCollection(orgsQuery)

  const orgById = new Map<string, Record<string, unknown>>()
  ;(orgs || []).forEach((o: { id: string } & Record<string, unknown>) => { orgById.set(o.id, o) })

  const result = new Map<string, Record<string, unknown>>()
  rows.forEach((r) => {
    if (isSecondaryOrg(r.organizationId, r.id, r.organizationRole)) {
      const overlay = orgById.get(r.organizationId as string)
      if (overlay) result.set(r.id, overlay)
    }
  })
  return result
}

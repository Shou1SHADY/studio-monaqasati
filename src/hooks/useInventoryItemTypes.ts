"use client"

import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { CustomItemType } from "@/lib/inventory-types"

/**
 * The org's custom inventory item types (beyond the built-in materials /
 * equipment). Org-scoped, not per-warehouse — the same sections appear in
 * every warehouse the company owns.
 */
export function useInventoryItemTypes(orgId: string | undefined) {
  const firestore = useFirestore()

  const typesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "inventoryItemTypes"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data, isLoading } = useCollection(typesQuery)

  return { customTypes: (data || []) as CustomItemType[], isLoading }
}

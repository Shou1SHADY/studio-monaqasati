"use client"

import { useMemo } from "react"
import { collection, query, where, type Firestore } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"

/**
 * The purchase orders addressed to a supplier organisation, by id.
 *
 * Every supplier screen that shows an award needs this, because whether an
 * award may be shown is decided by its order (`awardDisclosed`): until Finance
 * has approved it and it has been sent, the award is the buyer's business.
 * `ready` is false until the orders have loaded — a screen must not decide on
 * a half-read map, or an award would flash as accepted and then disappear.
 */
export function useSupplierOrdersById(supplierOrgId: string | null | undefined): {
  ordersById: ReadonlyMap<string, PurchaseOrder>
  ready: boolean
} {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => {
    if (!firestore || !supplierOrgId) return null
    return query(collection(firestore as Firestore, PURCHASE_ORDERS), where("supplierOrgId", "==", supplierOrgId))
  }, [firestore, supplierOrgId])
  const { data, isLoading } = useCollection<Omit<PurchaseOrder, "id">>(q)
  const ordersById = useMemo(
    () => new Map(((data || []) as PurchaseOrder[]).map((po) => [po.id, po])),
    [data]
  )
  return { ordersById, ready: !!supplierOrgId && !isLoading }
}

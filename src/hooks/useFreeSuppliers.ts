"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { collection, doc, getDocs, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { buildFreeSupplierRows, claimedOrgIdsOf, invitedOrgIdsOf, orderCounts, riyadhMonthStartISO, type FreeSupplierRow } from "@/lib/admin-free-suppliers"
import { QUOTA_SETTINGS_DOC, monthlyLimitOf, riyadhMonth } from "@/lib/supplier-approval"
import { useSupplierCompanies } from "@/hooks/useSupplierCompanies"

type Rec = Record<string, unknown>

/**
 * The free journey's companies with everything the list shows, from a handful of reads and no read per row: the supplier
 * companies and plans (useSupplierCompanies), the month's offers (quotes this month, last activity), the offers a guest
 * began (how a company came), the accepted invitations, and the admin's allowance.
 */
export function useFreeSuppliers(): { rows: FreeSupplierRow[]; month: string; limit: number | null; isLoading: boolean } {
  const base = useSupplierCompanies()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const month = useMemo(() => riyadhMonth(new Date()), [])

  const monthQuery = useMemoFirebase(() => (firestore && user && !isUserLoading ? query(collection(firestore, "offers"), where("createdAt", ">=", riyadhMonthStartISO(month))) : null), [firestore, user, isUserLoading, month])
  const claimedQuery = useMemoFirebase(() => (firestore && user && !isUserLoading ? query(collection(firestore, "offers"), where("wasGuestOffer", "==", true)) : null), [firestore, user, isUserLoading])
  const invitedQuery = useMemoFirebase(() => (firestore && user && !isUserLoading ? query(collection(firestore, "invitations"), where("acceptedSupplierOrgId", "!=", null)) : null), [firestore, user, isUserLoading])
  const quotaRef = useMemoFirebase(() => (firestore && user && !isUserLoading ? doc(firestore, QUOTA_SETTINGS_DOC.collection, QUOTA_SETTINGS_DOC.id) : null), [firestore, user, isUserLoading])

  const { data: monthOffers } = useCollection(monthQuery)
  const { data: claimedOffers } = useCollection(claimedQuery)
  const { data: invitations } = useCollection(invitedQuery)
  const { data: quota } = useDoc(quotaRef)

  const rows = useMemo(
    () =>
      buildFreeSupplierRows({
        companies: base.companies,
        usersById: base.usersById,
        fullOrgIds: base.fullOrgIds,
        invitedOrgIds: invitedOrgIdsOf(invitations as Rec[] | null),
        claimedOrgIds: claimedOrgIdsOf(claimedOffers as Rec[] | null),
        monthOffers: (monthOffers || []) as Rec[],
        month,
      }),
    [base.companies, base.usersById, base.fullOrgIds, invitations, claimedOffers, monthOffers, month],
  )

  return { rows, month, limit: monthlyLimitOf((quota as Rec | null)?.freeMonthlyQuotes), isLoading: base.isLoading }
}

/** Orders per company for the companies asked about — read in chunks of 30 (`in`), each company once, so a page of rows costs the orders of those rows and no more. */
export function useSupplierOrderCounts(orgIds: readonly string[]): ReadonlyMap<string, number> {
  const firestore = useFirestore()
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map())
  const loaded = useRef(new Set<string>())
  const key = orgIds.join(",")

  useEffect(() => {
    if (!firestore) return
    const todo = orgIds.filter((id) => !loaded.current.has(id))
    if (!todo.length) return
    let alive = true
    void (async () => {
      for (let i = 0; i < todo.length; i += 30) {
        const chunk = todo.slice(i, i + 30)
        const snap = await getDocs(query(collection(firestore, "purchaseOrders"), where("supplierOrgId", "in", chunk)))
        if (!alive) return
        const got = orderCounts(snap.docs.map((d) => d.data() as Rec))
        for (const id of chunk) loaded.current.add(id)
        setCounts((prev) => new Map([...prev, ...chunk.map((id) => [id, got.get(id) ?? 0] as const)]))
      }
    })().catch((err) => console.warn("supplier order counts failed:", err))
    return () => {
      alive = false
    }
  }, [firestore, key])

  return counts
}

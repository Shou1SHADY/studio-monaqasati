"use client"

import { useMemo } from "react"
import { collection, query, where, type Firestore } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { PRICE_AGREEMENTS, PRICE_HISTORY, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"

/**
 * The org's price agreements and its price history.
 *
 * Both are small by nature — an agreement per supplier and a row per approved
 * order line — and both are read by several screens at once (the Suppliers tab's
 * two segments, the Today queue's renewal reminder, and any screen comparing an
 * offer with what we last paid), so one hook loads them and each screen derives
 * what it needs.
 *
 * `ready` is false until both have loaded: a screen that decides "there is no
 * agreement for this material" on a half-read list would price an order at the
 * market when we already had a better price.
 */
export function useProcurementPrices(organizationId: string | null | undefined): {
  agreements: PriceAgreement[]
  history: PriceHistoryEntry[]
  ready: boolean
} {
  const firestore = useFirestore()

  const agreementsQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore as Firestore, PRICE_AGREEMENTS), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])

  const historyQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore as Firestore, PRICE_HISTORY), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])

  const { data: agreementDocs, isLoading: loadingAgreements } = useCollection<Omit<PriceAgreement, "id">>(agreementsQuery)
  const { data: historyDocs, isLoading: loadingHistory } = useCollection<Omit<PriceHistoryEntry, "id">>(historyQuery)

  const agreements = useMemo(() => ((agreementDocs || []) as PriceAgreement[]).filter((a) => a && a.docNumber), [agreementDocs])
  const history = useMemo(() => ((historyDocs || []) as PriceHistoryEntry[]).filter((h) => h && h.materialKey), [historyDocs])

  return { agreements, history, ready: Boolean(organizationId) && !loadingAgreements && !loadingHistory }
}

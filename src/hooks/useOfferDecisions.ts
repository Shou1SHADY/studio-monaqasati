"use client"

import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { OFFER_DECISIONS, type DecisionMap, type OfferDecision } from "@/lib/procurement/offer-decisions"

/** The buyer's decisions about the offers of one RFQ, live: `{ [offerId]: { shortlist, exclusion } }`. Private to the buying
 * organisation — the rule lets it read only its own, so the query names it. */
export function useOfferDecisions(orgId: string | null | undefined, rfqId: string | null | undefined): { decisions: DecisionMap; records: Array<OfferDecision & { id: string }>; isLoading: boolean } {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId && rfqId ? query(collection(firestore, OFFER_DECISIONS), where("organizationId", "==", orgId), where("rfqId", "==", rfqId)) : null), [firestore, orgId, rfqId])
  const { data, isLoading } = useCollection<OfferDecision>(q)
  const records = (data || []) as Array<OfferDecision & { id: string }>
  return { decisions: Object.fromEntries(records.map((d) => [d.id, d])), records, isLoading }
}

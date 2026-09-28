"use client"

// One RFQ's queries, counted for its card and row (R-36): how many and how
// many still unanswered. One small listener per visible RFQ that is past its
// draft — the list pages, so it stays a handful.

import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { unansweredCount, type InquiryLike } from "@/lib/procurement/rfq-detail"

export function useRfqInquiryCounts(rfqId: string | null): { total: number; unanswered: number } {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && rfqId ? collection(firestore, "rfqs", rfqId, "inquiries") : null), [firestore, rfqId])
  const { data } = useCollection<InquiryLike>(q)
  const rows = (data || []) as InquiryLike[]
  return { total: rows.length, unanswered: unansweredCount(rows) }
}

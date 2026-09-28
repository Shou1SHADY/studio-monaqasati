"use client"

// Suppliers' questions on our OPEN RFQs (`rfqs/{id}/inquiries`), live — Today
// lists the unanswered ones («استفسار مورد بلا جواب»). One listener per open
// RFQ: an inquiry carries no org id, so there is no one query across them.

import { useEffect, useMemo, useState } from "react"
import { collection, onSnapshot } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import type { RfqQueryFact } from "@/lib/procurement/today"

export function useRfqQueries(rfqIds: string[]): RfqQueryFact[] {
  const firestore = useFirestore()
  const ids = useMemo(() => Array.from(new Set(rfqIds)).sort().join(","), [rfqIds])
  const [byRfq, setByRfq] = useState<Record<string, RfqQueryFact[]>>({})

  useEffect(() => {
    if (!firestore || !ids) return
    const unsubs = ids.split(",").map((rfqId) =>
      onSnapshot(
        collection(firestore, "rfqs", rfqId, "inquiries"),
        (snap) =>
          setByRfq((prev) => ({
            ...prev,
            [rfqId]: snap.docs.map((d) => {
              const v = d.data() as { question?: string; reply?: string | null }
              return { id: d.id, rfqId, question: v.question || "", answered: Boolean((v.reply || "").trim()) }
            }),
          })),
        (err) => console.warn("rfq inquiries read failed:", rfqId, err.code)
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [firestore, ids])

  return useMemo(() => (ids ? ids.split(",").flatMap((id) => byRfq[id] || []) : []), [ids, byRfq])
}

"use client"

// Withdrawal requests live under each CENTRAL warehouse's `requests`
// subcollection (see warehouse-requests.ts) — a company can have more than
// one central, so a page that wants "every request across the org" (not
// just the ones touching a single warehouse) needs to listen to all of
// them at once. useCollection can't do that (the query shape is fixed at
// call time, and hooks can't be called in a loop for a dynamic list of
// centrals), so this fans out its own onSnapshot listeners and merges them.

import { useEffect, useState } from "react"
import { collection, onSnapshot } from "firebase/firestore"
import { useFirestore } from "@/firebase"

export function useOrgWarehouseRequests(centralIds: string[]) {
  const firestore = useFirestore()
  const [byCentral, setByCentral] = useState<Record<string, any[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const idsKey = centralIds.slice().sort().join(",")

  useEffect(() => {
    if (!firestore || centralIds.length === 0) {
      setByCentral({})
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    let pending = centralIds.length
    const unsubs = centralIds.map((centralId) =>
      onSnapshot(
        collection(firestore, "warehouses", centralId, "requests"),
        (snap) => {
          setByCentral((prev) => ({
            ...prev,
            [centralId]: snap.docs.map((d) => ({ id: d.id, centralWarehouseId: centralId, ...d.data() })),
          }))
          if (pending > 0) { pending -= 1; if (pending === 0) setIsLoading(false) }
        },
        () => { if (pending > 0) { pending -= 1; if (pending === 0) setIsLoading(false) } }
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [firestore, idsKey])

  const requests = Object.values(byCentral).flat()
  return { requests, isLoading }
}

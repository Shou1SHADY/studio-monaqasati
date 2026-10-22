"use client"

// Inventory's and the workshop's windows, read from the company's Procurement settings alone — what their desks need to know which
// questions are still open, without loading the whole Procurement world.

import { useMemo, useState } from "react"
import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { replyClockOf, type ReplyClock } from "@/lib/procurement/incoming-state"
import { resolvePolicies, type ResolvedPolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"

export function useReplyClock(orgId: string | null | undefined): ReplyClock {
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId])
  const { data } = useDoc(ref)
  const [now] = useState(() => new Date())
  return useMemo(() => replyClockOf(now, resolvePolicies((data as Partial<ResolvedPolicies> | null) ?? null)), [now, data])
}

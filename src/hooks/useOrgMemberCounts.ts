"use client"

import { useEffect, useMemo, useState } from "react"
import { collection, getDocs, query, where } from "firebase/firestore"
import { useFirestore } from "@/firebase"

const CHUNK = 30

/**
 * How many accounts each company has (the admin contractors list, AD-02: «{city} · {N} users · since …»): the users naming
 * the company as their organisation, plus the owner's own account (a legacy solo owner names none). Read once per list of
 * companies, 30 to a query (Firestore's `in` limit).
 */
export function useOrgMemberCounts(orgIds: readonly string[]): ReadonlyMap<string, number> {
  const firestore = useFirestore()
  const key = useMemo(() => [...new Set(orgIds)].sort().join("|"), [orgIds])
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map())
  useEffect(() => {
    const ids = key ? key.split("|") : []
    if (!firestore || ids.length === 0) return
    let cancelled = false
    void (async () => {
      const members = new Map<string, Set<string>>(ids.map((id) => [id, new Set([id])]))
      try {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const snap = await getDocs(query(collection(firestore, "users"), where("organizationId", "in", ids.slice(i, i + CHUNK))))
          snap.docs.forEach((d) => {
            const org = (d.data() as { organizationId?: unknown }).organizationId
            if (typeof org === "string") members.get(org)?.add(d.id)
          })
        }
      } catch (err) {
        console.error("member counts:", err)
        return
      }
      if (!cancelled) setCounts(new Map([...members].map(([id, set]) => [id, set.size])))
    })()
    return () => {
      cancelled = true
    }
  }, [firestore, key])
  return counts
}

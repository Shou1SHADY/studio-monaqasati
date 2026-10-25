"use client"

import { useEffect, useMemo, useState } from "react"
import { collection, getDocs, query, where } from "firebase/firestore"
import { useFirestore } from "@/firebase"

const CHUNK = 30

/**
 * How many accounts each company has (the admin contractors list, AD-02: «{city} · {N} users · since …»): the users naming
 * the company as their organisation, plus the owner's own account (a legacy solo owner names none). Read once per list of
 * companies, 30 to a query (Firestore's `in` limit). A secondary company's id is an `organizations` doc, not an account:
 * `owners` names its owner's uid so he is counted once (an owner switched elsewhere still belongs to it).
 */
export function useOrgMemberCounts(orgIds: readonly string[], owners?: ReadonlyMap<string, string | null>): ReadonlyMap<string, number> {
  const firestore = useFirestore()
  const key = useMemo(() => [...new Set(orgIds)].sort().map((id) => `${id}:${owners?.get(id) ?? id}`).join("|"), [orgIds, owners])
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map())
  useEffect(() => {
    const pairs = key ? key.split("|").map((p) => p.split(":") as [string, string]) : []
    const ids = pairs.map(([id]) => id)
    if (!firestore || ids.length === 0) return
    let cancelled = false
    void (async () => {
      const members = new Map<string, Set<string>>(pairs.map(([id, owner]) => [id, new Set([owner])]))
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

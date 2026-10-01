"use client"

// «اعتماد عيّنة {no}: …» — the number of the sample with the consultant for
// each desk line held on one, read as the need drawer reads it (the latest
// submittal of the line's BOQ item). Empty until read: the row then names none.

import { useEffect, useMemo, useState } from "react"
import { collection, getDocs, query, where } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { latestSampleNo, type NeedRow } from "@/lib/procurement/need-desk"
import type { PmSubmittal } from "@/lib/pm/sample"

export function useSampleNumbers(rows: NeedRow[]): Record<string, string> {
  const firestore = useFirestore()
  const wanted = useMemo(() => {
    const out: Record<string, string> = {}
    for (const r of rows) if (r.samplePending && r.itemId && r.need.kind === "project" && r.need.projectId) out[r.key] = `${r.need.projectId}/${r.itemId}`
    return out
  }, [rows])
  const signature = Array.from(new Set(Object.values(wanted))).sort().join("|")
  const [byItem, setByItem] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!firestore || !signature) return
    let cancelled = false
    Promise.all(
      signature.split("|").map(async (path) => {
        const [projectId, itemId] = path.split("/")
        const snap = await getDocs(query(collection(firestore, "projects", projectId, "pmSubmittals"), where("itemId", "==", itemId))).catch(() => null)
        const no = snap ? latestSampleNo(snap.docs.map((d) => d.data() as Pick<PmSubmittal, "seq" | "rev">)) : null
        return no ? ([path, no] as const) : null
      })
    ).then((pairs) => {
      if (!cancelled) setByItem(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p !== null)))
    })
    return () => {
      cancelled = true
    }
  }, [firestore, signature])
  return useMemo(() => {
    const out: Record<string, string> = {}
    for (const [key, path] of Object.entries(wanted)) if (byItem[path]) out[key] = byItem[path]
    return out
  }, [wanted, byItem])
}

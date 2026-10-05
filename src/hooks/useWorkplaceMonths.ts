"use client"

// HR 1.0 — every workplace's attendance month the viewer may read (AT-03): the
// HR office roles list the company's months; a supervisor reads his own
// workplaces' months one by one, by `get` — the rules never let him list them.

import { useEffect, useState } from "react"
import { collection, doc, onSnapshot, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { attendanceId, type WorkplaceMonth } from "@/lib/hr/attendance"
import { HR_ATTENDANCE } from "@/lib/hr/collections"

export function useWorkplaceMonths(access: Pick<HrAccess, "orgId" | "ctx">, month: string): { months: WorkplaceMonth[]; isLoading: boolean } {
  const firestore = useFirestore()
  const orgId = access.orgId
  const canList = access.ctx.owner || access.ctx.roles.has("manager") || access.ctx.roles.has("payroll") || access.ctx.roles.has("management") || access.ctx.roles.has("gov")
  const q = useMemoFirebase(() => (firestore && orgId && canList ? query(collection(firestore, HR_ATTENDANCE), where("organizationId", "==", orgId), where("month", "==", month)) : null), [firestore, orgId, canList, month])
  const { data, isLoading } = useCollection(q)
  const siteKey = canList ? "" : [...access.ctx.sites].sort().join(",")
  const [own, setOwn] = useState<{ key: string; rows: WorkplaceMonth[] } | null>(null)
  useEffect(() => {
    if (!firestore || !orgId || canList) return
    const key = `${orgId}|${month}|${siteKey}`
    const sites = siteKey ? siteKey.split(",") : []
    if (!sites.length) {
      setOwn({ key, rows: [] })
      return
    }
    const parts = new Map<string, WorkplaceMonth | null>()
    const publish = () => parts.size === sites.length && setOwn({ key, rows: sites.map((s) => parts.get(s)).filter((x): x is WorkplaceMonth => Boolean(x)) })
    const unsubs = sites.map((s) =>
      onSnapshot(
        doc(firestore, HR_ATTENDANCE, attendanceId(orgId, s, month)),
        (snap) => {
          parts.set(s, snap.exists() ? ({ ...(snap.data() as Omit<WorkplaceMonth, "id">), id: snap.id } as WorkplaceMonth) : null)
          publish()
        },
        () => {
          parts.set(s, null)
          publish()
        }
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [firestore, orgId, canList, month, siteKey])
  if (canList) return { months: (data ?? []) as unknown as WorkplaceMonth[], isLoading }
  const key = `${orgId}|${month}|${siteKey}`
  return own?.key === key ? { months: own.rows, isLoading: false } : { months: [], isLoading: Boolean(firestore && orgId) }
}

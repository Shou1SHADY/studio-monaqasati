"use client"

// HR 1.0 (RL-01) — a company's HR records read the way the rules let the viewer
// read them. `scope` null is ONE company-wide query (every HR role but the
// supervisor); a list of workplaces is one live query per workplace, merged —
// a supervisor's own sites, `where('siteId', '==', s)`, which firestore.rules can
// prove (a company-wide query from him is refused whole). An empty list reads
// nothing. `filters` are extra equality clauses (e.g. kind == leave).

import { useEffect, useMemo, useState } from "react"
import { collection, onSnapshot, query, where, type DocumentData } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"

type Row<T> = T & { id: string }
type Filter = readonly [field: string, value: string]

export function useScopedCollection<T = DocumentData>(
  name: string,
  orgId: string | null,
  scope: readonly string[] | null,
  enabled = true,
  filters: readonly Filter[] = []
): { data: Row<T>[] | null; isLoading: boolean } {
  const firestore = useFirestore()
  const filterKey = filters.map(([f, v]) => `${f}\u0001${v}`).join("\u0002")
  const siteKey = scope === null ? null : [...new Set(scope)].sort().join("\u0002")
  const live = Boolean(firestore && orgId && enabled)
  const wholeCompany = siteKey === null
  const clauses = useMemo(() => (filterKey ? filterKey.split("\u0002").map((p) => p.split("\u0001") as [string, string]) : []), [filterKey])

  const orgQ = useMemoFirebase(
    () => (live && wholeCompany ? query(collection(firestore!, name), where("organizationId", "==", orgId), ...clauses.map(([f, v]) => where(f, "==", v))) : null),
    [live, wholeCompany, firestore, name, orgId, clauses]
  )
  const whole = useCollection<T>(orgQ)

  const [bySite, setBySite] = useState<{ key: string; rows: Row<T>[] | null } | null>(null)
  useEffect(() => {
    if (!live || siteKey === null) return
    const key = `${name}|${orgId}|${siteKey}|${filterKey}`
    const sites = siteKey ? siteKey.split("\u0002") : []
    if (!sites.length) {
      setBySite({ key, rows: [] })
      return
    }
    const parts = new Map<string, Row<T>[]>()
    const publish = () => parts.size === sites.length && setBySite({ key, rows: sites.flatMap((s) => parts.get(s) ?? []) })
    const unsubs = sites.map((s) =>
      onSnapshot(
        query(collection(firestore!, name), where("organizationId", "==", orgId), where("siteId", "==", s), ...clauses.map(([f, v]) => where(f, "==", v))),
        (snap) => {
          parts.set(s, snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })))
          publish()
        },
        (err) => {
          // One workplace refused (a supervisor removed from it a moment ago) leaves the others readable.
          console.error("Scoped HR query refused:", name, s, err)
          parts.set(s, [])
          publish()
        }
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [live, siteKey, firestore, name, orgId, filterKey, clauses])

  if (wholeCompany) return { data: (whole.data as Row<T>[] | null) ?? null, isLoading: whole.isLoading }
  const key = `${name}|${orgId}|${siteKey}|${filterKey}`
  const rows = live && bySite?.key === key ? bySite.rows : null
  return { data: live ? rows : null, isLoading: live && rows === null }
}

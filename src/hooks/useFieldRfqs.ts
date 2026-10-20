"use client"

// The public RFQs in a supplier's field (PUR-03/04): those written on the material tree
// whose sub-categories meet his (`array-contains-any`, read in slices of 30), plus those
// written before the tree whose category name is one of his. One RFQ carrying several
// sub-categories arrives once.

import { useMemo } from "react"
import { collection, query, where, type Firestore } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { slices } from "@/lib/materials/reach"

type Row = Record<string, unknown> & { id: string }

/** At most 4 × 30 sub-categories are read (the tree has 106 sub-categories + first-level leaves). */
const SLOTS = 4

export function useFieldRfqs(opts: { enabled: boolean; subIds: string[]; specs: string[]; statuses?: string[]; publicOnly?: boolean }): { rfqs: Row[]; isLoading: boolean } {
  const firestore = useFirestore()
  const statuses = opts.statuses ?? ["New"]
  const statusKey = statuses.join("|")
  const subKey = opts.subIds.join("|")
  const specKey = opts.specs.slice(0, 30).join("|")
  const publicOnly = opts.publicOnly !== false

  const base = (db: Firestore) => {
    const st = statusKey.split("|")
    const q = query(collection(db, "rfqs"), st.length === 1 ? where("status", "==", st[0]) : where("status", "in", st))
    return publicOnly ? query(q, where("visibility", "==", "public")) : q
  }
  const parts = subKey ? slices(subKey.split("|")) : []

  const legacyQ = useMemoFirebase(() => (firestore && opts.enabled && specKey ? query(base(firestore), where("category", "in", specKey.split("|"))) : null), [firestore, opts.enabled, specKey, statusKey, publicOnly])
  const q0 = useMemoFirebase(() => (firestore && opts.enabled && parts[0] ? query(base(firestore), where("subCategoryIds", "array-contains-any", parts[0])) : null), [firestore, opts.enabled, subKey, statusKey, publicOnly])
  const q1 = useMemoFirebase(() => (firestore && opts.enabled && parts[1] ? query(base(firestore), where("subCategoryIds", "array-contains-any", parts[1])) : null), [firestore, opts.enabled, subKey, statusKey, publicOnly])
  const q2 = useMemoFirebase(() => (firestore && opts.enabled && parts[2] ? query(base(firestore), where("subCategoryIds", "array-contains-any", parts[2])) : null), [firestore, opts.enabled, subKey, statusKey, publicOnly])
  const q3 = useMemoFirebase(() => (firestore && opts.enabled && parts[SLOTS - 1] ? query(base(firestore), where("subCategoryIds", "array-contains-any", parts[SLOTS - 1])) : null), [firestore, opts.enabled, subKey, statusKey, publicOnly])

  const a = useCollection(legacyQ)
  const b = useCollection(q0)
  const c = useCollection(q1)
  const d = useCollection(q2)
  const e = useCollection(q3)

  const rfqs = useMemo(() => {
    const by = new Map<string, Row>()
    for (const list of [a.data, b.data, c.data, d.data, e.data]) for (const r of (list || []) as Row[]) by.set(r.id, r)
    return [...by.values()]
  }, [a.data, b.data, c.data, d.data, e.data])
  return { rfqs, isLoading: a.isLoading || b.isLoading || c.isLoading || d.isLoading || e.isLoading }
}

"use client"

// What the org's stores hold, by item name — read once when a Manufacturing
// form needs it (release, material request, new order), not subscribed: a
// shortage warning is advice before a decision, and the release itself is
// re-validated against live stock by the write that moves it.

import { useEffect, useState } from "react"
import { collection, getDocs } from "firebase/firestore"
import { useFirestore } from "@/firebase"

export interface StockRow {
  id: string
  name: string
  quantity: number
  unit: string
  unitCost: number | null
  /** Block / lot — a batch of stone is one colour and vein. */
  lot?: string | null
  /** A usable remnant returned by manufacturing. */
  remnant?: boolean
  isManufactured?: boolean
}

export interface OrgStock {
  loading: boolean
  /** Lower-cased trimmed item name → quantity across the warehouses read. */
  byName: Map<string, number>
  byWarehouse: Map<string, StockRow[]>
}

export const stockKey = (name: string) => name.trim().toLowerCase()

export function useOrgStock(
  warehouses: Array<{ id: string; isOutbound?: boolean }>,
  enabled: boolean,
  /** Bump to read again (e.g. after a withdrawal is issued). */
  refreshKey: string | number = 0
): OrgStock {
  const firestore = useFirestore()
  const [state, setState] = useState<OrgStock>({ loading: enabled, byName: new Map(), byWarehouse: new Map() })
  const ids = warehouses.filter((w) => !w.isOutbound).map((w) => w.id).join(",")

  useEffect(() => {
    if (!enabled || !firestore || !ids) {
      setState((s) => ({ ...s, loading: false }))
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    Promise.all(
      ids.split(",").map(async (id) => {
        const snap = await getDocs(collection(firestore, "warehouses", id, "inventoryItems"))
        const rows: StockRow[] = snap.docs.map((d) => {
          const v = d.data() as { name?: string; quantity?: number; unit?: string; unitCost?: number | null; lot?: string | null; remnant?: boolean; isManufactured?: boolean }
          return {
            id: d.id,
            name: v.name || "",
            quantity: Number(v.quantity) || 0,
            unit: v.unit || "",
            unitCost: v.unitCost ?? null,
            lot: v.lot ?? null,
            remnant: !!v.remnant,
            isManufactured: !!v.isManufactured,
          }
        })
        return [id, rows] as const
      })
    )
      .then((pairs) => {
        if (cancelled) return
        const byName = new Map<string, number>()
        const byWarehouse = new Map<string, StockRow[]>()
        for (const [id, rows] of pairs) {
          byWarehouse.set(id, rows)
          for (const r of rows) {
            if (!r.name) continue
            byName.set(stockKey(r.name), (byName.get(stockKey(r.name)) || 0) + r.quantity)
          }
        }
        setState({ loading: false, byName, byWarehouse })
      })
      .catch((err) => {
        console.warn("stock read failed:", err?.code || err)
        if (!cancelled) setState((s) => ({ ...s, loading: false }))
      })
    return () => {
      cancelled = true
    }
  }, [firestore, ids, enabled, refreshKey])

  return state
}

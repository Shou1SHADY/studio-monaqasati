"use client"

// The stores' item cards by material name, for the price screens (S-46/S-47):
// the item's code (its SKU) and the warehouse that keeps it, so a material we
// buy can say «{code} · {category}» and link to its card in Inventory. Read
// once when a price screen asks for it, not subscribed.

import { useEffect, useMemo, useState } from "react"
import { collection, getDocs, query, where } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { foldSearchText } from "@/lib/search-text"

export interface CatalogItem {
  code: string | null
  warehouseId: string
}

export function inventoryIndex(rows: Array<{ warehouseId: string; name?: string | null; sku?: string | null }>): Map<string, CatalogItem> {
  const out = new Map<string, CatalogItem>()
  for (const r of rows) {
    const key = foldSearchText(r.name || "")
    if (!key) continue
    const code = (r.sku || "").trim() || null
    const had = out.get(key)
    if (!had || (!had.code && code)) out.set(key, { code, warehouseId: r.warehouseId })
  }
  return out
}

export function useInventoryCatalog(orgId: string, enabled: boolean): { itemOf: (name: string) => CatalogItem | null } {
  const firestore = useFirestore()
  const [rows, setRows] = useState<Array<{ warehouseId: string; name?: string | null; sku?: string | null }>>([])
  useEffect(() => {
    if (!enabled || !firestore || !orgId) return
    let cancelled = false
    getDocs(query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)))
      .then((whs) =>
        Promise.all(
          whs.docs.map(async (w) => {
            const items = await getDocs(collection(firestore, "warehouses", w.id, "inventoryItems"))
            return items.docs.map((d) => ({ warehouseId: w.id, ...(d.data() as { name?: string; sku?: string }) }))
          })
        )
      )
      .then((lists) => {
        if (!cancelled) setRows(lists.flat())
      })
      .catch((err) => console.warn("inventory catalogue not read:", (err as { code?: string })?.code || err))
    return () => {
      cancelled = true
    }
  }, [enabled, firestore, orgId])
  const index = useMemo(() => inventoryIndex(rows), [rows])
  return useMemo(() => ({ itemOf: (name: string) => index.get(foldSearchText(name)) ?? null }), [index])
}

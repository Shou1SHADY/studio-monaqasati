"use client"

// What "Issue" and "Convert to order" check a quotation against (Sales PRD T4,
// T9): the price list (list price, standard cost), which items are MADE — they
// have a workshop product card — and what the stores hold. Read once when the
// page opens; `reload` re-reads before a decision, because stock that covered
// a line at quote time may be gone by acceptance (SO-04).

import { useCallback, useEffect, useMemo, useState } from "react"
import { collection, getDocs, query, where } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { MFG_PRODUCTS } from "@/lib/manufacturing-engine"
import { SALES_PRICE_ITEMS, type SalesPriceItem } from "@/lib/sales"
import { discountCapPercent } from "@/lib/sales-transfers"
import type { IssueContext } from "@/lib/sales-quotes"

export interface QuoteIssueContext {
  context: IssueContext
  priceItems: SalesPriceItem[]
  isReady: boolean
  /** Re-reads everything and resolves to the fresh context. */
  reload: () => Promise<IssueContext>
}

export function useQuoteIssueContext(orgId: string): QuoteIssueContext {
  const firestore = useFirestore()
  const { can, isOrgOwner } = usePermissions()
  const capPercent = discountCapPercent({ isOwner: isOrgOwner, canApprove: can("sales.approve") })

  const [priceItems, setPriceItems] = useState<SalesPriceItem[]>([])
  const [manufacturedNames, setManufacturedNames] = useState<string[]>([])
  const [stockByName, setStockByName] = useState<Map<string, number>>(new Map())
  const [isReady, setIsReady] = useState(false)

  const read = useCallback(async () => {
    if (!firestore || !orgId) return null
    const org = where("organizationId", "==", orgId)
    const [priceSnap, productSnap, warehouseSnap] = await Promise.all([
      getDocs(query(collection(firestore, SALES_PRICE_ITEMS), org)),
      getDocs(query(collection(firestore, MFG_PRODUCTS), org)),
      getDocs(query(collection(firestore, "warehouses"), org)),
    ])
    const stock = new Map<string, number>()
    for (const wh of warehouseSnap.docs) {
      const inv = await getDocs(collection(firestore, "warehouses", wh.id, "inventoryItems"))
      inv.forEach((d) => {
        const name = ((d.data().name as string) || "").trim().toLowerCase()
        if (name) stock.set(name, (stock.get(name) || 0) + (Number(d.data().quantity) || 0))
      })
    }
    return {
      priceItems: priceSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SalesPriceItem, "id">) })),
      manufacturedNames: productSnap.docs.filter((d) => !d.data().archived).map((d) => (d.data().name as string) || ""),
      stockByName: stock,
    }
  }, [firestore, orgId])

  useEffect(() => {
    let alive = true
    setIsReady(false)
    read()
      .then((r) => {
        if (!alive || !r) return
        setPriceItems(r.priceItems)
        setManufacturedNames(r.manufacturedNames)
        setStockByName(r.stockByName)
        setIsReady(true)
      })
      .catch((err) => {
        console.error("Quote issue context failed to load:", err)
        if (alive) setIsReady(true)
      })
    return () => {
      alive = false
    }
  }, [read])

  const context = useMemo<IssueContext>(() => ({ priceItems, capPercent, manufacturedNames, stockByName }), [priceItems, capPercent, manufacturedNames, stockByName])

  const reload = useCallback(async (): Promise<IssueContext> => {
    const r = await read()
    if (!r) return context
    setPriceItems(r.priceItems)
    setManufacturedNames(r.manufacturedNames)
    setStockByName(r.stockByName)
    return { priceItems: r.priceItems, capPercent, manufacturedNames: r.manufacturedNames, stockByName: r.stockByName }
  }, [read, context, capPercent])

  return { context, priceItems, isReady, reload }
}

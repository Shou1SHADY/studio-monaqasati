"use client"

// «المتبقي من موازنة مواد البند» on a need line: the BOQ item's estimated cost
// budget less what orders, issues and subcontracts already commit on it — read
// from the project's cost world, for price roles only. Null when the item has
// no estimate (nothing to measure against).

import { useMemo } from "react"
import { doc } from "firebase/firestore"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useProjectCost } from "@/hooks/useProjectCost"
import { itemCosts } from "@/lib/pm/cost"

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

export function useItemBudgetLeft(projectId: string | null, orgId: string | null, itemId: string | null, enabled: boolean): number | null {
  const firestore = useFirestore()
  const on = Boolean(enabled && projectId && itemId)
  const itemRef = useMemoFirebase(() => (firestore && on ? doc(firestore, "projects", projectId as string, "boqItems", itemId as string) : null), [firestore, on, projectId, itemId])
  const projectRef = useMemoFirebase(() => (firestore && on ? doc(firestore, "projects", projectId as string) : null), [firestore, on, projectId])
  const { data: item } = useDoc<Record<string, unknown>>(itemRef)
  const { data: project } = useDoc<{ warehouseId?: string | null }>(projectRef)
  const world = useProjectCost(projectId ?? "", orgId, on)
  return useMemo(() => {
    if (!on || !item || !itemId) return null
    const estCost = num(item.estCost)
    const quantity = num(item.quantity)
    if (!(estCost > 0 && quantity > 0)) return null
    const one = { id: itemId, code: String(item.itemNo ?? ""), description: "", division: "", quantity, rate: num(item.unitPrice), executed: num(item.executedQuantity), estCost }
    const { items } = itemCosts({ items: [one], pos: world.pos, issues: world.issues, projectWarehouseId: project?.warehouseId ?? null, subcontracts: world.subcontracts, direct: world.direct })
    return Math.round((estCost * quantity - (items.get(itemId)?.committed ?? 0)) * 100) / 100
  }, [on, item, itemId, world.pos, world.issues, world.subcontracts, world.direct, project])
}

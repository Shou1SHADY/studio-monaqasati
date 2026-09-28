"use client"

// The actual cost booked per BOQ line of a PM project (src/lib/pm/cost.ts
// `itemCosts`): received on its purchase orders, stock issued to it, certified
// subcontract work and direct purchases tied to a line. What the BOQ table's
// cost / margin / bleeding columns read. Money holders only — empty otherwise.

import { useMemo } from "react"
import { useProjectCost } from "@/hooks/useProjectCost"
import { itemCosts, type CostItem } from "@/lib/pm/cost"

export function usePmItemActualCost(projectId: string, orgId: string | null, itemIds: readonly string[], projectWarehouseId: string | null, money: boolean): ReadonlyMap<string, number> {
  const world = useProjectCost(projectId, orgId, money)
  const key = itemIds.join(",")
  return useMemo(() => {
    const out = new Map<string, number>()
    if (!money) return out
    const items: CostItem[] = key ? key.split(",").map((id) => ({ id, code: "", description: "", division: "", quantity: 0, rate: 0, executed: 0, estCost: 0 })) : []
    const { items: costs } = itemCosts({ items, pos: world.pos, issues: world.issues, projectWarehouseId, subcontracts: world.subcontracts, direct: world.direct })
    for (const [id, c] of costs) if (c.actual > 0) out.set(id, c.actual)
    return out
  }, [money, key, world.pos, world.issues, world.subcontracts, world.direct, projectWarehouseId])
}

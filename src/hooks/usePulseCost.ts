"use client"

// The project's cost as the Pulse and the head read it (src/lib/pm/cost.ts):
// the BOQ lines' estimated cost, the project's purchase orders, stock issued to
// it, its subcontracts and site purchases. Read only for money holders.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { itemCosts, projectCost, type CostIssue, type CostItem, type CostPo, type CostSubcontract, type ItemCost, type ProjectCost } from "@/lib/pm/cost"
import { PM_SUBCONTRACTS } from "@/lib/pm/subcontract"
import { PM_PETTY } from "@/lib/pm/supply"
import { PM_VARIATIONS } from "@/lib/pm/variation"
import { PURCHASE_ORDERS } from "@/lib/procurement/types"

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

export interface PulseCost {
  items: CostItem[]
  costs: Map<string, ItemCost>
  total: ProjectCost
  /** Any line carries an estimated cost — without one the budget is unknown, not zero. */
  estimated: boolean
}

export function usePulseCost(projectId: string, organizationId: string | null | undefined, warehouseId: string | null | undefined, baseValue: number, enabled: boolean): PulseCost | null {
  const firestore = useFirestore()
  const sub = (name: string) => (firestore && enabled ? collection(firestore, "projects", projectId, name) : null)
  const itemQ = useMemoFirebase(() => sub("boqItems"), [firestore, projectId, enabled])
  const issueQ = useMemoFirebase(() => sub("wasteRecords"), [firestore, projectId, enabled])
  const scQ = useMemoFirebase(() => sub(PM_SUBCONTRACTS), [firestore, projectId, enabled])
  const pettyQ = useMemoFirebase(() => sub(PM_PETTY), [firestore, projectId, enabled])
  const voQ = useMemoFirebase(() => sub(PM_VARIATIONS), [firestore, projectId, enabled])
  const poQ = useMemoFirebase(
    () => (firestore && enabled && organizationId ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", organizationId), where("projectId", "==", projectId)) : null),
    [firestore, organizationId, projectId, enabled]
  )
  const { data: itemData } = useCollection(itemQ)
  const { data: issueData } = useCollection(issueQ)
  const { data: scData } = useCollection(scQ)
  const { data: pettyData } = useCollection(pettyQ)
  const { data: voData } = useCollection(voQ)
  const { data: poData } = useCollection(poQ)

  return useMemo(() => {
    if (!enabled || !itemData) return null
    const items: CostItem[] = (itemData as Array<Record<string, unknown> & { id: string }>).map((d) => ({
      id: d.id,
      code: String(d.itemNo ?? ""),
      description: String(d.descriptionAr ?? d.descriptionEn ?? ""),
      division: String(d.divisionNameAr ?? d.divisionNameEn ?? d.divisionNo ?? ""),
      quantity: num(d.quantity),
      rate: num(d.unitPrice),
      executed: num(d.executedQuantity),
      estCost: num(d.estCost),
    }))
    const pos = (poData ?? []) as unknown as CostPo[]
    const issues = (issueData ?? []) as unknown as CostIssue[]
    const subcontracts = (scData ?? []) as unknown as CostSubcontract[]
    const direct = ((pettyData ?? []) as Array<{ amount?: number }>).map((p) => ({ itemId: null, amount: num(p.amount), paid: true }))
    const variations = ((voData ?? []) as Array<{ status?: string; value?: number; cost?: number; executedPct?: number }>).map((v) => ({ status: v.status ?? "", value: num(v.value), cost: num(v.cost), executedPct: num(v.executedPct) }))
    const { items: costs, unassigned } = itemCosts({ items, pos: pos.map((p) => ({ ...p, lines: p.lines || [] })), issues, projectWarehouseId: warehouseId ?? null, subcontracts: subcontracts.map((s) => ({ ...s, lines: s.lines || [] })), direct })
    return { items, costs, total: projectCost({ items, costs, unassigned, variations, baseValue, penalty: 0 }), estimated: items.some((i) => i.estCost > 0) }
  }, [enabled, itemData, poData, issueData, scData, pettyData, voData, warehouseId, baseValue])
}

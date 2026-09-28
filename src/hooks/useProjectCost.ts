"use client"

// A PM 1.0 project's cost world, read once for the Money group's Cost,
// Match and Reconciliation sub-tabs: the project's purchase orders (the
// buyer's org, this project), the stock issued to it (`wasteRecords`), its
// subcontracts and variations, its direct site purchases (`pmPetty`, paid on
// the spot), and the supplier invoices tied to its orders' RFQs. Only for
// holders of money — nothing is read otherwise.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { CostDirect, CostIssue, CostPo, CostSubcontract, CostVariation } from "@/lib/pm/cost"
import type { InvoiceFact } from "@/lib/pm/match"
import { PM_SUBCONTRACTS } from "@/lib/pm/subcontract"
import { PM_PETTY } from "@/lib/pm/supply"
import { PM_VARIATIONS } from "@/lib/pm/variation"
import { PURCHASE_ORDERS } from "@/lib/procurement/types"

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown) => (typeof v === "string" ? v : "")

type Row = Record<string, unknown> & { id: string }

export interface ProjectCostWorld {
  pos: CostPo[]
  issues: CostIssue[]
  subcontracts: CostSubcontract[]
  variations: CostVariation[]
  /** Direct site purchases — a project cost not tied to a BOQ line, paid on the spot. */
  direct: CostDirect[]
  invoices: InvoiceFact[]
  isLoading: boolean
}

export function useProjectCost(projectId: string, orgId: string | null, money: boolean): ProjectCostWorld {
  const firestore = useFirestore()
  const on = Boolean(firestore && money && orgId)
  const poQ = useMemoFirebase(
    () => (on && firestore ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null),
    [on, firestore, orgId, projectId]
  )
  const issueQ = useMemoFirebase(() => (on && firestore ? collection(firestore, "projects", projectId, "wasteRecords") : null), [on, firestore, projectId])
  const subQ = useMemoFirebase(() => (on && firestore ? collection(firestore, "projects", projectId, PM_SUBCONTRACTS) : null), [on, firestore, projectId])
  const voQ = useMemoFirebase(() => (on && firestore ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [on, firestore, projectId])
  const pettyQ = useMemoFirebase(() => (on && firestore ? collection(firestore, "projects", projectId, PM_PETTY) : null), [on, firestore, projectId])
  const { data: poData, isLoading: poLoading } = useCollection(poQ)
  const { data: issueData } = useCollection(issueQ)
  const { data: subData } = useCollection(subQ)
  const { data: voData } = useCollection(voQ)
  const { data: pettyData } = useCollection(pettyQ)

  const pos = useMemo<CostPo[]>(
    () =>
      ((poData ?? []) as Row[]).map((d) => ({
        id: d.id,
        docNumber: str(d.docNumber),
        status: str(d.status),
        supplierName: str(d.supplierName),
        rfqId: str(d.rfqId) || null,
        totalExVat: num(d.totalExVat),
        lines: (Array.isArray(d.lines) ? (d.lines as Array<Record<string, unknown>>) : []).map((l, i) => ({
          id: str(l.id) || `l${i + 1}`,
          name: str(l.name),
          unit: str(l.unit),
          quantity: num(l.quantity),
          unitPrice: l.unitPrice == null ? null : num(l.unitPrice),
          accepted: num(l.accepted),
          cancelled: num(l.cancelled),
          boqItemId: str(l.boqItemId) || null,
        })),
      })),
    [poData]
  )

  const rfqIds = useMemo(() => [...new Set(pos.map((p) => p.rfqId).filter((x): x is string => Boolean(x)))].sort().slice(0, 30), [pos])
  const rfqKey = rfqIds.join(",")
  const invQ = useMemoFirebase(
    () => (on && firestore && rfqKey ? query(collection(firestore, "invoices"), where("rfqId", "in", rfqKey.split(","))) : null),
    [on, firestore, rfqKey]
  )
  const { data: invData } = useCollection(invQ)

  return useMemo(() => {
    const issues: CostIssue[] = ((issueData ?? []) as Row[]).map((d) => ({
      id: d.id,
      type: str(d.type) || null,
      reversesRecordId: str(d.reversesRecordId) || null,
      boqItemId: str(d.boqItemId) || null,
      warehouseId: str(d.warehouseId) || null,
      quantityTaken: num(d.quantityTaken),
      unitCost: d.unitCost == null ? null : num(d.unitCost),
    }))
    const subcontracts: CostSubcontract[] = ((subData ?? []) as Row[]).map((d) => ({
      value: num(d.value),
      paid: num(d.paid),
      lines: (Array.isArray(d.lines) ? (d.lines as Array<Record<string, unknown>>) : []).map((l) => ({ itemId: str(l.itemId), value: num(l.value), certified: num(l.certified) })),
    }))
    const variations: CostVariation[] = ((voData ?? []) as Row[]).map((d) => ({ status: str(d.status), value: num(d.value), cost: num(d.cost), executedPct: num(d.executedPct) }))
    const invoices: InvoiceFact[] = ((invData ?? []) as Row[])
      .filter((d) => d.status !== "draft")
      .map((d) => ({
        id: d.id,
        no: str(d.invoiceNumber) || d.id,
        date: str(d.issueDate) || null,
        poId: str(d.poId) || null,
        rfqId: str(d.rfqId) || null,
        lines: (Array.isArray(d.items) ? (d.items as Array<Record<string, unknown>>) : []).map((x) => ({ name: str(x.description), quantity: num(x.quantity), unitPrice: num(x.unitPrice) })),
      }))
    const direct: CostDirect[] = ((pettyData ?? []) as Row[]).map((d) => ({ itemId: str(d.itemId) || null, amount: num(d.amount), paid: true }))
    return { pos, issues, subcontracts, variations, direct, invoices, isLoading: poLoading }
  }, [pos, issueData, subData, voData, pettyData, invData, poLoading])
}

"use client"

// Aggregates a project's wasteRecords subcollection into a single "stock in vs.
// stock used" picture for accounting: total quantity taken from the warehouse,
// total quantity actually used, and the resulting waste percentage — compared
// against the project's own waste target.
//
// The collection is append-only (see firestore.rules), so a mistaken entry is
// corrected the way a ledger corrects one: by appending a reversal document that
// points back at the original. Both sides are then excluded from the totals here
// while staying visible in the ledger, so the audit trail is never rewritten.

import { collection } from "firebase/firestore"
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase"

export interface WasteRecord {
  id: string
  /** Absent on records written before reversals existed — those are all consumptions. */
  type?: "consumption" | "reversal"
  /** Set on a reversal: the id of the consumption record it cancels. */
  reversesRecordId?: string | null
  /** Groups the rows committed together by a single "issue from warehouse" action. */
  batchId?: string | null
  /** Source of the stock, needed to put it back on a reversal. Absent on legacy rows. */
  inventoryItemId?: string | null
  warehouseId?: string | null
  /** Barcode-unit document ids, needed to flip units back to in_stock on a reversal. */
  unitIds?: string[] | null
  boqItemId?: string | null
  itemName: string
  unit: string
  unitCode?: string | null
  quantityTaken: number
  quantityUsed: number
  wastePercent: number
  /** Snapshot of the item's cost at the time of issue — later price edits must not rewrite history. */
  unitCost?: number | null
  /** wasted quantity x unitCost, in SAR. Null when the item has no cost on file. */
  wasteValue?: number | null
  /** Canonical category from `@/lib/waste-reasons`. */
  reasonCode?: string | null
  /** Free-text detail for this specific row. */
  reasonNote?: string | null
  /** The over-target justification for the batch this row belongs to. */
  exceptionReason?: string | null
  unitBarcodes?: string[] | null
  wastedUnitBarcodes?: string[] | null
  recordedByUserId: string
  recordedByUserName: string
  createdAt?: unknown
}

export interface WasteByReason {
  code: string
  quantity: number
  value: number
}

export interface ProjectWasteStats {
  /** Every document, reversals and reversed originals included, newest first. */
  records: WasteRecord[]
  /** Ids of consumption records cancelled by a reversal. */
  reversedIds: Set<string>
  /** Only the records that still count — what the totals below are computed from. */
  activeRecords: WasteRecord[]
  totalTaken: number
  totalUsed: number
  totalWaste: number
  wastePercent: number
  /** Value of the wasted quantity in SAR, across records that carry a unit cost. */
  totalWasteValue: number
  /** How much of the waste could be valued — a partial figure must say so. */
  valuedRecordCount: number
  byReason: WasteByReason[]
  isLoading: boolean
}

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis()
  }
  return 0
}

/**
 * The whole aggregation, as a pure function of the raw documents — kept separate from
 * the hook so the netting rules (which reversal cancels which entry, what still counts
 * toward the percentage, how partial valuation is reported) can be tested directly.
 */
export function aggregateWasteRecords(all: WasteRecord[]): Omit<ProjectWasteStats, "isLoading"> {
  const records = all.slice().sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))

  const reversedIds = new Set(
    all.filter((r) => r.type === "reversal" && r.reversesRecordId).map((r) => r.reversesRecordId as string)
  )
  // A reversal and the row it cancels both drop out of the totals; keeping either
  // one would double-count or leave a phantom.
  const activeRecords = records.filter((r) => r.type !== "reversal" && !reversedIds.has(r.id))

  const totalTaken = activeRecords.reduce((sum, r) => sum + (r.quantityTaken || 0), 0)
  const totalUsed = activeRecords.reduce((sum, r) => sum + (r.quantityUsed || 0), 0)
  const totalWaste = Math.max(0, totalTaken - totalUsed)
  const wastePercent = totalTaken > 0 ? parseFloat(((totalWaste / totalTaken) * 100).toFixed(1)) : 0

  const valued = activeRecords.filter((r) => r.wasteValue != null)
  const totalWasteValue = valued.reduce((sum, r) => sum + (r.wasteValue || 0), 0)

  const reasonMap = new Map<string, WasteByReason>()
  activeRecords.forEach((r) => {
    const wasted = Math.max(0, (r.quantityTaken || 0) - (r.quantityUsed || 0))
    if (wasted <= 0) return
    const code = r.reasonCode || "unspecified"
    const entry = reasonMap.get(code) || { code, quantity: 0, value: 0 }
    entry.quantity += wasted
    entry.value += r.wasteValue || 0
    reasonMap.set(code, entry)
  })
  const byReason = [...reasonMap.values()].sort((a, b) => b.quantity - a.quantity)

  return {
    records,
    reversedIds,
    activeRecords,
    totalTaken,
    totalUsed,
    totalWaste,
    wastePercent,
    totalWasteValue,
    valuedRecordCount: valued.length,
    byReason,
  }
}

export function useProjectWasteStats(projectId: string | undefined | null): ProjectWasteStats {
  const firestore = useFirestore()

  const wasteQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "wasteRecords")
  }, [firestore, projectId])
  const { data, isLoading } = useCollection(wasteQuery)

  return { ...aggregateWasteRecords((data || []) as WasteRecord[]), isLoading }
}

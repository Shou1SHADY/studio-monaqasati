"use client"

// Aggregates a project's wasteRecords subcollection into a single "stock in vs.
// stock used" picture for accounting: total quantity taken from the warehouse,
// total quantity actually used, and the resulting waste percentage — compared
// against the project's own waste target.

import { collection } from "firebase/firestore"
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase"

export interface WasteRecord {
  id: string
  boqItemId?: string | null
  itemName: string
  unit: string
  quantityTaken: number
  quantityUsed: number
  wastePercent: number
  unitBarcodes?: string[] | null
  wastedUnitBarcodes?: string[] | null
  recordedByUserId: string
  recordedByUserName: string
  createdAt?: unknown
}

export interface ProjectWasteStats {
  records: WasteRecord[]
  totalTaken: number
  totalUsed: number
  totalWaste: number
  wastePercent: number
  isLoading: boolean
}

export function useProjectWasteStats(projectId: string | undefined | null): ProjectWasteStats {
  const firestore = useFirestore()

  const wasteQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "wasteRecords")
  }, [firestore, projectId])
  const { data, isLoading } = useCollection(wasteQuery)

  const records = (data || []) as WasteRecord[]
  const totalTaken = records.reduce((sum, r) => sum + (r.quantityTaken || 0), 0)
  const totalUsed = records.reduce((sum, r) => sum + (r.quantityUsed || 0), 0)
  const totalWaste = Math.max(0, totalTaken - totalUsed)
  const wastePercent = totalTaken > 0 ? parseFloat(((totalWaste / totalTaken) * 100).toFixed(1)) : 0

  return { records, totalTaken, totalUsed, totalWaste, wastePercent, isLoading }
}

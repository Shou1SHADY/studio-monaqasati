"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { SUPPLIER_RECORDS, type SupplierRecord } from "@/lib/procurement/supplier-file"

/** Our records of our suppliers (verified, VAT, CR), keyed by the supplier's org id. */
export function useSupplierRecords(orgId: string | null | undefined): Map<string, SupplierRecord> {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, SUPPLIER_RECORDS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data } = useCollection<Omit<SupplierRecord, "id">>(q)
  return useMemo(() => new Map(((data || []) as SupplierRecord[]).filter((r) => r.supplierOrgId).map((r) => [r.supplierOrgId, r])), [data])
}

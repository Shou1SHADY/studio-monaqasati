"use client"

import { useEffect, useState } from "react"
import { doc, getDoc } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { supplierIdentityOf, type SupplierIdentity } from "@/lib/procurement/receipt-print"

/**
 * A registered supplier's CR, VAT, city and phone, for the printed receipt and
 * the receipt statement. Read once when the drawer opens — not at print time,
 * where a wait would cost the pop-up its click. The profile is the supplier's
 * user, else its secondary company (as `useProcurementWorld` reads it); a guest
 * or an unreadable profile gives null and the paper prints what it has.
 */
export function useSupplierIdentity(supplierOrgId: string | null | undefined, vatFallback?: string | null): SupplierIdentity | null {
  const firestore = useFirestore()
  const [identity, setIdentity] = useState<SupplierIdentity | null>(null)
  useEffect(() => {
    setIdentity(null)
    if (!firestore || !supplierOrgId || supplierOrgId === "guest") return
    let cancelled = false
    ;(async () => {
      try {
        let snap = await getDoc(doc(firestore, "users", supplierOrgId))
        if (!snap.exists()) snap = await getDoc(doc(firestore, "organizations", supplierOrgId))
        if (!cancelled) setIdentity(supplierIdentityOf(snap.exists() ? (snap.data() as Record<string, unknown>) : null, vatFallback))
      } catch (err) {
        console.warn("supplier identity not read:", (err as { code?: string })?.code || err)
        if (!cancelled) setIdentity(supplierIdentityOf(null, vatFallback))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [firestore, supplierOrgId, vatFallback])
  return identity
}

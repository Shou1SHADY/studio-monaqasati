"use client"

import { useMemo } from "react"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { COMPANY_MODULES, offSet } from "@/lib/company-modules"
import { CONNECTORS, packageOf, type Connector, type PackageFlags } from "@/lib/procurement/package"
import { subscriptionStatusOf, type SubscriptionStatus } from "@/lib/subscription-status"

export interface CompanyPackage {
  off: string[]
  pkg: PackageFlags
  /** The connectors the company said «yes» to and does not have — the admin's reminder. */
  missing: Connector[]
  /** «نشط» / «تجريبي» beside the package (AD-03) — no field is Active. */
  subscription: SubscriptionStatus
}

const answerOf = (raw: unknown) => raw === 1

/** Every contractor company's package, by company id — the admin lists it. A company with no document has the full package. */
export function useCompanyPackages(): { byOrg: ReadonlyMap<string, CompanyPackage>; isLoading: boolean } {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const q = useMemoFirebase(() => (firestore && user && !isUserLoading ? collection(firestore, COMPANY_MODULES) : null), [firestore, user, isUserLoading])
  const { data, isLoading } = useCollection(q)
  const byOrg = useMemo(() => {
    const map = new Map<string, CompanyPackage>()
    for (const row of (data || []) as Array<{ id: string; off?: unknown; needs?: Record<string, unknown>; subscription?: unknown }>) {
      const off = [...offSet(row, "contractor")]
      const pkg = packageOf(off)
      map.set(row.id, { off, pkg, missing: CONNECTORS.filter((c) => answerOf(row.needs?.[c]) && !pkg[c]), subscription: subscriptionStatusOf(row.subscription) })
    }
    return map
  }, [data])
  return { byOrg, isLoading }
}

export const FULL_COMPANY_PACKAGE: CompanyPackage = { off: [], pkg: packageOf([]), missing: [], subscription: "active" }

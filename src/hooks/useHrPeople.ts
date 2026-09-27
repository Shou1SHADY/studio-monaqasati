"use client"

// HR 1.0 — the org's people and workplaces, as the HR screens read them. Pay is
// read separately, and only by roles that may see it (useEmployeePay).

import { useMemo } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { HR_EMPLOYEES, HR_PAY, HR_SITES } from "@/lib/hr/collections"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrSite } from "@/lib/hr/sites"

export function useHrPeople(orgId: string | null, enabled = true) {
  const firestore = useFirestore()
  const empQ = useMemoFirebase(() => (firestore && orgId && enabled ? query(collection(firestore, HR_EMPLOYEES), where("organizationId", "==", orgId)) : null), [firestore, orgId, enabled])
  const { data: empData, isLoading } = useCollection(empQ)
  // Workplaces are readable by every member (My file names his own); only the people are gated.
  const sitesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_SITES), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: sitesData } = useCollection(sitesQ)
  return useMemo(() => {
    const employees = ((empData ?? []) as unknown as HrEmployee[]).slice().sort((a, b) => (a.no ?? 0) - (b.no ?? 0))
    const sites = (sitesData ?? []) as unknown as HrSite[]
    const siteName = (id: string | null | undefined) => sites.find((s) => s.id === id)?.name ?? null
    return { employees, sites, siteName, isLoading }
  }, [empData, sitesData, isLoading])
}

/** Every pay document of the org — for money roles only (the rules refuse others). */
export function useOrgPay(orgId: string | null, enabled: boolean) {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId && enabled ? query(collection(firestore, HR_PAY), where("organizationId", "==", orgId)) : null), [firestore, orgId, enabled])
  const { data } = useCollection(q)
  return useMemo(() => new Map(((data ?? []) as unknown as EmployeePay[]).map((p) => [p.employeeId, p])), [data])
}

/** One employee's pay — for money roles and the employee himself. */
export function useEmployeePay(employeeId: string | null, enabled: boolean) {
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore && employeeId && enabled ? doc(firestore, HR_PAY, employeeId) : null), [firestore, employeeId, enabled])
  const { data, isLoading } = useDoc(ref)
  return { pay: (data as unknown as EmployeePay | null) ?? null, isLoading }
}

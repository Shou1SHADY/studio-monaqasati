"use client"

// HR 1.0 — the org's people and workplaces, as the HR screens read them. Pay is
// read separately, and only by roles that may see it (useEmployeePay).

import { useMemo } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useScopedCollection } from "@/hooks/useScopedCollection"
import { hrPeopleScope } from "@/lib/hr/access"
import { HR_EMPLOYEES, HR_PAY, HR_SITES } from "@/lib/hr/collections"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrSite } from "@/lib/hr/sites"
import { todayDay } from "@/lib/hr/format"
import { payOn } from "@/lib/hr/pay"

/** The people the viewer may read (RL-01): the whole company for every HR role but the supervisor; a
 * supervisor's own workplaces, asked site by site (`hrPeopleScope`) — the rules refuse him a company-wide list. */
export function useHrPeople(access: Pick<HrAccess, "orgId" | "ctx">, enabled = true) {
  const firestore = useFirestore()
  const orgId = access.orgId
  const { data: empData, isLoading } = useScopedCollection<HrEmployee>(HR_EMPLOYEES, orgId, hrPeopleScope(access.ctx), enabled)
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
  // The figures in force today (EM-04: a future-dated change waits for its day); the history stays on
  // the document for the screens that compute a month.
  return useMemo(() => {
    const today = todayDay()
    return new Map(((data ?? []) as unknown as EmployeePay[]).map((p) => [p.employeeId, payOn(p, today)]))
  }, [data])
}

/** One employee's pay — for money roles and the employee himself — as in force today. */
export function useEmployeePay(employeeId: string | null, enabled: boolean) {
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore && employeeId && enabled ? doc(firestore, HR_PAY, employeeId) : null), [firestore, employeeId, enabled])
  const { data, isLoading } = useDoc(ref)
  const pay = useMemo(() => (data ? payOn(data as unknown as EmployeePay, todayDay()) : null), [data])
  return { pay, isLoading }
}

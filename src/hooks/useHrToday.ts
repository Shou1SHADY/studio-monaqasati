"use client"

// HR 1.0 — what Today reads, the way the rules let each role read it: pay
// roles and management list the org's workplace months, payrolls and pay; a
// supervisor reads his own workplaces' months one by one (he may not list).

import { useEffect, useMemo, useState } from "react"
import { collection, doc, getDoc, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import { attendanceId, type WorkplaceMonth } from "@/lib/hr/attendance"
import { HR_ATTENDANCE, HR_EXITS, HR_INJURIES, HR_PAYROLLS } from "@/lib/hr/collections"
import type { HrExit } from "@/lib/hr/exit-writes"
import type { HrInjury } from "@/lib/hr/injuries"
import { MANPOWER_REQUESTS, type ManpowerRequest } from "@/lib/hr/manpower"
import type { Payroll } from "@/lib/hr/payroll"
import { HR_ASSIGN_FIXES, type AssignFix } from "@/lib/hr/sites"
import { addDays } from "@/lib/hr/statutory"

function useWorkplaceMonths(access: HrAccess, month: string): WorkplaceMonth[] {
  const firestore = useFirestore()
  const orgId = access.orgId
  const canList = access.ctx.roles.has("manager") || access.ctx.roles.has("payroll") || access.ctx.roles.has("management")
  const q = useMemoFirebase(() => (firestore && orgId && canList ? query(collection(firestore, HR_ATTENDANCE), where("organizationId", "==", orgId), where("month", "==", month)) : null), [firestore, orgId, canList, month])
  const { data } = useCollection(q)
  const [own, setOwn] = useState<WorkplaceMonth[]>([])
  const siteKey = access.ctx.sites.join(",")
  useEffect(() => {
    if (!firestore || !orgId || canList || !siteKey) return
    let live = true
    Promise.all(siteKey.split(",").map((s) => getDoc(doc(firestore, HR_ATTENDANCE, attendanceId(orgId, s, month))).catch(() => null)))
      .then((snaps) => live && setOwn(snaps.filter((x) => x?.exists()).map((x) => ({ id: x!.id, ...(x!.data() as Omit<WorkplaceMonth, "id">) }))))
      .catch(() => live && setOwn([]))
    return () => {
      live = false
    }
  }, [firestore, orgId, canList, siteKey, month])
  return canList ? ((data ?? []) as unknown as WorkplaceMonth[]) : own
}

export function useHrToday(access: HrAccess, today: string) {
  const firestore = useFirestore()
  const orgId = access.orgId
  const staff = access.ctx.roles.size > 0
  const payRoles = access.allowed("pay.view")
  const { employees, sites } = useHrPeople(orgId, staff)
  const pays = useOrgPay(orgId, payRoles)
  const { requests } = useHrRequests(access)
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
  const lastWm = useWorkplaceMonths(access, lastMonth)
  const thisWm = useWorkplaceMonths(access, today.slice(0, 7))
  const orgQ = (name: string, on: boolean) => (firestore && orgId && on ? query(collection(firestore, name), where("organizationId", "==", orgId)) : null)
  const injQ = useMemoFirebase(() => orgQ(HR_INJURIES, staff), [firestore, orgId, staff])
  const exQ = useMemoFirebase(() => orgQ(HR_EXITS, staff), [firestore, orgId, staff])
  const prQ = useMemoFirebase(() => orgQ(HR_PAYROLLS, payRoles), [firestore, orgId, payRoles])
  const { data: inj } = useCollection(injQ)
  const { data: ex } = useCollection(exQ)
  const { data: pr } = useCollection(prQ)
  const answers = access.allowed("manpower.answer")
  const mpQ = useMemoFirebase(() => (firestore && orgId && answers ? query(collection(firestore, MANPOWER_REQUESTS), where("organizationId", "==", orgId), where("state", "==", "open")) : null), [firestore, orgId, answers])
  const { data: mp } = useCollection(mpQ)
  // AS-03 — pending assignment corrections, for the hand that decides them.
  const decidesFixes = access.allowed("employee.assign")
  const afQ = useMemoFirebase(() => (firestore && orgId && decidesFixes ? query(collection(firestore, HR_ASSIGN_FIXES), where("organizationId", "==", orgId), where("state", "==", "pending")) : null), [firestore, orgId, decidesFixes])
  const { data: af } = useCollection(afQ)
  return useMemo(
    () => ({
      employees,
      sites,
      pays,
      requests,
      lastMonth: lastWm,
      thisMonth: thisWm,
      injuries: (inj ?? []) as unknown as HrInjury[],
      exits: (ex ?? []) as unknown as HrExit[],
      payrolls: (pr ?? []) as unknown as Payroll[],
      manpower: (mp ?? []) as unknown as ManpowerRequest[],
      assignFixes: (af ?? []) as unknown as AssignFix[],
    }),
    [employees, sites, pays, requests, lastWm, thisWm, inj, ex, pr, mp, af]
  )
}

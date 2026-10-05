"use client"

// HR 1.0 — the requests a viewer may read, the way the rules let him: pay roles
// read them all; government relations and supervisors read leaves and attendance
// corrections (an advance carries money); everyone reads his own.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useScopedCollection } from "@/hooks/useScopedCollection"
import { hrPeopleScope } from "@/lib/hr/access"
import { HR_REQUESTS } from "@/lib/hr/collections"
import type { HrRequest } from "@/lib/hr/requests"

export function useHrRequests(access: HrAccess) {
  const firestore = useFirestore()
  const orgId = access.orgId
  const all = access.allowed("pay.view")
  const leaves = !all && access.ctx.roles.size > 0
  const allQ = useMemoFirebase(() => (firestore && orgId && all ? query(collection(firestore, HR_REQUESTS), where("organizationId", "==", orgId)) : null), [firestore, orgId, all])
  // Leaves: government relations the company's; a supervisor his own workplaces', site by site (RL-01).
  const { data: l } = useScopedCollection(HR_REQUESTS, orgId, hrPeopleScope(access.ctx), leaves, [["kind", "leave"]])
  // …and attendance corrections the same way: the supervisor who keeps the sheet decides them (PRD form 11).
  const { data: f } = useScopedCollection(HR_REQUESTS, orgId, hrPeopleScope(access.ctx), leaves, [["kind", "attfix"]])
  const ownQ = useMemoFirebase(
    () => (firestore && orgId && !all && access.ctx.uid ? query(collection(firestore, HR_REQUESTS), where("organizationId", "==", orgId), where("employeeUserId", "==", access.ctx.uid)) : null),
    [firestore, orgId, all, access.ctx.uid]
  )
  const { data: a, isLoading } = useCollection(allQ)
  const { data: o } = useCollection(ownQ)
  return useMemo(() => {
    const m = new Map<string, HrRequest>()
    for (const r of [...(a ?? []), ...(l ?? []), ...(f ?? []), ...(o ?? [])] as unknown as HrRequest[]) m.set(r.id, r)
    const requests = [...m.values()].sort((x, y) => (y.createdAt ?? "").localeCompare(x.createdAt ?? ""))
    return { requests, isLoading }
  }, [a, l, f, o, isLoading])
}

"use client"

// What the head of every Procurement page shows (the reference prototype's
// shell): the three numbers, the count on each tab of the rail, and the
// viewer's authority — every page, not Today alone. Derived on every read.

import { useMemo, useState } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { WORK_ORDERS } from "@/lib/manufacturing"
import { procTabCounts, toProcWorld, type ProcTabCounts } from "@/lib/procurement/shell"
import { todayKpis, todayTasks, type ProcKpis } from "@/lib/procurement/today"

export interface ProcurementShell {
  loading: boolean
  kpis: ProcKpis | null
  counts: ProcTabCounts
  /** The owner approves any order; `po.approve` up to the manager limit; others none. */
  approvalLimit: "any" | number | null
}

type OrderWithRequests = { status?: string; purchaseRequests?: Array<{ state?: string }> }

export function useProcurementShell(): ProcurementShell {
  const firestore = useFirestore()
  const loaded = useProcurementWorld()
  const { actor, loading, orders, deliveries, rfqs, offers, policies, supplierFacts, orgId } = loaded
  const { agreements } = useProcurementPrices(orgId)
  const [now] = useState(() => new Date())

  const woQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: workOrders } = useCollection(woQ)
  const incomingRequests = useMemo(
    () => ((workOrders || []) as OrderWithRequests[]).filter((o) => o.status === "open").reduce((a, o) => a + (o.purchaseRequests || []).filter((p) => p.state === "sent").length, 0),
    [workOrders]
  )

  const world = useMemo(() => ({ ...toProcWorld({ orders, deliveries, rfqs, offers, policies, supplierFacts }), agreements }), [orders, deliveries, rfqs, offers, policies, supplierFacts, agreements])
  const tasks = useMemo(() => todayTasks(world, actor, now), [world, actor, now])
  const kpis = useMemo(() => (loading ? null : todayKpis(world, actor, now)), [loading, world, actor, now])
  const counts = useMemo(() => procTabCounts({ tasks: tasks.length, incomingRequests, rfqs, orders, now }), [tasks.length, incomingRequests, rfqs, orders, now])
  const approvalLimit = actor.isOwner ? "any" : actor.canApprove ? policies.managerApprovalLimit : null

  return { loading, kpis, counts, approvalLimit }
}

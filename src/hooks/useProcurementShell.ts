"use client"

// What the head of every Procurement page shows (the reference prototype's
// shell): the three numbers, the count on each tab of the rail, and the
// viewer's authority — every page, not Today alone. Derived on every read.

import { useMemo, useState } from "react"
import { useProcurementNeeds } from "@/hooks/useProcurementNeeds"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useRfqQueries } from "@/hooks/useRfqQueries"
import { actionRows, inBuyerScope } from "@/lib/procurement/need-desk"
import { procRole, procTabCounts, toProcWorld, type ProcRole, type ProcTabCounts } from "@/lib/procurement/shell"
import { todayKpis, todayTasks, type ProcKpis } from "@/lib/procurement/today"

export interface ProcurementShell {
  loading: boolean
  kpis: ProcKpis | null
  counts: ProcTabCounts
  /** The owner approves any order; `po.approve` up to the manager limit; others none. */
  approvalLimit: "any" | number | null
  role: ProcRole | null
  /** A buyer's categories, when set. */
  categories: string[] | null
}

export function useProcurementShell(): ProcurementShell {
  const loaded = useProcurementWorld()
  const { actor, loading, orders, deliveries, rfqs, offers, policies, supplierFacts, supplierRecords, orgId } = loaded
  const { agreements, history } = useProcurementPrices(orgId)
  const needs = useProcurementNeeds(loaded)
  const [now] = useState(() => new Date())
  const openRfqIds = useMemo(() => rfqs.filter((r) => r.status === "New").map((r) => r.id), [rfqs])
  const rfqQueries = useRfqQueries(openRfqIds)

  const needDesk = useMemo(() => ({ rows: needs.rows, buyers: needs.buyers, viewerCategories: needs.viewerCategories }), [needs.rows, needs.buyers, needs.viewerCategories])
  const world = useMemo(
    () => ({ ...toProcWorld({ orders, deliveries, rfqs, offers, policies, supplierFacts }), agreements, history, supplierRecords, needDesk, rfqQueries, ownerHasTeam: needs.ownerHasTeam }),
    [orders, deliveries, rfqs, offers, policies, supplierFacts, agreements, history, supplierRecords, needDesk, rfqQueries, needs.ownerHasTeam]
  )
  const tasks = useMemo(() => todayTasks(world, actor, now), [world, actor, now])
  const kpis = useMemo(() => (loading ? null : todayKpis(world, actor, now)), [loading, world, actor, now])
  const incomingRequests = useMemo(() => actionRows(needs.rows).filter((r) => inBuyerScope(r, needs.viewerCategories)).length, [needs.rows, needs.viewerCategories])
  const counts = useMemo(() => procTabCounts({ tasks: tasks.length, incomingRequests, rfqs, orders, receipts: deliveries, now }), [tasks.length, incomingRequests, rfqs, orders, deliveries, now])
  const approvalLimit = actor.isOwner ? "any" : actor.canApprove ? policies.managerApprovalLimit : null

  return { loading, kpis, counts, approvalLimit, role: procRole(actor, needs.ownerHasTeam), categories: needs.viewerCategories }
}

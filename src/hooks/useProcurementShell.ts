"use client"

// What the head of every Procurement page shows (the reference prototype's
// shell): the three numbers, the count on each tab of the rail, and the
// viewer's authority — every page, not Today alone. Derived on every read.
// `useProcTodayWorld` (`./useTodayWorld`) is the one place the Today world is
// assembled, so the header's counts and the Today screen can never read different worlds.

import { incomingCardCounts, requestCards } from "@/lib/procurement/incoming-requests"
import { useMemo } from "react"
import { useProcTodayWorld } from "@/hooks/useTodayWorld"
import type { ProcurementWorld } from "@/hooks/useProcurementWorld"
import { inBuyerScope } from "@/lib/procurement/need-desk"
import { isBuyer, rfqInScope } from "@/lib/procurement/rfq-view"
import { procRole, procTabCounts, type ProcRole, type ProcTabCounts } from "@/lib/procurement/shell"
import { todayKpis, type ProcKpis } from "@/lib/procurement/kpis"
import { todayTasks, type RfqFact, type TodayActor } from "@/lib/procurement/today"

export interface ProcurementShell {
  loading: boolean
  kpis: ProcKpis | null
  counts: ProcTabCounts
  /** The owner approves any order; `po.approve` up to the manager limit; others none. */
  approvalLimit: "any" | number | null
  role: ProcRole | null
  /** A buyer's categories, when set. */
  categories: string[] | null
  /** The owner has a procurement team: he reads, and the page heads hide their actions from him. */
  ownerReadOnly: boolean
  /** What the page heads' own actions need (the orders tab's service order). */
  loaded: ProcurementWorld
  actor: TodayActor
}

export function useProcurementShell(): ProcurementShell {
  const { loaded, needs, world, actor, now } = useProcTodayWorld()
  const { loading, orders, deliveries, rfqs, policies } = loaded
  const tasks = useMemo(() => todayTasks(world, actor, now), [world, actor, now])
  const kpis = useMemo(() => (loading ? null : todayKpis(world, actor, now)), [loading, world, actor, now])
  // The rail counts REQUESTS that are new (PUR-01/08: «2 جديدة»), not their lines — a request prepared into a draft is not new; the remainder of a partly handled one is new again.
  const incomingRequests = useMemo(
    () => incomingCardCounts(requestCards(needs.rows.filter((r) => inBuyerScope(r, needs.viewerCategories)), world.rfqs as Array<{ id: string; status?: string | null; needSources?: unknown; purchaseSource?: unknown }>)).new,
    [needs.rows, needs.viewerCategories, world.rfqs]
  )
  const counts = useMemo(() => {
    // The badge counts what the RFQ list shows: the list scopes a buyer by `isBuyer` (rfq-view), so the badge does too.
    const scope = { uid: actor.uid, isOwner: actor.isOwner, canApprove: actor.canApprove, canPrepare: actor.canPrepare }
    const byId = new Map(world.rfqs.map((r) => [r.id, r]))
    const inScope = isBuyer(scope) ? (r: { status?: string | null }) => rfqInScope(byId.get((r as { id: string }).id) as RfqFact, scope) : undefined
    return procTabCounts({ tasks: tasks.length, incomingRequests, rfqs, orders, receipts: deliveries, now, rfqInScope: inScope })
  }, [tasks.length, incomingRequests, rfqs, orders, deliveries, now, actor, world.rfqs])
  const approvalLimit = actor.isOwner ? "any" : actor.canApprove ? policies.managerApprovalLimit : null

  return { loading, kpis, counts, approvalLimit, role: procRole(actor, needs.ownerHasTeam), categories: needs.viewerCategories, ownerReadOnly: actor.isOwner && needs.ownerHasTeam, loaded, actor }
}

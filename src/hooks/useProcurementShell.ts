"use client"

// What the head of every Procurement page shows (the reference prototype's
// shell): the three numbers, the count on each tab of the rail, and the
// viewer's authority — every page, not Today alone. Derived on every read.
// `useProcTodayWorld` is the one place the Today world is assembled, so the
// header's counts and the Today screen can never read different worlds.

import { useMemo, useState } from "react"
import { useModules } from "@/hooks/useCompanyModules"
import { usePermissions } from "@/hooks/usePermissions"
import { usePmBoundaryEvents } from "@/hooks/usePmBoundaryEvents"
import { useProcurementNeeds } from "@/hooks/useProcurementNeeds"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useProcurementWorld, type ProcurementWorld } from "@/hooks/useProcurementWorld"
import { useRfqQueries } from "@/hooks/useRfqQueries"
import { actionRows, inBuyerScope } from "@/lib/procurement/need-desk"
import { isBuyer, rfqInScope } from "@/lib/procurement/rfq-view"
import { useBudgetOverruns, useForwardFacts, useMfgReadyDates } from "@/hooks/useProcShellFacts"
import { useSampleNumbers } from "@/hooks/useSampleNumbers"
import { procRole, procTabCounts, toProcWorld, type ProcRole, type ProcTabCounts } from "@/lib/procurement/shell"
import { todayKpis, todayTasks, type ProcKpis, type ProcWorld, type RfqFact, type TodayActor } from "@/lib/procurement/today"

export interface ProcTodayWorld {
  loaded: ProcurementWorld
  needs: ReturnType<typeof useProcurementNeeds>
  world: ProcWorld
  actor: TodayActor
  now: Date
}

export function useProcTodayWorld(): ProcTodayWorld {
  const loaded = useProcurementWorld()
  const { can } = usePermissions()
  const { orders, deliveries, rfqs, offers, policies, supplierFacts, supplierRecords, orgId } = loaded
  const { agreements, history } = useProcurementPrices(orgId)
  const needs = useProcurementNeeds(loaded)
  const [now] = useState(() => new Date())
  const openRfqIds = useMemo(() => rfqs.filter((r) => r.status === "New").map((r) => r.id), [rfqs])
  const rfqQueries = useRfqQueries(openRfqIds)
  const { on } = useModules()
  const pmOn = on("project-management")
  const mfgOn = on("manufacturing")
  const pmEvents = usePmBoundaryEvents(orgId, pmOn)
  const canSource = can("rfq.manage")
  const actor = useMemo<TodayActor>(() => ({ ...loaded.actor, canSource: loaded.actor.canPrepare || canSource }), [loaded.actor, canSource])

  const needDesk = useMemo(() => ({ rows: needs.rows, buyers: needs.buyers, viewerCategories: needs.viewerCategories }), [needs.rows, needs.buyers, needs.viewerCategories])
  const budgetOverruns = useBudgetOverruns(orders, pmOn)
  const readyDates = useMfgReadyDates(orgId, needs.rows, needs.mfgRequests)
  const forwardFacts = useForwardFacts(orgId, deliveries, orders, policies, pmOn)
  const sampleNos = useSampleNumbers(needs.rows)
  const world = useMemo(() => {
    const base = toProcWorld({ orders, deliveries, rfqs, offers, policies, supplierFacts })
    const raw = new Map(rfqs.map((r) => [r.id, r as typeof r & { rfqNumber?: string | null; closedEarly?: { at?: string | null } | null }]))
    const withRecord = base.rfqs.map((r) => ({ ...r, number: raw.get(r.id)?.rfqNumber ?? null, closedEarly: raw.get(r.id)?.closedEarly ?? null }))
    return { ...base, rfqs: withRecord, agreements, history, supplierRecords, needDesk, rfqQueries, pmEvents, ownerHasTeam: needs.ownerHasTeam, budgetOverruns, readyDates, forwardFacts, sampleNos, projectsOn: pmOn, workshopOn: mfgOn }
  }, [pmOn, mfgOn, orders, deliveries, rfqs, offers, policies, supplierFacts, agreements, history, supplierRecords, needDesk, rfqQueries, pmEvents, needs.ownerHasTeam, budgetOverruns, readyDates, forwardFacts, sampleNos])
  return { loaded, needs, world, actor, now }
}

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
  const incomingRequests = useMemo(() => actionRows(needs.rows).filter((r) => inBuyerScope(r, needs.viewerCategories)).length, [needs.rows, needs.viewerCategories])
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

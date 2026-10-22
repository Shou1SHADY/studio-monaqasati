"use client"

// The Today world: everything the queue, the waits, the route strip and the invitations read, assembled in ONE place so the
// header's counts and the Today screen can never read different worlds. The pure layer (`src/lib/procurement/today.ts`) derives the
// rest; this hook only gathers — the orders and deliveries, the RFQs and their offers with the buyer's decisions, the stored
// incoming requests, the platform invitations, and the facts other modules own.

import { useMemo, useState } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { useIncomingDocs } from "@/hooks/useIncomingDocs"
import { usePermissions } from "@/hooks/usePermissions"
import { usePmBoundaryEvents } from "@/hooks/usePmBoundaryEvents"
import { useBudgetOverruns, useForwardFacts, useMfgReadyDates } from "@/hooks/useProcShellFacts"
import { useProcurementNeeds } from "@/hooks/useProcurementNeeds"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useProcurementWorld, type ProcurementWorld } from "@/hooks/useProcurementWorld"
import { useRfqQueries } from "@/hooks/useRfqQueries"
import { useSampleNumbers } from "@/hooks/useSampleNumbers"
import { supplierInvitationsQuery } from "@/lib/procurement/invite-query"
import { OFFER_DECISIONS, type DecisionMap, type OfferDecision } from "@/lib/procurement/offer-decisions"
import { toProcWorld, visibleProcTabs } from "@/lib/procurement/shell"
import type { InvitationFact, ProcWorld, TodayActor } from "@/lib/procurement/today"

export interface ProcTodayWorld {
  loaded: ProcurementWorld
  needs: ReturnType<typeof useProcurementNeeds>
  world: ProcWorld
  actor: TodayActor
  now: Date
}

/** The buyer's decisions on every offer of the company (a live offer is one nobody excluded), for whoever sources. */
function useOrgDecisions(orgId: string | null | undefined, enabled: boolean): DecisionMap {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId && enabled ? query(collection(firestore, OFFER_DECISIONS), where("organizationId", "==", orgId)) : null), [firestore, orgId, enabled])
  const { data } = useCollection<OfferDecision>(q)
  return useMemo(() => Object.fromEntries(((data || []) as Array<OfferDecision & { id: string }>).map((d) => [d.id, d])), [data])
}

function useInvitations(orgId: string | null | undefined, enabled: boolean): InvitationFact[] {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId && enabled ? supplierInvitationsQuery(firestore, orgId) : null), [firestore, orgId, enabled])
  const { data } = useCollection<InvitationFact>(q)
  return useMemo(() => (data || []) as InvitationFact[], [data])
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
  const financeOn = on("payments")
  const pmEvents = usePmBoundaryEvents(orgId, pmOn)
  const canSource = can("rfq.manage")
  const actor = useMemo<TodayActor>(() => ({ ...loaded.actor, canSource: loaded.actor.canPrepare || canSource }), [loaded.actor, canSource])
  const sources = actor.canPrepare || actor.canApprove || actor.isOwner || Boolean(actor.canSource)
  const seesSuppliers = visibleProcTabs(can).some((t) => t.id === "suppliers")
  const decisions = useOrgDecisions(orgId, sources)
  const invitations = useInvitations(orgId, seesSuppliers)
  const incoming = useIncomingDocs(orgId || null)

  const needDesk = useMemo(() => ({ rows: needs.rows, buyers: needs.buyers, viewerCategories: needs.viewerCategories }), [needs.rows, needs.buyers, needs.viewerCategories])
  const budgetOverruns = useBudgetOverruns(orders, pmOn)
  const readyDates = useMfgReadyDates(orgId, needs.rows, needs.mfgRequests)
  const forwardFacts = useForwardFacts(orgId, deliveries, orders, policies, pmOn)
  const sampleNos = useSampleNumbers(needs.rows)
  const world = useMemo(() => {
    const base = toProcWorld({ orders, deliveries, rfqs, offers, policies, supplierFacts })
    const raw = new Map(rfqs.map((r) => [r.id, r as typeof r & { rfqNumber?: string | null; closedEarly?: { at?: string | null } | null }]))
    const withRecord = base.rfqs.map((r) => ({ ...r, number: raw.get(r.id)?.rfqNumber ?? null, closedEarly: raw.get(r.id)?.closedEarly ?? null }))
    return {
      ...base,
      rfqs: withRecord,
      decisions,
      incomingDocs: incoming.docs,
      invitations,
      agreements,
      history,
      supplierRecords,
      needDesk,
      rfqQueries,
      pmEvents,
      ownerHasTeam: needs.ownerHasTeam,
      budgetOverruns,
      readyDates,
      forwardFacts,
      sampleNos,
      projectsOn: pmOn,
      workshopOn: mfgOn,
      financeOn,
    }
  }, [pmOn, mfgOn, financeOn, orders, deliveries, rfqs, offers, policies, supplierFacts, decisions, incoming.docs, invitations, agreements, history, supplierRecords, needDesk, rfqQueries, pmEvents, needs.ownerHasTeam, budgetOverruns, readyDates, forwardFacts, sampleNos])
  return { loaded, needs, world, actor, now }
}

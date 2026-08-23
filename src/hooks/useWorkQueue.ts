"use client"

// Aggregates real actionable items across a contractor org into one
// prioritized "your work today" queue. Client-side composition of queries
// that already exist near-verbatim on their own pages — no server-side
// rollup needed (list queries are already org-scoped and unrestricted by
// firestore.rules; isolation happens via the `where` clauses below).

import { useEffect, useState } from "react"
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase"
import { collection, query, where, getDocs } from "firebase/firestore"
import { resolveProjectStatus, projectStatusLabelKey, type ProjectStatus } from "@/lib/project-status"

export type WorkQueueItemType =
  | "guarantee_expiring"
  | "rfq_decision"
  | "rfq_closing_soon"
  | "rfq_no_offers"
  | "delivery_confirm"
  | "project_waiting_approval"
  | "low_stock"
  | "team_invite_pending"

export interface WorkQueueItem {
  id: string
  type: WorkQueueItemType
  tier: number
  sortMs: number
  actionUrl: string
  data: Record<string, unknown>
}

const TIER: Record<WorkQueueItemType, number> = {
  guarantee_expiring: 1,
  rfq_closing_soon: 2,
  delivery_confirm: 3,
  rfq_decision: 4,
  project_waiting_approval: 5,
  rfq_no_offers: 6,
  low_stock: 7,
  team_invite_pending: 8,
}

// An RFQ younger than this is still fresh — no supplier has had a fair chance
// to respond yet, so flagging it as "no offers" would just be noise.
const NO_OFFERS_GRACE_MS = 3 * 24 * 60 * 60 * 1000
// Flag RFQs whose deadline is inside this window (or already passed) as closing soon.
const CLOSING_SOON_MS = 48 * 60 * 60 * 1000
// Guarantees are a compliance/financial risk, so the warning window is wider
// than an RFQ deadline — a lapsed guarantee letter is a real liability.
const GUARANTEE_EXPIRING_MS = 30 * 24 * 60 * 60 * 1000
// Project statuses that represent a stalled decision this member can act on —
// there's no milestone/date concept in the data model, so "stuck in one of
// these statuses" is the only real signal available.
const PROJECT_NEEDS_DECISION_STATUSES: ProjectStatus[] = ["waiting_approval", "pricing"]

function toMs(v: unknown): number {
  if (!v) return 0
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().getTime()
  }
  const t = new Date(v as string | number).getTime()
  return isNaN(t) ? 0 : t
}

export function useWorkQueue(organizationId: string | undefined | null, userId: string | undefined | null) {
  const firestore = useFirestore()

  const rfqsQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "rfqs"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: rfqs } = useCollection(rfqsQuery)

  const offersQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "offers"), where("contractorOrgId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: offers } = useCollection(offersQuery)

  const deliveriesQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(
      collection(firestore, "deliveries"),
      where("contractorOrgId", "==", organizationId),
      where("status", "==", "pending_confirmation")
    )
  }, [firestore, organizationId])
  const { data: deliveries } = useCollection(deliveriesQuery)

  const warehousesQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "warehouses"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: warehouses } = useCollection(warehousesQuery)

  const guaranteesQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(
      collection(firestore, "guarantees"),
      where("contractorOrgId", "==", organizationId),
      where("hasGuarantee", "==", true)
    )
  }, [firestore, organizationId])
  const { data: guarantees } = useCollection(guaranteesQuery)

  const projectsQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "projects"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: projects } = useCollection(projectsQuery)

  // Firestore rules restrict `invitations` reads to `invitedBy == caller` —
  // this can only ever reflect invites the current member personally sent.
  const invitationsQuery = useMemoFirebase(() => {
    if (!firestore || !userId) return null
    return query(collection(firestore, "invitations"), where("invitedBy", "==", userId))
  }, [firestore, userId])
  const { data: invitations } = useCollection(invitationsQuery)

  // Low-stock items live in a per-warehouse subcollection — can't be expressed as a
  // single top-level query, so fetch once (not real-time) whenever the warehouse list changes.
  const [lowStockItems, setLowStockItems] = useState<Array<{ id: string; warehouseId: string; warehouseName: string; name: string; quantity: number; minStockLevel: number }>>([])

  useEffect(() => {
    if (!firestore || !warehouses || warehouses.length === 0) {
      setLowStockItems([])
      return
    }
    let cancelled = false
    ;(async () => {
      const results: typeof lowStockItems = []
      for (const wh of warehouses as { id: string; name?: string }[]) {
        const snap = await getDocs(collection(firestore, "warehouses", wh.id, "inventoryItems"))
        snap.forEach((d) => {
          const item = d.data() as { name?: string; quantity?: number; minStockLevel?: number }
          if (item.minStockLevel != null && (item.quantity ?? 0) <= item.minStockLevel) {
            results.push({
              id: d.id,
              warehouseId: wh.id,
              warehouseName: wh.name || "",
              name: item.name || "",
              quantity: item.quantity ?? 0,
              minStockLevel: item.minStockLevel,
            })
          }
        })
      }
      if (!cancelled) setLowStockItems(results)
    })()
    return () => { cancelled = true }
  }, [firestore, warehouses])

  const items: WorkQueueItem[] = []
  const now = Date.now()

  // Guarantee letters expiring soon (or already lapsed) — a real compliance risk.
  ;(guarantees || []).forEach((g: any) => {
    if (g.status === "rejected" || !g.expirationDate) return
    const expiresMs = toMs(g.expirationDate)
    if (!expiresMs || expiresMs - now > GUARANTEE_EXPIRING_MS) return
    items.push({
      id: `guarantee_expiring_${g.id}`,
      type: "guarantee_expiring",
      tier: TIER.guarantee_expiring,
      sortMs: now - expiresMs,
      actionUrl: "/contractor/guarantees",
      data: {
        itemName: g.itemName || g.itemNameEn || g.rfqTitle || "",
        daysLeft: Math.round((expiresMs - now) / (24 * 60 * 60 * 1000)),
        isExpired: expiresMs < now,
      },
    })
  })

  // RFQs awaiting decision — grouped by rfqId from pending offers.
  const pendingOffersByRfq = new Map<string, { count: number; rfqTitle: string; latestMs: number }>()
  ;(offers || []).forEach((o: any) => {
    if (o.status !== "قيد المراجعة") return
    const existing = pendingOffersByRfq.get(o.rfqId) || { count: 0, rfqTitle: o.rfqTitle || "", latestMs: 0 }
    existing.count += 1
    existing.latestMs = Math.max(existing.latestMs, toMs(o.createdAt))
    pendingOffersByRfq.set(o.rfqId, existing)
  })
  pendingOffersByRfq.forEach((v, rfqId) => {
    const rfq = (rfqs || []).find((r: any) => r.id === rfqId) as { projectId?: string } | undefined
    items.push({
      id: `rfq_decision_${rfqId}`,
      type: "rfq_decision",
      tier: TIER.rfq_decision,
      sortMs: v.latestMs,
      actionUrl: rfq?.projectId ? `/contractor/projects/${rfq.projectId}/tenders/${rfqId}/offers` : `/contractor/rfqs/${rfqId}/offers`,
      data: { rfqTitle: v.rfqTitle, offerCount: v.count },
    })
  })

  // Offer count per RFQ (any status) — used to detect RFQs with zero offers at all,
  // distinct from pendingOffersByRfq above which only counts offers still under review.
  const offerCountByRfq = new Map<string, number>()
  ;(offers || []).forEach((o: any) => {
    offerCountByRfq.set(o.rfqId, (offerCountByRfq.get(o.rfqId) || 0) + 1)
  })

  // Published RFQs that are stalling (no offers yet, past a grace period) or
  // closing within 48h — both real risks that don't show up anywhere else
  // (a stalled RFQ has no offer to notify on; a closing deadline has no event).
  ;(rfqs || []).forEach((r: any) => {
    if (r.status !== "New") return
    const rfqActionUrl = r.projectId ? `/contractor/projects/${r.projectId}/tenders/${r.id}/offers` : `/contractor/rfqs/${r.id}/offers`

    const createdMs = toMs(r.createdAt)
    if (!offerCountByRfq.has(r.id) && createdMs && now - createdMs >= NO_OFFERS_GRACE_MS) {
      items.push({
        id: `rfq_no_offers_${r.id}`,
        type: "rfq_no_offers",
        tier: TIER.rfq_no_offers,
        sortMs: now - createdMs,
        actionUrl: rfqActionUrl,
        data: { rfqTitle: r.title || "", daysOpen: Math.floor((now - createdMs) / (24 * 60 * 60 * 1000)) },
      })
    }

    if (r.deadline) {
      const deadlineMs = new Date(r.deadline).getTime()
      if (!isNaN(deadlineMs) && deadlineMs - now <= CLOSING_SOON_MS) {
        items.push({
          id: `rfq_closing_soon_${r.id}`,
          type: "rfq_closing_soon",
          tier: TIER.rfq_closing_soon,
          sortMs: now - deadlineMs,
          actionUrl: rfqActionUrl,
          data: { rfqTitle: r.title || "", hoursLeft: Math.max(0, Math.round((deadlineMs - now) / (60 * 60 * 1000))), isOverdue: deadlineMs < now },
        })
      }
    }
  })

  // Deliveries needing confirmation.
  ;(deliveries || []).forEach((d: any) => {
    items.push({
      id: `delivery_confirm_${d.id}`,
      type: "delivery_confirm",
      tier: TIER.delivery_confirm,
      sortMs: toMs(d.deliveryDate || d.createdAt),
      actionUrl: "/contractor/goods-received",
      data: { rfqTitle: d.rfqTitle || "", supplierName: d.supplierName || "" },
    })
  })

  // Projects stalled in a status that needs an explicit decision.
  ;(projects || []).forEach((p: any) => {
    const status = resolveProjectStatus(p.status)
    if (!PROJECT_NEEDS_DECISION_STATUSES.includes(status)) return
    const updatedMs = toMs(p.updatedAt) || toMs(p.createdAt)
    items.push({
      id: `project_waiting_approval_${p.id}`,
      type: "project_waiting_approval",
      tier: TIER.project_waiting_approval,
      sortMs: updatedMs ? now - updatedMs : 0,
      actionUrl: `/contractor/projects/${p.id}`,
      data: { projectName: p.name || "", statusLabelKey: projectStatusLabelKey(status) },
    })
  })

  // Low-stock warehouse items.
  lowStockItems.forEach((item) => {
    items.push({
      id: `low_stock_${item.id}`,
      type: "low_stock",
      tier: TIER.low_stock,
      sortMs: 0,
      actionUrl: `/contractor/warehouses/${item.warehouseId}`,
      data: { itemName: item.name, warehouseName: item.warehouseName, quantity: item.quantity, minStockLevel: item.minStockLevel },
    })
  })

  // Team invites this member sent that are still awaiting a response.
  ;(invitations || []).forEach((inv: any) => {
    if (inv.type !== "team_invite" || inv.status !== "pending") return
    items.push({
      id: `team_invite_pending_${inv.id}`,
      type: "team_invite_pending",
      tier: TIER.team_invite_pending,
      sortMs: now - toMs(inv.createdAt),
      actionUrl: "/contractor/team",
      data: { email: inv.email || "", name: inv.name || "" },
    })
  })

  items.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : b.sortMs - a.sortMs))

  const isLoading = !rfqs || !offers || !deliveries || !warehouses || !guarantees || !projects

  return { items, isLoading }
}

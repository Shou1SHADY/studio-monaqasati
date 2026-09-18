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
  // Manufacturing's handoffs — acts other modules owe the workshop (PRD 1.2 boundary)
  | "sales_deposits_to_confirm"
  | "mfg_materials_to_issue"
  | "mfg_requests_unanswered"
  | "mfg_drawing_results_due"
  | "mfg_client_drawings_due"
  | "mfg_notes_to_receive"
  | "mfg_custody_to_receive"
  | "mfg_purchase_requests"

export interface WorkQueueItem {
  id: string
  type: WorkQueueItemType
  tier: number
  sortMs: number
  actionUrl: string
  data: Record<string, unknown>
}

export interface WorkQueueStats {
  projectsTotal: number
  projectsOngoing: number
  rfqsOpen: number
  offersTotal: number
  warehousesTotal: number
  inventoryItemsTotal: number
  guaranteesActive: number
}

export interface RecentWorkItem {
  id: string
  name: string
  ms: number
  href: string
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
  sales_deposits_to_confirm: 3,
  mfg_materials_to_issue: 3,
  mfg_requests_unanswered: 4,
  mfg_drawing_results_due: 4,
  mfg_client_drawings_due: 4,
  mfg_notes_to_receive: 5,
  mfg_custody_to_receive: 5,
  mfg_purchase_requests: 5,
}

interface QueueWorkOrder {
  id: string
  status?: string
  productId?: string | null
  projectId?: string | null
  projectName?: string | null
  salesOrderId?: string | null
  docNumber?: string | null
  orderNumber?: number
  materials?: Array<{ requestNumber: string; state: string; requestedAt?: string }>
  purchaseRequests?: Array<{ state: string; at?: string }>
  drawing?: { submittedAt: string | null; code: string | null; approverOrg: string } | null
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

  // Manufacturing's handoffs. Each is a fact on the workshop's own documents
  // that another module acts on — read here so the owner sees it on arrival.
  const workOrdersQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "workOrders"), where("organizationId", "==", organizationId), where("status", "==", "open"))
  }, [firestore, organizationId])
  const { data: workOrders } = useCollection(workOrdersQuery)

  const notesQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "deliveryNotes"), where("organizationId", "==", organizationId), where("status", "==", "in_transit"))
  }, [firestore, organizationId])
  const { data: notesInTransit } = useCollection(notesQuery)

  const depositsQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "salesOrders"), where("organizationId", "==", organizationId), where("status", "==", "awaiting_deposit"))
  }, [firestore, organizationId])
  const { data: awaitingDeposit } = useCollection(depositsQuery)

  const mfgRequestsQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "manufacturingRequests"), where("organizationId", "==", organizationId), where("status", "==", "new"))
  }, [firestore, organizationId])
  const { data: newMfgRequests } = useCollection(mfgRequestsQuery)

  // Low-stock items live in a per-warehouse subcollection — can't be expressed as a
  // single top-level query, so fetch once (not real-time) whenever the warehouse list changes.
  const [lowStockItems, setLowStockItems] = useState<Array<{ id: string; warehouseId: string; warehouseName: string; name: string; quantity: number; minStockLevel: number }>>([])
  const [inventoryItemsTotal, setInventoryItemsTotal] = useState(0)

  useEffect(() => {
    if (!firestore || !warehouses || warehouses.length === 0) {
      setLowStockItems([])
      setInventoryItemsTotal(0)
      return
    }
    let cancelled = false
    ;(async () => {
      const results: typeof lowStockItems = []
      let itemsTotal = 0
      for (const wh of warehouses as { id: string; name?: string }[]) {
        const snap = await getDocs(collection(firestore, "warehouses", wh.id, "inventoryItems"))
        itemsTotal += snap.size
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
      if (!cancelled) {
        setLowStockItems(results)
        setInventoryItemsTotal(itemsTotal)
      }
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

  // ── Manufacturing handoffs (one card per kind, or per project / sales order) ──
  const liveOrders = ((workOrders || []) as QueueWorkOrder[]).filter((o) => !!o.productId)
  const oldestAge = (isos: Array<string | undefined>) => {
    const ms = isos.map((x) => toMs(x)).filter(Boolean)
    return ms.length ? now - Math.min(...ms) : 0
  }

  const deposits = (awaitingDeposit || []) as Array<{ id: string; payment?: { kind?: string; depositPaid?: boolean; depositReportedAt?: string | null } }>
  const unpaid = deposits.filter((o) => o.payment?.kind === "deposit" && !o.payment.depositPaid)
  if (unpaid.length) {
    items.push({
      id: "sales_deposits_to_confirm",
      type: "sales_deposits_to_confirm",
      tier: TIER.sales_deposits_to_confirm,
      sortMs: oldestAge(unpaid.map((o) => o.payment?.depositReportedAt || undefined)),
      actionUrl: "/contractor/sales/payments",
      data: { count: unpaid.length, reported: unpaid.filter((o) => o.payment?.depositReportedAt).length },
    })
  }

  const withdrawals = new Map<string, string | undefined>()
  for (const o of liveOrders) for (const m of o.materials || []) if (m.state === "requested") withdrawals.set(`${o.id}__${m.requestNumber}`, m.requestedAt)
  if (withdrawals.size) {
    items.push({
      id: "mfg_materials_to_issue",
      type: "mfg_materials_to_issue",
      tier: TIER.mfg_materials_to_issue,
      sortMs: oldestAge(Array.from(withdrawals.values())),
      actionUrl: "/contractor/warehouses/manufacturing",
      data: { count: withdrawals.size },
    })
  }

  const requests = (newMfgRequests || []) as Array<{ requestedAt?: string }>
  if (requests.length) {
    items.push({
      id: "mfg_requests_unanswered",
      type: "mfg_requests_unanswered",
      tier: TIER.mfg_requests_unanswered,
      sortMs: oldestAge(requests.map((r) => r.requestedAt)),
      actionUrl: "/contractor/manufacturing/requests",
      data: { count: requests.length },
    })
  }

  // A drawing with the client: the result is Sales' to record, from the inbox
  // heading its orders page — whether or not the order names a sales order.
  const clientDrawings = liveOrders.filter((o) => !!o.drawing?.submittedAt && !o.drawing.code && o.drawing.approverOrg === "client")
  if (clientDrawings.length) {
    items.push({
      id: "mfg_client_drawings_due",
      type: "mfg_client_drawings_due",
      tier: TIER.mfg_client_drawings_due,
      sortMs: oldestAge(clientDrawings.map((o) => o.drawing?.submittedAt || undefined)),
      actionUrl: "/contractor/sales/orders",
      data: { count: clientDrawings.length },
    })
  }

  // A drawing waiting on its approver: the project's office or consultant.
  const drawingsByProject = new Map<string, { name: string; count: number; since: string[] }>()
  for (const o of liveOrders) {
    const d = o.drawing
    if (!o.projectId || !d?.submittedAt || d.code || d.approverOrg === "client" || d.approverOrg === "workshop") continue
    const row = drawingsByProject.get(o.projectId) || { name: o.projectName || "", count: 0, since: [] }
    row.count += 1
    row.since.push(d.submittedAt)
    drawingsByProject.set(o.projectId, row)
  }
  drawingsByProject.forEach((row, pid) => {
    items.push({
      id: `mfg_drawing_results_due_${pid}`,
      type: "mfg_drawing_results_due",
      tier: TIER.mfg_drawing_results_due,
      sortMs: oldestAge(row.since),
      actionUrl: `/contractor/projects/${pid}?tab=mfg`,
      data: { count: row.count, projectName: row.name },
    })
  })

  const notes = (notesInTransit || []) as Array<{ toKind?: string; toProjectId?: string | null; toWarehouseName?: string; sentAt?: string }>
  const toStores = notes.filter((n) => n.toKind !== "project")
  if (toStores.length) {
    items.push({
      id: "mfg_notes_to_receive",
      type: "mfg_notes_to_receive",
      tier: TIER.mfg_notes_to_receive,
      sortMs: oldestAge(toStores.map((n) => n.sentAt)),
      actionUrl: "/contractor/warehouses/delivery-notes",
      data: { count: toStores.length },
    })
  }
  const custody = new Map<string, { count: number; since: string[] }>()
  for (const n of notes) {
    if (n.toKind !== "project" || !n.toProjectId) continue
    const row = custody.get(n.toProjectId) || { count: 0, since: [] }
    row.count += 1
    if (n.sentAt) row.since.push(n.sentAt)
    custody.set(n.toProjectId, row)
  }
  custody.forEach((row, pid) => {
    const project = (projects || []).find((p: { id: string }) => p.id === pid) as { name?: string } | undefined
    items.push({
      id: `mfg_custody_to_receive_${pid}`,
      type: "mfg_custody_to_receive",
      tier: TIER.mfg_custody_to_receive,
      sortMs: oldestAge(row.since),
      actionUrl: `/contractor/projects/${pid}?tab=mfg`,
      data: { count: row.count, projectName: project?.name || "" },
    })
  })

  const purchases = liveOrders.flatMap((o) => (o.purchaseRequests || []).filter((p) => p.state === "sent"))
  if (purchases.length) {
    items.push({
      id: "mfg_purchase_requests",
      type: "mfg_purchase_requests",
      tier: TIER.mfg_purchase_requests,
      sortMs: oldestAge(purchases.map((p) => p.at)),
      actionUrl: "/contractor/rfqs",
      data: { count: purchases.length },
    })
  }

  items.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : b.sortMs - a.sortMs))

  const isLoading = !rfqs || !offers || !deliveries || !warehouses || !guarantees || !projects

  const stats: WorkQueueStats = {
    projectsTotal: (projects || []).length,
    projectsOngoing: (projects || []).filter((p: any) => p.status !== "canceled" && p.status !== "remaining_payment").length,
    rfqsOpen: (rfqs || []).filter((r: any) => r.status === "New").length,
    offersTotal: (offers || []).length,
    warehousesTotal: (warehouses || []).length,
    inventoryItemsTotal,
    guaranteesActive: (guarantees || []).filter((g: any) => g.status !== "rejected").length,
  }

  const recentItems: RecentWorkItem[] = [
    ...(projects || []).map((p: any) => ({
      id: `project_${p.id}`,
      name: (p.name as string) || "",
      ms: toMs(p.updatedAt) || toMs(p.createdAt),
      href: `/contractor/projects/${p.id}`,
    })),
    ...(rfqs || []).map((r: any) => ({
      id: `rfq_${r.id}`,
      name: (r.title as string) || "",
      ms: toMs(r.updatedAt) || toMs(r.createdAt),
      href: r.projectId ? `/contractor/projects/${r.projectId}/tenders/${r.id}/offers` : `/contractor/rfqs/${r.id}`,
    })),
  ]
    .filter((x) => x.name && x.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3)

  return { items, isLoading, stats, recentItems }
}

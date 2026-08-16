"use client"

// Aggregates real actionable items across a contractor org into one
// prioritized "your work today" queue. Client-side composition of queries
// that already exist near-verbatim on their own pages — no server-side
// rollup needed (list queries are already org-scoped and unrestricted by
// firestore.rules; isolation happens via the `where` clauses below).

import { useEffect, useState } from "react"
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase"
import { collection, query, where, getDocs } from "firebase/firestore"
import { resolveInvoiceStatus } from "@/utils/invoice-utils"

export type WorkQueueItemType =
  | "rfq_decision"
  | "rfq_closing_soon"
  | "rfq_no_offers"
  | "delivery_confirm"
  | "invoice_overdue"
  | "low_stock"

export interface WorkQueueItem {
  id: string
  type: WorkQueueItemType
  tier: number
  sortMs: number
  actionUrl: string
  data: Record<string, unknown>
}

const TIER: Record<WorkQueueItemType, number> = {
  invoice_overdue: 1,
  rfq_closing_soon: 2,
  delivery_confirm: 3,
  rfq_decision: 4,
  rfq_no_offers: 5,
  low_stock: 6,
}

// An RFQ younger than this is still fresh — no supplier has had a fair chance
// to respond yet, so flagging it as "no offers" would just be noise.
const NO_OFFERS_GRACE_MS = 3 * 24 * 60 * 60 * 1000
// Flag RFQs whose deadline is inside this window (or already passed) as closing soon.
const CLOSING_SOON_MS = 48 * 60 * 60 * 1000

function toMs(v: unknown): number {
  if (!v) return 0
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().getTime()
  }
  const t = new Date(v as string | number).getTime()
  return isNaN(t) ? 0 : t
}

export function useWorkQueue(organizationId: string | undefined | null) {
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

  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "invoices"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: invoices } = useCollection(invoicesQuery)

  const warehousesQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "warehouses"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: warehouses } = useCollection(warehousesQuery)

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

  const now = Date.now()

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

  // Overdue invoices.
  ;(invoices || []).forEach((inv: any) => {
    const resolved = resolveInvoiceStatus(inv.dueDate, inv.status)
    if (resolved !== "overdue") return
    items.push({
      id: `invoice_overdue_${inv.id}`,
      type: "invoice_overdue",
      tier: TIER.invoice_overdue,
      sortMs: toMs(inv.dueDate),
      actionUrl: "/contractor/invoices",
      data: { invoiceNumber: inv.invoiceNumber || "", clientName: inv.clientName || "" },
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

  items.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : b.sortMs - a.sortMs))

  const isLoading = !rfqs || !offers || !deliveries || !invoices || !warehouses

  return { items, isLoading }
}

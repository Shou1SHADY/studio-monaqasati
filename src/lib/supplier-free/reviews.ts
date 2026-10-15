// The ratings a supplier's Company account shows (PRD ACC-07): only those tied to a delivery that happened — a review
// carrying the order it judges, on an order of his that was received (or closed after receipt) — each with the
// material it was for. A review with no order, or on an order still open, is not shown.

import { poStatus } from "@/lib/procurement/po"
import type { PurchaseOrder } from "@/lib/procurement/types"

export interface ReviewDoc {
  rating?: number
  comment?: string
  createdAt?: string
  reviewerName?: string
  reviewerRole?: string
  poId?: string
  material?: string
}

export interface DeliveryReview extends ReviewDoc {
  poId: string
  material: string
  poNumber: string
}

export function deliveryReviews(reviews: readonly ReviewDoc[], pos: readonly PurchaseOrder[]): DeliveryReview[] {
  const byId = new Map(pos.map((p) => [p.id, p]))
  const out: DeliveryReview[] = []
  for (const r of reviews) {
    if (r.reviewerRole !== "Contractor" || !r.poId) continue
    const po = byId.get(r.poId)
    if (!po) continue
    const st = poStatus(po)
    const received = st === "received" || (st === "closed" && po.lines.some((l) => (Number(l.accepted) || 0) > 0))
    if (!received) continue
    out.push({ ...r, poId: r.poId, poNumber: po.docNumber, material: r.material || po.lines.map((l) => l.name).filter(Boolean).join("، ") })
  }
  return out.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
}

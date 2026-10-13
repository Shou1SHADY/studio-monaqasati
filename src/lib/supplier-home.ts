// What the supplier's home page counts and asks for — pure, so the tests read it.
// The home itself is the shared portal home (PortalHomeView); this file is the
// supplier's side of its numbers: the RFQs open to him, the offers he sent, and
// the purchase orders waiting for his acceptance.

import { supplierSegmentOf, visibleSupplierOrders } from "@/lib/procurement/supplier"
import type { PurchaseOrder } from "@/lib/procurement/types"

const DAY_MS = 86_400_000

export interface HomeRfq {
  id: string
  title?: string | null
  status?: string | null
  category?: string | null
  deadline?: string | null
}

export interface HomeOffer {
  id: string
  rfqId?: string | null
  rfqTitle?: string | null
  status?: string | null
  createdAt?: unknown
}

const PENDING = new Set(["قيد المراجعة", "New"])
const ACCEPTED = new Set(["مقبول", "Accepted"])

/** An offer's `createdAt` is an ISO string on new offers and a Firestore timestamp on old ones. */
export function msOf(value: unknown): number {
  if (typeof value === "string") {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : 0
  }
  if (value && typeof value === "object") {
    const v = value as { toMillis?: () => number; seconds?: number }
    if (typeof v.toMillis === "function") return v.toMillis()
    if (typeof v.seconds === "number") return v.seconds * 1000
  }
  return 0
}

/** Whole days until the end of the deadline's day: 0 = closes today, negative = passed. No deadline = null. */
export function daysToDeadline(deadline: string | null | undefined, now: number): number | null {
  if (!deadline) return null
  const d = new Date(deadline)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(23, 59, 59, 999)
  return Math.floor((d.getTime() - now) / DAY_MS)
}

/** RFQs still open for offers: status New and the deadline not passed (none = open). */
export function openRfqs<T extends HomeRfq>(rfqs: T[], now: number): T[] {
  return rfqs.filter((r) => (r.status ?? "New") === "New" && (daysToDeadline(r.deadline, now) ?? 0) >= 0)
}

export interface SupplierHomeCounts {
  openRfqs: number
  /** Open RFQs this company has sent no offer to — what the Sales tile asks for. */
  unanswered: number
  pendingOffers: number
  acceptedOffers: number
  ordersToAccept: number
  ordersInDelivery: number
  ordersTotal: number
}

export function supplierHomeCounts(input: { rfqs: HomeRfq[]; offers: HomeOffer[]; orders: PurchaseOrder[]; now: number }): SupplierHomeCounts {
  const open = openRfqs(input.rfqs, input.now)
  const answered = new Set(input.offers.map((o) => o.rfqId).filter(Boolean))
  const visible = visibleSupplierOrders(input.orders)
  return {
    openRfqs: open.length,
    unanswered: open.filter((r) => !answered.has(r.id)).length,
    pendingOffers: input.offers.filter((o) => PENDING.has(o.status ?? "")).length,
    acceptedOffers: input.offers.filter((o) => ACCEPTED.has(o.status ?? "")).length,
    ordersToAccept: visible.filter((po) => supplierSegmentOf(po) === "to_accept").length,
    ordersInDelivery: visible.filter((po) => supplierSegmentOf(po) === "in_delivery").length,
    ordersTotal: visible.length,
  }
}

export type SupplierDecision =
  | { kind: "po_to_accept"; id: string; poId: string; docNumber: string; rfqTitle: string; waitingDays: number; href: string }
  | { kind: "rfq_to_answer"; id: string; rfqId: string; title: string; daysLeft: number | null; href: string }

/**
 * The decisions waiting on the supplier, most pressing first: purchase orders
 * sent to him and not yet accepted (oldest dispatch first — the buyer's clock is
 * running), then open RFQs in his line with no offer from him (soonest deadline first).
 * `seesRfqs` follows the Sales tile's own gate (offers.view).
 */
export function supplierDecisions(input: { rfqs: HomeRfq[]; offers: HomeOffer[]; orders: PurchaseOrder[]; now: number; seesRfqs: boolean }): SupplierDecision[] {
  const orders: SupplierDecision[] = visibleSupplierOrders(input.orders)
    .filter((po) => supplierSegmentOf(po) === "to_accept")
    .sort((a, b) => (a.sentAt || a.createdAt || "").localeCompare(b.sentAt || b.createdAt || ""))
    .map((po) => ({
      kind: "po_to_accept" as const,
      id: `po:${po.id}`,
      poId: po.id,
      docNumber: po.docNumber,
      rfqTitle: po.rfqTitle || "",
      waitingDays: Math.max(0, Math.floor((input.now - msOf(po.sentAt || po.createdAt)) / DAY_MS)),
      href: `/supplier/orders?po=${encodeURIComponent(po.id)}`,
    }))
  if (!input.seesRfqs) return orders
  const answered = new Set(input.offers.map((o) => o.rfqId).filter(Boolean))
  const rfqs: SupplierDecision[] = openRfqs(input.rfqs, input.now)
    .filter((r) => !answered.has(r.id))
    .map((r) => ({ r, left: daysToDeadline(r.deadline, input.now) }))
    .sort((a, b) => (a.left ?? Number.MAX_SAFE_INTEGER) - (b.left ?? Number.MAX_SAFE_INTEGER))
    .map(({ r, left }) => ({
      kind: "rfq_to_answer" as const,
      id: `rfq:${r.id}`,
      rfqId: r.id,
      title: r.title || "",
      daysLeft: left,
      href: r.title ? `/supplier/rfqs?search=${encodeURIComponent(r.title)}` : "/supplier/rfqs",
    }))
  return [...orders, ...rfqs]
}

/** "Continue where you left off": the offers this company sent most recently. */
export function recentOffers(offers: HomeOffer[], limit = 3): Array<{ id: string; name: string; href: string; ms: number }> {
  return offers
    .map((o) => ({ id: o.id, name: o.rfqTitle || "", href: "/supplier/offers", ms: msOf(o.createdAt) }))
    .filter((o) => o.name && o.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit)
}

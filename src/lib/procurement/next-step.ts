// «الخطوة التالية» of an order on its way, built from the FACTS (Procurement 1.5, PUR-07):
// who we wait on, since when, and what is ours to press. The supplier is never blamed for
// a delivery he notified in time and that waits for our count; a guest supplier who cannot
// notify is asked about by us; what arrived in part says what is left. Pure.

import { daysFromNow, dayOf, daysLate, lineOutstanding, poStatus, type NoticeFact } from "./po"
import type { PurchaseOrder } from "./types"

export interface StepNotice extends NoticeFact {
  id: string
  receiverReport?: unknown
  forwardedTo?: { name?: string | null; userId?: string | null; at?: string | null; auto?: boolean } | null
}

export type DeliveryStep =
  /** A notice is with us: forward it to the receiver. Waits on: us. */
  | { kind: "notice_to_forward"; deliveryId: string; noticeDay: string | null }
  /** Forwarded; the delivery day has not come. Waits on: nobody. */
  | { kind: "in_transit"; deliveryId: string; day: string | null; receiver: string }
  /** Forwarded; the day passed and nobody counted. Waits on: the receiver. */
  | { kind: "receiver_late"; deliveryId: string; receiver: string; days: number; noticeDay: string | null; forwardedDay: string | null; byLink: boolean }
  /** The receiver counted at the gate; the receipt is to be booked. Waits on: us. */
  | { kind: "counted"; deliveryId: string; receiver: string }
  /** Some of it arrived. Waits on: the supplier, for the rest. */
  | { kind: "part_received"; received: number; ordered: number; left: number; unit: string; byLines: boolean; linesDone: number; linesTotal: number }
  /** A rejected quantity waits for our decision with the supplier. Waits on: us. */
  | { kind: "rejected"; qty: number; unit: string; reason: string | null }
  /** A guest supplier's day came and he cannot notify on the platform. Waits on: us. */
  | { kind: "guest_due"; day: string }
  /** No notice past his own promise. Waits on: the supplier. */
  | { kind: "supplier_late"; days: number }
  /** His promise is ahead. Waits on: the supplier. */
  | { kind: "supplier_due"; day: string }
  | { kind: "no_date" }

export type StepWaitsOn = "us" | "supplier" | "receiver" | "nobody"

export const STEP_WAITS_ON: Record<DeliveryStep["kind"], StepWaitsOn> = {
  notice_to_forward: "us",
  in_transit: "nobody",
  receiver_late: "receiver",
  counted: "us",
  part_received: "supplier",
  rejected: "us",
  guest_due: "us",
  supplier_late: "supplier",
  supplier_due: "supplier",
  no_date: "supplier",
}

const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0)
const daysSince = (iso: string | null | undefined, now: Date): number => {
  const d = daysFromNow(dayOf(iso), now)
  return d == null ? 0 : Math.max(0, -d)
}

export function deliveryStep(po: PurchaseOrder, notices: ReadonlyArray<StepNotice>, now: Date): DeliveryStep | null {
  const st = poStatus(po)
  if (st !== "in_delivery" && st !== "part_received") return null
  const pending = notices.filter((n) => n.poId === po.id && n.status === "pending_confirmation" && !n.closedByReceipt).sort((a, b) => (dayOf(a.deliveryDate) || "").localeCompare(dayOf(b.deliveryDate) || ""))
  const n = pending[0]
  if (n) {
    const day = dayOf(n.deliveryDate) || null
    if (n.receiverReport) return { kind: "counted", deliveryId: n.id, receiver: n.forwardedTo?.name || "" }
    if (!n.forwardedTo) return { kind: "notice_to_forward", deliveryId: n.id, noticeDay: day }
    const d = daysFromNow(day, now)
    if (d != null && d < 0)
      return { kind: "receiver_late", deliveryId: n.id, receiver: n.forwardedTo.name || "", days: -d, noticeDay: day, forwardedDay: dayOf(n.forwardedTo.at) || null, byLink: !n.forwardedTo.userId }
    return { kind: "in_transit", deliveryId: n.id, day, receiver: n.forwardedTo.name || "" }
  }
  const rejected = po.lines.filter((l) => num(l.rejected) > 0 && !l.rejectDecision)
  if (rejected.length) return { kind: "rejected", qty: rejected.reduce((s, l) => s + num(l.rejected), 0), unit: rejected[0].unit, reason: null }
  if (st === "part_received") return { kind: "part_received", ...receiptProgress(po.lines) }
  if (!po.promisedDate) return { kind: "no_date" }
  const d = daysFromNow(po.promisedDate, now)
  if (po.isGuestSupplier && d != null && d <= 0) return { kind: "guest_due", day: po.promisedDate }
  const late = daysLate(po, now, notices)
  if (late > 0) return { kind: "supplier_late", days: late }
  return { kind: "supplier_due", day: po.promisedDate }
}

/** «بانتظار اعتماد … منذ يوم» / «لم يقبل المورد الأمر منذ يومين» — how long the order has waited on its current hands. */
export const waitingSinceDays = (iso: string | null | undefined, now: Date): number => daysSince(iso, now)

/**
 * How much of an order arrived. Quantities are only added when every line counts in the same unit —
 * «510 من 1000 طن» for steel and cement together would be false (review of 20 Oct 2026); otherwise
 * it is told in materials: «اكتمل 2 من 3 مواد».
 */
export function receiptProgress(lines: Array<{ quantity: number; cancelled?: number; accepted?: number; unit: string; rejected?: number; held?: number }>): { received: number; ordered: number; left: number; unit: string; byLines: boolean; linesDone: number; linesTotal: number } {
  const live = lines.filter((l) => num(l.quantity) - num(l.cancelled) > 0)
  const units = new Set(live.map((l) => (l.unit || "").trim()))
  const ordered = live.reduce((s, l) => s + num(l.quantity) - num(l.cancelled), 0)
  const received = live.reduce((s, l) => s + num(l.accepted), 0)
  const linesDone = live.filter((l) => lineOutstanding(l as Parameters<typeof lineOutstanding>[0]) <= 0).length
  return { received, ordered, left: Math.max(0, ordered - received), unit: units.size === 1 ? [...units][0] : "", byLines: units.size > 1, linesDone, linesTotal: live.length }
}


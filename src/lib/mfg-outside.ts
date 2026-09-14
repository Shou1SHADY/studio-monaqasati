// What the other modules need to act on the workshop's requests — Inventory
// issuing a withdrawal or receiving a note, Projects recording a drawing
// result or receiving into custody, Procurement routing a need to make.
//
// Manufacturing requests and reads (D9); these helpers belong to the screens
// that act. Pure where possible: the note shape the v2 flow writes, how long a
// note has been on the road, and the readable reference a purchase request
// carries into Manufacturing.

import type { DeliveryNote } from "./delivery-notes"

/** A delivery note as the product-born flow writes it (issueDeliveryNote):
 * the order's yearly number, pieces, crates and the fleet vehicle. */
export type MfgDeliveryNote = DeliveryNote & {
  source: DeliveryNote["source"] & { workOrderDocNumber?: string | null }
  vehicleId?: string | null
  vehicleLabel?: string | null
}

/** A note written for a product-born order carries the v2 shipment fields;
 * a legacy stage-flow handover has none of them. */
export function isV2Note(n: Partial<MfgDeliveryNote> & Pick<DeliveryNote, "source">): boolean {
  return "brokenQuantity" in n || "vehicleId" in n || !!n.source?.workOrderDocNumber
}

/** Hours a note has been on the road. */
export function noteHoursOut(n: Pick<DeliveryNote, "sentAt">, nowMs: number): number {
  if (!n.sentAt) return 0
  return Math.max(0, (nowMs - new Date(n.sentAt).getTime()) / 3600000)
}

/** In transit past the escalation window (DN-02: 48 h by default). */
export function noteEscalated(n: Pick<DeliveryNote, "sentAt" | "status">, nowMs: number, escalationHours: number): boolean {
  return n.status === "in_transit" && noteHoursOut(n, nowMs) >= escalationHours
}

export function noteOrderRef(n: Pick<MfgDeliveryNote, "source">): string {
  return n.source.workOrderDocNumber || `#${n.source.workOrderNumber}`
}

/** The readable reference a purchase request carries into Manufacturing. */
export function purchaseRequestRef(requestId: string): string {
  return `PR-${requestId.slice(0, 6).toUpperCase()}`
}


// Re-award after the supplier declined the order (Supplier 1.0 DEC, ORD-03) — the rule, shared by the order drawer
// (whether to offer the button) and the server act that reopens the award (`award.reopen` in supplier-free/server-acts).

import type { ProcActor, PurchaseOrder } from "./types"

export type ReopenAwardRefusal = "no_permission" | "not_your_rfq" | "not_declined" | "rfq_not_awarded" | "award_split_live"

export interface ReopenRfq {
  status?: string
  createdByUserId?: string | null
  contractorId?: string | null
}

/** Why this order's award may not be reopened — null when it may. The order was cancelled by its supplier's
 * decline; the RFQ still reads `Awarded`; the buyer runs it (the award's own rule). */
export function reopenAwardRefusal(
  po: Pick<PurchaseOrder, "status" | "supplierDecline" | "rfqId" | "offerId"> | null,
  rfq: ReopenRfq | null,
  actor: Pick<ProcActor, "uid" | "isOwner" | "canPrepare" | "canApprove">
): ReopenAwardRefusal | null {
  if (!actor.isOwner && !actor.canPrepare) return "no_permission"
  if (!po || po.status !== "cancelled" || !po.supplierDecline || !po.rfqId || !po.offerId) return "not_declined"
  if (!rfq || rfq.status !== "Awarded") return "rfq_not_awarded"
  if (!actor.isOwner && !actor.canApprove && (rfq.createdByUserId || rfq.contractorId || "") !== actor.uid) return "not_your_rfq"
  return null
}

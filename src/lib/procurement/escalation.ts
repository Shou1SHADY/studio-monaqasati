// TDY-05 · «صعّد» — a delivery nobody counted after the policy window (`escalateAfterDays`, 2 by default) shows red and can be escalated
// ONCE: to the project manager of the site, or — without Projects, or for a site that is no project — to the owner. The prototype's rule
// is `-n.date > escDays`: the delivery day passed by MORE than the window. Pure: the server act and the screens read the same two answers.

import { daysBetween, dayOf, todayOf } from "./po"
import type { DeliveryEscalation, DeskDelivery } from "./receipt-desk"

type Uncounted = Pick<DeskDelivery, "forwardedTo" | "deliveryDate" | "status" | "closedByReceipt" | "escalation">

/** Whole days since the delivery day (0 before it) — never negative: a delivery is not late before its day. */
export function daysUncounted(d: Pick<DeskDelivery, "deliveryDate">, now: Date): number {
  const day = dayOf(d.deliveryDate)
  return day ? Math.max(0, daysBetween(day, todayOf(now))) : 0
}

/** Forwarded, still uncounted, past the window, and nobody escalated it yet. */
export function needsEscalation(d: Uncounted, now: Date, escalateAfterDays: number): boolean {
  if (d.status === "confirmed" || d.closedByReceipt || !d.forwardedTo || d.escalation) return false
  return daysUncounted(d, now) > escalateAfterDays
}

export interface EscalationTarget {
  kind: DeliveryEscalation["toKind"]
  uid: string
}

/** The project manager when Projects is on and the order's site is a project that names one; otherwise the owner (whose uid is the company's). */
export function escalationTarget(input: { projectsOn: boolean; projectManagerId: string | null | undefined; ownerId: string }): EscalationTarget {
  return input.projectsOn && input.projectManagerId ? { kind: "project_manager", uid: input.projectManagerId } : { kind: "owner", uid: input.ownerId }
}

/** Who may press «صعّد»: whoever follows deliveries up — the expediter, the buyer, the approver, the owner. */
export const ESCALATE_PERMISSIONS = ["po.expedite", "offers.accept", "po.approve"] as const

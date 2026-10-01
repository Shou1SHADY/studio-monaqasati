// Automatic forwarding of a delivery notice once the policy window lapses
// (PRD 3.0 §5.2-3b, policy `forwardWindowDays`). A scheduled job
// (/api/cron/forward-notices) asks `selectDueNotices` which notices nobody in
// Procurement forwarded in time, and forwards each to the register's suggested
// receiver for the place the goods land — the same person the desk offers by
// hand. Pure: no clock, no database; the route supplies both.

import { daysFromNow } from "./po"
import { noticeTold } from "./policy-enforce"
import { landingWarehouseId, suggestedReceiver, type DeskDelivery } from "./receipt-desk"
import { forwardUrgency, phoneUsable, type ProcReceiver } from "./receivers"
import type { ProcurementPolicies } from "./types"

/** A notice whose day passed longer ago than this is left to a person: the first run
 * after switching the job on must not text a store keeper about last quarter's truck. */
export const AUTO_FORWARD_MAX_OVERDUE_DAYS = 7

/** Written as `createdById` / `byName` on the link: nobody in the office pressed the button. */
export const AUTO_FORWARD_ACTOR = { id: "system:auto-forward", name: "Mdmak Tech" } as const

export interface AutoForwardInput {
  orgId: string
  deliveries: DeskDelivery[]
  policies: ProcurementPolicies | null | undefined
  receivers: ProcReceiver[]
  projects: Array<{ id: string; warehouseId?: string | null }>
  orders: Array<{ id: string; projectId?: string | null }>
  now: Date
}

export interface DueNotice {
  delivery: DeskDelivery
  receiver: ProcReceiver
  warehouseId: string | null
  daysToDelivery: number
}

/** Why a pending notice is NOT forwarded now — null when it is due. */
export type AutoForwardSkip = "not_pending" | "told" | "no_notice" | "no_date" | "in_window" | "too_old" | "no_receiver" | "no_phone"

export function autoForwardSkip(d: DeskDelivery, input: Omit<AutoForwardInput, "deliveries">): { skip: AutoForwardSkip } | { skip: null; due: DueNotice } {
  if (d.status !== "pending_confirmation" || d.closedByReceipt) return { skip: "not_pending" }
  if (noticeTold(d, input.policies)) return { skip: "told" }
  if (d.noNotice || d.source === "manual") return { skip: "no_notice" }
  const days = daysFromNow(d.deliveryDate, input.now)
  if (days == null) return { skip: "no_date" }
  if (forwardUrgency(days, input.policies?.forwardWindowDays ?? 1) === "none") return { skip: "in_window" }
  if (days < -AUTO_FORWARD_MAX_OVERDUE_DAYS) return { skip: "too_old" }
  const po = d.poId ? input.orders.find((o) => o.id === d.poId) : undefined
  const warehouseId = d.landedWarehouseId || landingWarehouseId(d.projectId || po?.projectId, input.projects, input.orgId)
  const receiver = suggestedReceiver(input.receivers, warehouseId)
  if (!receiver) return { skip: "no_receiver" }
  if (!phoneUsable(receiver.phone)) return { skip: "no_phone" }
  return { skip: null, due: { delivery: d, receiver, warehouseId, daysToDelivery: days } }
}

/** The notices to forward now, oldest delivery day first. A notice with no resolvable receiver stays untouched. */
export function selectDueNotices(input: AutoForwardInput): DueNotice[] {
  const out: DueNotice[] = []
  for (const d of input.deliveries) {
    const r = autoForwardSkip(d, input)
    if (r.skip === null) out.push(r.due)
  }
  return out.sort((a, b) => a.daysToDelivery - b.daysToDelivery || a.delivery.id.localeCompare(b.delivery.id))
}

/** Is a forward made by the job, not by a person? */
export const isAutoForwarded = (d: { forwardedTo?: { auto?: boolean } | null }): boolean => d.forwardedTo?.auto === true

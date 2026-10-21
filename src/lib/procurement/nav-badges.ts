// The counts beside Procurement's sidebar entries (NAV-02, prototype `TABS()`): Incoming = requests that are new, RFQs =
// the open ones, Receipts = the notices still waiting to be forwarded (red — they wait on the buyer). Pure; the page
// head publishes them from the numbers it already derives, and the sidebar reads them by href (`PortalFrameContext.navBadges`
// carries the same shape for the plans that provide their own).

import type { NavBadge } from "@/lib/portal-components"
import type { ProcTabCounts } from "./shell"

export type ProcNavBadges = Readonly<Record<string, NavBadge>>

export interface NoticeToForward {
  status?: string | null
  forwardedTo?: unknown
  receiverReport?: unknown
  closedByReceipt?: unknown
}

/** A supplier's notice nobody has been told to receive yet. */
export const noticesToForward = (deliveries: ReadonlyArray<NoticeToForward>): number =>
  deliveries.filter((d) => d.status === "pending_confirmation" && !d.forwardedTo && !d.receiverReport && !d.closedByReceipt).length

/** The three pages that carry a count — the same addresses as `PROC_TABS` (a test pins them), kept here so the sidebar does not load the shell. */
export const NAV_BADGE_HREFS = { requests: "/contractor/rfqs/requests", rfqs: "/contractor/rfqs", receipts: "/contractor/goods-received" } as const

export function procNavBadges(counts: ProcTabCounts, toForward: number): ProcNavBadges {
  const out: Record<string, NavBadge> = {}
  if (counts.requests) out[NAV_BADGE_HREFS.requests] = { n: counts.requests, tone: "blue" }
  if (counts.rfqs) out[NAV_BADGE_HREFS.rfqs] = { n: counts.rfqs, tone: "blue" }
  if (toForward) out[NAV_BADGE_HREFS.receipts] = { n: toForward, tone: "red" }
  return out
}

const sameBadges = (a: ProcNavBadges, b: ProcNavBadges): boolean => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] && a[k].n === b[k].n && a[k].tone === b[k].tone)
}

const NONE: ProcNavBadges = Object.freeze({})
let current: ProcNavBadges = NONE
const listeners = new Set<() => void>()

export function publishProcNavBadges(next: ProcNavBadges): void {
  if (sameBadges(current, next)) return
  current = next
  listeners.forEach((l) => l())
}

export const subscribeProcNavBadges = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const readProcNavBadges = (): ProcNavBadges => current
export const serverProcNavBadges = (): ProcNavBadges => NONE

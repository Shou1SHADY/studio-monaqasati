// «لا عرض حيّاً» (Procurement 2.0 RFQ-15, WF-26): an open or comparing RFQ with no offer in the running — it closed with none, or
// every offer that came was excluded. The page and Today show the same two exits: «أعد فتحه» with a new deadline, or «ألغِ الطلب».
// Pure: no I/O.

import { competingOffers } from "./award"
import type { DecisionMap } from "./offer-decisions"
import { addDays, todayOf } from "./po"

export type NoLive = "closed_empty" | "all_excluded"

export interface NoLiveRfq {
  status?: string | null
  deadline?: string | null
  closedEarly?: unknown
}

/** Why there is no live offer, or null when there is one — or the round is still waiting for its first. */
export function noLiveOffer(rfq: NoLiveRfq | null | undefined, offers: Array<{ id?: string; status?: string | null; withdrawnAt?: unknown }>, decisions: DecisionMap | null | undefined, now: Date = new Date()): NoLive | null {
  if (!rfq || rfq.status !== "New") return null
  if (competingOffers(offers, decisions).length > 0) return null
  if (offers.length > 0) return "all_excluded"
  const day = (rfq.deadline || "").slice(0, 10)
  const passed = Boolean(rfq.closedEarly) || (day !== "" && day < todayOf(now))
  return passed ? "closed_empty" : null
}

/** The earliest date a reopening may take: today, and a day after the current deadline when that is still ahead. */
export function earliestNewDeadline(deadline: string | null | undefined, now: Date = new Date()): string {
  const today = todayOf(now)
  const day = (deadline || "").slice(0, 10)
  return day && day >= today ? addDays(day, 1) : today
}

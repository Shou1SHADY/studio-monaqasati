// The computed route of an incoming need (PRD 3.0 §7.2, the requests tab's
// "computed route" column): what Purchasing would do with it, derived from what
// we already hold — never chosen by hand.
//
// In order: what is in stock is reserved; a material a live price agreement
// covers is ordered on it; a need whose estimate at the last price we paid
// stays under the direct-purchase ceiling may be bought direct; everything
// else goes to competition. A need we never paid for has no estimate, so it
// cannot prove it is small — it goes to an RFQ.

import { agreementFor, lastPaid, type PriceAgreement, type PriceHistoryEntry } from "./prices"

export type NeedRoute = "stock" | "agreement" | "direct" | "rfq"

export interface NeedRouteInput {
  name: string
  unit: string
  quantity: number
  onHand: number | null
  agreements: PriceAgreement[]
  history: PriceHistoryEntry[]
  directCap: number
  today: string
}

export function needRoute(n: NeedRouteInput): NeedRoute {
  if (n.onHand != null && n.quantity > 0 && n.onHand >= n.quantity) return "stock"
  if (agreementFor(n.agreements, n.name, n.unit, n.today)) return "agreement"
  const last = lastPaid(n.history, n.name, n.unit)
  if (last && last.price > 0 && last.price * n.quantity <= n.directCap) return "direct"
  return "rfq"
}

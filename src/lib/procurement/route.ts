// The computed route of an incoming need (PRD 3.0 §7.2, the requests tab's
// "computed route" column): what Purchasing would do with it, derived from what
// we already hold — never chosen by hand.
//
// In order: what is in stock is reserved; a need ONE live price agreement
// covers line by line is ordered on it; a need whose estimate at the last
// prices we paid stays under the direct-purchase cap may be bought direct;
// everything else goes to competition. A line we never paid for has no
// estimate, so it cannot prove the need is small — it goes to an RFQ.

import { agreementFor, agreementIsLive, lastPaid, materialKey, type PriceAgreement, type PriceHistoryEntry } from "./prices"

export type NeedRoute = "stock" | "agreement" | "direct" | "rfq"

export interface RouteLine {
  name: string
  unit: string
  quantity: number
  /** What the stores hold of it; null = not stocked. */
  onHand: number | null
}

export interface NeedRouteInput {
  lines: RouteLine[]
  agreements: PriceAgreement[]
  history: PriceHistoryEntry[]
  directCap: number
  today: string
}

export interface RouteResult {
  route: NeedRoute
  /** The agreement to order on (route `agreement`). */
  agreement: PriceAgreement | null
  /** The estimate at the last prices paid (route `direct`), and whom we paid last. */
  estimate: number | null
  lastSupplier: { orgId: string; name: string } | null
}

const covers = (a: PriceAgreement, l: RouteLine) => (a.lines || []).some((x) => materialKey(x.name, x.unit) === materialKey(l.name, l.unit) && Number(x.price) > 0)

export function needRoute(n: NeedRouteInput): RouteResult {
  const lines = n.lines.filter((l) => l.name.trim() && l.quantity > 0)
  const none: RouteResult = { route: "rfq", agreement: null, estimate: null, lastSupplier: null }
  if (!lines.length) return none
  if (lines.every((l) => l.onHand != null && l.onHand >= l.quantity)) return { ...none, route: "stock" }

  // One agreement must cover every line: an order goes to one supplier.
  const live = n.agreements.filter((a) => agreementIsLive(a, n.today) && lines.every((l) => covers(a, l)))
  if (live.length) {
    const best = lines.length === 1 ? agreementFor(live, lines[0].name, lines[0].unit, n.today)?.agreement ?? live[0] : live[0]
    return { ...none, route: "agreement", agreement: best }
  }

  const paid = lines.map((l) => ({ l, last: lastPaid(n.history, l.name, l.unit) }))
  if (paid.every((p) => p.last && p.last.price > 0)) {
    const estimate = Math.round(paid.reduce((s, p) => s + (p.last?.price ?? 0) * p.l.quantity, 0) * 100) / 100
    if (estimate <= n.directCap) {
      const first = paid[0].last
      return { route: "direct", agreement: null, estimate, lastSupplier: first ? { orgId: first.supplierOrgId, name: first.supplierName } : null }
    }
  }
  return none
}

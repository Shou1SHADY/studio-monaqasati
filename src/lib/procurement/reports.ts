// Procurement reports (PRD 3.0 §9) — seven questions over the same world the
// Today screen reads: where spend goes, who carries it, who delivers on time,
// which way prices move, how long a cycle takes and how much competition it
// had, what left the usual path, and what Finance will be asked for soon.
// Every report is a pure function returning rows and totals; the screen
// formats, exports and prints. No Firestore, no React, no sentences.
//
// Values are commitments EXCLUDING VAT, not costs: the actual cost of an item
// is read from Finance's ledger after the invoice. A lump-sum order's part is
// never invented — where a proportional figure would be a guess the row says
// "unknown" and the total leaves it out.

import { acceptedValue, dayOf, daysBetween, daysFromNow, daysLate, isShortCompetition, lowestOffer, offerPrice, poFacts, poLive, poOpenValue, poStatus, poValue, receiptDay, round2, supplierKey, supplierScore, todayOf } from "./po"
import type { OfferFact, ProcWorld, RfqFact } from "./today"
import type { PurchaseOrder } from "./types"

/** `YYYY-MM-DD` bounds on the document's creation day, both inclusive. */
export interface Period {
  from?: string | null
  to?: string | null
}

export const inPeriod = (day: string, p: Period | null | undefined): boolean => Boolean(day) && (!p?.from || day >= p.from) && (!p?.to || day <= p.to)

/** Orders that became commitments: not still awaiting approval, not cancelled. */
export function committedOrders(w: ProcWorld, period?: Period | null): PurchaseOrder[] {
  return w.orders.filter((po) => po.status !== "awaiting_approval" && po.status !== "cancelled" && inPeriod(dayOf(po.createdAt), period))
}

const nameKey = (name: string, unit: string) => `${(name || "").trim().toLowerCase()}|${(unit || "").trim().toLowerCase()}`

// ---------------------------------------------------------------------------
// 1 · Spend by project
// ---------------------------------------------------------------------------

export interface ProjectSpendRow {
  projectId: string | null
  projectName: string
  orders: number
  lines: number
  ordered: number
  /** Accepted value; a lump-sum order still on its way contributes nothing and sets `receivedUnknown`. */
  received: number
  receivedUnknown: boolean
  open: number
}

export interface ProjectSpendReport {
  rows: ProjectSpendRow[]
  totals: { orders: number; lines: number; ordered: number; received: number; open: number }
}

export function spendByProject(w: ProcWorld, period?: Period | null): ProjectSpendReport {
  const by = new Map<string, ProjectSpendRow>()
  for (const po of committedOrders(w, period)) {
    const key = po.projectId || ""
    const row = by.get(key) || { projectId: po.projectId || null, projectName: po.projectName || "", orders: 0, lines: 0, ordered: 0, received: 0, receivedUnknown: false, open: 0 }
    const accepted = acceptedValue(po)
    row.orders++
    row.lines += po.lines.length
    row.ordered = round2(row.ordered + poValue(po))
    row.received = round2(row.received + (accepted ?? 0))
    if (accepted == null) row.receivedUnknown = true
    row.open = round2(row.open + poOpenValue(po))
    if (!row.projectName && po.projectName) row.projectName = po.projectName
    by.set(key, row)
  }
  const rows = [...by.values()].sort((a, b) => b.ordered - a.ordered)
  return {
    rows,
    totals: {
      orders: rows.reduce((s, r) => s + r.orders, 0),
      lines: rows.reduce((s, r) => s + r.lines, 0),
      ordered: round2(rows.reduce((s, r) => s + r.ordered, 0)),
      received: round2(rows.reduce((s, r) => s + r.received, 0)),
      open: round2(rows.reduce((s, r) => s + r.open, 0)),
    },
  }
}

// ---------------------------------------------------------------------------
// 2 · Spend by supplier — concentration above 30 % is worth a ready alternative
// ---------------------------------------------------------------------------

export const CONCENTRATION_PERCENT = 30

export interface SupplierSpendRow {
  supplierKey: string
  supplierName: string
  orders: number
  value: number
  sharePercent: number
  onTimePercent: number | null
  concentrated: boolean
}

export interface SupplierSpendReport {
  rows: SupplierSpendRow[]
  totals: { orders: number; value: number }
  /** The top supplier when his share passes the threshold. */
  concentration: { supplierName: string; sharePercent: number } | null
}

export function spendBySupplier(w: ProcWorld, period: Period | null | undefined, now: Date): SupplierSpendReport {
  const by = new Map<string, { name: string; orders: PurchaseOrder[] }>()
  for (const po of committedOrders(w, period)) {
    const k = supplierKey(po)
    const g = by.get(k) || { name: po.supplierName, orders: [] }
    g.orders.push(po)
    by.set(k, g)
  }
  const total = round2([...by.values()].reduce((s, g) => s + g.orders.reduce((x, po) => x + poValue(po), 0), 0))
  const allBySupplier = new Map<string, PurchaseOrder[]>()
  for (const po of w.orders) allBySupplier.set(supplierKey(po), [...(allBySupplier.get(supplierKey(po)) || []), po])
  const rows: SupplierSpendRow[] = [...by.entries()]
    .map(([k, g]) => {
      const value = round2(g.orders.reduce((s, po) => s + poValue(po), 0))
      const share = total > 0 ? round2((value / total) * 100) : 0
      return { supplierKey: k, supplierName: g.name, orders: g.orders.length, value, sharePercent: share, onTimePercent: supplierScore(allBySupplier.get(k) || [], w.receipts, now).onTimePercent, concentrated: share > CONCENTRATION_PERCENT }
    })
    .sort((a, b) => b.value - a.value)
  const top = rows[0]
  return { rows, totals: { orders: rows.reduce((s, r) => s + r.orders, 0), value: total }, concentration: top && top.concentrated ? { supplierName: top.supplierName, sharePercent: top.sharePercent } : null }
}

// ---------------------------------------------------------------------------
// 3 · Delivery performance — receipts are Inventory's; we measure the supplier by them
// ---------------------------------------------------------------------------

export type DeliveryOrderState = "on_time" | "late" | "on_time_so_far" | "pending"

export interface DeliveryOrderRow {
  orderId: string
  docNumber: string
  supplierName: string
  promisedDate: string | null
  lastReceiptDay: string | null
  /** Days past the promise (negative = early); null while nothing can be judged yet. */
  gap: number | null
  state: DeliveryOrderState
}

export interface DeliverySupplierRow {
  supplierKey: string
  supplierName: string
  orders: number
  onTimePercent: number | null
  avgDaysLate: number | null
  rejectPercent: number | null
}

export interface DeliveryReport {
  suppliers: DeliverySupplierRow[]
  orders: DeliveryOrderRow[]
}

export function deliveryPerformance(w: ProcWorld, period: Period | null | undefined, now: Date): DeliveryReport {
  const judged = committedOrders(w, period).filter((po) => po.supplierAcceptedAt)
  const orders: DeliveryOrderRow[] = judged.map((po) => {
    const facts = poFacts(po, w.receipts)
    const st = poStatus(po)
    const complete = st === "received" || st === "closed"
    let gap: number | null = null
    let state: DeliveryOrderState = "pending"
    if (complete && facts.lastReceiptDay && po.promisedDate) {
      gap = daysBetween(po.promisedDate, facts.lastReceiptDay)
      state = gap > 0 ? "late" : "on_time"
    } else if (po.promisedDate) {
      const d = daysLate(po, now)
      gap = d > 0 ? d : null
      state = d > 0 ? "late" : "on_time_so_far"
    }
    return { orderId: po.id, docNumber: po.docNumber, supplierName: po.supplierName, promisedDate: po.promisedDate || null, lastReceiptDay: facts.lastReceiptDay, gap, state }
  })
  const by = new Map<string, PurchaseOrder[]>()
  for (const po of judged) by.set(supplierKey(po), [...(by.get(supplierKey(po)) || []), po])
  const suppliers: DeliverySupplierRow[] = [...by.entries()]
    .map(([k, list]) => {
      const score = supplierScore(list, w.receipts, now)
      const gaps = orders.filter((o) => list.some((po) => po.id === o.orderId) && o.gap != null).map((o) => Math.max(0, o.gap as number))
      return { supplierKey: k, supplierName: list[0].supplierName, orders: score.orders, onTimePercent: score.onTimePercent, avgDaysLate: gaps.length ? round2(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null, rejectPercent: score.rejectPercent }
    })
    .sort((a, b) => b.orders - a.orders)
  return { suppliers, orders }
}

// ---------------------------------------------------------------------------
// 4 · Price drift vs last buy — (this price − the last price we paid) × quantity
// ---------------------------------------------------------------------------

export interface DriftRow {
  name: string
  unit: string
  orderId: string
  docNumber: string
  supplierName: string
  day: string
  previous: number
  current: number
  quantity: number
  /** Signed, SAR. Positive is not always wrong — steel and copper move — but it deserves to be seen. */
  impact: number
}

export interface DriftReport {
  rows: DriftRow[]
  totals: { impact: number; base: number; percent: number | null }
}

/** Only priced lines; the previous price is the same name+unit on an EARLIER
 * order (any committed one, inside the period or before it). */
export function priceDrift(w: ProcWorld, period?: Period | null): DriftReport {
  const ordered = committedOrders(w).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const last = new Map<string, number>()
  const rows: DriftRow[] = []
  let base = 0
  for (const po of ordered) {
    const day = dayOf(po.createdAt)
    const seen = new Map<string, number>()
    for (const l of po.lines) {
      if (l.unitPrice == null) continue
      const key = nameKey(l.name, l.unit)
      const prev = last.get(key)
      const qty = round2(Number(l.quantity) - Number(l.cancelled || 0))
      if (prev != null && inPeriod(day, period)) {
        rows.push({ name: l.name, unit: l.unit, orderId: po.id, docNumber: po.docNumber, supplierName: po.supplierName, day, previous: prev, current: l.unitPrice, quantity: qty, impact: round2((l.unitPrice - prev) * qty) })
        base += prev * qty
      }
      seen.set(key, l.unitPrice)
    }
    for (const [k, v] of seen) last.set(k, v)
  }
  const impact = round2(rows.reduce((s, r) => s + r.impact, 0))
  return { rows, totals: { impact, base: round2(base), percent: base > 0 ? round2((impact / base) * 100) : null } }
}

// ---------------------------------------------------------------------------
// 5 · Cycle time & competition
// ---------------------------------------------------------------------------

export interface CycleRow {
  rfqId: string
  title: string
  offersCount: number
  invitedCount: number | null
  awarded: boolean
  /** Publish → award, in days, when both dates exist. */
  publishToAwardDays: number | null
  lowestTotal: number | null
  awardedTotal: number | null
  shortCompetition: boolean
}

export interface CycleReport {
  rows: CycleRow[]
  totals: { rfqs: number; awarded: number; avgDays: number | null; avgOffers: number | null; shortCompetition: number }
}

export function cycleAndCompetition(w: ProcWorld, period?: Period | null): CycleReport {
  const offersByRfq = new Map<string, OfferFact[]>()
  for (const o of w.offers) offersByRfq.set(o.rfqId, [...(offersByRfq.get(o.rfqId) || []), o])
  const orderByRfq = new Map<string, PurchaseOrder>()
  for (const po of w.orders) if (po.rfqId && po.status !== "cancelled") orderByRfq.set(po.rfqId, po)

  const rows: CycleRow[] = w.rfqs
    .filter((r: RfqFact) => r.status !== "Draft" && (!r.createdAt || inPeriod(dayOf(r.createdAt), period)))
    .map((r) => {
      const offers = offersByRfq.get(r.id) || []
      const count = offers.length || Number(r.offersCount) || 0
      const po = orderByRfq.get(r.id)
      const awarded = r.status === "Awarded" || Boolean(po)
      const awardDay = dayOf(r.awardedAt) || (po ? dayOf(po.createdAt) : "")
      const publish = dayOf(r.createdAt)
      const best = lowestOffer(offers)
      const lowestTotal = best ? offerPrice(best) : po?.lowestOfferTotal ?? null
      const awardedTotal = po ? poValue(po) : offers.filter((o) => o.status === "مقبول").map(offerPrice).find((p) => p != null) ?? null
      const short = po ? po.shortCompetition : isShortCompetition(awardedTotal ?? lowestTotal, count, w.policies)
      return { rfqId: r.id, title: r.title || "", offersCount: count, invitedCount: r.invitedCount ?? null, awarded, publishToAwardDays: awarded && publish && awardDay ? daysBetween(publish, awardDay) : null, lowestTotal, awardedTotal, shortCompetition: short }
    })
  const days = rows.map((r) => r.publishToAwardDays).filter((d): d is number => d != null)
  return {
    rows,
    totals: {
      rfqs: rows.length,
      awarded: rows.filter((r) => r.awarded).length,
      avgDays: days.length ? round2(days.reduce((s, d) => s + d, 0) / days.length) : null,
      avgOffers: rows.length ? round2(rows.reduce((s, r) => s + r.offersCount, 0) / rows.length) : null,
      shortCompetition: rows.filter((r) => r.shortCompetition).length,
    },
  }
}

// ---------------------------------------------------------------------------
// 6 · Exceptions — permitted actions off the usual path, by name. Not
// violations: what the owner should see monthly.
// ---------------------------------------------------------------------------

export const EXCEPTION_KINDS = ["retroactive", "direct", "non_lowest", "short_competition", "self_approval", "no_official_quote", "closed_short", "manual_receipt", "no_po", "self_received", "no_notice", "cash_expense"] as const
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]

export interface ExceptionRow {
  kind: ExceptionKind
  docNumber: string
  orderId: string | null
  receiptId: string | null
  supplierName: string
  byName: string
  approvedByName: string
  day: string
  params: Record<string, string | number>
  href: string
}

export function exceptions(w: ProcWorld, period?: Period | null): ExceptionRow[] {
  const out: ExceptionRow[] = []
  const orderById = new Map(w.orders.map((o) => [o.id, o]))
  const orderHref = (id: string) => `/contractor/rfqs/orders?po=${id}`
  const receiptHref = (id: string) => `/contractor/goods-received?tab=incoming&delivery=${id}`

  for (const po of committedOrders(w, period)) {
    const base = { docNumber: po.docNumber, orderId: po.id, receiptId: null, supplierName: po.supplierName, byName: po.preparedByName, approvedByName: po.approvedByName || "", day: dayOf(po.createdAt), href: orderHref(po.id) }
    if (po.basis === "retroactive") out.push({ ...base, kind: "retroactive", params: {} })
    else if (po.basis === "direct") out.push({ ...base, kind: "direct", params: { reason: po.awardReasonText || po.awardReasonCode || "" } })
    if (po.basis !== "direct" && po.basis !== "retroactive" && (po.awardReasonCode || po.awardReasonText)) out.push({ ...base, kind: "non_lowest", params: { reasonCode: po.awardReasonCode || "other", reason: po.awardReasonText || "" } })
    if (po.shortCompetition && po.basis === "rfq") out.push({ ...base, kind: "short_competition", params: { count: po.offersCount } })
    if (po.approvedById && po.approvedById === po.preparedById) out.push({ ...base, kind: "self_approval", params: {}, day: dayOf(po.approvedAt) || base.day })
    if (po.noOfficialQuote) out.push({ ...base, kind: "no_official_quote", params: {} })
    if (po.status === "closed" && po.closedShort) out.push({ ...base, kind: "closed_short", params: { reason: po.closeReason || "" }, day: dayOf(po.closedAt) || base.day })
  }

  for (const r of w.receipts) {
    if (r.status !== "confirmed") continue
    const day = receiptDay(r)
    if (!inPeriod(day, period)) continue
    const po = r.poId ? orderById.get(r.poId) : undefined
    const base = { docNumber: r.docNumber || r.poNumber || "", orderId: r.poId || null, receiptId: r.id, supplierName: r.supplierName || po?.supplierName || "", byName: "", approvedByName: "", day, href: receiptHref(r.id) }
    if (r.source === "manual" && !r.poId && !r.offerId) out.push({ ...base, kind: "no_po", params: {} })
    else if (r.source === "manual" && r.poId) out.push({ ...base, kind: "manual_receipt", params: {} })
    if (r.selfReceived) out.push({ ...base, kind: "self_received", params: {}, byName: po?.preparedByName || "" })
    // Both already stored on the receipt and both off the usual path (PRD SS9):
    // a truck that arrived with nothing announcing it, and a no-order receipt
    // sent to Finance as an expense instead of being regularised by an order.
    if (r.noNotice) out.push({ ...base, kind: "no_notice", params: {} })
    if (r.regularisation === "expense") out.push({ ...base, kind: "cash_expense", params: {} })
  }

  return out.sort((a, b) => b.day.localeCompare(a.day) || a.docNumber.localeCompare(b.docNumber))
}

// ---------------------------------------------------------------------------
// 7 · Open commitments by due date — what Finance will be asked for, and when
// ---------------------------------------------------------------------------

export const COMMITMENT_BUCKETS = ["within7", "within30", "within60", "later", "noDate"] as const
export type CommitmentBucket = (typeof COMMITMENT_BUCKETS)[number]

export interface CommitmentRow {
  orderId: string
  docNumber: string
  supplierName: string
  promisedDate: string | null
  /** Days to the promise (negative = overdue); null without a date. */
  daysToDue: number | null
  value: number
  bucket: CommitmentBucket
}

export interface CommitmentReport {
  rows: CommitmentRow[]
  buckets: Record<CommitmentBucket, { count: number; value: number }>
  total: number
}

/** Live orders by their promised date: the overdue sit in the first week's
 * bucket (Finance will be asked for them first, not never). Not period-filtered. */
export function openCommitments(w: ProcWorld, now: Date): CommitmentReport {
  const buckets = Object.fromEntries(COMMITMENT_BUCKETS.map((b) => [b, { count: 0, value: 0 }])) as Record<CommitmentBucket, { count: number; value: number }>
  const rows: CommitmentRow[] = []
  for (const po of w.orders) {
    if (!poLive(po)) continue
    const value = poOpenValue(po)
    if (!(value > 0)) continue
    const d = daysFromNow(po.promisedDate, now)
    const bucket: CommitmentBucket = d == null ? "noDate" : d <= 7 ? "within7" : d <= 30 ? "within30" : d <= 60 ? "within60" : "later"
    rows.push({ orderId: po.id, docNumber: po.docNumber, supplierName: po.supplierName, promisedDate: po.promisedDate || null, daysToDue: d, value, bucket })
    buckets[bucket].count++
    buckets[bucket].value = round2(buckets[bucket].value + value)
  }
  rows.sort((a, b) => (a.daysToDue ?? 9999) - (b.daysToDue ?? 9999) || a.docNumber.localeCompare(b.docNumber))
  return { rows, buckets, total: round2(rows.reduce((s, r) => s + r.value, 0)) }
}

/** The period the screen's "last N days" segment means, ending today. */
export function lastDays(days: number, now: Date): Period {
  const to = todayOf(now)
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10)
  return { from, to }
}

// Sales reports (PRD REP-01…04) — how much did we sell at what margin, where
// does the funnel stall, and who did what.
//
// Sales are recognised on SIGNED DELIVERY, never on the order: a signed
// quotation that never ships never inflates a report. So the exit criterion of
// release 2 holds by construction — sales = signed deliveries, transfers =
// notices. Cost and margin are computed only for a viewer who may see them
// (INV-08); a line with no standard cost is excluded from margin and named as
// such, never filled with a guess (PRC-04). No pay, commission or appraisal
// here — that is HR's.
//
// No Firestore, no React, no strings: the screen formats.

import type { CrmQuotation } from "./crm"
import { committedValue, deliveryNoteValue, isExternal, orderLineProgress, orderNet, type SalesOrder } from "./sales-orders"
import { addDays, quoteLifecycle, type QuoteLifecycle } from "./sales-quotes"
import { orderGapValue, type SalesWorld } from "./sales-today"

const round2 = (n: number) => Math.round(n * 100) / 100
const keyOf = (name: string) => name.trim().toLowerCase()
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "")
const pct = (part: number, whole: number) => (whole > 0 ? round2((part / whole) * 100) : null)

export const REPORT_PERIODS = [30, 90, 365] as const
export type ReportPeriod = (typeof REPORT_PERIODS)[number]

interface SignedLine {
  day: string
  order: SalesOrder
  name: string
  quantity: number
  value: number
  /** Null when the line's standard cost was never known. */
  cost: number | null
}

/** Every signed, external delivery line — the one source all sales figures read. */
function signedLines(w: SalesWorld): SignedLine[] {
  const orderById = new Map(w.orders.map((o) => [o.id, o]))
  const out: SignedLine[] = []
  for (const note of w.notes) {
    if (note.status !== "delivered" || !note.deliveredAt) continue
    const order = orderById.get(note.orderId)
    if (!order || !isExternal(order)) continue
    for (const l of note.lines) {
      const line = order.lines.find((x) => keyOf(x.name) === keyOf(l.name))
      if (!line) continue
      out.push({ day: dayOf(note.deliveredAt), order, name: line.name, quantity: l.quantity, value: round2(l.quantity * line.unitPrice), cost: line.unitCost == null ? null : round2(l.quantity * line.unitCost) })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Company (REP-01)
// ---------------------------------------------------------------------------

export interface MonthRow {
  /** "2026-09" */
  month: string
  sales: number
  /** Null without cost access, or when nothing sold had a known cost. */
  marginPercent: number | null
}

export function monthlySales(w: SalesWorld, seesCost: boolean, months = 6): MonthRow[] {
  const lines = signedLines(w)
  const out: MonthRow[] = []
  const base = new Date(`${w.today}T00:00:00Z`)
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1))
    const month = d.toISOString().slice(0, 7)
    const mine = lines.filter((l) => l.day.slice(0, 7) === month)
    const sales = round2(mine.reduce((s, l) => s + l.value, 0))
    const costed = mine.filter((l) => l.cost != null)
    const costedValue = costed.reduce((s, l) => s + l.value, 0)
    const cost = costed.reduce((s, l) => s + (l.cost || 0), 0)
    out.push({ month, sales, marginPercent: seesCost ? pct(costedValue - cost, costedValue) : null })
  }
  return out
}

export interface ProductRow {
  name: string
  quantity: number
  value: number
  /** Real margin on the costed part; null without cost access or with no cost at all. */
  marginPercent: number | null
  /** Part of the value that carries no standard cost — excluded from margin. */
  uncostedValue: number
}

export function topProducts(w: SalesWorld, period: ReportPeriod, seesCost: boolean): { rows: ProductRow[]; total: number; marginPercent: number | null } {
  const from = addDays(w.today, -period)
  const by = new Map<string, { name: string; quantity: number; value: number; costedValue: number; cost: number }>()
  for (const l of signedLines(w)) {
    if (l.day < from || l.day > w.today) continue
    const row = by.get(keyOf(l.name)) || { name: l.name, quantity: 0, value: 0, costedValue: 0, cost: 0 }
    row.quantity += l.quantity
    row.value += l.value
    if (l.cost != null) {
      row.costedValue += l.value
      row.cost += l.cost
    }
    by.set(keyOf(l.name), row)
  }
  const rows = Array.from(by.values())
    .map((r) => ({ name: r.name, quantity: round2(r.quantity), value: round2(r.value), marginPercent: seesCost ? pct(r.costedValue - r.cost, r.costedValue) : null, uncostedValue: round2(r.value - r.costedValue) }))
    .sort((a, b) => b.value - a.value)
  const all = Array.from(by.values())
  const costedValue = all.reduce((s, r) => s + r.costedValue, 0)
  return { rows, total: round2(rows.reduce((s, r) => s + r.value, 0)), marginPercent: seesCost ? pct(costedValue - all.reduce((s, r) => s + r.cost, 0), costedValue) : null }
}

export interface ClientShare {
  contactId: string
  name: string
  value: number
  sharePercent: number
}

/** A share above this is a concentration figure, not a success figure. */
export const CONCENTRATION_ALERT_PERCENT = 40

export function clientShares(w: SalesWorld, period: ReportPeriod): ClientShare[] {
  const from = addDays(w.today, -period)
  const orderById = new Map(w.orders.map((o) => [o.id, o]))
  const by = new Map<string, { name: string; value: number }>()
  for (const note of w.notes) {
    const day = dayOf(note.deliveredAt)
    if (note.status !== "delivered" || !day || day < from || day > w.today) continue
    const order = orderById.get(note.orderId)
    if (!order || !isExternal(order) || !order.contactId) continue
    const row = by.get(order.contactId) || { name: order.contactName || "", value: 0 }
    row.value += deliveryNoteValue(note, order)
    by.set(order.contactId, row)
  }
  const total = Array.from(by.values()).reduce((s, r) => s + r.value, 0)
  return Array.from(by, ([contactId, r]) => ({ contactId, name: r.name, value: round2(r.value), sharePercent: pct(r.value, total) ?? 0 })).sort((a, b) => b.value - a.value)
}

export type PromiseHorizon = "past_due" | "this_week" | "next_two_weeks" | "later" | "no_promise"
export const PROMISE_HORIZONS: PromiseHorizon[] = ["past_due", "this_week", "next_two_weeks", "later", "no_promise"]

/** The order book: what is promised and not delivered, by when it was promised. */
export function orderBook(w: SalesWorld): { rows: Record<PromiseHorizon, number>; total: number } {
  const rows: Record<PromiseHorizon, number> = { past_due: 0, this_week: 0, next_two_weeks: 0, later: 0, no_promise: 0 }
  for (const o of w.orders) {
    if (o.status !== "running" || !isExternal(o) || o.type === "framework") continue
    const owed = orderLineProgress(o, w.notes).reduce((s, l) => s + l.remainingValue, 0)
    if (!(owed > 0)) continue
    const days = o.promiseDate ? Math.round((Date.parse(`${dayOf(o.promiseDate)}T00:00:00Z`) - Date.parse(`${w.today}T00:00:00Z`)) / 86400000) : null
    const h: PromiseHorizon = days == null ? "no_promise" : days < 0 ? "past_due" : days <= 7 ? "this_week" : days <= 21 ? "next_two_weeks" : "later"
    rows[h] = round2(rows[h] + owed)
  }
  return { rows, total: committedValue(w.orders, w.notes) }
}

// ---------------------------------------------------------------------------
// Sales (REP-02)
// ---------------------------------------------------------------------------

export interface FunnelStage {
  key: "requests" | "live_quotes" | "confirmed" | "transfers"
  count: number
  value: number
}

export function salesFunnel(w: SalesWorld): FunnelStage[] {
  const open = w.requests.filter((r) => r.status === "new")
  const live = w.quotations.filter((q) => quoteLifecycle(q, w.today) === "sent")
  const running = w.orders.filter((o) => o.status === "running" && isExternal(o) && o.type !== "framework" && orderLineProgress(o, w.notes).some((l) => l.remaining > 0))
  const reported = w.notices.filter((n) => n.status === "reported")
  return [
    { key: "requests", count: open.length, value: 0 },
    { key: "live_quotes", count: live.length, value: round2(live.reduce((s, q) => s + (Number(q.amount) || 0), 0)) },
    { key: "confirmed", count: running.length, value: committedValue(w.orders, w.notes) },
    { key: "transfers", count: reported.length, value: round2(reported.reduce((s, n) => s + (Number(n.amountStated) || 0), 0)) },
  ]
}

/** Whole days from the CRM request to the quote being issued — the answer
 * CRM is waiting for. Null when nothing can be measured yet. */
function responseDays(quotes: CrmQuotation[], w: SalesWorld): number | null {
  const requestedAt = new Map(w.requests.map((r) => [r.id, r.requestedAt]))
  const spans: number[] = []
  for (const q of quotes) {
    const asked = q.requestId ? requestedAt.get(q.requestId) : null
    if (!asked || !q.issuedAt) continue
    spans.push(Math.max(0, (Date.parse(q.issuedAt) - Date.parse(asked)) / 86400000))
  }
  return spans.length ? round2(spans.reduce((a, b) => a + b, 0) / spans.length) : null
}

export interface WinLoss {
  won: number
  lost: number
  winRatePercent: number | null
  /** Expired with no outcome — silent losses. */
  expiredUndecided: number
  responseDays: number | null
  byState: Record<QuoteLifecycle, number>
  /** Loss reasons, most frequent first. */
  reasons: Array<{ reason: string; count: number; value: number }>
}

export function winLoss(w: SalesWorld, period: ReportPeriod): WinLoss {
  const from = addDays(w.today, -period)
  const byState: Record<QuoteLifecycle, number> = { draft: 0, issued: 0, sent: 0, expired: 0, won: 0, lost: 0, superseded: 0 }
  for (const q of w.quotations) byState[quoteLifecycle(q, w.today)] += 1
  const inPeriod = (iso: string | null | undefined) => !!iso && dayOf(iso) >= from
  const won = w.quotations.filter((q) => q.status === "accepted" && !q.supersededById && inPeriod(q.acceptedAt))
  const lost = w.quotations.filter((q) => q.status === "rejected" && !q.supersededById && inPeriod(q.rejectedAt))
  const reasons = new Map<string, { reason: string; count: number; value: number }>()
  for (const q of lost) {
    const reason = (q.lostReason || "").trim()
    const row = reasons.get(keyOf(reason)) || { reason, count: 0, value: 0 }
    row.count += 1
    row.value = round2(row.value + (Number(q.amount) || 0))
    reasons.set(keyOf(reason), row)
  }
  return {
    won: won.length,
    lost: lost.length,
    winRatePercent: pct(won.length, won.length + lost.length),
    expiredUndecided: byState.expired,
    responseDays: responseDays(w.quotations.filter((q) => inPeriod(q.issuedAt)), w),
    byState,
    reasons: Array.from(reasons.values()).sort((a, b) => b.count - a.count || b.value - a.value),
  }
}

export interface ExecutionBlocks {
  uncoveredOrders: number
  gatedOrders: number
  unansweredRequests: number
  awaitingAdvance: number
  heldShipments: number
}

export function executionBlocks(w: SalesWorld): ExecutionBlocks {
  const orderById = new Map(w.orders.map((o) => [o.id, o]))
  return {
    uncoveredOrders: w.orders.filter((o) => o.status === "running" && isExternal(o) && o.type !== "framework" && orderGapValue(o, w.coverage) > 0).length,
    gatedOrders: w.orders.filter((o) => o.status === "running" && w.gates.has(o.id)).length,
    // The plant's clock does not run while the order still waits for its advance (PAY-07).
    unansweredRequests: w.mfgRequests.filter((r) => {
      if (r.status !== "new" || r.kind === "cost" || !r.orderId) return false
      if (orderById.get(r.orderId)?.status === "awaiting_deposit") return false
      return r.requestedAt ? (w.nowMs - Date.parse(r.requestedAt)) / 3600000 >= w.answerWindowHours : false
    }).length,
    awaitingAdvance: w.orders.filter((o) => o.status === "awaiting_deposit").length,
    heldShipments: w.notes.filter((n) => n.status === "held").length,
  }
}

// ---------------------------------------------------------------------------
// Staff (REP-03) — what each did, not what they are owed
// ---------------------------------------------------------------------------

export interface StaffRow {
  userId: string
  name: string
  quotes: number
  sent: number
  won: number
  lost: number
  winRatePercent: number | null
  /** Net value of the orders born of their quotes. */
  orderValue: number
  /** Average discount off the list price across their quoted lines; null when
   * no list price is known to the viewer. */
  avgDiscountPercent: number | null
  responseDays: number | null
}

export function staffReport(
  w: SalesWorld,
  period: ReportPeriod,
  people: Array<{ id: string; name: string }>,
  /** The price list — pass only to a viewer who may read it. */
  listPrices: Array<{ name: string; unitPrice: number }> | null,
  /** A rep sees only himself. */
  onlyUserId: string | null
): StaffRow[] {
  const from = addDays(w.today, -period)
  const list = new Map((listPrices || []).map((p) => [keyOf(p.name), Number(p.unitPrice) || 0]))
  const orderByQuote = new Map(w.orders.filter((o) => o.quotationId).map((o) => [o.quotationId as string, o]))
  const names = new Map(people.map((p) => [p.id, p.name]))
  const byUser = new Map<string, CrmQuotation[]>()
  for (const q of w.quotations) {
    if (!q.createdByUserId || q.supersededById) continue
    if (dayOf(q.date || "") < from && dayOf(q.issuedAt) < from) continue
    if (onlyUserId && q.createdByUserId !== onlyUserId) continue
    byUser.set(q.createdByUserId, [...(byUser.get(q.createdByUserId) || []), q])
  }
  const rows: StaffRow[] = []
  for (const [userId, quotes] of byUser) {
    const won = quotes.filter((q) => q.status === "accepted")
    const lost = quotes.filter((q) => q.status === "rejected")
    let listTotal = 0
    let netTotal = 0
    for (const q of quotes) {
      for (const i of q.items || []) {
        const price = list.get(keyOf(i.name))
        if (!price) continue
        listTotal += price * i.quantity
        netTotal += i.unitPrice * i.quantity
      }
    }
    rows.push({
      userId,
      name: names.get(userId) || quotes[0]?.createdByUserName || "",
      quotes: quotes.length,
      sent: quotes.filter((q) => !!q.sentAt).length,
      won: won.length,
      lost: lost.length,
      winRatePercent: pct(won.length, won.length + lost.length),
      orderValue: round2(won.reduce((s, q) => s + (orderByQuote.get(q.id) ? orderNet(orderByQuote.get(q.id) as SalesOrder) : 0), 0)),
      avgDiscountPercent: listPrices && listTotal > 0 ? round2(((listTotal - netTotal) / listTotal) * 100) : null,
      responseDays: responseDays(quotes, w),
    })
  }
  return rows.sort((a, b) => b.orderValue - a.orderValue || b.quotes - a.quotes)
}

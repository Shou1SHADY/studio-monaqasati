// "Today" in Sales (PRD §4, §5, HOME-01…04) — what needs my decision now?
//
// Three KPIs, not six; the flow strip; and the single "needs your decision"
// queue: one action per row, only what the role can do, nearest risk first, in
// four groups. Everything here is derived from the documents (INV-04) — the
// screen owns no numbers of its own. No Firestore, no React, no strings: the
// screen formats.

import type { CrmQuotation } from "./crm"
import { installmentStates } from "./sales-installments"
import {
  committedValue,
  deliveredSales,
  deliveryNoteValue,
  orderLineProgress,
  returnValue,
  type LineCoverage,
  type ManufacturingRequest,
  type SalesDeliveryNote,
  type SalesOrder,
  type SalesReturn,
} from "./sales-orders"
import { installmentNoticeState, type QuoteRequest, type TransferNotice } from "./sales-transfers"
import { addDays, daysToExpiry, quoteLifecycle } from "./sales-quotes"

const round2 = (n: number) => Math.round(n * 100) / 100
const keyOf = (name: string) => name.trim().toLowerCase()
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "")
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

/** What the viewer may act on — the queue shows nothing else (HOME-03). */
export interface TodayViewer {
  canSell: boolean
  /** Prices & returns — the manager's (DLV-05). */
  canDecideReturns: boolean
  /** Cost and margin — never a rep's (INV-08). */
  seesCost: boolean
}

export interface SalesWorld {
  today: string
  nowMs: number
  quotations: CrmQuotation[]
  requests: QuoteRequest[]
  orders: SalesOrder[]
  notes: SalesDeliveryNote[]
  returns: SalesReturn[]
  notices: TransferNotice[]
  mfgRequests: ManufacturingRequest[]
  /** `${orderId}|${itemKey}` → the line's supply (from `allocateCoverage`). */
  coverage: Map<string, LineCoverage>
  /** Sales orders whose work orders wait on a gate: order id → the gate. */
  gates: Map<string, "measurement" | "approval">
  /** The plant's answer window, Finance's policy. */
  answerWindowHours: number
  /** Products whose actual cost ran past standard (cost roles only). */
  costDrifts?: CostDrift[]
}

export interface CostDrift {
  name: string
  standard: number
  actual: number
  /** Percent over standard. */
  driftPercent: number
}

// ---------------------------------------------------------------------------
// The three KPIs (HOME-01)
// ---------------------------------------------------------------------------

export interface TodayKpis {
  /** Sales recognised on SIGNED delivery in the last 30 days, external only. */
  delivered30: number
  /** Margin on those sales — null for a viewer without cost access, or when no cost is known. */
  margin30Percent: number | null
  /** Confirmed, not yet delivered. */
  promised: number
  /** …of which nothing covers: no stock, no work order. */
  promisedNoSupply: number
  liveQuotes: number
  liveQuotesValue: number
  /** Live quotes whose validity ends within 7 days. */
  expiringIn7: number
}

/** Value of an order's lines that nothing covers, at the order's prices. */
export function orderGapValue(order: SalesOrder, coverage: Map<string, LineCoverage>): number {
  return round2(
    order.lines.reduce((sum, l) => {
      const c = coverage.get(`${order.id}|${keyOf(l.name)}`)
      return sum + (c ? c.gap * l.unitPrice : 0)
    }, 0)
  )
}

const isPromised = (o: SalesOrder) => o.status === "running" && o.type !== "internal" && o.type !== "framework"

export function todayKpis(w: SalesWorld, viewer: TodayViewer): TodayKpis {
  const from = addDays(w.today, -30)
  const sold = deliveredSales(w.notes, w.orders, from, w.today)
  const live = w.quotations.filter((q) => quoteLifecycle(q, w.today) === "sent")
  return {
    delivered30: sold.external,
    margin30Percent: viewer.seesCost && sold.external > 0 && sold.cost > 0 ? round2(((sold.external - sold.cost) / sold.external) * 100) : null,
    promised: committedValue(w.orders, w.notes),
    promisedNoSupply: round2(w.orders.filter(isPromised).reduce((sum, o) => sum + orderGapValue(o, w.coverage), 0)),
    liveQuotes: live.length,
    liveQuotesValue: round2(live.reduce((s, q) => s + (Number(q.amount) || 0), 0)),
    expiringIn7: live.filter((q) => {
      const d = daysToExpiry(q, w.today)
      return d != null && d <= 7
    }).length,
  }
}

// ---------------------------------------------------------------------------
// The flow strip (HOME-02)
// ---------------------------------------------------------------------------

export interface FlowStrip {
  liveQuotes: number
  promised: number
  delivered30: number
  /** Transfers the seller reported that Finance has not answered. */
  transfersAwaiting: number
  /** Confirmed by Finance in the last 30 days — read-only, from Finance. */
  confirmed30: number
}

export function flowStrip(w: SalesWorld): FlowStrip {
  const from = addDays(w.today, -30)
  const k = todayKpis(w, { canSell: true, canDecideReturns: false, seesCost: false })
  return {
    liveQuotes: k.liveQuotesValue,
    promised: k.promised,
    delivered30: k.delivered30,
    transfersAwaiting: round2(w.notices.filter((n) => n.status === "reported").reduce((s, n) => s + (Number(n.amountStated) || 0), 0)),
    confirmed30: round2(
      w.notices.filter((n) => n.status === "confirmed" && dayOf(n.answeredAt) >= from).reduce((s, n) => s + (Number(n.amountStated) || 0), 0)
    ),
  }
}

// ---------------------------------------------------------------------------
// "Needs your decision" — the single queue (§5, HOME-03)
// ---------------------------------------------------------------------------

export type DecisionGroup = "requests" | "orders" | "delivery" | "payments"
export const DECISION_GROUPS: DecisionGroup[] = ["requests", "orders", "delivery", "payments"]

export type DecisionKind =
  | "request_to_price" // 1
  | "request_draft" // 1 (a draft exists: finish it)
  | "quote_not_sent" // 2
  | "draft_not_issued" // 3
  | "quote_expiring" // 4
  | "quote_expired" // 4
  | "order_awaits_advance" // 5
  | "transfer_not_found" // 6
  | "shipment_held" // 7
  | "line_no_supply" // 8
  | "gate_closed" // 9
  | "mfg_request_unanswered" // 10
  | "mfg_request_declined" // 8 (the plant said no: adjust the order or tell the client)
  | "promise_overdue" // 11
  | "shipment_to_sign" // 13
  | "return_to_decide" // 14
  | "price_to_review" // 15

export type DecisionTone = "danger" | "warn" | "info"

export interface Decision {
  key: string
  kind: DecisionKind
  group: DecisionGroup
  tone: DecisionTone
  /** Nearest risk first: days until it bites (negative = already late). */
  risk: number
  /** Where the one action is performed (portal-relative, under `sales/`). */
  href: string
  /** Facts the row names; the screen formats them. */
  facts: Record<string, string | number>
}

const GROUP_OF: Record<DecisionKind, DecisionGroup> = {
  request_to_price: "requests",
  request_draft: "requests",
  quote_not_sent: "requests",
  draft_not_issued: "requests",
  quote_expiring: "requests",
  quote_expired: "requests",
  price_to_review: "requests",
  order_awaits_advance: "payments",
  transfer_not_found: "payments",
  return_to_decide: "payments",
  shipment_held: "delivery",
  shipment_to_sign: "delivery",
  line_no_supply: "orders",
  gate_closed: "orders",
  mfg_request_unanswered: "orders",
  mfg_request_declined: "orders",
  promise_overdue: "orders",
}

export function todayDecisions(w: SalesWorld, viewer: TodayViewer): Decision[] {
  const out: Decision[] = []
  const add = (d: Omit<Decision, "group">) => out.push({ ...d, group: GROUP_OF[d.kind] })
  const orderById = new Map(w.orders.map((o) => [o.id, o]))

  if (viewer.canSell) {
    // 1 · a request awaits pricing — red when past due; "finish the draft" when one exists.
    for (const r of w.requests) {
      if (r.status !== "new") continue
      const due = r.dueDate ? daysBetween(w.today, r.dueDate) : null
      add({
        key: `rq:${r.id}`,
        kind: r.draftQuotationId ? "request_draft" : "request_to_price",
        tone: due != null && due < 0 ? "danger" : due != null && due <= 2 ? "warn" : "info",
        risk: due == null ? 9 : due - 10,
        href: r.draftQuotationId ? `quotations/new?draft=${r.draftQuotationId}` : `quotations/new?request=${r.id}`,
        facts: { number: r.requestNumber, client: r.contactName || "", due: r.dueDate || "", late: due != null && due < 0 ? 1 : 0 },
      })
    }
    const draftOfRequest = new Set(w.requests.filter((r) => r.status === "new" && r.draftQuotationId).map((r) => r.draftQuotationId as string))

    for (const q of w.quotations) {
      const state = quoteLifecycle(q, w.today)
      const facts = { number: q.quotationNumber, client: q.contactName || "", amount: Number(q.amount) || 0 }
      // 2 · issued but not logged as sent — a quote that never reaches the client is not a quote.
      if (state === "issued") add({ key: `qi:${q.id}`, kind: "quote_not_sent", tone: "warn", risk: -5, href: `quotations/${q.id}`, facts })
      // 3 · a draft never issued (one that answers an open request is row 1).
      else if (state === "draft" && !draftOfRequest.has(q.id)) add({ key: `qd:${q.id}`, kind: "draft_not_issued", tone: "info", risk: 0, href: `quotations/new?draft=${q.id}`, facts })
      // 4 · expires within 3 days, or expired undecided — a silent loss shown daily.
      else if (state === "expired") add({ key: `qx:${q.id}`, kind: "quote_expired", tone: "warn", risk: daysToExpiry(q, w.today) ?? 0, href: `quotations/${q.id}`, facts: { ...facts, until: dayOf(q.validUntil) } })
      else if (state === "sent") {
        const left = daysToExpiry(q, w.today)
        if (left != null && left <= 3) add({ key: `qe:${q.id}`, kind: "quote_expiring", tone: "warn", risk: left, href: `quotations/${q.id}`, facts: { ...facts, days: left } })
      }
    }

    const noticesByQuote = new Map<string, TransferNotice[]>()
    for (const n of w.notices) noticesByQuote.set(n.quotationId, [...(noticesByQuote.get(n.quotationId) || []), n])
    const quoteById = new Map(w.quotations.map((q) => [q.id, q]))

    for (const o of w.orders) {
      const facts = { number: o.orderNumber, client: o.contactName || "" }
      // 5 · awaits its advance — only until the transfer is reported; then it is Finance's.
      if (o.status === "awaiting_deposit") {
        const q = o.quotationId ? quoteById.get(o.quotationId) : null
        const advanceId = o.payment.advanceInstallmentId || "deposit"
        const state = q ? installmentStates(q).find((s) => s.id === advanceId) : null
        const noticeState = state ? installmentNoticeState(state, noticesByQuote.get(o.quotationId || "") || []) : "not_reported"
        if (noticeState === "not_reported" && !o.payment.depositReportedAt) {
          add({ key: `adv:${o.id}`, kind: "order_awaits_advance", tone: "warn", risk: 1, href: "payments", facts: { ...facts, percent: o.payment.depositPercent ?? 0 } })
        }
        continue
      }
      if (!isPromised(o)) continue

      const promiseIn = o.promiseDate ? daysBetween(w.today, o.promiseDate) : null
      // 9 · a gate is closed — the plant records the measurement; the client's approval is ours to chase.
      const gate = w.gates.get(o.id)
      if (gate) add({ key: `gate:${o.id}`, kind: "gate_closed", tone: promiseIn != null && promiseIn < 7 ? "danger" : "warn", risk: promiseIn == null ? 9 : promiseIn - 1, href: `orders?open=${o.id}`, facts: { ...facts, gate } })

      // 8 · a line has no supply — send a production request, or adjust the order.
      const gapLine = o.lines.find((l) => (w.coverage.get(`${o.id}|${keyOf(l.name)}`)?.gap || 0) > 0)
      if (gapLine) {
        const gap = w.coverage.get(`${o.id}|${keyOf(gapLine.name)}`)!.gap
        const asked = w.mfgRequests.filter((r) => r.orderId === o.id && keyOf(r.itemName || "") === keyOf(gapLine.name))
        const declined = asked.find((r) => r.status === "rejected")
        const pending = asked.some((r) => r.status === "new")
        if (declined && !pending) {
          add({ key: `dec:${o.id}`, kind: "mfg_request_declined", tone: "danger", risk: promiseIn ?? 9, href: `orders?open=${o.id}`, facts: { ...facts, item: gapLine.name, qty: gap, reason: declined.rejectionReason || declined.answerNote || "" } })
        } else if (!pending) {
          add({ key: `gap:${o.id}`, kind: "line_no_supply", tone: "danger", risk: promiseIn ?? 9, href: `orders?open=${o.id}`, facts: { ...facts, item: gapLine.name, qty: gap, value: orderGapValue(o, w.coverage) } })
        }
      }

      // 11 · the promise has passed and goods are still owed — reset it and tell the client.
      if (promiseIn != null && promiseIn < 0 && orderLineProgress(o, w.notes).some((l) => l.remaining > 0)) {
        add({ key: `pro:${o.id}`, kind: "promise_overdue", tone: "danger", risk: promiseIn, href: `orders?open=${o.id}`, facts: { ...facts, promise: o.promiseDate || "", days: -promiseIn } })
      }
    }

    // 10 · a production request unanswered past the window — the clock does not
    // run while the order still waits for its advance (PAY-07).
    for (const r of w.mfgRequests) {
      if (r.status !== "new" || r.sourceKind === "project" || r.kind === "cost" || !r.orderId) continue
      const order = orderById.get(r.orderId)
      if (order?.status === "awaiting_deposit") continue
      const hours = r.requestedAt ? (w.nowMs - Date.parse(r.requestedAt)) / 3600000 : 0
      if (hours < w.answerWindowHours) continue
      add({ key: `mr:${r.id}`, kind: "mfg_request_unanswered", tone: "warn", risk: -Math.floor(hours / 24), href: `orders?open=${r.orderId}`, facts: { number: r.requestNumber, order: r.orderNumber ?? "", item: r.itemName || "", days: Math.floor(hours / 24) } })
    }

    for (const n of w.notes) {
      const order = orderById.get(n.orderId)
      const facts = { number: n.noteNumber, client: n.contactName || "", amount: deliveryNoteValue(n, order) }
      // 7 · held by Finance — the seller's only act is to ask for the release.
      if (n.status === "held" && !n.releaseRequestedAt) add({ key: `hold:${n.id}`, kind: "shipment_held", tone: "danger", risk: -38, href: "fulfillment", facts })
      // 13 · authorised, not signed — a delivery does not count before the signature.
      if (n.status === "authorized") add({ key: `sign:${n.id}`, kind: "shipment_to_sign", tone: "info", risk: 0, href: "fulfillment", facts })
    }

    // 6 · Finance could not find a transfer — check with the client and report again.
    for (const q of w.quotations) {
      const mine = noticesByQuote.get(q.id)
      if (!mine?.length) continue
      for (const s of installmentStates(q)) {
        if (installmentNoticeState(s, mine) !== "not_found") continue
        const last = [...mine].filter((n) => n.installmentId === s.id && n.status === "not_found").sort((a, b) => (b.answeredAt || "").localeCompare(a.answeredAt || ""))[0]
        add({ key: `nf:${q.id}:${s.id}`, kind: "transfer_not_found", tone: "danger", risk: -20, href: "payments", facts: { number: q.quotationNumber, client: q.contactName || "", message: last?.financeMessage || "" } })
      }
    }
  }

  // 14 · a return awaits our decision — the manager's, never a rep's.
  if (viewer.canDecideReturns) {
    for (const r of w.returns) {
      if (r.status !== "awaiting_decision") continue
      add({ key: `ret:${r.id}`, kind: "return_to_decide", tone: "warn", risk: 0, href: "fulfillment", facts: { number: r.returnNumber, client: r.contactName || "", amount: returnValue(r, orderById.get(r.orderId)), reason: r.reason } })
    }
  }

  // 15 · actual cost past standard — cost roles only, so the figures never leak.
  if (viewer.seesCost) {
    for (const d of w.costDrifts || []) {
      if (d.driftPercent <= 4) continue
      add({ key: `cost:${keyOf(d.name)}`, kind: "price_to_review", tone: d.driftPercent > 10 ? "danger" : "warn", risk: -5, href: "price-list", facts: { item: d.name, drift: d.driftPercent, standard: d.standard, actual: d.actual } })
    }
  }

  return out.sort((a, b) => a.risk - b.risk)
}

/** Actual unit cost from closed work orders against the price list's standard
 * cost — what feeds "review the price" (PRC-03). */
export function costDriftsOf(
  priceItems: Array<{ name: string; cost?: number | null }>,
  workOrders: Array<{ productName?: string | null; quantity?: number | null; frozenCost?: { cost?: number | null } | null }>
): CostDrift[] {
  const actual = new Map<string, { cost: number; qty: number }>()
  for (const w of workOrders) {
    // Frozen at production close — the workshop's actual, not an estimate.
    const total = Number(w.frozenCost?.cost)
    const qty = Number(w.quantity)
    if (!w.productName || !(total > 0) || !(qty > 0)) continue
    const k = keyOf(w.productName)
    const row = actual.get(k) || { cost: 0, qty: 0 }
    actual.set(k, { cost: row.cost + total, qty: row.qty + qty })
  }
  const out: CostDrift[] = []
  for (const p of priceItems) {
    const a = actual.get(keyOf(p.name))
    const standard = Number(p.cost)
    if (!a || !(standard > 0)) continue
    const unit = round2(a.cost / a.qty)
    out.push({ name: p.name, standard, actual: unit, driftPercent: round2(((unit - standard) / standard) * 100) })
  }
  return out.sort((x, y) => y.driftPercent - x.driftPercent)
}

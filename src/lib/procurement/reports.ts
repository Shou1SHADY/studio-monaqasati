// Procurement reports (PRD 3.0 §9) — seven questions over the same world the
// Today screen reads: where spend goes and who asked for it, who carries it,
// who delivers on time, which way prices move, how long a cycle takes and what
// the competition saved, what left the usual path, and what Finance will be
// asked for soon. Every report is a pure function returning rows and totals;
// the screen formats, exports and prints. No Firestore, no React, no sentences.
//
// Values are commitments EXCLUDING VAT, not costs: the actual cost of an item
// is read from Finance's ledger after the invoice. A lump-sum order's part is
// never invented — where a proportional figure would be a guess the row says
// "unknown" and the total leaves it out.
//
// A few facts the Today world does not carry — an RFQ closed early, an offer
// keyed in by our staff, an offer's credit days and advance, the payment terms
// on OUR supplier record — ride on `ReportWorld`, built by `reportWorld()`
// from the raw documents. Absent, every report still runs: the extra
// exception kinds are simply not found and the terms fall back to none.
//
// Payment timing (report 7): due = the supplier's date (or the last receipt,
// for what already arrived) + the payment terms. Terms are read from our
// supplier record first, then the offer's credit days, then a "30 days"
// written on the order. The advance is the order's own (carried from the
// offer at award, else the offer's): due now while nothing has arrived, until
// Finance records it paid on the order (`financePayments`, R-24); a paid
// advance comes off what is still to be delivered, and what Finance paid
// against invoices comes off what is still owed for received goods.

import { acceptedValue, addDays, dayOf, daysBetween, daysFromNow, daysLate, isShortCompetition, lowestOffer, offerPrice, poFacts, poLive, poOpenValue, poStatus, poValue, receiptDay, round2, supplierKey, supplierScore, todayOf } from "./po"
import { advanceState, asX, paidTotal } from "./po-extras"
import { materialKey } from "./prices"
import type { OfferFact, ProcWorld, RfqFact } from "./today"
import type { PurchaseOrder, ReceiptFact } from "./types"

export interface RfqEarlyCloseFact {
  at?: string | null
  byName?: string | null
  reason?: string | null
}

export interface ReportRfqFact extends RfqFact {
  closedEarly?: RfqEarlyCloseFact | null
  /** ISO — when the earliest need behind the RFQ reached Procurement (the needs desk's `at`). */
  needArrivedAt?: string | null
}

/** A quoted rate: the offer's unit price for one of the RFQ's products. */
export interface OfferRateFact {
  rfqProductIndex: number
  unitPrice: number
}

export interface ReportOfferFact extends OfferFact {
  supplierName?: string | null
  isManualOffer?: boolean | null
  recordedByName?: string | null
  createdAt?: string | null
  creditDays?: number | null
  advancePercent?: number | null
  lines?: OfferRateFact[] | null
}

export interface ReportWorld extends ProcWorld {
  rfqs: ReportRfqFact[]
  offers: ReportOfferFact[]
  /** Our supplier record's payment terms, by supplier org id. */
  supplierTermsDays?: Record<string, number>
}

export interface RawReportRfq {
  id: string
  closedEarly?: RfqEarlyCloseFact | null
}

export interface RawReportOffer {
  id: string
  supplierName?: string | null
  companyName?: string | null
  isManualOffer?: boolean | null
  recordedByName?: string | null
  createdAt?: unknown
  creditDays?: unknown
  advancePercent?: unknown
  lines?: Array<{ rfqProductIndex?: unknown; unitPrice?: unknown }> | null
}

export interface RawSupplierTerms {
  supplierOrgId: string
  paymentTermsDays?: number | null
}

const numberOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s%]/g, ""))
  return Number.isFinite(n) && n >= 0 ? n : null
}

const isoOrNull = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : null
}

const quotedRates = (lines: RawReportOffer["lines"]): OfferRateFact[] =>
  (lines || [])
    .map((l) => ({ rfqProductIndex: Number(l.rfqProductIndex), unitPrice: numberOrNull(l.unitPrice) ?? 0 }))
    .filter((l) => Number.isInteger(l.rfqProductIndex) && l.rfqProductIndex >= 0 && l.unitPrice > 0)

export function reportWorld(
  base: ProcWorld,
  raw: { rfqs?: RawReportRfq[] | null; offers?: RawReportOffer[] | null; supplierRecords?: RawSupplierTerms[] | null; needArrivals?: Record<string, string> | null }
): ReportWorld {
  const rfqById = new Map((raw.rfqs || []).map((r) => [r.id, r]))
  const arrivals = raw.needArrivals || {}
  const offerById = new Map((raw.offers || []).map((o) => [o.id, o]))
  const supplierTermsDays: Record<string, number> = {}
  for (const rec of raw.supplierRecords || []) {
    const d = numberOrNull(rec.paymentTermsDays)
    if (rec.supplierOrgId && d != null) supplierTermsDays[rec.supplierOrgId] = Math.round(d)
  }
  return {
    ...base,
    rfqs: base.rfqs.map((r) => {
      const x = rfqById.get(r.id)
      const out: ReportRfqFact = x?.closedEarly ? { ...r, closedEarly: x.closedEarly } : r
      return arrivals[r.id] ? { ...out, needArrivedAt: arrivals[r.id] } : out
    }),
    offers: base.offers.map((o) => {
      const x = offerById.get(o.id)
      if (!x) return o
      const advance = numberOrNull(x.advancePercent)
      return {
        ...o,
        supplierName: x.supplierName || x.companyName || null,
        isManualOffer: x.isManualOffer === true,
        recordedByName: x.recordedByName || null,
        createdAt: isoOrNull(x.createdAt),
        creditDays: numberOrNull(x.creditDays),
        advancePercent: advance == null ? null : Math.min(100, advance),
        lines: quotedRates(x.lines),
      }
    }),
    supplierTermsDays,
  }
}

/** `YYYY-MM-DD` bounds on the document's creation day, both inclusive. */
export interface Period {
  from?: string | null
  to?: string | null
}

export const inPeriod = (day: string, p: Period | null | undefined): boolean => Boolean(day) && (!p?.from || day >= p.from) && (!p?.to || day <= p.to)

/** The period segment: the last 30 / 90 days, this year, «منذ البداية», or chosen days. */
export const REPORT_PERIOD_PRESETS = ["30", "90", "year", "all", "custom"] as const
export type ReportPeriodPreset = (typeof REPORT_PERIOD_PRESETS)[number]

export function presetPeriod(preset: ReportPeriodPreset, now: Date, custom?: Period | null): Period {
  if (preset === "30") return lastDays(30, now)
  if (preset === "90") return lastDays(90, now)
  // «سنة» is the last 365 days, as the prototype reads it — not the calendar year to date.
  if (preset === "year") return lastDays(365, now)
  if (preset === "all") return { from: null, to: null }
  return { from: custom?.from || null, to: custom?.to || null }
}

/** Orders that became commitments: not still awaiting approval, not cancelled. */
export function committedOrders(w: ProcWorld, period?: Period | null): PurchaseOrder[] {
  return w.orders.filter((po) => po.status !== "awaiting_approval" && po.status !== "cancelled" && inPeriod(dayOf(po.createdAt), period))
}

// The same folded key the price history uses: lower-casing and trimming alone
// split one material in two the first time somebody typed "حديد ١٢مم" where the
// last order said "حديد 12مم", and the drift against the last price vanished.
const nameKey = (name: string, unit: string) => materialKey(name, unit)

// ---------------------------------------------------------------------------
// 1 · Spend by project and requester — a project's need under its project;
// a need with no project under the party that raised it (the workshop's
// shortfall, Inventory's stock gap), and what a buyer added himself apart.
// ---------------------------------------------------------------------------

export type RequesterKind = "project" | "workshop" | "inventory" | "buyers"
export const REQUESTER_KINDS: readonly RequesterKind[] = ["project", "workshop", "inventory", "buyers"]

export function requesterOf(po: Pick<PurchaseOrder, "projectId" | "purchaseSource">): { key: string; kind: RequesterKind; projectId: string | null } {
  const projectId = po.projectId || po.purchaseSource?.projectId || null
  if (projectId) return { key: `project:${projectId}`, kind: "project", projectId }
  const src = po.purchaseSource
  if (src?.kind === "mfg_purchase" || src?.workOrderId) return { key: "workshop", kind: "workshop", projectId: null }
  if (src?.kind === "stock_gap") return { key: "inventory", kind: "inventory", projectId: null }
  return { key: "buyers", kind: "buyers", projectId: null }
}

export interface ProjectSpendRow {
  key: string
  kind: RequesterKind
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
    const who = requesterOf(po)
    const key = who.key
    const row = by.get(key) || { key, kind: who.kind, projectId: who.projectId, projectName: who.kind === "project" ? po.projectName || "" : "", orders: 0, lines: 0, ordered: 0, received: 0, receivedUnknown: false, open: 0 }
    const accepted = acceptedValue(po)
    row.orders++
    row.lines += po.lines.length
    row.ordered = round2(row.ordered + poValue(po))
    row.received = round2(row.received + (accepted ?? 0))
    if (accepted == null) row.receivedUnknown = true
    row.open = round2(row.open + poOpenValue(po))
    if (who.kind === "project" && !row.projectName && po.projectName) row.projectName = po.projectName
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
// 2 · Spend by supplier — one supplier above 35 % is worth a ready alternative
// ---------------------------------------------------------------------------

export const CONCENTRATION_PERCENT = 35

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
// 5 · Cycle time & competition — and what the competition saved: the average
// of the offers in the running less what we awarded. Two offers or fewer above
// the threshold is short competition, shown to the approver.
// ---------------------------------------------------------------------------

export interface CycleRow {
  rfqId: string
  title: string
  offersCount: number
  invitedCount: number | null
  awarded: boolean
  /** Publish → award, in days, when both dates exist. */
  publishToAwardDays: number | null
  /** The need's arrival at Procurement → award; the RFQ's publication stands in
   * for an RFQ no need raised (a buyer's own). */
  daysToAward: number | null
  /** `daysToAward` is counted from the need's arrival, not from publication. */
  fromNeed: boolean
  /** The saving was priced line by line from the quoted rates. */
  savingByLine: boolean
  lowestTotal: number | null
  /** Every order laid over the RFQ (a split award has one per supplier). */
  awardedTotal: number | null
  /** Mean of the priced offers still in the running. */
  averageOffer: number | null
  /** Per awarded line: (the mean of the rates quoted for it − the rate awarded)
   * × its quantity, summed; the totals (averageOffer − awardedTotal) only when
   * no offer quoted rates. Positive = saved. Null until awarded. */
  saving: number | null
  shortCompetition: boolean
}

export interface CycleReport {
  rows: CycleRow[]
  totals: { rfqs: number; awarded: number; avgDays: number | null; avgOffers: number | null; shortCompetition: number; saving: number }
}

const OFFER_REJECTED = "مرفوض"

/** The line-by-line saving over the awarded orders, or null when no awarded line has a quoted rate to compare. */
export function lineSaving(orders: PurchaseOrder[], offers: ReportOfferFact[]): number | null {
  const competing = offers.filter((o) => o.status !== OFFER_REJECTED)
  let saving = 0
  let priced = false
  for (const po of orders) {
    for (const l of po.lines) {
      if (l.unitPrice == null || l.rfqProductIndex == null) continue
      const rates = competing.map((o) => (o.lines || []).find((r) => r.rfqProductIndex === l.rfqProductIndex)?.unitPrice).filter((r): r is number => r != null && r > 0)
      if (!rates.length) continue
      const mean = rates.reduce((s, r) => s + r, 0) / rates.length
      saving += (mean - l.unitPrice) * (Number(l.quantity) || 0)
      priced = true
    }
  }
  return priced ? round2(saving) : null
}

export function cycleAndCompetition(w: ProcWorld | ReportWorld, period?: Period | null): CycleReport {
  const offersByRfq = new Map<string, ReportOfferFact[]>()
  for (const o of w.offers as ReportOfferFact[]) offersByRfq.set(o.rfqId, [...(offersByRfq.get(o.rfqId) || []), o])
  const ordersByRfq = new Map<string, PurchaseOrder[]>()
  for (const po of w.orders) if (po.rfqId && po.status !== "cancelled") ordersByRfq.set(po.rfqId, [...(ordersByRfq.get(po.rfqId) || []), po])

  const rows: CycleRow[] = (w.rfqs as ReportRfqFact[])
    .filter((r) => r.status !== "Draft" && (!r.createdAt || inPeriod(dayOf(r.createdAt), period)))
    .map((r) => {
      const offers = offersByRfq.get(r.id) || []
      const count = offers.length || Number(r.offersCount) || 0
      const pos = (ordersByRfq.get(r.id) || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const po = pos[0]
      const awarded = r.status === "Awarded" || pos.length > 0
      const awardDay = dayOf(r.awardedAt) || (po ? dayOf(po.createdAt) : "")
      const publish = dayOf(r.createdAt)
      const best = lowestOffer(offers)
      const lowestTotal = best ? offerPrice(best) : po?.lowestOfferTotal ?? null
      const awardedTotal = pos.length ? round2(pos.reduce((s, x) => s + poValue(x), 0)) : offers.filter((o) => o.status === "مقبول").map(offerPrice).find((p) => p != null) ?? null
      const prices = offers.filter((o) => o.status !== OFFER_REJECTED).map(offerPrice).filter((p): p is number => p != null)
      const averageOffer = prices.length ? round2(prices.reduce((s, p) => s + p, 0) / prices.length) : null
      const byLine = awarded ? lineSaving(pos, offers) : null
      const saving = byLine != null ? byLine : awarded && awardedTotal != null && averageOffer != null ? round2(averageOffer - awardedTotal) : null
      const short = po ? po.shortCompetition : isShortCompetition(awardedTotal ?? lowestTotal, count, w.policies)
      const arrived = dayOf(r.needArrivedAt)
      const start = arrived && (!publish || arrived <= publish) ? arrived : publish
      const publishToAwardDays = awarded && publish && awardDay ? daysBetween(publish, awardDay) : null
      const daysToAward = awarded && start && awardDay ? daysBetween(start, awardDay) : null
      return {
        rfqId: r.id,
        title: r.title || "",
        offersCount: count,
        invitedCount: r.invitedCount ?? null,
        awarded,
        publishToAwardDays,
        daysToAward,
        fromNeed: Boolean(arrived && start === arrived && start !== publish),
        lowestTotal,
        awardedTotal,
        averageOffer,
        saving,
        savingByLine: byLine != null,
        shortCompetition: short,
      }
    })
  const days = rows.map((r) => r.daysToAward).filter((d): d is number => d != null)
  return {
    rows,
    totals: {
      rfqs: rows.length,
      awarded: rows.filter((r) => r.awarded).length,
      avgDays: days.length ? round2(days.reduce((s, d) => s + d, 0) / days.length) : null,
      avgOffers: rows.length ? round2(rows.reduce((s, r) => s + r.offersCount, 0) / rows.length) : null,
      shortCompetition: rows.filter((r) => r.shortCompetition).length,
      saving: round2(rows.reduce((s, r) => s + (r.saving ?? 0), 0)),
    },
  }
}

// ---------------------------------------------------------------------------
// 6 · Exceptions — permitted actions off the usual path, by name. Not
// violations: what the owner should see monthly.
// ---------------------------------------------------------------------------

export const EXCEPTION_KINDS = [
  "retroactive",
  "direct",
  "non_lowest",
  "short_competition",
  "self_approval",
  "no_official_quote",
  "awarded_manual_offer",
  "closed_short",
  "manual_receipt",
  "no_po",
  "self_received",
  "no_notice",
  "auto_forwarded",
  "cash_expense",
  "manual_offer",
  "early_close",
  "self_issued",
  "variance_accepted",
] as const
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]

export interface ExceptionRow {
  kind: ExceptionKind
  docNumber: string
  orderId: string | null
  receiptId: string | null
  rfqId: string | null
  supplierName: string
  byName: string
  approvedByName: string
  day: string
  params: Record<string, string | number>
  href: string
}

export function exceptions(w: ReportWorld | ProcWorld, period?: Period | null): ExceptionRow[] {
  const out: ExceptionRow[] = []
  const orderById = new Map(w.orders.map((o) => [o.id, o]))
  const offers = w.offers as ReportOfferFact[]
  const offerById = new Map(offers.map((o) => [o.id, o]))
  const orderHref = (id: string) => `/contractor/rfqs/orders?po=${id}`
  const receiptHref = (id: string) => `/contractor/goods-received?tab=incoming&delivery=${id}`
  const rfqHref = (id: string) => `/contractor/rfqs/${id}/offers`

  for (const po of committedOrders(w, period)) {
    const base = { docNumber: po.docNumber, orderId: po.id, receiptId: null, rfqId: po.rfqId, supplierName: po.supplierName, byName: po.preparedByName, approvedByName: po.approvedByName || "", day: dayOf(po.createdAt), href: orderHref(po.id) }
    if (po.basis === "retroactive") out.push({ ...base, kind: "retroactive", params: {} })
    else if (po.basis === "direct" && !po.agreementId) out.push({ ...base, kind: "direct", params: { reason: po.awardReasonText || po.awardReasonCode || "" } })
    if (po.basis !== "direct" && po.basis !== "retroactive" && (po.awardReasonCode || po.awardReasonText)) out.push({ ...base, kind: "non_lowest", params: { reasonCode: po.awardReasonCode || "other", reason: po.awardReasonText || "" } })
    if (po.shortCompetition && po.basis === "rfq") out.push({ ...base, kind: "short_competition", params: { count: po.offersCount } })
    const px = asX(po)
    // A buyer's own order under his limit is listed as that, not as a self-approval.
    if (px.selfIssued) out.push({ ...base, kind: "self_issued", params: {}, day: dayOf(po.approvedAt) || base.day })
    else if (po.approvedById && po.approvedById === po.preparedById) out.push({ ...base, kind: "self_approval", params: {}, day: dayOf(po.approvedAt) || base.day })
    // Procurement accepted an invoice's new price on a price hold (prototype `varAcc`).
    for (const h of px.financeHolds || []) {
      if (h.reason === "price" && (h.decision === "new_price" || h.decision === "inv_price")) out.push({ ...base, kind: "variance_accepted", params: { invoice: h.invoiceNo }, byName: h.decidedByName || base.byName, day: dayOf(h.decidedAt) || base.day })
    }
    if (po.noOfficialQuote && !po.agreementId) out.push({ ...base, kind: "no_official_quote", params: {} })
    if (po.offerId && offerById.get(po.offerId)?.isManualOffer) out.push({ ...base, kind: "awarded_manual_offer", params: {} })
    if (po.status === "closed" && po.closedShort) out.push({ ...base, kind: "closed_short", params: { reason: po.closeReason || "" }, day: dayOf(po.closedAt) || base.day })
  }

  // A notice the scheduled job forwarded because Procurement did not, listed on
  // the day it was forwarded — whether or not the goods have been received since.
  for (const r of w.receipts) {
    const fw = (r as ReceiptFact & { forwardedTo?: { auto?: boolean; at?: string | null; name?: string | null; byName?: string | null } | null }).forwardedTo
    if (!fw?.auto) continue
    const day = dayOf(fw.at)
    if (!day || !inPeriod(day, period)) continue
    const po = r.poId ? orderById.get(r.poId) : undefined
    out.push({ kind: "auto_forwarded", docNumber: r.docNumber || r.poNumber || po?.docNumber || "", orderId: r.poId || null, receiptId: r.id, rfqId: null, supplierName: r.supplierName || po?.supplierName || "", byName: fw.byName || "", approvedByName: po?.approvedByName || "", day, params: { name: fw.name || "" }, href: receiptHref(r.id) })
  }

  for (const r of w.receipts) {
    if (r.status !== "confirmed") continue
    const day = receiptDay(r)
    if (!inPeriod(day, period)) continue
    const po = r.poId ? orderById.get(r.poId) : undefined
    const base = { docNumber: r.docNumber || r.poNumber || "", orderId: r.poId || null, receiptId: r.id, rfqId: null, supplierName: r.supplierName || po?.supplierName || "", byName: r.confirmedByName || "", approvedByName: po?.approvedByName || "", day, href: receiptHref(r.id) }
    // A no-order receipt later sent to Finance as an expense is listed once, as
    // the expense, by whoever sent it: open and expensed are two states of the
    // same queue, not two exceptions.
    if (r.regularisation === "expense") out.push({ ...base, kind: "cash_expense", params: {}, byName: r.regularisedByName || r.confirmedByName || "" })
    else if (r.source === "manual" && !r.poId && !r.offerId) out.push({ ...base, kind: "no_po", params: {} })
    else if (r.source === "manual" && r.poId) out.push({ ...base, kind: "manual_receipt", params: {} })
    if (r.selfReceived) out.push({ ...base, kind: "self_received", params: {}, byName: po?.preparedByName || "" })
    if (r.noNotice) out.push({ ...base, kind: "no_notice", params: {} })
  }

  const rfqs = w.rfqs as ReportRfqFact[]
  const rfqById = new Map(rfqs.map((r) => [r.id, r]))
  for (const o of offers) {
    if (!o.isManualOffer) continue
    const rfq = rfqById.get(o.rfqId)
    const day = dayOf(o.createdAt) || dayOf(rfq?.createdAt)
    if (!inPeriod(day, period)) continue
    out.push({ kind: "manual_offer", docNumber: rfq?.title || "", orderId: null, receiptId: null, rfqId: o.rfqId, supplierName: o.supplierName || "", byName: o.recordedByName || "", approvedByName: "", day, params: {}, href: rfqHref(o.rfqId) })
  }
  for (const r of rfqs) {
    if (!r.closedEarly) continue
    const day = dayOf(r.closedEarly.at)
    if (!inPeriod(day, period)) continue
    out.push({ kind: "early_close", docNumber: r.title || "", orderId: null, receiptId: null, rfqId: r.id, supplierName: "", byName: r.closedEarly.byName || "", approvedByName: "", day, params: { reason: r.closedEarly.reason || "" }, href: rfqHref(r.id) })
  }

  return out.sort((a, b) => b.day.localeCompare(a.day) || a.docNumber.localeCompare(b.docNumber))
}

// ---------------------------------------------------------------------------
// 7 · Open commitments by payment due — what Finance will be asked for, and
// when. Finance's cash forecast only sees an order once it is invoiced; this
// fills the gap. Three columns per bucket: advances due, received but unpaid
// (accepted only — never what was counted or held), committed not delivered.
// ---------------------------------------------------------------------------

export const COMMITMENT_BUCKETS = ["within7", "within30", "within60", "later", "noDate"] as const
export type CommitmentBucket = (typeof COMMITMENT_BUCKETS)[number]

export const COMMITMENT_PARTS = ["advance", "received", "undelivered"] as const
export type CommitmentPart = (typeof COMMITMENT_PARTS)[number]

export type TermsSource = "supplier" | "offer" | "order" | "none"

export interface OrderTerms {
  days: number
  advancePercent: number
  source: TermsSource
}

// "30 يوماً", "آجل 60 يوم", "net 45 days" — a number of days written on the order.
const TERMS_DAYS = /(\d{1,3})\s*(?:يوم|أيام|days?\b)/i

/** Our supplier record first, then the offer's credit days, then days written on the order. */
export function orderTerms(po: PurchaseOrder, w: ReportWorld | ProcWorld): OrderTerms {
  const offer = po.offerId ? (w.offers as ReportOfferFact[]).find((o) => o.id === po.offerId) : undefined
  const own = asX(po).advancePercent
  const advancePercent = Math.min(100, Math.max(0, Number(own != null ? own : offer?.advancePercent) || 0))
  const recorded = (w as ReportWorld).supplierTermsDays?.[po.supplierOrgId]
  if (recorded != null && Number.isFinite(recorded)) return { days: Math.max(0, recorded), advancePercent, source: "supplier" }
  if (offer?.creditDays != null && Number.isFinite(offer.creditDays)) return { days: Math.max(0, Math.round(offer.creditDays)), advancePercent, source: "offer" }
  const m = TERMS_DAYS.exec(po.paymentTerms || "")
  if (m) return { days: Number(m[1]), advancePercent, source: "order" }
  return { days: 0, advancePercent, source: "none" }
}

export interface CommitmentRow {
  orderId: string
  docNumber: string
  supplierName: string
  part: CommitmentPart
  termsDays: number
  termsSource: TermsSource
  /** `YYYY-MM-DD` — null when the supplier gave no date yet. */
  dueDate: string | null
  /** Days to the due date (negative = overdue); null without a date. */
  daysToDue: number | null
  value: number
  bucket: CommitmentBucket
}

export type CommitmentBucketTotals = Record<CommitmentPart, number> & { total: number }

export interface CommitmentReport {
  rows: CommitmentRow[]
  buckets: Record<CommitmentBucket, CommitmentBucketTotals>
  totals: CommitmentBucketTotals
  /** Lump-sum orders with goods accepted but no breakdown: left out of "received". */
  receivedUnknown: number
}

const bucketOf = (d: number | null): CommitmentBucket => (d == null ? "noDate" : d <= 7 ? "within7" : d <= 30 ? "within30" : d <= 60 ? "within60" : "later")

const emptyTotals = (): CommitmentBucketTotals => ({ advance: 0, received: 0, undelivered: 0, total: 0 })

/** Not period-filtered: what is owed from today on. The overdue sit in the
 * first week's bucket — Finance will be asked for them first, not never. */
export function openCommitments(w: ReportWorld | ProcWorld, now: Date): CommitmentReport {
  const today = todayOf(now)
  const rows: CommitmentRow[] = []
  let receivedUnknown = 0
  for (const po of w.orders) {
    if (po.status === "awaiting_approval" || po.status === "cancelled" || po.status === "closed") continue
    const terms = orderTerms(po, w)
    const base = { orderId: po.id, docNumber: po.docNumber, supplierName: po.supplierName, termsDays: terms.days, termsSource: terms.source }
    const push = (part: CommitmentPart, value: number, dueDate: string | null) => {
      if (!(value > 0)) return
      const daysToDue = dueDate ? daysFromNow(dueDate, now) : null
      rows.push({ ...base, part, dueDate, daysToDue, value: round2(value), bucket: bucketOf(daysToDue) })
    }
    const st = poStatus(po)
    const px = asX(po)
    const advState = advanceState({ ...px, advancePercent: terms.advancePercent })
    const advanceValue = terms.advancePercent > 0 ? round2((poValue(po) * terms.advancePercent) / 100) : 0
    const advancePaid = advState === "paid" ? round2((px.financePayments || []).filter((p) => p.kind === "adv").reduce((a, p) => a + (Number(p.amount) || 0), 0)) : 0
    const invoicePaid = round2(paidTotal(px) - advancePaid)
    if (poLive(po)) {
      // Not paid yet: due now — unless goods already came (the supplier shipped, whatever he was paid up front).
      const nothingArrived = !po.lines.some((l) => Number(l.accepted) > 0)
      const advanceDue = (advState === "requested" || advState === "pending") && nothingArrived ? advanceValue : 0
      push("advance", advanceDue, today)
      push("undelivered", Math.max(0, poOpenValue(po) - advanceDue - advancePaid), po.promisedDate ? addDays(po.promisedDate, terms.days) : null)
    }
    if (st === "part_received" || st === "received") {
      const accepted = acceptedValue(po)
      if (accepted == null) receivedUnknown++
      else {
        const last = poFacts(po, w.receipts).lastReceiptDay
        push("received", Math.max(0, accepted - invoicePaid), last ? addDays(last, terms.days) : null)
      }
    }
  }
  rows.sort((a, b) => (a.daysToDue ?? 99999) - (b.daysToDue ?? 99999) || a.docNumber.localeCompare(b.docNumber) || COMMITMENT_PARTS.indexOf(a.part) - COMMITMENT_PARTS.indexOf(b.part))
  const buckets = Object.fromEntries(COMMITMENT_BUCKETS.map((b) => [b, emptyTotals()])) as Record<CommitmentBucket, CommitmentBucketTotals>
  const totals = emptyTotals()
  for (const r of rows) {
    const b = buckets[r.bucket]
    b[r.part] = round2(b[r.part] + r.value)
    b.total = round2(b.total + r.value)
    totals[r.part] = round2(totals[r.part] + r.value)
    totals.total = round2(totals.total + r.value)
  }
  return { rows, buckets, totals, receivedUnknown }
}

/** The period the screen's "last N days" segment means, ending today. */
export function lastDays(days: number, now: Date): Period {
  const to = todayOf(now)
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10)
  return { from, to }
}

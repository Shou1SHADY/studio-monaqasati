// Requests & cost statements — the pure half of the Requests screen (PRD 1.2,
// REQ-01…REQ-09).
//
// Two doors only: Sales (a manufacturing request for a sales order, or a
// costing request for a non-standard line) and Procurement (a project need it
// decided to make). Nothing is requested from inside Manufacturing. A request
// is read before it is answered: every line is screened (make, partial or buy,
// with its reason), it ages against the answer window, and the answer returns
// to its owner. A cost statement carries cost, lead time and validity only —
// the price, the quote and the client's decision are Sales' (D10).
//
// No Firestore, no React, no strings: the screens format.

import type { ManufacturingRequest, MfgRequestLine, SalesOrder } from "./sales-orders"
import {
  daysFrom,
  estimateExpired,
  itemKey,
  mainMaterial,
  possibleForDays,
  round2,
  roundNeed,
  standardCost,
  verdict,
  wasteFactor,
  type DeptCapacityFields,
  type LostHours,
  type MfgCostEstimate,
  type MfgProduct,
  type MfgSettings,
  type OrderCalc,
  type StdCost,
  type Verdict,
} from "./manufacturing-engine"

/** A request that names no date is screened against two weeks. */
export const DEFAULT_NEED_DAYS = 14

// ---------------------------------------------------------------------------
// Segments — awaiting answer · cost statements · answered · all
// ---------------------------------------------------------------------------

export type RequestSegment = "new" | "estimates" | "answered" | "all"
export const REQUEST_SEGMENTS: RequestSegment[] = ["new", "estimates", "answered", "all"]

export function parseRequestSegment(raw: string | null | undefined): RequestSegment | null {
  return REQUEST_SEGMENTS.includes(raw as RequestSegment) ? (raw as RequestSegment) : null
}

/** The cost-statements segment exists only while cost estimating is switched on. */
export function effectiveSegment(segment: RequestSegment, estimatesOn: boolean): RequestSegment {
  return segment === "estimates" && !estimatesOn ? "new" : segment
}

export function inRequestSegment(r: Pick<ManufacturingRequest, "status">, segment: RequestSegment): boolean {
  if (segment === "new") return r.status === "new"
  if (segment === "answered") return r.status !== "new"
  return segment === "all"
}

/** A statement waiting on the cost controller: a draft, or one past its validity. */
export function estimateNeedsWork(e: Pick<MfgCostEstimate, "state" | "sentAt" | "validityDays">, today: string, settings: MfgSettings): boolean {
  return e.state === "draft" || estimateExpired(e, today, settings)
}

export function requestSegmentCounts(
  requests: Array<Pick<ManufacturingRequest, "status">>,
  estimates: Array<Pick<MfgCostEstimate, "state" | "sentAt" | "validityDays">>,
  estimatesOn: boolean,
  today: string,
  settings: MfgSettings
): Record<RequestSegment, number> {
  const open = requests.filter((r) => r.status === "new").length
  return {
    new: open,
    estimates: estimatesOn ? estimates.filter((e) => estimateNeedsWork(e, today, settings)).length : 0,
    answered: requests.length - open,
    // "All" shows the statements too, so it counts them.
    all: requests.length + (estimatesOn ? estimates.length : 0),
  }
}

// ---------------------------------------------------------------------------
// The request — where it came from
// ---------------------------------------------------------------------------

export type RequestSource = "sales" | "procurement"
export type RequestKind = "make" | "cost"

/** Two doors. Older project-born requests reached us through Procurement's door. */
export function requestSource(r: Pick<ManufacturingRequest, "sourceKind" | "orderId">): RequestSource {
  if (r.sourceKind === "sales") return "sales"
  if (!r.sourceKind && r.orderId) return "sales"
  return "procurement"
}

export function requestKind(r: Pick<ManufacturingRequest, "kind">): RequestKind {
  return r.kind === "cost" ? "cost" : "make"
}

/** Multi-line requests carry `lines`; older single-item ones one item. */
export function requestLines(r: Pick<ManufacturingRequest, "lines" | "itemName" | "unit" | "quantity">): MfgRequestLine[] {
  if (r.lines?.length) return r.lines
  return [{ productId: null, itemName: r.itemName, unit: r.unit, quantity: r.quantity }]
}

/** The sales order's down payment as the request reads it: confirmed by
 * Finance, reported and pending, or no down-payment terms at all. `null` when
 * it does not apply (Procurement, costing) or the sales order is not readable. */
export type DownPaymentView = "confirmed" | "pending" | "none"

export function requestDownPayment(
  r: Pick<ManufacturingRequest, "sourceKind" | "orderId" | "kind">,
  salesOrder: Pick<SalesOrder, "payment"> | null | undefined
): DownPaymentView | null {
  if (requestSource(r) !== "sales" || requestKind(r) === "cost" || !salesOrder) return null
  if (salesOrder.payment?.kind !== "deposit") return "none"
  return salesOrder.payment.depositPaid ? "confirmed" : "pending"
}

export type RequestRefKind = "sales_order" | "rfq" | "purchase_request" | "pm_request" | "cost_item"

export interface RequestRef {
  kind: RequestRefKind
  ref: string
}

export interface RequestSourceInfo {
  source: RequestSource
  kind: RequestKind
  /** The client (Sales) or the project (Procurement). */
  name: string
  refs: RequestRef[]
  downPayment: DownPaymentView | null
}

export function requestSourceInfo(
  r: Pick<ManufacturingRequest, "sourceKind" | "orderId" | "orderNumber" | "kind" | "contactName" | "projectName" | "rfqRef" | "purchaseRequestRef" | "pmRequestRef" | "costItemName">,
  salesOrder?: Pick<SalesOrder, "payment" | "contactName"> | null
): RequestSourceInfo {
  const source = requestSource(r)
  const kind = requestKind(r)
  const refs: RequestRef[] = []
  if (source === "sales") {
    if (r.orderNumber != null) refs.push({ kind: "sales_order", ref: `SO-${r.orderNumber}` })
    if (r.rfqRef) refs.push({ kind: "rfq", ref: r.rfqRef })
  } else {
    if (r.purchaseRequestRef) refs.push({ kind: "purchase_request", ref: r.purchaseRequestRef })
    if (r.pmRequestRef) refs.push({ kind: "pm_request", ref: r.pmRequestRef })
    if (r.costItemName) refs.push({ kind: "cost_item", ref: r.costItemName })
  }
  return {
    source,
    kind,
    name: source === "sales" ? r.contactName || salesOrder?.contactName || "" : r.projectName || "",
    refs,
    downPayment: requestDownPayment(r, salesOrder),
  }
}

// ---------------------------------------------------------------------------
// The answer window (REQ-07) and the state
// ---------------------------------------------------------------------------

export interface AnswerWindow {
  ageHours: number
  overdue: boolean
  /** Whole hours left in the window (0 once overdue). */
  leftHours: number
}

/** A request that reached us while Sales' order still waits for its down
 * payment is for PLANNING: Finance has not confirmed, nothing may be executed,
 * and the answer clock does not run — "no answer" is not counted before the
 * confirmation (Sales PRD PAY-07, D8). */
export function awaitsDownPayment(
  r: Pick<ManufacturingRequest, "sourceKind" | "orderId" | "kind">,
  salesOrder: Pick<SalesOrder, "payment"> | null | undefined
): boolean {
  return requestDownPayment(r, salesOrder) === "pending"
}

export function answerWindow(r: Pick<ManufacturingRequest, "requestedAt" | "status">, windowHours: number, nowMs: number, downPaymentPending = false): AnswerWindow {
  const at = r.requestedAt ? new Date(r.requestedAt).getTime() : NaN
  const ageHours = Number.isFinite(at) ? Math.max(0, (nowMs - at) / 3600000) : 0
  const overdue = r.status === "new" && !downPaymentPending && ageHours >= windowHours
  return { ageHours, overdue, leftHours: overdue ? 0 : Math.max(0, Math.ceil(windowHours - ageHours)) }
}

export type RequestState = "awaiting" | "overdue" | "accepted" | "partial" | "costed" | "declined" | "moved"

export function requestState(r: Pick<ManufacturingRequest, "requestedAt" | "status">, windowHours: number, nowMs: number, downPaymentPending = false): RequestState {
  switch (r.status) {
    case "new":
      return answerWindow(r, windowHours, nowMs, downPaymentPending).overdue ? "overdue" : "awaiting"
    case "accepted":
      return "accepted"
    case "partial":
      return "partial"
    case "estimated":
      return "costed"
    case "moved":
      return "moved"
    default:
      return "declined"
  }
}

/** Waiting requests first, the oldest leading (the overdue ones); answered ones newest first. */
export function sortRequests<T extends Pick<ManufacturingRequest, "status" | "requestedAt" | "decidedAt">>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const an = a.status === "new"
    const bn = b.status === "new"
    if (an !== bn) return an ? -1 : 1
    if (an) return (a.requestedAt || "").localeCompare(b.requestedAt || "")
    return (b.decidedAt || b.requestedAt || "").localeCompare(a.decidedAt || a.requestedAt || "")
  })
}

export function workOrderIdsOf(r: Pick<ManufacturingRequest, "workOrderIds" | "workOrderId">): string[] {
  if (r.workOrderIds?.length) return r.workOrderIds
  return r.workOrderId ? [r.workOrderId] : []
}

// ---------------------------------------------------------------------------
// Screening — every line, before answering (REQ-03)
// ---------------------------------------------------------------------------

/** A line's product card: by id, else by name (older requests carry only a name). */
export function matchProduct(
  line: Pick<MfgRequestLine, "productId" | "itemName">,
  products: MfgProduct[],
  productById: Map<string, MfgProduct>
): MfgProduct | null {
  if (line.productId) {
    const hit = productById.get(line.productId)
    if (hit) return hit
  }
  const key = itemKey(line.itemName || "")
  if (!key) return null
  const named = products.filter((p) => itemKey(p.name) === key)
  return named.find((p) => !p.archived) || null
}

export function neededInDays(r: Pick<ManufacturingRequest, "neededBy">, today: string): number {
  return r.neededBy ? Math.max(0, daysFrom(today, r.neededBy)) : DEFAULT_NEED_DAYS
}

export interface SlabNeed {
  itemName: string
  unit: string
  /** For the asked quantity, planned waste included. */
  need: number
  /** Free in stock after reservations; null when the stock is not readable. */
  available: number | null
}

/** The main slab a line needs (net + planned waste) against what is free. */
export function slabNeed(product: MfgProduct, quantity: number, free: Map<string, number> | null): SlabNeed | null {
  const m = mainMaterial(product)
  if (!m) return null
  return {
    itemName: m.itemName,
    unit: m.unit,
    need: roundNeed(m.unit, m.qtyPerUnit * quantity * wasteFactor(product)),
    available: free ? round2(Math.max(0, free.get(itemKey(m.itemName)) ?? 0)) : null,
  }
}

export interface ScreenContext {
  products: MfgProduct[]
  productById: Map<string, MfgProduct>
  calcs: OrderCalc[]
  departments: DeptCapacityFields[]
  settings: MfgSettings
  lost: LostHours
  /** Free stock by item key after every reservation — null when unknown. */
  free: Map<string, number> | null
  today: string
}

export interface ScreenedLine {
  index: number
  line: MfgRequestLine
  product: MfgProduct | null
  /** Standard cost of the asked quantity — null without a product card. */
  std: StdCost | null
  verdict: Verdict | null
  /** Working days until the asked quantity could be ready (time on). */
  possibleDays: number | null
  slab: SlabNeed | null
}

export function screenLine(line: MfgRequestLine, index: number, product: MfgProduct | null, needDays: number, ctx: ScreenContext): ScreenedLine {
  if (!product || !(line.quantity > 0)) return { index, line, product, std: null, verdict: null, possibleDays: null, slab: null }
  const v = verdict(product, line.quantity, needDays, ctx.calcs, ctx.departments, ctx.settings, ctx.lost)
  return {
    index,
    line,
    product,
    std: standardCost(product, ctx.departments, ctx.settings, line.quantity),
    verdict: v,
    possibleDays: v.possibleDays,
    slab: slabNeed(product, line.quantity, ctx.free),
  }
}

export function screenRequest(r: Pick<ManufacturingRequest, "lines" | "itemName" | "unit" | "quantity" | "neededBy">, ctx: ScreenContext): ScreenedLine[] {
  const needDays = neededInDays(r, ctx.today)
  return requestLines(r).map((line, index) => screenLine(line, index, matchProduct(line, ctx.products, ctx.productById), needDays, ctx))
}

export interface ScreenSummary {
  /** Standard cost of making every screened line in full. */
  fullCost: number
  /** False when a BOM line has no unit cost — the total understates. */
  allPriced: boolean
  /** When ALL of it could be ready (the slowest line), in working days. */
  earliestDays: number | null
  /** Lines with no product card. */
  unscreened: number
}

export function summarizeScreen(lines: ScreenedLine[]): ScreenSummary {
  const screened = lines.filter((l) => l.std)
  const days = screened.map((l) => l.possibleDays).filter((d): d is number => d != null)
  return {
    fullCost: round2(screened.reduce((a, l) => a + (l.std?.total || 0), 0)),
    allPriced: screened.every((l) => l.std?.allPriced !== false),
    earliestDays: days.length ? Math.max(...days) : null,
    unscreened: lines.length - screened.length,
  }
}

/** The verdict's reason in one line (a key and its figures). */
export type VerdictReason =
  | { key: "make_ready"; days: number; spareDays: number }
  | { key: "make_untimed" }
  | { key: "partial"; qty: number; needDays: number }
  | { key: "buy_labour_gap"; materialUnit: number }
  | { key: "buy_materials_dearer"; materialUnit: number }
  | { key: "buy_capacity"; possibleDays: number | null; needDays: number }

export function verdictReason(v: Verdict, needDays: number): VerdictReason {
  switch (v.kind) {
    case "make":
      return v.possibleDays == null ? { key: "make_untimed" } : { key: "make_ready", days: v.possibleDays, spareDays: Math.max(0, needDays - v.possibleDays) }
    case "partial":
      return { key: "partial", qty: v.makeQty, needDays }
    case "buy_price":
      return (v.buyPrice || 0) > v.unitMaterialCost ? { key: "buy_labour_gap", materialUnit: v.unitMaterialCost } : { key: "buy_materials_dearer", materialUnit: v.unitMaterialCost }
    case "buy_capacity":
      return { key: "buy_capacity", possibleDays: v.possibleDays, needDays }
  }
}

// ---------------------------------------------------------------------------
// The answer — make (full or partial), cost it, or decline with a reason
// ---------------------------------------------------------------------------

/** The screening's suggestion: make → all of it, partial → what capacity fits,
 * buy → none. A line with no product card starts at none. */
export function defaultMakeQty(l: Pick<ScreenedLine, "verdict" | "line">): number {
  if (!l.verdict) return 0
  if (l.verdict.kind === "make") return l.line.quantity
  if (l.verdict.kind === "partial") return Math.min(l.verdict.makeQty, l.line.quantity)
  return 0
}

export function parseQty(input: string): number {
  if (!input.trim()) return 0
  const n = Number(input)
  return Number.isFinite(n) ? n : NaN
}

export type MakeLineError = "invalid" | "over" | "no_product"

export interface MakeDraftLine {
  asked: number
  qty: number
  hasProduct: boolean
}

export function validateMakeLines(lines: MakeDraftLine[]): { lineErrors: Array<MakeLineError | null>; formError: "nothing" | "lines" | null } {
  const lineErrors = lines.map((l): MakeLineError | null => {
    if (Number.isNaN(l.qty) || l.qty < 0) return "invalid"
    if (l.qty > l.asked) return "over"
    if (l.qty > 0 && !l.hasProduct) return "no_product"
    return null
  })
  if (lineErrors.some(Boolean)) return { lineErrors, formError: "lines" }
  if (!lines.some((l) => l.qty > 0)) return { lineErrors, formError: "nothing" }
  return { lineErrors, formError: null }
}

/** What is not taken, per line — it returns to the owner to decide buying. */
export function makeRemainders(lines: Array<Pick<MakeDraftLine, "asked" | "qty">>): number[] {
  return lines.map((l) => round2(Math.max(0, l.asked - (Number.isFinite(l.qty) ? Math.min(Math.max(l.qty, 0), l.asked) : 0))))
}

// ---------------------------------------------------------------------------
// Cost statements — cost, lead time and validity; no price (REQ-02, REQ-06)
// ---------------------------------------------------------------------------

export type EstimateStatus = "draft" | "sent" | "expired"

export function estimateStatus(e: Pick<MfgCostEstimate, "state" | "sentAt" | "validityDays">, today: string, settings: MfgSettings): EstimateStatus {
  if (estimateExpired(e, today, settings)) return "expired"
  return e.state === "draft" ? "draft" : "sent"
}

/** What Sales did with it — read, never written here (REQ-08). */
export type SalesQuoteState = "none" | "no_quote" | "quoted" | "won" | "lost"

export function salesQuoteState(e: Pick<MfgCostEstimate, "state" | "quoteNumber">): SalesQuoteState {
  if (e.state === "quoted" || e.state === "won" || e.state === "lost") return e.state
  if (e.state === "sent") return e.quoteNumber ? "quoted" : "no_quote"
  return "none"
}

/** Days since it was sent; null for a draft. */
export function estimateSentDays(e: Pick<MfgCostEstimate, "sentAt">, today: string): number | null {
  return e.sentAt ? Math.max(0, daysFrom(e.sentAt, today)) : null
}

/** The earliest the whole statement could be ready: the slowest line joining
 * the back of every queue. Null when no line can be scheduled. */
export function earliestDaysFor(lines: Array<{ product: MfgProduct | null | undefined; quantity: number }>, calcs: OrderCalc[], departments: DeptCapacityFields[], lost: LostHours): number | null {
  let worst: number | null = null
  for (const l of lines) {
    if (!l.product || !(l.quantity > 0)) continue
    const d = possibleForDays(l.product, l.quantity, calcs, departments, lost)
    worst = worst == null ? d : Math.max(worst, d)
  }
  return worst
}

export function estimateEarliestDays(e: Pick<MfgCostEstimate, "lines">, productById: Map<string, MfgProduct>, calcs: OrderCalc[], departments: DeptCapacityFields[], lost: LostHours): number | null {
  return earliestDaysFor(
    e.lines.map((l) => ({ product: productById.get(l.productId), quantity: l.quantity })),
    calcs,
    departments,
    lost
  )
}

/** Live standard cost of a statement at today's product cards — what sending
 * or recalculating writes. Lines whose card is gone keep their stored cost. */
export function estimateCostToday(e: Pick<MfgCostEstimate, "lines">, productById: Map<string, MfgProduct>, departments: DeptCapacityFields[], settings: MfgSettings): { total: number; materials: number; missing: string[] } {
  let total = 0
  let materials = 0
  const missing: string[] = []
  for (const l of e.lines) {
    const p = productById.get(l.productId)
    if (!p) {
      missing.push(l.productName)
      total += l.totalCost
      materials += l.materialCost
      continue
    }
    const std = standardCost(p, departments, settings, l.quantity)
    total += std.total
    materials += std.materials
  }
  return { total: round2(total), materials: round2(materials), missing }
}

const STATUS_RANK: Record<EstimateStatus, number> = { draft: 0, expired: 0, sent: 1 }
const SALES_RANK: Record<SalesQuoteState, number> = { none: 0, no_quote: 0, quoted: 0, won: 1, lost: 1 }

/** Work first (drafts and expired), then those at Sales, then the closed record. */
export function sortEstimates<T extends Pick<MfgCostEstimate, "state" | "sentAt" | "validityDays" | "quoteNumber">>(list: T[], today: string, settings: MfgSettings): T[] {
  return [...list].sort(
    (a, b) =>
      STATUS_RANK[estimateStatus(a, today, settings)] - STATUS_RANK[estimateStatus(b, today, settings)] ||
      SALES_RANK[salesQuoteState(a)] - SALES_RANK[salesQuoteState(b)] ||
      (b.sentAt || "").localeCompare(a.sentAt || "")
  )
}

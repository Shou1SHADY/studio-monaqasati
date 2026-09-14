// Manufacturing requests & cost estimates — the pure half of the Requests
// screen. A request is screened the moment it arrives (make-or-buy per line,
// with a one-line reason), ages visibly against the answer window, and is
// answered by a route whose inputs are validated here so the form can only
// confirm what the writes will accept.

import type { ManufacturingRequest, MfgRequestLine, MfgRequestSourceKind } from "./sales-orders"
import {
  addDaysISO,
  daysFrom,
  marginPercent,
  minPriceFor,
  possibleForDays,
  round2,
  standardCost,
  verdict,
  wasteFactor,
  type DeptCapacityFields,
  type EstimateState,
  type MfgCostEstimate,
  type MfgProduct,
  type MfgSettings,
  type ScheduleInput,
  type StdCost,
  type Verdict,
} from "./manufacturing-engine"

/** When a request names no date, it is screened against two weeks. */
export const DEFAULT_NEED_DAYS = 14

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export type RequestSegment = "new" | "estimates" | "answered" | "all"

export function parseRequestSegment(raw: string | null | undefined): RequestSegment | null {
  if (raw === "new" || raw === "answered" || raw === "all" || raw === "estimates") return raw
  return null
}

/** The estimates segment exists only while the feature is on. */
export function effectiveSegment(segment: RequestSegment, estimatesOn: boolean): RequestSegment {
  return segment === "estimates" && !estimatesOn ? "new" : segment
}

export function inRequestSegment(r: Pick<ManufacturingRequest, "status">, segment: RequestSegment): boolean {
  if (segment === "new") return r.status === "new"
  if (segment === "answered") return r.status !== "new"
  return segment === "all"
}

export function requestSegmentCounts(
  requests: Array<Pick<ManufacturingRequest, "status">>,
  estimates: Array<Pick<MfgCostEstimate, "state">>,
  estimatesOn: boolean
): Record<RequestSegment, number> {
  const open = requests.filter((r) => r.status === "new").length
  return {
    new: open,
    estimates: estimatesOn ? estimates.filter((e) => e.state !== "lost").length : 0,
    answered: requests.length - open,
    all: requests.length + (estimatesOn ? estimates.length : 0),
  }
}

const ESTIMATE_ORDER: Record<EstimateState, number> = { draft: 0, sent: 1, quoted: 2, won: 3, lost: 4 }

/** Work first (draft → sent → quoted), the record last (won, lost). */
export function sortEstimates<T extends Pick<MfgCostEstimate, "state">>(list: T[]): T[] {
  return [...list].sort((a, b) => ESTIMATE_ORDER[a.state] - ESTIMATE_ORDER[b.state])
}

// ---------------------------------------------------------------------------
// The request itself
// ---------------------------------------------------------------------------

/** Multi-line v2 requests carry `lines`; older sales-born ones one item. */
export function requestLines(r: Pick<ManufacturingRequest, "lines" | "itemName" | "unit" | "quantity">): MfgRequestLine[] {
  if (r.lines?.length) return r.lines
  return [{ productId: null, itemName: r.itemName, unit: r.unit, quantity: r.quantity }]
}

/** A sales-born request with no product lines — answered by the legacy
 * accept (a stage-flow work order) or reject. */
export function isLegacyRequest(r: Pick<ManufacturingRequest, "lines">): boolean {
  return !r.lines?.length
}

export function productForLine(
  line: Pick<MfgRequestLine, "productId" | "itemName">,
  products: MfgProduct[],
  productById: Map<string, MfgProduct>
): MfgProduct | null {
  if (line.productId) return productById.get(line.productId) || null
  const name = (line.itemName || "").trim()
  return (name && products.find((p) => p.name.trim() === name)) || null
}

export function requestSourceKind(r: Pick<ManufacturingRequest, "sourceKind" | "orderId">): MfgRequestSourceKind {
  return r.sourceKind || (r.orderId ? "sales" : "project")
}

/** Project or client — whoever the work is for. */
export function requestSourceName(r: Pick<ManufacturingRequest, "projectName" | "contactName">): string {
  return r.projectName || r.contactName || ""
}

export interface AnswerWindow {
  ageHours: number
  overdue: boolean
  /** Whole hours left in the window (0 once overdue). */
  leftHours: number
  /** Whole hours past the window (0 while inside it). */
  overdueHours: number
}

export function answerWindow(r: Pick<ManufacturingRequest, "requestedAt" | "status">, windowHours: number, nowMs: number): AnswerWindow {
  const at = r.requestedAt ? new Date(r.requestedAt).getTime() : NaN
  const ageHours = Number.isFinite(at) ? Math.max(0, (nowMs - at) / 3600000) : 0
  const overdue = r.status === "new" && ageHours >= windowHours
  return {
    ageHours,
    overdue,
    leftHours: overdue ? 0 : Math.max(0, Math.ceil(windowHours - ageHours)),
    overdueHours: overdue ? Math.floor(ageHours - windowHours) : 0,
  }
}

export function neededInDays(r: Pick<ManufacturingRequest, "neededBy">, today: string): number {
  return r.neededBy ? Math.max(0, daysFrom(today, r.neededBy)) : DEFAULT_NEED_DAYS
}

export function needDateOf(r: Pick<ManufacturingRequest, "neededBy">, today: string): string {
  return r.neededBy ? r.neededBy.slice(0, 10) : addDaysISO(today, DEFAULT_NEED_DAYS)
}

// ---------------------------------------------------------------------------
// Screening — make or buy, line by line, with the reason in one line
// ---------------------------------------------------------------------------

export interface ScreenContext {
  products: MfgProduct[]
  productById: Map<string, MfgProduct>
  inputs: ScheduleInput[]
  departments: DeptCapacityFields[]
  settings: MfgSettings
  today: string
}

export type VerdictReason =
  | { key: "make_ready"; date: string; spareDays: number }
  | { key: "make_untimed"; hasBuyPrice: boolean }
  | { key: "partial"; qty: number; needDate: string }
  | { key: "buy_labour_gap"; materialUnit: number }
  | { key: "buy_materials_dearer"; materialUnit: number }
  | { key: "buy_capacity"; possibleDate: string | null; needDate: string }

export function verdictReason(v: Verdict, today: string, needDays: number): VerdictReason {
  const needDate = addDaysISO(today, needDays)
  switch (v.kind) {
    case "make":
      return v.possibleDays == null
        ? { key: "make_untimed", hasBuyPrice: v.buyPrice != null && v.buyPrice > 0 }
        : { key: "make_ready", date: addDaysISO(today, v.possibleDays), spareDays: Math.max(0, needDays - v.possibleDays) }
    case "partial":
      return { key: "partial", qty: v.makeQty, needDate }
    case "buy_price":
      return (v.buyPrice || 0) > v.unitMaterialCost
        ? { key: "buy_labour_gap", materialUnit: v.unitMaterialCost }
        : { key: "buy_materials_dearer", materialUnit: v.unitMaterialCost }
    case "buy_capacity":
      return { key: "buy_capacity", possibleDate: v.possibleDays == null ? null : addDaysISO(today, v.possibleDays), needDate }
  }
}

export interface MainMaterial {
  itemName: string
  unit: string
  /** For the asked quantity, planned waste included when it applies. */
  qty: number
  wastePercent: number
}

/** The material that decides the answer — the one bought with waste (the
 * slab), else the first on the bill. */
export function mainMaterial(product: MfgProduct, quantity: number): MainMaterial | null {
  const bom = product.bom || []
  const b = bom.find((x) => x.withWaste) || bom[0]
  if (!b) return null
  return {
    itemName: b.itemName,
    unit: b.unit,
    qty: round2(b.qtyPerUnit * quantity * (b.withWaste ? wasteFactor(product) : 1)),
    wastePercent: b.withWaste ? Math.max(0, Number(product.wastePercent) || 0) : 0,
  }
}

export interface ScreenedLine {
  index: number
  line: MfgRequestLine
  product: MfgProduct | null
  /** Standard cost of the full asked quantity — null without a product card. */
  std: StdCost | null
  verdict: Verdict | null
  reason: VerdictReason | null
  /** ISO date the asked quantity could be finished (time feature on). */
  possibleDate: string | null
  material: MainMaterial | null
}

export function screenRequest(
  r: Pick<ManufacturingRequest, "lines" | "itemName" | "unit" | "quantity" | "neededBy">,
  ctx: ScreenContext
): ScreenedLine[] {
  const needDays = neededInDays(r, ctx.today)
  return requestLines(r).map((line, index) => {
    const product = productForLine(line, ctx.products, ctx.productById)
    if (!product || !(line.quantity > 0)) {
      return { index, line, product, std: null, verdict: null, reason: null, possibleDate: null, material: null }
    }
    const v = verdict(product, line.quantity, needDays, ctx.inputs, ctx.departments, ctx.settings)
    return {
      index,
      line,
      product,
      std: standardCost(product, ctx.departments, ctx.settings, line.quantity),
      verdict: v,
      reason: verdictReason(v, ctx.today, needDays),
      possibleDate: v.possibleDays == null ? null : addDaysISO(ctx.today, v.possibleDays),
      material: mainMaterial(product, line.quantity),
    }
  })
}

export interface ScreenSummary {
  /** Standard cost of making every line in full (lines with a card). */
  fullCost: number
  /** Latest possible date across the lines — when ALL of it could be ready. */
  earliestAll: string | null
  /** The verdict shared by every screened line, else null (mixed). */
  common: Verdict["kind"] | null
  unscreened: number
}

export function summarizeScreen(lines: ScreenedLine[]): ScreenSummary {
  const screened = lines.filter((l) => l.verdict)
  const dates = screened.map((l) => l.possibleDate).filter((d): d is string => !!d)
  const kinds = [...new Set(screened.map((l) => l.verdict!.kind))]
  return {
    fullCost: round2(screened.reduce((a, l) => a + (l.std?.total || 0), 0)),
    earliestAll: dates.length ? dates.sort()[dates.length - 1] : null,
    common: kinds.length === 1 ? kinds[0] : null,
    unscreened: lines.length - screened.length,
  }
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

export type AnswerRoute = "make" | "estimate" | "buy"

/** Everything the screening says buy → propose procurement; otherwise make. */
export function defaultAnswerRoute(lines: ScreenedLine[]): AnswerRoute {
  const screened = lines.filter((l) => l.verdict)
  if (screened.length && screened.length === lines.length && screened.every((l) => l.verdict!.makeQty === 0)) return "buy"
  return "make"
}

/** The screening's suggestion; a legacy line with no card is taken whole. */
export function defaultMakeQty(l: ScreenedLine, legacy: boolean): number {
  if (l.verdict) return l.verdict.makeQty
  return legacy ? l.line.quantity : 0
}

export interface MakeDraftLine {
  asked: number
  /** Raw input — empty means none of this line. */
  input: string
  /** A product card exists (or the legacy stage-flow order can take it). */
  makeable: boolean
}

export type MakeLineError = "invalid" | "over" | "no_product"

export function parseQty(input: string): number {
  if (!input.trim()) return 0
  const n = Number(input)
  return Number.isFinite(n) ? n : NaN
}

export function validateMakeAnswer(lines: MakeDraftLine[]): {
  lineErrors: Array<MakeLineError | null>
  formError: "nothing_made" | "line_errors" | null
} {
  const lineErrors = lines.map((l): MakeLineError | null => {
    const q = parseQty(l.input)
    if (Number.isNaN(q) || q < 0) return "invalid"
    if (q > l.asked) return "over"
    if (q > 0 && !l.makeable) return "no_product"
    return null
  })
  if (lineErrors.some(Boolean)) return { lineErrors, formError: "line_errors" }
  if (!lines.some((l) => parseQty(l.input) > 0)) return { lineErrors, formError: "nothing_made" }
  return { lineErrors, formError: null }
}

/** Units the workshop does not take — they go back as a purchase need. */
export function makeRemainder(lines: MakeDraftLine[]): number {
  return round2(
    lines.reduce((a, l) => {
      const q = parseQty(l.input)
      return a + Math.max(0, l.asked - (Number.isFinite(q) ? Math.min(Math.max(q, 0), l.asked) : 0))
    }, 0)
  )
}

export function makeOrderCount(lines: MakeDraftLine[]): number {
  return lines.filter((l) => parseQty(l.input) > 0).length
}

// ---------------------------------------------------------------------------
// New request
// ---------------------------------------------------------------------------

export interface NewRequestDraft {
  sourceKind: "project" | "procurement"
  projectId: string
  neededBy: string
  rows: Array<{ productId: string; quantity: string }>
}

export interface NewRequestErrors {
  project: boolean
  neededBy: "required" | "past" | null
  rows: Array<{ product: boolean; quantity: boolean }>
  /** No row is complete. */
  noLines: boolean
}

export function validateNewRequest(d: NewRequestDraft, today: string): { ok: boolean; errors: NewRequestErrors } {
  const rows = d.rows.map((r) => {
    const touched = !!r.productId || !!r.quantity.trim()
    const q = parseQty(r.quantity)
    return { product: touched && !r.productId, quantity: touched && !(q > 0) }
  })
  const complete = d.rows.filter((r, i) => r.productId && !rows[i].quantity)
  const errors: NewRequestErrors = {
    project: d.sourceKind === "project" && !d.projectId,
    neededBy: !d.neededBy ? "required" : d.neededBy < today ? "past" : null,
    rows,
    noLines: complete.length === 0,
  }
  const ok = !errors.project && !errors.neededBy && !errors.noLines && !rows.some((r) => r.product || r.quantity)
  return { ok, errors }
}

// ---------------------------------------------------------------------------
// Cost estimates
// ---------------------------------------------------------------------------

export function estimateEarliestDays(
  e: Pick<MfgCostEstimate, "lines">,
  productById: Map<string, MfgProduct>,
  inputs: ScheduleInput[],
  departments: DeptCapacityFields[]
): number | null {
  let worst: number | null = null
  for (const l of e.lines) {
    const p = productById.get(l.productId)
    if (!p || !(l.quantity > 0)) continue
    const d = possibleForDays(p, l.quantity, inputs, departments)
    worst = worst == null ? d : Math.max(worst, d)
  }
  return worst
}

export interface QuoteCheck {
  floor: number
  margin: number | null
  below: boolean
  /** How far under the floor, 0 when at or above it. */
  gap: number
}

export function quoteCheck(price: number, cost: number, settings: MfgSettings): QuoteCheck {
  const floor = minPriceFor(cost, settings)
  const p = Number(price) || 0
  return {
    floor,
    margin: p > 0 ? marginPercent(p, cost) : null,
    below: p > 0 && p < floor,
    gap: p > 0 ? Math.max(0, Math.round(floor - p)) : 0,
  }
}

export function validateValidityDays(input: string): boolean {
  const n = Number(input)
  return Number.isInteger(n) && n >= 1 && n <= 365
}

export interface QuoteDraft {
  quoteNumber: string
  price: string
  issuedBy: string
  financeApprover: string
}

export function validateQuote(
  d: QuoteDraft,
  cost: number,
  settings: MfgSettings
): { quoteNumber: boolean; price: boolean; issuedBy: boolean; financeApprover: boolean; ok: boolean } {
  const price = parseQty(d.price)
  const check = quoteCheck(Number.isFinite(price) ? price : 0, cost, settings)
  const errors = {
    quoteNumber: !d.quoteNumber.trim(),
    price: !(price > 0),
    issuedBy: !d.issuedBy.trim(),
    financeApprover: check.below && !d.financeApprover.trim(),
  }
  return { ...errors, ok: !Object.values(errors).some(Boolean) }
}

export function validateAward(d: { date: string; confirmedBy: string }, today: string): { date: "required" | "future" | null; confirmedBy: boolean; ok: boolean } {
  const date = !d.date ? "required" : d.date > today ? "future" : null
  const confirmedBy = !d.confirmedBy.trim()
  return { date, confirmedBy, ok: !date && !confirmedBy }
}

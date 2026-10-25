// Price agreements and price history (Procurement PRD 3.0 §4 `AGR` / `PH`,
// §7.2 Suppliers). Pure — the screens show these answers and the writes record
// against them.
//
// Both belong to Procurement, and both exist so that a price can be argued
// about with evidence: an agreement is a price we already negotiated and may
// order on without going back to the market, and the history is every price we
// actually committed to, with the supplier and the day.
//
// A MATERIAL HERE IS A NAME AND A UNIT. This product has no item catalogue, so
// there is no code to key on; the key is the Arabic-folded name and unit, the
// same pairing the drift report already groups its lines by — except folded, so
// "حديد ١٢مم" and "حديد 12مم" are one steel rather than two.
//
// NOTHING IS CACHED. Which agreement covers a material, what it is worth and
// whether it is about to end are all derived on read. That is what makes "an
// agreement expires and its items go back to the market" true without a job
// running anywhere.

import { foldSearchText } from "../search-text"
import { dayOf, daysBetween, todayOf } from "./po"
import type { PurchaseOrder } from "./types"

export const PRICE_AGREEMENTS = "priceAgreements"
export const PRICE_HISTORY = "priceHistory"

const num = (n: unknown): number => (Number.isFinite(Number(n)) ? Number(n) : 0)
const round2 = (n: number) => Math.round(n * 100) / 100

/** `حديد ١٢مم` + `طن` → one key. Folding is the point: an unfolded key splits a
 * material's history in two the first time somebody types Arabic-Indic digits. */
export function materialKey(name: string | null | undefined, unit: string | null | undefined): string {
  return `${foldSearchText(name)}|${foldSearchText(unit)}`
}

// ---------------------------------------------------------------------------
// The specification a price belongs to (CMP-05, R-28)
// ---------------------------------------------------------------------------

export interface SpecSource {
  name?: string | null
  unitOfMeasure?: string | null
  unit?: string | null
  material?: {
    nodeId?: string | null
    specs?: Array<{ name?: { ar?: string | null } | null; value?: { ar?: string | null } | null }> | null
    brand?: { ar?: string | null } | null
  } | null
}

/**
 * The key of a material AS SPECIFIED: the tree's node, its chosen spec values and brand, and the unit. «بلوك 20 سم» and
 * «بلوك 15 سم» are one node and two keys — a price for one is no evidence for the other. A row typed outside the list has
 * no node, hence no key: its history falls back to the folded name and unit.
 */
export function specKeyOf(p: SpecSource | null | undefined): { materialId: string | null; specKey: string | null } {
  const m = p?.material
  const node = (m?.nodeId || "").trim()
  if (!m || !node) return { materialId: null, specKey: null }
  const specs = (m.specs || [])
    .map((s) => `${foldSearchText(s?.name?.ar)}=${foldSearchText(s?.value?.ar)}`)
    .filter((s) => s !== "=")
    .sort()
    .join(";")
  const unit = foldSearchText(p?.unitOfMeasure || p?.unit)
  return { materialId: node, specKey: `spec:${node}|${specs}|${foldSearchText(m.brand?.ar)}|${unit}` }
}

// ---------------------------------------------------------------------------
// The agreement
// ---------------------------------------------------------------------------

export interface AgreementLine {
  name: string
  unit: string
  /** The agreed unit price, EXCLUDING VAT. */
  price: number
}

export interface AgreementLogEntry {
  action: "created" | "renewed" | "ended"
  at: string
  byId: string
  byName: string
  params?: Record<string, string | number> | null
}

export interface PriceAgreement {
  id: string
  organizationId: string
  /** `AG-2026/003` — shown `اتف-2026/003` in Arabic. */
  docNumber: string
  supplierOrgId: string
  supplierName: string
  /** `YYYY-MM-DD`, both inclusive. */
  from: string
  until: string
  lines: AgreementLine[]
  note?: string | null
  preparedById: string
  preparedByName: string
  createdAt: string
  log?: AgreementLogEntry[]
  /** Ended by hand before its date, with the reason on the log. */
  endedAt?: string | null
}

export type AgreementState = "upcoming" | "live" | "expiring" | "expired"

/** Inside this many days of its end, an agreement is worth renewing — it is
 * also when it reaches the Today queue. */
export const AGREEMENT_EXPIRY_WINDOW_DAYS = 14

/** Days left, negative once it has ended. */
export const agreementDaysLeft = (a: Pick<PriceAgreement, "until">, today: string): number => daysBetween(today, dayOf(a.until))

/**
 * Where an agreement stands today.
 *
 * Both dates are inclusive: one that ends today can still be ordered on, and
 * one that starts tomorrow cannot. The reference prototype never read `from` at
 * all, so an agreement signed for next quarter counted as live and would have
 * priced an order today — we honour it.
 */
export function agreementState(a: Pick<PriceAgreement, "from" | "until" | "endedAt">, today: string): AgreementState {
  if (a.endedAt) return "expired"
  const from = dayOf(a.from)
  const until = dayOf(a.until)
  if (until && until < today) return "expired"
  if (from && from > today) return "upcoming"
  const left = until ? daysBetween(today, until) : Number.POSITIVE_INFINITY
  return left <= AGREEMENT_EXPIRY_WINDOW_DAYS ? "expiring" : "live"
}

export const agreementIsLive = (a: Pick<PriceAgreement, "from" | "until" | "endedAt">, today: string): boolean => {
  const s = agreementState(a, today)
  return s === "live" || s === "expiring"
}

export interface AgreementMatch {
  agreement: PriceAgreement
  line: AgreementLine
  price: number
}

/**
 * The agreement to order this material on, or null.
 *
 * Several live agreements may cover one material — two suppliers, or last
 * year's renewed beside a new one. The prototype took whichever came first in
 * its array, which is no rule at all; we take the CHEAPEST live price, then the
 * one that runs longest, then the document number, so the same question always
 * gets the same answer and the answer is the one worth having.
 */
export function agreementFor(agreements: PriceAgreement[], name: string, unit: string, today: string): AgreementMatch | null {
  const key = materialKey(name, unit)
  const found: AgreementMatch[] = []
  for (const agreement of agreements) {
    if (!agreementIsLive(agreement, today)) continue
    for (const line of agreement.lines || []) {
      if (materialKey(line.name, line.unit) !== key) continue
      const price = num(line.price)
      if (price > 0) found.push({ agreement, line, price })
    }
  }
  if (!found.length) return null
  return found.sort(
    (a, b) =>
      a.price - b.price ||
      dayOf(b.agreement.until).localeCompare(dayOf(a.agreement.until)) ||
      a.agreement.docNumber.localeCompare(b.agreement.docNumber)
  )[0]
}

/** The agreements this supplier holds, soonest to end first. */
export function agreementsOfSupplier(agreements: PriceAgreement[], supplierOrgId: string): PriceAgreement[] {
  return agreements.filter((a) => a.supplierOrgId === supplierOrgId).sort((a, b) => dayOf(a.until).localeCompare(dayOf(b.until)))
}

/** What the Suppliers tab lists: every agreement, the ones needing a decision
 * first, then by how soon they end. */
export function agreementRows(agreements: PriceAgreement[], today: string): Array<PriceAgreement & { state: AgreementState; daysLeft: number }> {
  const rank: Record<AgreementState, number> = { expiring: 0, live: 1, upcoming: 2, expired: 3 }
  return agreements
    .map((a) => ({ ...a, state: agreementState(a, today), daysLeft: agreementDaysLeft(a, today) }))
    .sort((a, b) => rank[a.state] - rank[b.state] || dayOf(a.until).localeCompare(dayOf(b.until)) || a.docNumber.localeCompare(b.docNumber))
}

export const RENEWAL_DAYS = 180

/** The renewal form's default end date: half a year past the current one, and
 * never in the past for an agreement that already lapsed. */
export function renewalUntil(a: Pick<PriceAgreement, "until">, today: string): string {
  const base = dayOf(a.until) > today ? dayOf(a.until) : today
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + RENEWAL_DAYS)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// The history
// ---------------------------------------------------------------------------

/** `po` — a price we committed to when an order was approved. `variance` — the
 * price a supplier's invoice settled at, once somebody accepted the difference. `manual` — what a purchase made outside the
 * platform was paid, as its manual receipt typed it (RC-03). */
export type PriceKind = "po" | "variance" | "manual"

export interface PriceHistoryEntry {
  id: string
  organizationId: string
  materialKey: string
  /** The specification the price was paid for (`specKeyOf`) — absent on a row from before specifications or a material typed outside the list. */
  specKey?: string | null
  materialId?: string | null
  name: string
  unit: string
  supplierOrgId: string
  supplierName: string
  /** Unit price EXCLUDING VAT. */
  price: number
  /** `YYYY-MM-DD` — the day the price was committed to. */
  day: string
  kind: PriceKind
  poId: string | null
  poNumber: string | null
  /** A `manual` row: the receipt that recorded it. */
  receiptId?: string | null
  receiptNumber?: string | null
}

const forMaterial = (history: PriceHistoryEntry[], name: string, unit: string): PriceHistoryEntry[] => {
  const key = materialKey(name, unit)
  // Never trust the order a query came back in: every helper below reads the
  // series as a series.
  return history.filter((h) => h.materialKey === key).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
}

/** The last price we committed to for this material — the whole entry, because
 * who we paid it to and when are half the answer. */
export function lastPaid(history: PriceHistoryEntry[], name: string, unit: string): PriceHistoryEntry | null {
  const series = forMaterial(history, name, unit)
  return series.length ? series[series.length - 1] : null
}

/**
 * «آخر شراء» under a material on the comparison: the last price we committed to for the SAME SPECIFICATION, with the order's
 * number — or nothing. A line with a specification key matches only rows carrying that key (a name-and-unit match would show
 * the price of another size); a line typed outside the list falls back to its name and unit.
 */
export function lastPaidFor(history: PriceHistoryEntry[], line: { specKey?: string | null; name: string; unit: string }): PriceHistoryEntry | null {
  if (!line.specKey) return lastPaid(history, line.name, line.unit)
  const series = history.filter((h) => h.specKey === line.specKey).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
  return series.length ? series[series.length - 1] : null
}

/**
 * The last price before a given day — the honest baseline for drift.
 *
 * An order's own price must not be compared against itself, which is what
 * happens if you take "the last price" on the day the order was approved.
 */
export function priceBefore(history: PriceHistoryEntry[], name: string, unit: string, day: string): number | null {
  const series = forMaterial(history, name, unit).filter((h) => h.day < day)
  return series.length ? series[series.length - 1].price : null
}

/** How many points the material screen and its sparkline show. */
export const PRICE_TREND_POINTS = 6
/** A rise of more than this across those points is worth a colour. */
export const PRICE_RISE_ALARM_PERCENT = 3

export interface PriceTrend {
  name: string
  unit: string
  materialKey: string
  points: PriceHistoryEntry[]
  min: number
  max: number
  first: number
  last: number
  /** Change from the first of the shown points to the last, in percent. */
  changePercent: number | null
  /** Above `PRICE_RISE_ALARM_PERCENT`. */
  rising: boolean
}

export function priceTrend(history: PriceHistoryEntry[], name: string, unit: string, points = PRICE_TREND_POINTS): PriceTrend | null {
  const series = forMaterial(history, name, unit).slice(-points)
  if (!series.length) return null
  const prices = series.map((h) => h.price)
  const first = prices[0]
  const last = prices[prices.length - 1]
  // A first price of zero has no percentage — a division nobody can defend is
  // worse than a missing number (§6.2).
  const changePercent = first > 0 ? round2(((last - first) / first) * 100) : null
  return {
    name: series[series.length - 1].name,
    unit: series[series.length - 1].unit,
    materialKey: series[0].materialKey,
    points: series,
    min: Math.min(...prices),
    max: Math.max(...prices),
    first,
    last,
    changePercent,
    rising: changePercent != null && changePercent > PRICE_RISE_ALARM_PERCENT,
  }
}

/** One row per material we have ever paid for, the sharpest rise first. */
export function priceTrends(history: PriceHistoryEntry[], points = PRICE_TREND_POINTS): PriceTrend[] {
  const seen = new Map<string, { name: string; unit: string }>()
  for (const h of history) if (!seen.has(h.materialKey)) seen.set(h.materialKey, { name: h.name, unit: h.unit })
  return Array.from(seen.values())
    .map((m) => priceTrend(history, m.name, m.unit, points))
    .filter((t): t is PriceTrend => t != null)
    .sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity) || a.name.localeCompare(b.name))
}

/** The bar heights of the little sparkline, 30–100 % so a flat series still
 * draws something. */
export function sparkHeights(t: PriceTrend): number[] {
  if (t.max === t.min) return t.points.map(() => 60)
  return t.points.map((p) => 30 + ((p.price - t.min) / (t.max - t.min)) * 70)
}

// ---------------------------------------------------------------------------
// Warnings that read the history
// ---------------------------------------------------------------------------

/** An offer more than this above the last price we paid is worth saying out loud. */
export const OFFER_ABOVE_LAST_PERCENT = 3

/** How far above the last paid price this offer sits, in percent — null when
 * there is nothing to compare with, or when it is not above it. */
export function aboveLastPaid(price: number | null | undefined, last: number | null | undefined): number | null {
  const p = Number(price)
  const l = Number(last)
  if (!Number.isFinite(p) || !Number.isFinite(l) || l <= 0) return null
  const pct = round2((p / l - 1) * 100)
  return pct > OFFER_ABOVE_LAST_PERCENT ? pct : null
}

// ---------------------------------------------------------------------------
// What an approval records
// ---------------------------------------------------------------------------

export interface HistoryRow extends Omit<PriceHistoryEntry, "id"> {
  /** Deterministic: the same approval recorded twice writes the same row. */
  id: string
}

/**
 * The rows an approved order adds to the history.
 *
 * At APPROVAL, not at creation: a prepared order is a proposal, and a price
 * nobody approved is not a price we paid. Lump-sum lines carry no unit price and
 * record nothing — a total divided by a quantity is an invented number.
 *
 * The id is the order's line, so re-running a retried approval overwrites its
 * own row instead of adding a second point to the series.
 */
export function historyRowsForApproval(po: PurchaseOrder, at: string): HistoryRow[] {
  const day = dayOf(at) || todayOf(new Date())
  const rows: HistoryRow[] = []
  for (const line of po.lines || []) {
    if (line.unitPrice == null || !Number.isFinite(Number(line.unitPrice))) continue
    const price = round2(Number(line.unitPrice))
    if (price <= 0) continue
    rows.push({
      id: `${po.id}__${line.id}`,
      organizationId: po.organizationId,
      materialKey: materialKey(line.name, line.unit),
      ...(line.specKey ? { specKey: line.specKey, materialId: line.materialId ?? null } : {}),
      name: line.name,
      unit: line.unit,
      supplierOrgId: po.supplierOrgId,
      supplierName: po.supplierName,
      price,
      day,
      kind: "po",
      poId: po.id,
      poNumber: po.docNumber,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Price history v2 (SUP-05, SUP-06, WF-24): one material's series from the orders we approved, the offers we were quoted and
// the agreements we signed — and what an agreement has consumed. Pure and read-only: nothing here is stored.
// ---------------------------------------------------------------------------

/** `po` — a price we committed to on an approved order. `offer` — a price quoted to us. `agreement` — a price we agreed.
 * `manual` — a price paid outside the platform, from a manual receipt (RC-03). */
export type PriceSource = "po" | "offer" | "agreement" | "manual"

export interface PricePoint {
  id: string
  /** `YYYY-MM-DD`. */
  day: string
  supplier: string
  /** The supplier's org id, else his name — one line on the chart per key. */
  supplierKey: string
  /** Unit price EXCLUDING VAT. */
  price: number
  quantity: number | null
  source: PriceSource
  /** A price we committed to (an order or an agreement). An offer that did not become an order is the hollow dot. */
  awarded: boolean
  poId: string | null
  poNo: string | null
  rfqId: string | null
  rfqNo: string | null
  agreementId: string | null
  agreementNo: string | null
  /** A `manual` point: the receipt it came from (its number is `poNo`). */
  receiptId?: string | null
}

export interface PriceOfferLike {
  id: string
  rfqId?: string | null
  status?: string | null
  supplierId?: string | null
  organizationId?: string | null
  supplierName?: string | null
  companyName?: string | null
  createdAt?: unknown
  /** The current version's rates, per request unit; a piece rate carries `packLen`. */
  lines?: Array<{ rfqProductIndex?: unknown; unitPrice?: unknown; packLen?: unknown }> | null
  /** A request priced as one amount has no rate to compare. */
  lump?: unknown
}

export interface PriceRfqLike {
  id: string
  title?: string | null
  rfqNumber?: string | null
  docNumber?: string | null
  products?: Array<(SpecSource & { name?: string | null }) | null> | null
}

const OFFER_ACCEPTED = "مقبول"
const OFFER_WITHDRAWN = "مسحوب"

const isoDay = (v: unknown): string => {
  if (!v) return ""
  if (typeof v === "string") return v.slice(0, 10)
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString().slice(0, 10) : ""
}

const sameMaterial = (key: string, p: { materialKey: string; specKey?: string | null }): boolean => (key.startsWith("spec:") ? p.specKey === key : p.materialKey === key)

const SOURCE_ORDER: Record<PriceSource, number> = { agreement: 0, offer: 1, po: 2, manual: 3 }

/**
 * Every price one material has had, oldest first. `key` is a name-and-unit key (`materialKey`) or a specification key
 * (`specKeyOf`: «بلوك 20 سم» and «بلوك 15 سم» are two). A lump-sum order never enters (it has no unit price); an offer that
 * became an order is the ORDER's point, not a second dot; a withdrawn offer, a piece rate and a lump-sum quote are left out.
 */
export function priceSeries(
  key: string,
  src: { history: PriceHistoryEntry[]; offers?: PriceOfferLike[]; rfqs?: PriceRfqLike[]; agreements?: PriceAgreement[]; orders?: PurchaseOrder[] }
): PricePoint[] {
  const out: PricePoint[] = []
  const orderById = new Map((src.orders || []).map((o) => [o.id, o]))
  for (const h of src.history) {
    if (h.kind !== "po" || !(h.price > 0) || !sameMaterial(key, h)) continue
    const po = h.poId ? orderById.get(h.poId) : undefined
    const line = po?.lines.find((l) => `${po.id}__${l.id}` === h.id)
    out.push({
      id: `po:${h.id}`,
      day: h.day,
      supplier: h.supplierName || "",
      supplierKey: h.supplierOrgId || h.supplierName,
      price: h.price,
      quantity: line ? round2(num(line.quantity) - num(line.cancelled)) || null : null,
      source: "po",
      awarded: true,
      poId: h.poId,
      poNo: h.poNumber,
      rfqId: po?.rfqId ?? null,
      rfqNo: null,
      agreementId: po?.agreementId ?? null,
      agreementNo: po?.agreementNo ?? null,
    })
  }
  // A purchase made outside the platform (RC-03): a price we paid, so a filled dot, named by its receipt.
  for (const h of src.history) {
    if (h.kind !== "manual" || !(h.price > 0) || !sameMaterial(key, h)) continue
    out.push({
      id: `manual:${h.id}`,
      day: h.day,
      supplier: h.supplierName || "",
      supplierKey: h.supplierOrgId || h.supplierName,
      price: h.price,
      quantity: null,
      source: "manual",
      awarded: true,
      poId: null,
      poNo: h.receiptNumber ?? null,
      rfqId: null,
      rfqNo: null,
      agreementId: null,
      agreementNo: null,
      receiptId: h.receiptId ?? null,
    })
  }
  const rfqById = new Map((src.rfqs || []).map((r) => [r.id, r]))
  for (const o of src.offers || []) {
    if (o.status === OFFER_ACCEPTED || o.status === OFFER_WITHDRAWN || o.lump) continue
    const rfq = o.rfqId ? rfqById.get(o.rfqId) : undefined
    const day = isoDay(o.createdAt)
    if (!rfq || !day) continue
    for (const l of o.lines || []) {
      const idx = Number(l.rfqProductIndex)
      const price = Number(l.unitPrice)
      const product = Number.isInteger(idx) ? rfq.products?.[idx] : null
      if (!product || !(price > 0) || Number(l.packLen) > 0) continue
      const spec = specKeyOf(product).specKey
      const mk = materialKey(product.name, product.unitOfMeasure || product.unit)
      if (key.startsWith("spec:") ? spec !== key : mk !== key) continue
      out.push({
        id: `offer:${o.id}:${idx}`,
        day,
        supplier: o.supplierName || o.companyName || "",
        supplierKey: o.organizationId && o.organizationId !== "guest" ? o.organizationId : o.supplierId || o.supplierName || o.companyName || o.id,
        price: round2(price),
        quantity: null,
        source: "offer",
        awarded: false,
        poId: null,
        poNo: null,
        rfqId: rfq.id,
        rfqNo: rfq.rfqNumber || rfq.docNumber || rfq.title || null,
        agreementId: null,
        agreementNo: null,
      })
    }
  }
  for (const a of src.agreements || []) {
    for (const [i, l] of (a.lines || []).entries()) {
      if (materialKey(l.name, l.unit) !== key || !(num(l.price) > 0)) continue
      out.push({
        id: `agreement:${a.id}:${i}`,
        day: dayOf(a.from),
        supplier: a.supplierName || "",
        supplierKey: a.supplierOrgId || a.supplierName,
        price: round2(num(l.price)),
        quantity: null,
        source: "agreement",
        awarded: true,
        poId: null,
        poNo: null,
        rfqId: null,
        rfqNo: null,
        agreementId: a.id,
        agreementNo: a.docNumber,
      })
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.id.localeCompare(b.id))
}

/** The prototype compares the last price with the one ~60 days before it (its label says «قرابة 3 أشهر»; its fixture is −1.1 % over this window). */
export const PRICE_CHANGE_WINDOW_DAYS = 60

export interface PriceStats {
  /** Orders and agreements — what we committed to. Offers are evidence, not purchases. */
  purchases: number
  last: PricePoint | null
  min: number | null
  max: number | null
  average: number | null
  /** The price the change is measured from, with its day. */
  baseline: PricePoint | null
  changePercent: number | null
}

export function priceStats(points: PricePoint[], windowDays = PRICE_CHANGE_WINDOW_DAYS): PriceStats {
  const bought = points.filter((p) => p.awarded)
  if (!bought.length) return { purchases: 0, last: null, min: null, max: null, average: null, baseline: null, changePercent: null }
  const prices = bought.map((p) => p.price)
  const last = bought[bought.length - 1]
  const cutoff = new Date(`${last.day}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays)
  const before = bought.filter((p) => p.day <= cutoff.toISOString().slice(0, 10))
  const baseline = before.length ? before[before.length - 1] : bought[0]
  return {
    purchases: bought.length,
    last,
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: round2(prices.reduce((s, p) => s + p, 0) / prices.length),
    baseline,
    changePercent: bought.length > 1 && baseline.price > 0 ? Math.round(((last.price - baseline.price) / baseline.price) * 1000) / 10 : null,
  }
}

/** Each committed price against the committed price before it, in percent; an offer has no «previous purchase» and reads null. */
export function diffVsPrevious(points: PricePoint[]): Map<string, number | null> {
  const out = new Map<string, number | null>()
  let prev: PricePoint | null = null
  for (const p of points) {
    if (!p.awarded) {
      out.set(p.id, null)
      continue
    }
    out.set(p.id, prev && prev.price > 0 ? Math.round(((p.price - prev.price) / prev.price) * 1000) / 10 : null)
    prev = p
  }
  return out
}

// --- Agreements: the cap and what is left of it (SUP-06). Ordering ON an agreement stays as it is today (open decision 13). ---

/** An agreement line with its ceiling: the most we may buy on it, in the line's unit. Absent = no ceiling stated. */
export type CappedAgreementLine = AgreementLine & { cap?: number | null }

export interface AgreementConsumption {
  name: string
  unit: string
  price: number
  cap: number | null
  /** Ordered on this agreement and not cancelled. */
  consumed: number
  /** `cap − consumed`, never below zero; null without a cap. */
  left: number | null
  /** `consumed / cap`, 0–∞ in percent; null without a cap. */
  usedPercent: number | null
}

/** What each line of an agreement has been ordered for: the quantities of every live order that names it. */
export function agreementConsumption(agreement: PriceAgreement, orders: PurchaseOrder[]): AgreementConsumption[] {
  const mine = orders.filter((o) => o.agreementId === agreement.id && o.status !== "cancelled")
  return (agreement.lines || []).map((l) => {
    const key = materialKey(l.name, l.unit)
    const consumed = round2(mine.reduce((s, o) => s + o.lines.filter((x) => materialKey(x.name, x.unit) === key).reduce((t, x) => t + num(x.quantity) - num(x.cancelled), 0), 0))
    const cap = num((l as CappedAgreementLine).cap) > 0 ? num((l as CappedAgreementLine).cap) : null
    return {
      name: l.name,
      unit: l.unit,
      price: num(l.price),
      cap,
      consumed,
      left: cap == null ? null : Math.max(0, round2(cap - consumed)),
      usedPercent: cap == null ? null : Math.round((consumed / cap) * 1000) / 10,
    }
  })
}

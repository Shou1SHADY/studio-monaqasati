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
 * price a supplier's invoice settled at, once somebody accepted the difference. */
export type PriceKind = "po" | "variance"

export interface PriceHistoryEntry {
  id: string
  organizationId: string
  materialKey: string
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

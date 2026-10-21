// An offer is the supplier's document, and every edit of it — from the full portal, the free journey, the visitor link
// or the guest's own page — is a NEW version that keeps the one before (Procurement 2.0 OFR/WF-14, S3 D2). This module is
// the one place a quote becomes an offer's numbers: it reads what the supplier typed (rates per request unit or per
// sale unit, the warranty he offers, «للطلب كاملاً فقط», his VAT standing), checks it against the request, totals it
// through offer-calc, and shapes the version and the fields the offer document carries. Every door runs it on the
// SERVER, so no door believes a total or a pack the browser sent. Pure: no I/O.

import { toAmount } from "./offer-calc"
import { durationIssue, priceIssue } from "./input-limits"
import { priceOffer, pricedProducts, pricingFault, pricingModeOf, revisePrice, type PricedRfq, type RfqProductLike } from "./offer-pricing"

const round2 = (n: number) => Math.round(n * 100) / 100
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))
const day = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "")
type Rec = Record<string, unknown>

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

export interface SaleUnitLike {
  ar?: string
  en?: string
  /** Request units in one piece — 6 for «قطعة 6 م». */
  lengthM?: number
}

export type QuoteProduct = RfqProductLike & {
  saleUnits?: SaleUnitLike[] | null
  warrantyMonths?: number | null
  requiresWarranty?: boolean | null
}

export type QuoteRfq = Omit<PricedRfq, "products"> & { products?: QuoteProduct[] | null }

export interface VersionLine {
  rfqProductIndex: number
  unitPrice: number
  /** Request units in one piece, when the rate is per piece. */
  packLen?: number
  /** The sale unit's name as the RFQ offered it — «قطعة 6 م». */
  packKey?: string
  /** The warranty he offers on the line, in months; 0 = «بلا ضمان»; absent = not stated. */
  warrantyMonths?: number | null
}

export interface StoredVersion {
  n: number
  /** The day it was made (`YYYY-MM-DD`, Riyadh). */
  at: string
  arrive: string | null
  valid: string
  note: string
  fileUrl: string | null
  /** Ex-VAT, computed on the server. */
  total: number
  lines?: VersionLine[]
  /** The VAT rate this version was quoted with — its gross is its own, never re-read from today's flag. */
  vatRate?: number
  skipped?: number[]
  lump?: number
  whole?: boolean
  leadDays?: number | null
  by?: "supplier" | "guest"
  /** The answer to «اطلب تأكيد السعر»: same price, a new validity. */
  reval?: true
  /** The answer to «اطلب سعراً أفضل». */
  bafoReply?: "lowered" | "kept"
}

export const VERSION_ACTORS = ["supplier", "guest"] as const

// ---------------------------------------------------------------------------
// Reading a quote
// ---------------------------------------------------------------------------

export interface QuoteLineInput {
  rfqProductIndex: number
  unitPrice: unknown
  packLen?: unknown
  warrantyMonths?: unknown
}

export interface QuoteInput {
  lines?: QuoteLineInput[] | null
  skipped?: readonly number[] | null
  /** The one figure of a request priced as a total. */
  total?: unknown
  whole?: boolean | null
}

export type QuoteRefusalCode = "price_invalid" | "price_too_big" | "pack_not_offered" | "warranty_invalid" | "line_prices_incomplete" | "line_contradictory" | "no_line_priced"

export interface QuoteRefusal {
  code: QuoteRefusalCode
  indexes: number[]
}

export interface BuiltQuote {
  mode: "line" | "total"
  lines: VersionLine[]
  skipped: number[]
  /** Ex-VAT, 2 dp. */
  total: number
  /** A request of several materials priced as one amount. */
  lump: number | null
  whole: boolean
  vatRegistered: boolean
  vatRate: number
}

export const VAT_RATE_REGISTERED = 0.15
export const WARRANTY_OFFER_MAX_MONTHS = 120

/** What a line asks for: the months, or null. A request written before durations that only said «yes» asks a year. */
export function warrantyAskedOf(product: QuoteProduct | null | undefined): number | null {
  if (!product) return null
  const m = Number(product.warrantyMonths)
  if (Number.isFinite(m) && m > 0) return m
  return product.requiresWarranty ? 12 : null
}

export const saleUnitsOf = (product: QuoteProduct | null | undefined): Array<{ lengthM: number; name: string }> =>
  (product?.saleUnits || []).filter((u) => Number(u?.lengthM) > 0).map((u) => ({ lengthM: Number(u.lengthM), name: str(u.ar) || str(u.en) }))

const present = (v: unknown) => !(v === null || v === undefined || String(v).trim() === "")

/** Checks a quote against its request and totals it. The pack must be one the line offers; every price is positive,
 * finite and under the ceiling (NFR-07); the total is ours to compute, never the browser's. */
export function buildQuote(rfq: QuoteRfq | null | undefined, input: QuoteInput, vat: { registered: boolean }): { ok: true; quote: BuiltQuote } | { ok: false; refusal: QuoteRefusal } {
  const whole = Boolean(input.whole)
  const vatRate = vat.registered ? VAT_RATE_REGISTERED : 0
  const base = { whole, vatRegistered: vat.registered, vatRate }
  const fail = (code: QuoteRefusalCode, indexes: number[] = []) => ({ ok: false as const, refusal: { code, indexes } })

  if (pricingModeOf(rfq as PricedRfq) !== "line") {
    if (!present(input.total)) return fail("price_invalid")
    const total = round2(toAmount(input.total))
    const issue = priceIssue(total)
    if (issue) return fail(issue === "too_big" ? "price_too_big" : "price_invalid")
    const products = (rfq?.products || []).filter((p) => (p?.name || "").trim())
    return { ok: true, quote: { mode: "total", lines: [], skipped: [], total, lump: products.length > 1 ? total : null, ...base } }
  }

  const products = pricedProducts(rfq as PricedRfq)
  const raw = rfq?.products || []
  const rates: Record<number, number> = {}
  const packs: Record<number, number> = {}
  const warranties: Record<number, number | null> = {}
  const badPrice: number[] = []
  const tooBig: number[] = []
  const badPack: number[] = []
  const badWarranty: number[] = []
  const marked = new Set((input.skipped || []).map(Number))
  for (const l of input.lines || []) {
    const i = Number(l.rfqProductIndex)
    if (!Number.isInteger(i) || i < 0 || i >= products.length) continue
    if (present(l.unitPrice)) {
      const rate = round2(toAmount(l.unitPrice))
      const issue = priceIssue(rate)
      // A zero beside «not supplied» is that mark, not a price; anywhere else "free" is not a quote.
      if (issue === "not_positive" && marked.has(i)) continue
      if (issue === "not_positive") badPrice.push(i)
      else if (issue === "too_big") tooBig.push(i)
      else rates[i] = rate
    }
    if (present(l.packLen) && toAmount(l.packLen) > 0) {
      const len = toAmount(l.packLen)
      if (saleUnitsOf(raw[i]).some((u) => u.lengthM === len)) packs[i] = len
      else badPack.push(i)
    }
    if (present(l.warrantyMonths)) {
      const m = Number(l.warrantyMonths)
      if (Number.isInteger(m) && m >= 0 && m <= WARRANTY_OFFER_MAX_MONTHS) warranties[i] = m
      else badWarranty.push(i)
    }
  }
  if (badPrice.length) return fail("price_invalid", badPrice)
  if (tooBig.length) return fail("price_too_big", tooBig)
  if (badPack.length) return fail("pack_not_offered", badPack)
  if (badWarranty.length) return fail("warranty_invalid", badWarranty)

  const priced = priceOffer(products, rates, input.skipped || [], packs)
  const fault = pricingFault(priced)
  if (fault) return fail(fault.code === "LINE_CONTRADICTORY" ? "line_contradictory" : fault.code === "LINE_PRICES_INCOMPLETE" ? "line_prices_incomplete" : "no_line_priced", fault.indexes)

  const lines: VersionLine[] = priced.lines.map((l) => {
    const unit = l.packLen != null ? saleUnitsOf(raw[l.rfqProductIndex]).find((u) => u.lengthM === l.packLen) : null
    return {
      rfqProductIndex: l.rfqProductIndex,
      unitPrice: l.unitPrice,
      ...(l.packLen != null ? { packLen: l.packLen, ...(unit?.name ? { packKey: unit.name } : {}) } : {}),
      ...(warranties[l.rfqProductIndex] !== undefined ? { warrantyMonths: warranties[l.rfqProductIndex] } : {}),
    }
  })
  return { ok: true, quote: { mode: "line", lines, skipped: priced.skipped, total: priced.total, lump: null, ...base } }
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

const UNIT_DAYS: Record<string, number> = { أيام: 1, يوم: 1, days: 1, أسابيع: 7, أسبوع: 7, weeks: 7, أشهر: 30, شهر: 30, months: 30 }

/** A duration typed as a number and a unit, in days; null when none was typed. */
export function leadDaysFrom(duration: unknown, unit?: unknown): number | null {
  if (!present(duration)) return null
  const n = toAmount(duration)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * (UNIT_DAYS[str(unit).trim()] ?? 1) * 1000) / 1000
}

/** NFR-07: a duration is a whole number of days from 1 to 365 — null when it stands (or none was given). */
export function leadDaysRefusal(days: number | null): "duration_invalid" | null {
  if (days === null) return null
  return Number.isFinite(days) && durationIssue(days) === null ? null : "duration_invalid"
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export function versionFromQuote(
  quote: BuiltQuote,
  ctx: { at: string; arrive?: string | null; valid: string; note?: string; fileUrl?: string | null; leadDays?: number | null; by: "supplier" | "guest"; n?: number; reval?: boolean; bafoReply?: "lowered" | "kept" }
): StoredVersion {
  const v: StoredVersion = {
    n: ctx.n ?? 1,
    at: ctx.at,
    arrive: ctx.arrive || null,
    valid: ctx.valid,
    note: (ctx.note || "").trim().slice(0, 1000),
    fileUrl: ctx.fileUrl || null,
    total: quote.total,
    vatRate: quote.vatRate,
    whole: quote.whole,
    by: ctx.by,
  }
  if (quote.lines.length) v.lines = quote.lines
  if (quote.skipped.length) v.skipped = quote.skipped
  if (quote.lump != null) v.lump = quote.lump
  if (ctx.leadDays != null) v.leadDays = ctx.leadDays
  if (ctx.reval) v.reval = true
  if (ctx.bafoReply) v.bafoReply = ctx.bafoReply
  return v
}

/** A quote from before `versions` as its first version — so the first edit keeps it instead of losing it (OFR-03). */
export function legacyVersionOf(offer: Rec): StoredVersion {
  const batches = Array.isArray(offer.deliveryBatches) ? (offer.deliveryBatches as Rec[]) : []
  const lines: VersionLine[] = Array.isArray(offer.lines)
    ? (offer.lines as Rec[]).map((l) => ({ rfqProductIndex: Number(l.rfqProductIndex) || 0, unitPrice: toAmount(l.unitPrice), ...(toAmount(l.packLen) > 0 ? { packLen: toAmount(l.packLen) } : {}) }))
    : []
  const v: StoredVersion = {
    n: 1,
    at: day(offer.createdAt) || day(offer.updatedAt),
    arrive: day(batches[0]?.deliveryDate) || null,
    valid: day(offer.validUntil),
    note: str(offer.supplierNote),
    fileUrl: str(offer.offerPdfUrl) || null,
    total: round2(toAmount(offer.price)),
  }
  if (lines.length) v.lines = lines
  return v
}

const storedVersions = (offer: Rec): StoredVersion[] => (Array.isArray(offer.versions) && offer.versions.length ? (offer.versions as StoredVersion[]) : [legacyVersionOf(offer)])

/** The versions after this one: the stored ones (or the legacy quote as V1), then the new one, each with its own `n`. */
export function nextVersions(offer: Rec, next: StoredVersion): StoredVersion[] {
  const stored = storedVersions(offer)
  const used = stored.reduce((m, x, i) => Math.max(m, Number(x?.n) || i + 1), 0)
  return [...stored.map((x, i) => ({ ...x, n: Number(x?.n) || i + 1 })), { ...next, n: used + 1 }]
}

/** The offer's revision: how many versions it has made; an offer written before versions is V1. */
export const offerRev = (offer: Rec): number => (Array.isArray(offer.versions) && offer.versions.length ? offer.versions.length : 1)

/** The version the offer stands at now. */
export const currentVersionOf = (offer: Rec): StoredVersion => {
  const all = storedVersions(offer)
  return all[all.length - 1]
}

// ---------------------------------------------------------------------------
// The fields an offer document carries for a new total
// ---------------------------------------------------------------------------

export interface TotalFields {
  price: string
  totalBatchesPrice?: number
  deliveryBatches?: Array<Record<string, unknown>>
}

/**
 * The fields every reader of an offer has always used for its price — `price` as a string and the delivery batches that
 * agree with it. A multi-shipment offer's batches are scaled to the new total so its schedule still adds up, and
 * `totalBatchesPrice` (which every reader prefers over `price`) follows.
 */
export function totalFields(offer: Rec, total: number): TotalFields {
  const revised = revisePrice({ deliveryBatches: offer.deliveryBatches as never, totalBatchesPrice: offer.totalBatchesPrice as never }, null, { total })
  return { ...(revised.ok ? revised.fields : {}), price: String(total) }
}

// ---------------------------------------------------------------------------
// Can a quote still be made? (G-07, the one rule of every door)
// ---------------------------------------------------------------------------

export type QuotingGate = "rfq_closed" | "deadline"

/** The request takes quotes while it is `New` and the deadline's day (Riyadh) has not passed. `today` is `YYYY-MM-DD`. */
export function quotingGate(rfq: { status?: unknown; deadline?: unknown } | null | undefined, today: string): QuotingGate | null {
  if (!rfq || str(rfq.status) !== "New") return "rfq_closed"
  const deadline = day(rfq.deadline)
  if (deadline && deadline < today) return "deadline"
  return null
}

// The supplier's quote as rules (PRD OFR-01…05, WF-01…05) — pure, so the form shows them live, the server runs them
// again before it writes (NFR-08), and a test pins them. Nothing here reads or writes a database.

import { fieldCovers } from "@/lib/materials/reach"
import { toAmount } from "@/lib/procurement/offer-pricing"
import { VAT, addDaysTo, dayNum, r2, type DealLogic } from "./deal-logic"
import type { Deal, DealItem } from "./types"

export type QuoteMode = "new" | "edit" | "reduce"

export interface QuoteValues {
  /** Unit price typed per item id (`i1`…). */
  prices: Record<string, string>
  /** Items the supplier does not supply. */
  skip: Record<string, boolean>
  total: string
  arrive: string
  valid: string
  note: string
}

export type QuoteBlock = "total" | "zero" | "oneItem" | "deadline" | "valid"

export interface QuoteCheck {
  blocks: { code: QuoteBlock; item?: string }[]
  net: number
  vat: number
  gross: number
  /** Net per item id, for the live line totals. */
  lines: Record<string, number | null>
}

/** What of a request a quote is checked against. */
export type QuoteShape = Pick<Deal, "pricing" | "items" | "deadline">

/** Whole days from `from` to `iso` (negative = past). */
export const daysBetween = (iso: string, from: string): number => Math.round((dayNum(iso) - dayNum(from)) / 864e5)

/** The reasons a quote cannot go, in the order they are shown, and the figures it would carry (net, VAT, gross). The VAT
 * is the supplier company's own rate — 15% with a VAT number, 0 without (decision 9) — the same rule as his invoices. */
export function quoteBlocks(deal: QuoteShape, v: QuoteValues, mode: QuoteMode, L: Pick<DealLogic, "daysTo">, vatRate: number = VAT): QuoteCheck {
  const blocks: QuoteCheck["blocks"] = []
  const lines: Record<string, number | null> = {}
  let net = 0
  if (deal.pricing === "total") {
    const t = toAmount(v.total)
    net = t
    if (!(t > 0)) blocks.push({ code: "total" })
  } else {
    let priced = 0
    for (const i of deal.items) {
      if (v.skip[i.id]) {
        lines[i.id] = null
        continue
      }
      const raw = String(v.prices[i.id] ?? "").trim()
      const p = toAmount(raw)
      if (raw === "") {
        lines[i.id] = null
        continue
      }
      if (p <= 0) {
        blocks.push({ code: "zero", item: i.name })
        lines[i.id] = null
        continue
      }
      priced += 1
      lines[i.id] = r2(p * i.qty)
      net += p * i.qty
    }
    if (!priced) blocks.push({ code: "oneItem" })
  }
  // A reply to a price cut runs on its own clock (reply-by), never on the expired submission deadline.
  if (mode !== "reduce" && deal.deadline && L.daysTo(deal.deadline) < 0) blocks.push({ code: "deadline" })
  if (!v.valid) blocks.push({ code: "valid" })
  net = r2(net)
  return { blocks, net, vat: r2(net * vatRate), gross: r2(net * (1 + vatRate)), lines }
}

export interface StoredVersion {
  n: number
  at: string
  arrive: string | null
  valid: string
  note: string
  fileUrl: string | null
  total: number
  lines?: { rfqProductIndex: number; unitPrice: number }[]
  /** The VAT rate this version was quoted with (0.15 or 0) — its gross is its own, never re-read from today's flag. */
  vatRate?: number
}

/** The stored version a form becomes (`n` is set by `nextVersions`). */
export function versionOf(deal: QuoteShape, v: QuoteValues, today: string, fileUrl?: string | null, vatRate?: number): StoredVersion {
  const out: StoredVersion = { n: 1, at: today, arrive: v.arrive || null, valid: v.valid, note: v.note.trim().slice(0, 1000), fileUrl: fileUrl || null, total: 0 }
  if (vatRate != null) out.vatRate = vatRate
  if (deal.pricing === "total") out.total = r2(toAmount(v.total))
  else {
    const lines: { rfqProductIndex: number; unitPrice: number }[] = []
    deal.items.forEach((i, n) => {
      const rate = r2(toAmount(v.prices[i.id]))
      if (!v.skip[i.id] && rate > 0) lines.push({ rfqProductIndex: n, unitPrice: rate })
    })
    out.lines = lines
    out.total = r2(lines.reduce((s, l) => s + l.unitPrice * deal.items[l.rfqProductIndex].qty, 0))
  }
  return out
}

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))
const day = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "")

/** A quote from before `versions` as its first version — so the first edit keeps it instead of losing it (OFR-03). */
export function legacyVersionOf(offer: Rec): StoredVersion {
  const batches = Array.isArray(offer.deliveryBatches) ? (offer.deliveryBatches as Rec[]) : []
  const lines = Array.isArray(offer.lines) ? (offer.lines as Rec[]).map((l) => ({ rfqProductIndex: Number(l.rfqProductIndex) || 0, unitPrice: toAmount(l.unitPrice) })) : []
  const v: StoredVersion = {
    n: 1,
    at: day(offer.createdAt) || day(offer.updatedAt),
    arrive: day(batches[0]?.deliveryDate) || null,
    valid: day(offer.validUntil),
    note: str(offer.supplierNote),
    fileUrl: str(offer.offerPdfUrl) || null,
    total: r2(toAmount(offer.price)),
  }
  if (lines.length) v.lines = lines
  return v
}

/** The versions after this one: the stored ones (or the legacy quote as v1), then the new one, each with its own `n`. */
export function nextVersions(offer: Rec, next: StoredVersion): StoredVersion[] {
  const stored = Array.isArray(offer.versions) && offer.versions.length ? (offer.versions as StoredVersion[]) : [legacyVersionOf(offer)]
  const used = stored.reduce((m, x, i) => Math.max(m, Number(x?.n) || i + 1), 0)
  return [...stored.map((x, i) => ({ ...x, n: Number(x?.n) || i + 1 })), { ...next, n: used + 1 }]
}

/** The day a cut must be answered by: the contractor's own date, else three days from when it was asked. */
export function replyByOf(offer: Rec): string {
  const by = day(offer.reductionBy)
  if (by) return by
  const at = day(offer.reductionAt) || day(offer.decidedAt)
  return at ? addDaysTo(at, 3) : ""
}

/** The request's items as the supplier prices them (`i1`, `i2`…). */
export function rfqItems(rfq: Rec): DealItem[] {
  const products = Array.isArray(rfq.products) ? (rfq.products as Rec[]) : []
  const numOf = (v: unknown) => {
    const n = Number(String(v ?? "").replace(/[,\s]/g, ""))
    return Number.isFinite(n) ? n : 0
  }
  return products.map((p, i) => ({
    id: `i${i + 1}`,
    name: str(p.name).trim() || str(p.description).trim(),
    unit: str(p.unitOfMeasure || p.unit),
    qty: numOf(p.quantity),
    spec: str(p.description) !== str(p.name) ? str(p.description) : "",
  }))
}

/** What the server checks a quote against, read from the request itself. */
export function quoteShapeOf(rfq: Rec): QuoteShape {
  return { pricing: str(rfq.pricingMode) === "line" ? "item" : "total", items: rfqItems(rfq), deadline: day(rfq.deadline) }
}

/** Whether the request reaches this supplier: invited by name, or public in his specialties and cities (RFQ-01). */
export function requestReaches(rfq: Rec, orgId: string, field: { specs: string[]; cities: string[]; subIds?: string[] }): boolean {
  const named = [rfq.allowedSupplierOrgIds, rfq.invitedSupplierOrgIds].some((l) => Array.isArray(l) && (l as string[]).includes(orgId))
  if (named) return true
  if (rfq.visibility === "private") return false
  // One RFQ may carry several sub-categories (PUR-03): any of them is his field.
  if (!fieldCovers({ subIds: field.subIds || [], specs: field.specs }, rfq)) return false
  const city = str(rfq.city)
  // A request with no city is nationwide (as on the supplier's list).
  return !city || field.cities.includes(city)
}

/** Whether an invitation names him (only an invitation can be declined). */
export const namesSupplier = (rfq: Rec, orgId: string): boolean => [rfq.allowedSupplierOrgIds, rfq.invitedSupplierOrgIds].some((l) => Array.isArray(l) && (l as string[]).includes(orgId))

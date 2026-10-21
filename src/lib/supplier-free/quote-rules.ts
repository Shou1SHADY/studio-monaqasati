// The supplier's quote as rules (PRD OFR-01…05, WF-01…05) — pure, so the form shows them live, the server runs them
// again before it writes (NFR-08), and a test pins them. Nothing here reads or writes a database.

import { fieldCovers } from "@/lib/materials/reach"
import { MAX_UNIT_PRICE } from "@/lib/procurement/input-limits"
import { lineCalc, type PackInfo } from "@/lib/procurement/offer-calc"
import { bafoReplyBy } from "@/lib/procurement/offer-decisions"
import { toAmount } from "@/lib/procurement/offer-pricing"
import { legacyVersionOf, nextVersions, saleUnitsOf, warrantyAskedOf, type QuoteProduct, type StoredVersion, type VersionLine } from "@/lib/procurement/offer-versions"
import { VAT, dayNum, r2, type DealLogic } from "./deal-logic"
import type { Deal, DealItem } from "./types"

export { legacyVersionOf, nextVersions, type StoredVersion }

export type QuoteMode = "new" | "edit" | "reduce" | "reval"

export interface QuoteValues {
  /** Unit price typed per item id (`i1`…). */
  prices: Record<string, string>
  /** Items the supplier does not supply. */
  skip: Record<string, boolean>
  total: string
  arrive: string
  valid: string
  note: string
  /** The sale unit priced per item id, as its length in request units (`"6"`); absent or empty = priced per request unit. */
  packs?: Record<string, string>
  /** The warranty he offers per item id, in months (`"24"`); `"0"` = «بلا ضمان»; empty = not chosen yet. */
  warranty?: Record<string, string>
  /** «للطلب كاملاً فقط»: he sells it all or nothing. */
  whole?: boolean
}

export type QuoteBlock = "total" | "zero" | "unmarked" | "oneItem" | "deadline" | "valid" | "big" | "warranty" | "pack" | "arrive"

export interface QuoteCheck {
  blocks: { code: QuoteBlock; item?: string }[]
  net: number
  vat: number
  gross: number
  /** Net per item id, for the live line totals. */
  lines: Record<string, number | null>
  /** The pieces behind a line priced by the sale unit: «30 قطعة = 180 م». */
  packs: Record<string, PackInfo | null>
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
  const packs: Record<string, PackInfo | null> = {}
  let net = 0
  if (deal.pricing === "total") {
    const t = toAmount(v.total)
    net = t
    if (!(t > 0)) blocks.push({ code: "total" })
    else if (t > MAX_UNIT_PRICE) blocks.push({ code: "big" })
  } else {
    let priced = 0
    const unmarked: string[] = []
    for (const i of deal.items) {
      packs[i.id] = null
      if (v.skip[i.id]) {
        lines[i.id] = null
        continue
      }
      const raw = String(v.prices[i.id] ?? "").trim()
      const p = toAmount(raw)
      if (raw === "") {
        lines[i.id] = null
        unmarked.push(i.name)
        continue
      }
      if (p <= 0) {
        blocks.push({ code: "zero", item: i.name })
        lines[i.id] = null
        continue
      }
      if (p > MAX_UNIT_PRICE) {
        blocks.push({ code: "big", item: i.name })
        lines[i.id] = null
        continue
      }
      priced += 1
      const packRaw = String(v.packs?.[i.id] ?? "").trim()
      if (packRaw !== "" && toAmount(packRaw) > 0 && packLenOf(i, v) == null) blocks.push({ code: "pack", item: i.name })
      const calc = lineCalc(i.qty, p, packLenOf(i, v))
      packs[i.id] = calc.pack
      lines[i.id] = r2(calc.totalH / 100)
      net += calc.totalH / 100
      const months = String(v.warranty?.[i.id] ?? "").trim()
      const stated = months === "" ? !i.warranty : Number.isInteger(Number(months)) && Number(months) >= 0 && Number(months) <= 120
      if (!stated) blocks.push({ code: "warranty", item: i.name })
    }
    // An item is priced or marked «not supplied» (PUR-03): a blank one is a forgotten field, named so he can fix it.
    if (!priced) blocks.push({ code: "oneItem" })
    else for (const name of unmarked) blocks.push({ code: "unmarked", item: name })
  }
  // A reply to a price cut runs on its own clock (reply-by), never on the expired submission deadline; so does the answer
  // to «confirm your price», which only asks for a new validity.
  if (mode !== "reduce" && mode !== "reval" && deal.deadline && L.daysTo(deal.deadline) < 0) blocks.push({ code: "deadline" })
  if (!v.valid) blocks.push({ code: "valid" })
  if (v.arrive && L.daysTo(v.arrive) > 365) blocks.push({ code: "arrive" })
  net = r2(net)
  return { blocks, net, vat: r2(net * vatRate), gross: r2(net * (1 + vatRate)), lines, packs }
}

/** The sale unit chosen for an item, if it is one the request offers. */
export function packLenOf(item: DealItem, v: Pick<QuoteValues, "packs">): number | undefined {
  const len = toAmount(v.packs?.[item.id])
  return len > 0 && (item.packs || []).some((p) => p.len === len) ? len : undefined
}

/** The stored version a form becomes (`n` is set by `nextVersions`). Totals go through offer-calc, so a line priced by the
 * sale unit is pieces × price; the server runs this again and never believes the browser's figures. */
export function versionOf(deal: QuoteShape, v: QuoteValues, today: string, fileUrl?: string | null, vatRate?: number): StoredVersion {
  const out: StoredVersion = { n: 1, at: today, arrive: v.arrive || null, valid: v.valid, note: v.note.trim().slice(0, 1000), fileUrl: fileUrl || null, total: 0 }
  if (vatRate != null) out.vatRate = vatRate
  if (v.whole) out.whole = true
  if (deal.pricing === "total") out.total = r2(toAmount(v.total))
  else {
    const lines: VersionLine[] = []
    let totalH = 0
    deal.items.forEach((i, n) => {
      const rate = r2(toAmount(v.prices[i.id]))
      if (v.skip[i.id] || !(rate > 0)) return
      const pack = packLenOf(i, v)
      const calc = lineCalc(i.qty, rate, pack)
      totalH += calc.totalH
      const unit = pack != null ? (i.packs || []).find((p) => p.len === pack) : undefined
      const months = String(v.warranty?.[i.id] ?? "").trim()
      lines.push({
        rfqProductIndex: n,
        unitPrice: rate,
        ...(pack != null ? { packLen: pack, ...(unit?.name ? { packKey: unit.name } : {}) } : {}),
        ...(months !== "" && Number.isInteger(Number(months)) ? { warrantyMonths: Number(months) } : {}),
      })
    })
    out.lines = lines
    out.total = r2(totalH / 100)
  }
  return out
}

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))
const day = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "")

/** The day a cut must be answered by: the contractor's own date, else three days from when it was asked. */
export function replyByOf(offer: Rec): string {
  return bafoReplyBy(offer as Parameters<typeof bafoReplyBy>[0])
}

/** The request's items as the supplier prices them (`i1`, `i2`…). */
export function rfqItems(rfq: Rec): DealItem[] {
  const products = Array.isArray(rfq.products) ? (rfq.products as Rec[]) : []
  const numOf = (v: unknown) => {
    const n = Number(String(v ?? "").replace(/[,\s]/g, ""))
    return Number.isFinite(n) ? n : 0
  }
  return products.map((p, i) => {
    const packs = saleUnitsOf(p as QuoteProduct).map((u) => ({ len: u.lengthM, name: u.name }))
    const warranty = warrantyAskedOf(p as QuoteProduct)
    return {
      id: `i${i + 1}`,
      name: str(p.name).trim() || str(p.description).trim(),
      unit: str(p.unitOfMeasure || p.unit),
      qty: numOf(p.quantity),
      spec: str(p.description) !== str(p.name) ? str(p.description) : "",
      ...(packs.length ? { packs } : {}),
      ...(warranty != null ? { warranty } : {}),
    }
  })
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
  // Every city it delivers to (an RFQ in several places, PUR-03), else its one city; none = nationwide.
  const cities = Array.isArray(rfq.cities) && rfq.cities.length ? (rfq.cities as unknown[]).map(str).filter(Boolean) : [str(rfq.city)].filter(Boolean)
  return !cities.length || cities.some((c) => field.cities.includes(c))
}

/** Whether an invitation names him (only an invitation can be declined). */
export const namesSupplier = (rfq: Rec, orgId: string): boolean => [rfq.allowedSupplierOrgIds, rfq.invitedSupplierOrgIds].some((l) => Array.isArray(l) && (l as string[]).includes(orgId))

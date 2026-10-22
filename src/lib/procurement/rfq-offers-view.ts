// What the RFQ page's offers tab shows (Procurement 2.0 RFQ-02/04/05/06, CMP-04, G-03): every offer as ONE row built from
// the same evaluation the comparison and the award read (`offer-calc.ts`), so the lowest complete offer is one number on the
// header, the best-of card, row #1 and the card in the list. Filters, sort and counts follow the prototype's `rdOffers`.
// Pure: no I/O, no clock but the `today` passed in.

import { OFFER_ORDER_DECLINED, isWithdrawnOffer } from "./award"
import { evaluateOffers, fromHalalas, type CalcOffer, type Evaluation, type LineEval, type MixEval, type OfferEval, type PricedRfq, type ValidityState, toAmount } from "./offer-calc"
import { exclusionOf, isShortlisted, bafoOf, type DecidableOffer, type DecisionExclusion, type DecisionMap } from "./offer-decisions"
import { offerTags, termsDiffer, type OfferTag, type LabelOffer } from "./offer-labels"
import { currentVersionOf, leadDaysFrom, offerRev, warrantyAskedOf, type QuoteProduct } from "./offer-versions"

type Rec = Record<string, unknown>

export interface RowOffer extends LabelOffer {
  id: string
  rfqId?: string | null
  supplierId?: string | null
  organizationId?: string | null
  supplierOrgId?: string | null
  companyName?: string | null
  supplierName?: string | null
  isGuestOffer?: boolean | null
  isFromMdmak?: boolean | null
  isManualOffer?: boolean | null
  directAward?: boolean | null
  guestContact?: { name?: string | null; phone?: string | null; email?: string | null; vatNumber?: string | null; phoneVerified?: boolean | null } | null
  lines?: Array<{ rfqProductIndex?: number | null; unitPrice?: number | string | null; packLen?: number | string | null; warrantyMonths?: number | null }> | null
  skippedItems?: Array<number | null> | null
  lump?: number | string | null
  price?: unknown
  totalBatchesPrice?: unknown
  vatRate?: number | string | null
  leadDays?: number | string | null
  executionDuration?: string | number | null
  executionDurationUnit?: string | null
  offerPdfUrl?: string | null
  poId?: string | null
  paymentTerms?: string | null
  priceHistory?: Array<{ price?: string | number | null; replacedAt?: string | null }> | null
  createdAt?: unknown
}

export type OfferOrigin = "platform" | "guest" | "mdmak" | "manual"

export function originOf(o: RowOffer): OfferOrigin {
  if (o.isGuestOffer || o.supplierId === "guest") return "guest"
  if (o.isFromMdmak) return "mdmak"
  if (o.isManualOffer) return "manual"
  return "platform"
}

const asIso = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date; seconds?: number }
  if (typeof ts.toDate === "function") return ts.toDate().toISOString()
  if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000).toISOString()
  return null
}
export const submittedIso = (o: RowOffer): string | null => asIso(o.createdAt)

/** How long he takes: the version's days, else the duration he typed with its unit. */
export function leadDaysOfOffer(o: Pick<RowOffer, "leadDays" | "executionDuration" | "executionDurationUnit">): number | null {
  const stored = Number(o.leadDays)
  if (o.leadDays !== null && o.leadDays !== undefined && String(o.leadDays).trim() !== "" && Number.isFinite(stored) && stored >= 0) return stored
  const n = leadDaysFrom(o.executionDuration, o.executionDurationUnit)
  return n
}

export function supplierNameOfOffer(o: Pick<RowOffer, "companyName" | "supplierName" | "guestContact">): string {
  return (o.companyName || o.supplierName || o.guestContact?.name || "").trim()
}

/** The offer as the calculation core reads it. `excluded` takes the buyer's exclusion, a withdrawn quote and a declined order out of the running. */
export function calcOfferOf(o: RowOffer, excluded: boolean): CalcOffer {
  return {
    id: o.id,
    lines: o.lines || null,
    skippedItems: o.skippedItems || null,
    lump: o.lump ?? null,
    price: o.price,
    totalBatchesPrice: o.totalBatchesPrice,
    vatRegistered: o.vatRegistered ?? null,
    vatRate: o.vatRate ?? null,
    excluded,
    leadDays: leadDaysOfOffer(o),
    validUntil: o.validUntil ?? null,
  }
}

export interface OfferRowModel {
  id: string
  offer: RowOffer
  ev: OfferEval
  name: string
  origin: OfferOrigin
  excluded: boolean
  exclusion: DecisionExclusion | null
  withdrawn: boolean
  declined: boolean
  shortlisted: boolean
  awarded: boolean
  rev: number
  tags: OfferTag[]
  netH: number | null
  grossH: number | null
  /** His total before the price cut he made when we asked for a better one, incl. VAT — shown struck. */
  previousGrossH: number | null
  coverage: { covered: number; of: number; partial: boolean }
  leadDays: number | null
  validity: ValidityState
  validUntil: string | null
  submittedAt: string | null
  officialQuote: boolean
  differsTerms: boolean
  rating: number | null
  /** For the 50-offer list: the row's rank among complete live offers, or null. */
  rank: number | null
}

export interface RowsInput {
  rfq: (PricedRfq & { paymentTermsList?: unknown }) | null | undefined
  offers: RowOffer[]
  decisions: DecisionMap
  today: string
  tiePercent?: number
  ratingOf?: (o: RowOffer) => number | null
}

export interface OfferRows {
  rows: OfferRowModel[]
  ev: Evaluation
}

const grossOf = (netH: number, rate: number): number => Math.round(netH * (1 + rate) + 1e-6)

/** The offer's total before the cut it made in answer to a better-price request, from the stored versions. */
function previousNetH(o: RowOffer): number | null {
  const bafo = bafoOf(o as DecidableOffer)
  if (bafo.answered?.kind !== "lowered") return null
  const versions = Array.isArray(o.versions) ? (o.versions as unknown as Array<{ total?: number }>) : []
  if (versions.length < 2) return null
  const before = Number(versions[versions.length - 2]?.total)
  return Number.isFinite(before) && before > 0 ? Math.round(before * 100) : null
}

export function buildOfferRows(input: RowsInput): OfferRows {
  const { rfq, offers, decisions, today } = input
  const flags = offers.map((o) => {
    const exclusion = exclusionOf(o as DecidableOffer, decisions[o.id])
    const withdrawn = isWithdrawnOffer(o)
    const declined = o.status === OFFER_ORDER_DECLINED
    return { exclusion, withdrawn, declined, out: Boolean(exclusion) || withdrawn || declined }
  })
  const ev = evaluateOffers(rfq, offers.map((o, i) => calcOfferOf(o, flags[i].out)), { tiePercent: input.tiePercent, today })
  const rows = offers.map((o, i): OfferRowModel => {
    const e = ev.byId[o.id]
    const f = flags[i]
    const prevNet = previousNetH(o)
    const previousGrossH = prevNet != null ? grossOf(prevNet, e.vatRate) : null
    return {
      id: o.id,
      offer: o,
      ev: e,
      name: supplierNameOfOffer(o),
      origin: originOf(o),
      excluded: Boolean(f.exclusion),
      exclusion: f.exclusion,
      withdrawn: f.withdrawn,
      declined: f.declined,
      shortlisted: isShortlisted(decisions[o.id]),
      awarded: Boolean(o.poId) || o.status === "مقبول",
      rev: offerRev(o as unknown as Rec),
      tags: offerTags({ offer: o, decision: decisions[o.id], rfq, today }),
      netH: e.netH,
      grossH: e.grossH,
      previousGrossH,
      coverage: { covered: e.covered, of: e.of, partial: e.partial },
      leadDays: e.leadDays,
      validity: e.validity,
      validUntil: e.validUntil,
      submittedAt: submittedIso(o),
      officialQuote: Boolean(o.offerPdfUrl),
      differsTerms: termsDiffer(o, rfq),
      rating: input.ratingOf ? input.ratingOf(o) : null,
      rank: e.rank,
    }
  })
  return { rows, ev }
}

// ---------------------------------------------------------------------------
// Filters, sort, counts
// ---------------------------------------------------------------------------

export const OFFER_FILTERS = ["all", "complete", "partial", "shortlist", "terms_ok", "offplatform", "excluded"] as const
export type OfferFilter = (typeof OFFER_FILTERS)[number]

export const OFFER_SORTS = ["price", "fastest", "latest", "rating"] as const
export type OfferSort = (typeof OFFER_SORTS)[number]

const live = (r: OfferRowModel) => !r.excluded && !r.withdrawn && !r.declined

export function matchesFilter(r: OfferRowModel, f: OfferFilter): boolean {
  switch (f) {
    case "all":
      return true
    case "complete":
      return live(r) && r.ev.complete
    case "partial":
      return live(r) && r.ev.partial
    case "shortlist":
      return r.shortlisted
    case "terms_ok":
      return live(r) && !r.differsTerms
    case "offplatform":
      return r.origin === "guest"
    case "excluded":
      return r.excluded
  }
}

/** A filter with no offer behind it is not shown, except «الكل». */
export function filterCounts(rows: OfferRowModel[]): Record<OfferFilter, number> {
  return Object.fromEntries(OFFER_FILTERS.map((f) => [f, rows.filter((r) => matchesFilter(r, f)).length])) as Record<OfferFilter, number>
}

export const visibleFilters = (counts: Record<OfferFilter, number>, current: OfferFilter): OfferFilter[] => OFFER_FILTERS.filter((f) => f === "all" || f === current || counts[f] > 0)

const INF = Number.POSITIVE_INFINITY

export function sortRows(rows: OfferRowModel[], sort: OfferSort): OfferRowModel[] {
  const key = (r: OfferRowModel): number[] => {
    const out = Number(!live(r))
    switch (sort) {
      case "price":
        return [out, r.ev.complete ? 0 : 1, r.netH ?? INF]
      case "fastest":
        return [out, r.leadDays ?? INF, r.netH ?? INF]
      case "latest":
        return [out, -(r.submittedAt ? Date.parse(r.submittedAt) || 0 : 0)]
      case "rating":
        return [out, -(r.rating ?? -1), r.netH ?? INF]
    }
  }
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => {
      for (let n = 0; n < Math.max(a.k.length, b.k.length); n++) {
        const x = a.k[n] ?? 0
        const y = b.k[n] ?? 0
        if (x !== y) return x < y ? -1 : 1
      }
      return a.i - b.i
    })
    .map((x) => x.r)
}

// ---------------------------------------------------------------------------
// «أفضل ما وصل»
// ---------------------------------------------------------------------------

export interface SplitCard {
  mix: MixEval
  orders: number
  shipments: number
  /** A supplier in the mix we have no record with. */
  newSupplier: boolean
}

export interface BestCards {
  lowest: OfferRowModel | null
  fastest: { row: OfferRowModel; partial: boolean } | null
  split: SplitCard | null
  competition: { live: number; limit: number; line: LineEval } | null
  /** Every offer is excluded or none came: the page shows the two exits. */
  noLive: boolean
}

export interface BestInput {
  rows: OfferRowModel[]
  ev: Evaluation
  rfq: (PricedRfq & { products?: Array<{ deliverySiteId?: string | null }> | null; shipmentMode?: string | null }) | null | undefined
  limit: number
  /** The supplier's org id for an offer, or null for a guest — to tell whether we have a record with him. */
  hasRecord: (r: OfferRowModel) => boolean
}

export function bestCards(input: BestInput): BestCards {
  const { rows, ev } = input
  const byId = new Map(rows.map((r) => [r.id, r]))
  const lowest = ev.lowestComplete ? byId.get(ev.lowestComplete.id) || null : null
  const fastestEv = ev.fastest
  const fastest = fastestEv && fastestEv.leadDays != null ? { row: byId.get(fastestEv.id) as OfferRowModel, partial: !fastestEv.complete } : null

  let split: SplitCard | null = null
  const products = input.rfq?.products || []
  const lump = rows.some((r) => r.ev.kind === "lump")
  if (ev.mix && products.length >= 2 && !lump) {
    const mix = ev.mix
    const groups = new Set<string>()
    for (const l of ev.lines) {
      const site = (products[l.rfqProductIndex] as { deliverySiteId?: string | null } | undefined)?.deliverySiteId || ""
      groups.add(`${l.bestOfferId}|${site}`)
    }
    split = { mix, orders: groups.size, shipments: groups.size, newSupplier: mix.offerIds.some((id) => { const r = byId.get(id); return r ? !input.hasRecord(r) : false }) }
  }

  const thin = ev.thinnest
  const competition = thin && ev.hasLive && thin.liveCount < input.limit ? { live: thin.liveCount, limit: input.limit, line: thin } : null
  return { lowest, fastest, split, competition, noLive: !ev.hasLive }
}

// ---------------------------------------------------------------------------
// The panel's lines and a few numbers the header and the card share
// ---------------------------------------------------------------------------

export const money = (h: number | null | undefined): number | null => (h == null ? null : fromHalalas(h))

/** Days since he sent it, whole, from two ISO strings. */
export function daysAgo(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 86400000)
  return Number.isFinite(d) ? Math.max(0, d) : null
}

/** The previous price the supplier stood at, for the old `priceHistory` offers (the legacy cut). */
export function legacyPreviousPrice(o: RowOffer): number | null {
  const first = (o.priceHistory || []).slice().sort((a, b) => (a.replacedAt || "").localeCompare(b.replacedAt || ""))[0]
  const n = first ? toAmount(first.price) : 0
  return n > 0 ? n : null
}

/** The version the offer stands at, with its note — what the panel prints under «الشروط». */
export const currentNote = (o: RowOffer): string => {
  const v = currentVersionOf(o as unknown as Rec)
  return (v?.note || "").trim()
}

/** The warranty he states on his lines (the shortest of them) against what the request asks; null when he states none. */
export function warrantyOf(o: RowOffer, rfq: { products?: QuoteProduct[] | null } | null | undefined): { months: number; short: boolean } | null {
  const stated = (o.lines || []).filter((l) => l.warrantyMonths !== null && l.warrantyMonths !== undefined && Number.isFinite(Number(l.warrantyMonths)))
  if (!stated.length) return null
  const months = Math.min(...stated.map((l) => Number(l.warrantyMonths)))
  const asked = stated.map((l) => warrantyAskedOf(rfq?.products?.[Number(l.rfqProductIndex)])).filter((m): m is number => m != null)
  return { months, short: asked.length > 0 && months < Math.max(...asked) }
}

/** Whether any line is priced per sale unit («بالقطعة»). */
export const pricedByPiece = (o: RowOffer): boolean => (o.lines || []).some((l) => toAmount(l.packLen) > 0)

// ---------------------------------------------------------------------------
// «ما جرى» — the offer's own story, oldest first
// ---------------------------------------------------------------------------

export type HistoryKind = "submitted" | "submitted_link" | "updated" | "bafo_asked" | "bafo_lowered" | "bafo_kept" | "reval_asked" | "reval_answered" | "shortlisted" | "unshortlisted" | "excluded" | "restored" | "clarify" | "awarded"

export interface HistoryEntry {
  at: string
  kind: HistoryKind
  by?: string
  params?: Record<string, string | number>
}

export function offerHistory(row: OfferRowModel, log: Array<{ kind: string; at: string; byName?: string; meta?: Record<string, string | number | null> }> | null | undefined): HistoryEntry[] {
  const o = row.offer
  const out: HistoryEntry[] = []
  const versions = Array.isArray(o.versions) ? (o.versions as unknown as Array<{ n?: number; at?: string; total?: number; reval?: boolean; bafoReply?: string }>) : []
  const guest = row.origin === "guest"
  const created = submittedIso(o)
  if (created) out.push({ at: created, kind: guest ? "submitted_link" : "submitted" })
  versions.forEach((v, i) => {
    if (i === 0 || !v.at) return
    const at = v.at.length === 10 ? `${v.at}T12:00:00.000Z` : v.at
    if (v.reval) out.push({ at, kind: "reval_answered", params: { n: v.n ?? i + 1 } })
    else if (v.bafoReply === "lowered") out.push({ at, kind: "bafo_lowered", params: { n: v.n ?? i + 1, from: Number(versions[i - 1]?.total) || 0 } })
    else if (v.bafoReply === "kept") out.push({ at, kind: "bafo_kept", params: { n: v.n ?? i + 1 } })
    else out.push({ at, kind: "updated", params: { n: v.n ?? i + 1 } })
  })
  const bafo = bafoOf(o as DecidableOffer)
  if (bafo.asked && bafo.at) out.push({ at: bafo.at, kind: "bafo_asked", params: { date: bafo.replyBy || "" } })
  const reval = (o as { reval?: { at?: string } }).reval
  if (reval?.at) out.push({ at: reval.at, kind: "reval_asked" })
  for (const e of log || []) {
    if (e.kind === "shortlist") out.push({ at: e.at, kind: "shortlisted", by: e.byName })
    else if (e.kind === "unshortlist") out.push({ at: e.at, kind: "unshortlisted", by: e.byName })
    else if (e.kind === "exclude") out.push({ at: e.at, kind: "excluded", by: e.byName, params: { reason: String(e.meta?.code ?? "") } })
    else if (e.kind === "restore") out.push({ at: e.at, kind: "restored", by: e.byName })
    else if (e.kind === "clarify") out.push({ at: e.at, kind: "clarify", by: e.byName })
  }
  if (row.awarded) out.push({ at: String((o as { awardedAt?: string }).awardedAt || (o as { decidedAt?: string }).decidedAt || created || ""), kind: "awarded" })
  return out.filter((e) => e.at).sort((a, b) => a.at.localeCompare(b.at))
}

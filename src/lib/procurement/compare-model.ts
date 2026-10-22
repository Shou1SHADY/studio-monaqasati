// The comparison tab, as numbers (Procurement 2.0 CMP-01…05, 14, 15, RFQ-09): which offers sit where, what each cell says, which cells
// carry the ★, the fact rows, «آخر شراء» by specification and the strip of the lowest per material. Everything money is read from
// `offer-calc` (G-02/G-03), so the grid, the list, the panel and the review say one figure. Pure: no I/O.

import { isTie, lineOf, type Evaluation, type OfferEval, type OfferLineCalc, type ValidityState } from "./offer-calc"
import { evaluatePlanOffers, cellPickable, offerIsOut, offerLeadDays, planSupplier, type AwardPicks, type PlanContext, type PlanOffer, type PlanRfq } from "./award-plan"
import { isShortlisted } from "./offer-decisions"
import { termsDiffer } from "./offer-labels"
import { offerRev } from "./offer-versions"
import { lastPaidFor, specKeyOf, type PriceHistoryEntry } from "./prices"
import { pricedProducts } from "./offer-calc"

type Rec = Record<string, unknown>

export const AUTO_COLUMNS_MAX = 5

export interface Experience {
  /** Orders of ours he accepted. */
  orders: number
  onTimePercent: number | null
  rejectPercent: number | null
}

export interface CompareOptions {
  /** Which way the grid is turned: `auto` = suppliers as columns up to five offers, rows beyond. */
  layout?: "auto" | "columns" | "rows"
  hideExcluded?: boolean
  shortlistOnly?: boolean
  termsOnly?: boolean
  /** Sort the suppliers by this material's effective price (CMP-15). */
  sortLine?: number | null
}

export interface CompareInput {
  rfq: PlanRfq
  offers: PlanOffer[]
  ctx: Pick<PlanContext, "today" | "policies" | "decisions" | "locked" | "liveOfferIds">
  picks: AwardPicks
  history: PriceHistoryEntry[]
  experienceOf: (offer: PlanOffer) => Experience | null
  verifiedOf: (offer: PlanOffer) => boolean
  opts?: CompareOptions
}

export interface CompareFacts {
  grossH: number | null
  netH: number | null
  vatRate: number
  deltaPct: number | null
  /** Priced some of the materials only: `covered` of `of`. */
  partial: { covered: number; of: number } | null
  leadDays: number | null
  advancePercent: number | null
  creditDays: number | null
  paymentText: string | null
  differsTerms: boolean
  validUntil: string | null
  validity: ValidityState
  hasQuote: boolean
  experience: Experience | null
  isNewToUs: boolean
  rank: number | null
  isLowestComplete: boolean
  whole: boolean
  lump: boolean
  guest: boolean
  unregistered: boolean
}

export interface CompareColumn {
  offer: PlanOffer
  calc: OfferEval
  name: string
  rev: number
  excluded: boolean
  shortlisted: boolean
  taken: boolean
  facts: CompareFacts
}

export type CellState = "price" | "none" | "lump"

export interface CompareCell {
  offerId: string
  state: CellState
  /** The big number: the effective price per request unit, halalas. */
  effH: number | null
  /** The quoted rate (per request unit or per piece), halalas. */
  rateH: number | null
  totalH: number | null
  pack: OfferLineCalc["pack"]
  packName: string | null
  /** A price per piece or a total divided into the request unit — the line is told «لكل X فعلياً». */
  effective: boolean
  star: boolean
  picked: boolean
  pickable: ReturnType<typeof cellPickable>
  warrantyMonths: number | null
  /** The line already sits in a live order: its number. */
  lockedBy: string | null
}

export interface CompareRow {
  li: number
  name: string
  unit: string
  qty: number
  needBy: string | null
  lastBuy: PriceHistoryEntry | null
  cells: Record<string, CompareCell>
  liveCount: number
}

export interface StripEntry {
  li: number
  name: string
  unit: string
  lowestOfferId: string | null
  lowestEffH: number | null
  liveCount: number
  /** The lowest among the verified who attached an official quote, when that is not the lowest overall. */
  safe: { offerId: string; effH: number; moreH: number } | null
  lowestIsSafe: boolean
}

export interface CompareModel {
  ev: Evaluation
  layout: "columns" | "rows"
  columns: CompareColumn[]
  rows: CompareRow[]
  strip: StripEntry[]
  /** Every offer is a lump sum: no line prices, the lowest is the lowest total. */
  lumpOnly: boolean
  hasPieces: boolean
  hiddenExcluded: number
  shortlistCount: number
  lowestCompleteId: string | null
}

const nameOf = (o: PlanOffer): string => (o.companyName || o.supplierName || o.guestContact?.name || "").trim()

export function buildCompareModel(input: CompareInput): CompareModel {
  const { rfq, offers, ctx, picks, history } = input
  const opts = input.opts || {}
  const ev = evaluatePlanOffers(rfq, offers, ctx.decisions, ctx)
  const products = pricedProducts(rfq)
  const rawProducts = rfq.products || []

  const base = offers.map((offer): CompareColumn => {
    const calc = ev.byId[offer.id]
    const decision = ctx.decisions[offer.id]
    const sup = planSupplier(offer)
    const experience = input.experienceOf(offer)
    const terms = termsText(offer)
    return {
      offer,
      calc,
      name: nameOf(offer),
      rev: offerRev(offer as unknown as Rec),
      excluded: offerIsOut(offer, decision),
      shortlisted: isShortlisted(decision),
      taken: ctx.liveOfferIds.has(offer.id),
      facts: {
        grossH: calc.grossH,
        netH: calc.netH,
        vatRate: calc.vatRate,
        deltaPct: calc.deltaPct,
        partial: calc.partial ? { covered: calc.covered, of: calc.of } : null,
        leadDays: offerLeadDays(offer),
        advancePercent: Number(offer.advancePercent) > 0 ? Number(offer.advancePercent) : null,
        creditDays: Number(offer.creditDays) > 0 ? Number(offer.creditDays) : null,
        paymentText: terms,
        differsTerms: termsDiffer(offer, rfq),
        validUntil: calc.validUntil,
        validity: calc.validity,
        hasQuote: Boolean((offer.offerPdfUrl || "").trim()),
        experience,
        isNewToUs: !sup.isGuestSupplier ? !experience || experience.orders === 0 : true,
        rank: calc.rank,
        isLowestComplete: calc.isLowestComplete,
        whole: Boolean(offer.whole),
        lump: calc.kind === "lump",
        guest: sup.isGuestSupplier,
        unregistered: offer.vatRegistered === false,
      },
    }
  })

  const hiddenExcluded = opts.hideExcluded ? base.filter((c) => c.excluded).length : 0
  let columns = base.filter((c) => !(opts.hideExcluded && c.excluded) && !(opts.shortlistOnly && !c.shortlisted) && !(opts.termsOnly && c.facts.differsTerms))
  const cellEff = (c: CompareColumn, li: number): number | null => lineOf(c.calc, li)?.effH ?? null
  if (opts.sortLine != null) {
    const li = opts.sortLine
    columns = columns.slice().sort((a, b) => (cellEff(a, li) ?? Infinity) - (cellEff(b, li) ?? Infinity) || a.rev - b.rev)
  } else {
    columns = columns.slice().sort((a, b) => Number(b.excluded === false) - Number(a.excluded === false) || (a.facts.rank ?? Infinity) - (b.facts.rank ?? Infinity))
  }
  const layout = opts.layout && opts.layout !== "auto" ? opts.layout : columns.length > AUTO_COLUMNS_MAX ? "rows" : "columns"

  const rows: CompareRow[] = products.map((p) => {
    const raw = rawProducts[p.rfqProductIndex]
    const { specKey } = specKeyOf(raw)
    const le = ev.lines.find((l) => l.rfqProductIndex === p.rfqProductIndex)
    const cells: Record<string, CompareCell> = {}
    for (const c of columns) {
      const lc = c.calc.kind === "lump" ? null : lineOf(c.calc, p.rfqProductIndex)
      const pickedBy = picks[p.rfqProductIndex]
      const pickable = cellPickable(ev, c.offer.id, p.rfqProductIndex, ctx)
      const warranty = (c.offer.lines || []).find((l) => Number(l.rfqProductIndex) === p.rfqProductIndex)?.warrantyMonths
      cells[c.offer.id] = {
        offerId: c.offer.id,
        state: c.calc.kind === "lump" ? "lump" : lc ? "price" : "none",
        effH: lc ? lc.effH : null,
        rateH: lc ? lc.rateH : null,
        totalH: lc ? lc.totalH : null,
        pack: lc?.pack ?? null,
        packName: lc?.pack ? (c.offer.lines || []).find((l) => Number(l.rfqProductIndex) === p.rfqProductIndex)?.packKey || null : null,
        effective: Boolean(lc && (lc.pack || !lc.quoted)),
        star: c.calc.kind === "lump" ? c.calc.isLowestComplete && !c.excluded : Boolean(le?.lowestIds.includes(c.offer.id)) && !c.excluded,
        picked: Boolean(pickedBy && pickedBy.offerId === c.offer.id),
        pickable,
        warrantyMonths: warranty == null ? null : Number(warranty),
        lockedBy: ctx.locked[p.rfqProductIndex]?.poNumber || null,
      }
    }
    return {
      li: p.rfqProductIndex,
      name: p.name,
      unit: p.unit,
      qty: p.quantity,
      needBy: (raw?.needBy || rfq.needBy || null) as string | null,
      lastBuy: lastPaidFor(history, { specKey, name: p.name, unit: p.unit }),
      cells,
      liveCount: le?.liveCount ?? 0,
    }
  })

  // CMP-14: the lowest per material, and the next verified supplier with an official quote when the lowest is not one.
  const strip: StripEntry[] = products.map((p) => {
    const le = ev.lines.find((l) => l.rfqProductIndex === p.rfqProductIndex)
    const live = ev.offers.filter((o) => o.live && lineOf(o, p.rfqProductIndex))
    const safeList = live
      .filter((o) => {
        const offer = offers.find((x) => x.id === o.id) as PlanOffer
        return input.verifiedOf(offer) && Boolean((offer.offerPdfUrl || "").trim()) && !o.expired
      })
      .sort((a, b) => (lineOf(a, p.rfqProductIndex)?.totalH ?? Infinity) - (lineOf(b, p.rfqProductIndex)?.totalH ?? Infinity))
    const lowestId = le?.bestOfferId ?? null
    const lowestLine = lowestId ? lineOf(ev.byId[lowestId], p.rfqProductIndex) : null
    const lowestIsSafe = Boolean(lowestId && safeList.some((o) => o.id === lowestId || (le?.lowestIds || []).includes(o.id)))
    const next = !lowestIsSafe ? safeList[0] : null
    const nextLine = next ? lineOf(next, p.rfqProductIndex) : null
    return {
      li: p.rfqProductIndex,
      name: p.name,
      unit: p.unit,
      lowestOfferId: lowestId,
      lowestEffH: lowestLine?.effH ?? null,
      liveCount: le?.liveCount ?? 0,
      safe: next && nextLine && lowestLine ? { offerId: next.id, effH: nextLine.effH, moreH: Math.max(0, nextLine.totalH - lowestLine.totalH) } : null,
      lowestIsSafe,
    }
  })

  return {
    ev,
    layout,
    columns,
    rows,
    strip,
    lumpOnly: columns.length > 0 && columns.every((c) => c.calc.kind === "lump"),
    hasPieces: rows.some((r) => Object.values(r.cells).some((c) => c.pack)),
    hiddenExcluded,
    shortlistCount: base.filter((c) => c.shortlisted).length,
    lowestCompleteId: ev.lowestComplete?.id ?? null,
  }
}

function termsText(o: PlanOffer): string | null {
  const adv = Number(o.advancePercent)
  const credit = Number(o.creditDays)
  if (Number.isFinite(adv) && adv > 0 && adv < 100) return `${adv}% / ${Number.isFinite(credit) && credit > 0 ? credit : 0}`
  if (Number.isFinite(credit) && credit > 0) return `${credit}`
  return (o.paymentTerms || "").trim() || null
}

/** «اختر الأقل لكل بند» for the picks the grid shows: ties pick the earlier offer. Suppliers hidden by the filters are not picked. */
export function lowestPicksOfModel(model: CompareModel, offersById: ReadonlyMap<string, PlanOffer>, opts: { safeOnly?: (offer: PlanOffer) => boolean } = {}): AwardPicks {
  const out: AwardPicks = {}
  for (const r of model.rows) {
    let best: { id: string; h: number } | null = null
    for (const c of model.columns) {
      const cell = r.cells[c.offer.id]
      const offer = offersById.get(c.offer.id)
      if (!cell || cell.state !== "price" || !cell.pickable.ok || !offer || (opts.safeOnly && !opts.safeOnly(offer))) continue
      const h = cell.totalH as number
      if (!best || h < best.h) best = { id: c.offer.id, h }
    }
    if (best) out[r.li] = { offerId: best.id, rev: model.columns.find((c) => c.offer.id === best?.id)?.rev ?? 1 }
  }
  return out
}

export { isTie }

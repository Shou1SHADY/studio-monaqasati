// The award, planned (Procurement 2.0 CMP-06…12, 16…19, WF-12/13, G-04/05/14/16/18). ONE pure function that the review dialog shows
// live and the server route runs again as the authority: it takes the RFQ, its offers, the buyer's decisions about them, the
// selection (each pick pinned to the offer VERSION it was made on), and says
//   · which picks still stand and which dropped out, and why («عُدّل بعد اختيارك»),
//   · the orders it makes — one per supplier × delivery site — with money, pieces, arrival against the need date and the
//     approval class,
//   · which lines are not the lowest and which reasons the NUMBERS back (`AW_OK`), whether the competition was too thin,
//   · what returns to «الواردة», and the first thing that refuses the award (a code the route turns into 409/422).
// The server never reads a price, total or pack from the browser: it re-plans from the stored versions. Pure: no I/O.

import { arrivalEstimate, arrivalVsNeed, awardReasonEligible, awardReasonRefusal, AWARD_WHY_CODES, evaluateOffers, fromHalalas, lineOf, lowCompetition, lowCompetitionReasonRefusal, nonLowestPicks, pricedProducts, toAmount, toHalalas, withVat, type AwardWhyCode, type CalcOffer, type Evaluation, type LowCompetition, type NonLowestLine, type OfferEval, type OfferLineCalc, type PricedRfq, type ReasonFacts } from "./offer-calc"
import { isWithdrawnOffer, OFFER_ORDER_DECLINED } from "./award"
import { isExcluded, type DecisionMap, type DecidableOffer } from "./offer-decisions"
import { offerRev } from "./offer-versions"
import { orderTermsOf } from "./offer-terms"
import { frozenTermsOf } from "./terms-freeze"
import { orderSiteKey } from "./po-state"
import { dayOf } from "./po"
import { specKeyOf } from "./prices"
import { lineSpecOf, type SpecMaterial } from "./po-line-spec"
import { requiredApprover } from "./po"
import { readDeliveryOptions } from "./delivery-options"
import type { ResolvedPolicies } from "./policies"
import type { PoLine, PoSite, PurchaseOrder } from "./types"

type Rec = Record<string, unknown>
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// The shapes the plan reads
// ---------------------------------------------------------------------------

export interface PlanProduct {
  name?: string | null
  quantity?: number | string | null
  unitOfMeasure?: string | null
  unit?: string | null
  needBy?: string | null
  deliverySiteId?: string | null
  deliveryCity?: string | null
  deliveryDistrict?: string | null
  boqItemId?: string | null
  projectId?: string | null
  warrantyMonths?: number | null
  requiresWarranty?: boolean | null
  material?: Parameters<typeof specKeyOf>[0] extends infer S ? (S extends { material?: infer M } ? M : never) : never
  saleUnits?: Array<{ ar?: string; en?: string; lengthM?: number }> | null
  /** The spec words and the tree path the order line copies (PO-01). */
  description?: string | null
  materialPath?: string | null
  category?: string | null
  subCategory?: string | null
}

export interface PlanRfq extends PricedRfq {
  id: string
  title?: string | null
  rfqNumber?: string | null
  status?: string | null
  deadline?: string | null
  needBy?: string | null
  directAward?: boolean | null
  dirOver?: boolean | null
  directWhy?: string | null
  organizationId?: string | null
  contractorId?: string | null
  projectId?: string | null
  projectName?: string | null
  category?: string | null
  city?: string | null
  district?: string | null
  deliverySiteId?: string | null
  deliveryOptions?: unknown
  paymentTermsList?: unknown
  purchaseSource?: PurchaseOrder["purchaseSource"]
  closedEarly?: unknown
  products?: PlanProduct[] | null
}

export interface PlanOffer extends DecidableOffer {
  id: string
  rev?: number | null
  versions?: unknown[] | null
  lines?: Array<{ rfqProductIndex?: number | null; unitPrice?: number | string | null; packLen?: number | string | null; packKey?: string | null; warrantyMonths?: number | null }> | null
  skippedItems?: Array<number | null> | null
  lump?: number | string | null
  price?: unknown
  totalBatchesPrice?: unknown
  vatRegistered?: boolean | null
  vatRate?: number | string | null
  whole?: boolean | null
  leadDays?: number | string | null
  executionDuration?: string | number | null
  executionDurationUnit?: string | null
  validUntil?: string | null
  isGuestOffer?: boolean | null
  supplierId?: string | null
  organizationId?: string | null
  supplierOrgId?: string | null
  companyName?: string | null
  supplierName?: string | null
  guestContact?: { name?: string | null } | null
  offerPdfUrl?: string | null
  advancePercent?: number | string | null
  creditDays?: number | string | null
  priceBasis?: string | null
  paymentTerms?: string | null
  deliveryLocation?: string | null
  deliveryDistrict?: string | null
  directAward?: boolean | null
}

/** A selection made on a version of an offer: the server refuses it if the offer has changed since (G-14). */
export interface PinnedPick {
  li: number
  offerId: string
  rev: number
}

export type AwardPicks = Record<number, { offerId: string; rev: number }>

export const picksFromList = (list: readonly PinnedPick[]): AwardPicks => Object.fromEntries(list.map((p) => [p.li, { offerId: p.offerId, rev: p.rev }]))
export const picksToList = (picks: AwardPicks): PinnedPick[] =>
  Object.entries(picks)
    .map(([li, p]) => ({ li: Number(li), offerId: p.offerId, rev: p.rev }))
    .sort((a, b) => a.li - b.li)

export type PlanPolicies = Pick<ResolvedPolicies, "managerApprovalLimit" | "directPurchaseCap" | "competitionThreshold" | "minOffers" | "tieBandPct" | "supplierAcceptanceDays">

export interface PlanActor {
  uid: string
  isOwner: boolean
  canPrepare: boolean
  canApprove: boolean
}

export interface PlanContext {
  /** `YYYY-MM-DD`, Riyadh. */
  today: string
  policies: PlanPolicies
  /** The buyer's decisions, by offer id. */
  decisions: DecisionMap
  /** Request lines carried by a live order: a locked line is not awarded twice. */
  locked: Record<number, { poId: string; poNumber: string }>
  /** Offers that already carry a live order — shown as «رُسّي عليه»; they may still win the lines no order carries. */
  liveOfferIds: ReadonlySet<string>
  actor: PlanActor
  /** The supplier's on-time rate over our orders, 0–100; null without a record. */
  onTimeOf: (offer: PlanOffer) => number | null
  /** Whether we have received from him before (an accepted order of his): a first-time supplier's advance waits for the owner. */
  hasRecord: (offer: PlanOffer) => boolean
}

// ---------------------------------------------------------------------------
// Offers → numbers
// ---------------------------------------------------------------------------

const UNIT_DAYS: Record<string, number> = { أسابيع: 7, أسبوع: 7, weeks: 7, أشهر: 30, شهر: 30, months: 30 }

export function offerLeadDays(o: Pick<PlanOffer, "leadDays" | "executionDuration" | "executionDurationUnit">): number | null {
  const stored = o.leadDays
  if (stored !== null && stored !== undefined && String(stored).trim() !== "") {
    const n = Number(stored)
    if (Number.isFinite(n) && n >= 0) return n
  }
  const n = parseInt(String(o.executionDuration ?? ""), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n * (UNIT_DAYS[text(o.executionDurationUnit)] ?? 1)
}

/** Out of the comparison and the award: excluded by the buyer (record or legacy status), withdrawn by its supplier, or its order was declined. */
export const offerIsOut = (o: DecidableOffer, decision: DecisionMap[string]): boolean => isExcluded(o, decision) || isWithdrawnOffer(o) || o.status === OFFER_ORDER_DECLINED

export function toCalcOffer(o: PlanOffer, decision: DecisionMap[string]): CalcOffer {
  return {
    id: o.id,
    lines: o.lines,
    skippedItems: o.skippedItems,
    lump: o.lump,
    price: o.price,
    totalBatchesPrice: o.totalBatchesPrice,
    vatRegistered: o.vatRegistered,
    vatRate: o.vatRate,
    excluded: offerIsOut(o, decision),
    leadDays: offerLeadDays(o),
    validUntil: o.validUntil ?? null,
  }
}

export const evaluatePlanOffers = (rfq: PricedRfq | null | undefined, offers: PlanOffer[], decisions: DecisionMap, ctx: Pick<PlanContext, "today" | "policies">): Evaluation =>
  evaluateOffers(rfq, offers.map((o) => toCalcOffer(o, decisions[o.id])), { tiePercent: ctx.policies.tieBandPct, today: ctx.today })

/** The supplier as an order carries him; a guest has no org and no user. */
export function planSupplier(offer: PlanOffer): Pick<PurchaseOrder, "supplierOrgId" | "supplierUserId" | "supplierName" | "isGuestSupplier"> {
  const name = (offer.companyName || offer.supplierName || offer.guestContact?.name || "").trim()
  if (offer.isGuestOffer || offer.supplierId === "guest") return { supplierOrgId: "guest", supplierUserId: null, supplierName: name, isGuestSupplier: true }
  const uid = offer.supplierId && offer.supplierId !== "mdmak-system" ? offer.supplierId : null
  return { supplierOrgId: offer.supplierOrgId || offer.organizationId || uid || "guest", supplierUserId: uid, supplierName: name, isGuestSupplier: false }
}

const supplierKeyOf = (offer: PlanOffer): string => {
  const s = planSupplier(offer)
  return s.isGuestSupplier || !s.supplierOrgId || s.supplierOrgId === "guest" ? `guest:${s.supplierName.toLowerCase()}` : s.supplierOrgId
}

// ---------------------------------------------------------------------------
// Where each line goes
// ---------------------------------------------------------------------------

export interface LineSite {
  id: string | null
  key: string
  city: string
  district: string
}

export function siteOfLine(rfq: PlanRfq, li: number): LineSite {
  const p = rfq.products?.[li]
  const id = text(p?.deliverySiteId) || text(rfq.deliverySiteId) || null
  const city = text(p?.deliveryCity) || text(rfq.city)
  const district = text(p?.deliveryDistrict) || text(rfq.district)
  return { id, key: id || (city || district ? `loc:${city}|${district}` : "-"), city, district }
}

export const needOfLine = (rfq: PlanRfq, li: number): string | null => dayOf(text(rfq.products?.[li]?.needBy) || text(rfq.needBy)) || null

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export const PLAN_REFUSALS = [
  "nothing_picked",
  "offer_missing",
  "offer_changed",
  "offer_excluded",
  "offer_expired",
  "offer_taken",
  "line_locked",
  "line_not_covered",
  "lump_partial",
  "whole_partial",
  "reason_required",
  "reason_untrue",
  "reason_text_short",
  "lowcomp_reason_required",
  "guest_unregistered",
  "approve_not_owner",
] as const
export type PlanRefusalCode = (typeof PLAN_REFUSALS)[number]

export type DropWhy = "missing" | "changed" | "excluded" | "expired" | "locked" | "not_priced"

export interface Dropped {
  li: number
  offerId: string
  why: DropWhy
}

const DROP_REFUSAL: Record<DropWhy, PlanRefusalCode> = {
  missing: "offer_missing",
  changed: "offer_changed",
  excluded: "offer_excluded",
  expired: "offer_expired",
  locked: "line_locked",
  not_priced: "line_not_covered",
}

export interface PlannedLine {
  li: number
  offerId: string
  rev: number
  name: string
  /** The request unit and quantity asked for. */
  unit: string
  qty: number
  /** The price as quoted: per request unit, or per piece when `pcs` is set. */
  rate: number | null
  netH: number | null
  effH: number | null
  packLen: number | null
  packName: string | null
  pcs: number | null
  received: number | null
  extra: number | null
  perReceivedH: number | null
  lowest: boolean
  /** Live offers that priced this line. */
  liveCount: number
  thin: boolean
  needBy: string | null
}

export type ApprovalKind = "sent" | "above_limit" | "direct_over" | "prepared_by_approver"

export interface PlannedGroup {
  key: string
  offerId: string
  rev: number
  supplierKey: string
  siteKey: string
  site: LineSite
  lines: PlannedLine[]
  lump: boolean
  netH: number
  vatRate: number
  grossH: number
  needBy: string | null
  arrival: string | null
  late: boolean
  daysLate: number
  guest: boolean
  noOfficialQuote: boolean
  firstTimeSupplier: boolean
  offLowest: boolean
  /** The thinnest line's live-offer count when the competition was too thin on a line of this order, else null. */
  thinN: number | null
  approval: ApprovalKind
  /** The owner may approve it in the award window. */
  approveNowAllowed: boolean
  /** The order is approved and sent by the award: within the limit and approved by policy, or approved now by the owner. */
  sendsNow: boolean
}

export interface AwardInput {
  rfq: PlanRfq
  offers: PlanOffer[]
  picks: readonly PinnedPick[]
  why?: { code: string; text?: string | null } | null
  lowComp?: { code: string; text?: string | null } | null
  approveNow?: readonly string[]
  acceptGuest?: boolean
}

export interface AwardPlan {
  evaluation: Evaluation
  clean: PinnedPick[]
  dropped: Dropped[]
  groups: PlannedGroup[]
  nonLowest: PinnedPick[]
  /** Which structured reasons the numbers back (R-15). */
  whyEligible: Record<AwardWhyCode, boolean>
  lowComp: LowCompetition
  /** Request lines nobody was awarded and no live order carries: they return to «الواردة». */
  unawarded: number[]
  netH: number
  grossH: number
  suppliers: number
  warnings: { noQuote: string[]; firstTime: string[]; unawarded: number; closesEarly: boolean; late: string[] }
  refusal: PlanRefusalCode | null
  refusals: PlanRefusalCode[]
}

const liveRfq = (rfq: Pick<PlanRfq, "status">) => rfq.status === "New"

/** The award closes an open RFQ early when its deadline's day has not passed. */
export function awardClosesEarly(rfq: Pick<PlanRfq, "status" | "deadline" | "closedEarly">, today: string): boolean {
  if (rfq.status !== "New" || rfq.closedEarly) return false
  const d = dayOf(rfq.deadline || "")
  return !d || today <= d
}

function warrantyMet(rfq: PlanRfq, offer: PlanOffer, li: number): boolean | null {
  const p = rfq.products?.[li]
  const asked = Number(p?.warrantyMonths) > 0 ? Number(p?.warrantyMonths) : p?.requiresWarranty ? 12 : null
  if (asked == null) return null
  const line = (offer.lines || []).find((l) => Number(l.rfqProductIndex) === li)
  if (!line || line.warrantyMonths === null || line.warrantyMonths === undefined) return null
  return Number(line.warrantyMonths) >= asked
}

const hasQuote = (o: PlanOffer | undefined): boolean => Boolean(text(o?.offerPdfUrl))

export function planAward(input: AwardInput, ctx: PlanContext): AwardPlan {
  const { rfq, offers } = input
  const products = pricedProducts(rfq)
  const byId = new Map(offers.map((o) => [o.id, o]))
  const ev = evaluatePlanOffers(rfq, offers, ctx.decisions, ctx)
  const dropped: Dropped[] = []
  const clean: PinnedPick[] = []

  for (const pick of input.picks) {
    const o = byId.get(pick.offerId)
    const calc = ev.byId[pick.offerId]
    const drop = (why: DropWhy) => void dropped.push({ li: pick.li, offerId: pick.offerId, why })
    if (!o || !calc || !products.some((p) => p.rfqProductIndex === pick.li)) drop("missing")
    else if (offerIsOut(o, ctx.decisions[o.id])) drop("excluded")
    else if (offerRev(o as unknown as Rec) !== pick.rev) drop("changed")
    else if (ctx.locked[pick.li]) drop("locked")
    else if (calc.expired) drop("expired")
    else if (calc.kind !== "lump" && !lineOf(calc, pick.li)) drop("not_priced")
    else clean.push(pick)
  }
  // One line, one place: a later pick of the same line replaces the earlier.
  const lastPerLine = new Map(clean.map((p) => [p.li, p]))
  const kept = [...lastPerLine.values()].sort((a, b) => a.li - b.li)

  const refusals: PlanRefusalCode[] = []
  const refuse = (c: PlanRefusalCode) => {
    if (!refusals.includes(c)) refusals.push(c)
  }
  if (!kept.length && !dropped.length) refuse("nothing_picked")
  for (const d of dropped) refuse(DROP_REFUSAL[d.why])
  if (!kept.length && dropped.length) refuse("nothing_picked")

  // A lump sum is awarded whole to ONE supplier; «للطلب كاملاً فقط» likewise — never some lines of it.
  const open = products.map((p) => p.rfqProductIndex).filter((li) => !ctx.locked[li])
  const pickedBy = new Map<string, number[]>()
  for (const p of kept) pickedBy.set(p.offerId, [...(pickedBy.get(p.offerId) || []), p.li])
  for (const [offerId, lis] of pickedBy) {
    const calc = ev.byId[offerId]
    const o = byId.get(offerId) as PlanOffer
    if (calc.kind === "lump") {
      if (open.some((li) => !lis.includes(li)) || kept.some((p) => p.offerId !== offerId)) refuse("lump_partial")
    } else if (o.whole && open.some((li) => !lis.includes(li))) refuse("whole_partial")
  }

  // Groups: one order per supplier × delivery site (G-05); a lump sum is one order.
  const lineEvalOf = (li: number) => ev.lines.find((l) => l.rfqProductIndex === li)
  const thinLimit = ctx.policies.minOffers
  const groups = new Map<string, { offerId: string; rev: number; site: LineSite; lis: number[] }>()
  for (const p of kept) {
    const o = byId.get(p.offerId) as PlanOffer
    const calc = ev.byId[p.offerId]
    const site = siteOfLine(rfq, p.li)
    const sk = calc.kind === "lump" ? "-" : site.key
    const key = orderSiteKey(supplierKeyOf(o), sk)
    const g = groups.get(key) || { offerId: p.offerId, rev: p.rev, site: calc.kind === "lump" ? { id: null, key: "-", city: site.city, district: site.district } : site, lis: [] }
    g.lis.push(p.li)
    groups.set(key, g)
  }

  const planned: PlannedGroup[] = []
  for (const [key, g] of groups) {
    const o = byId.get(g.offerId) as PlanOffer
    const calc = ev.byId[g.offerId]
    const lump = calc.kind === "lump"
    const lines: PlannedLine[] = g.lis
      .slice()
      .sort((a, b) => a - b)
      .map((li) => {
        const prod = products.find((p) => p.rfqProductIndex === li) as (typeof products)[number]
        const lc: OfferLineCalc | null = lump ? null : lineOf(calc, li)
        const le = lineEvalOf(li)
        const pack = lc?.pack || null
        const unitName = text(o.lines?.find((l) => Number(l.rfqProductIndex) === li)?.packKey)
        return {
          li,
          offerId: g.offerId,
          rev: g.rev,
          name: prod.name,
          unit: prod.unit,
          qty: prod.quantity,
          rate: lc ? fromHalalas(lc.rateH) : null,
          netH: lc ? lc.totalH : null,
          effH: lc ? lc.effH : null,
          packLen: pack ? pack.packLen : null,
          packName: pack ? unitName || null : null,
          pcs: pack ? pack.pcs : null,
          received: pack ? pack.received : null,
          extra: pack ? pack.extra : null,
          perReceivedH: pack ? pack.perReceivedH : null,
          lowest: lump ? calc.isLowestComplete : Boolean(le?.lowestIds.includes(g.offerId)),
          liveCount: le?.liveCount ?? 0,
          thin: (le?.liveCount ?? 0) < thinLimit,
          needBy: needOfLine(rfq, li),
        }
      })
    const netH = lump ? calc.netH ?? 0 : lines.reduce((s, l) => s + (l.netH ?? 0), 0)
    const grossH = withVat(netH, calc.vatRate)
    const needs = lines.map((l) => l.needBy).filter((d): d is string => Boolean(d))
    const needBy = needs.length ? needs.slice().sort()[0] : null
    const arrival = arrivalEstimate(ctx.today, ctx.policies.supplierAcceptanceDays, calc.leadDays)
    const late = arrivalVsNeed(arrival, needBy)
    const directOver = Boolean(rfq.dirOver) || (Boolean(rfq.directAward) && netH > toHalalas(ctx.policies.directPurchaseCap))
    const aboveLimit = grossH > toHalalas(ctx.policies.managerApprovalLimit)
    const preparerApproves = ctx.actor.canApprove && !ctx.actor.isOwner
    const approval: ApprovalKind = directOver ? "direct_over" : aboveLimit ? "above_limit" : preparerApproves ? "prepared_by_approver" : "sent"
    const thin = lines.filter((l) => l.thin)
    planned.push({
      key,
      offerId: g.offerId,
      rev: g.rev,
      supplierKey: supplierKeyOf(o),
      siteKey: lump ? "-" : g.site.key,
      site: g.site,
      lines,
      lump,
      netH,
      vatRate: calc.vatRate,
      grossH,
      needBy,
      arrival,
      late: Boolean(late?.late),
      daysLate: late?.daysLate ?? 0,
      guest: planSupplier(o).isGuestSupplier,
      noOfficialQuote: !hasQuote(o),
      firstTimeSupplier: !planSupplier(o).isGuestSupplier && !ctx.hasRecord(o),
      offLowest: lines.some((l) => !l.lowest),
      thinN: thin.length ? Math.min(...thin.map((l) => l.liveCount)) : null,
      approval,
      approveNowAllowed: ctx.actor.isOwner && approval !== "sent",
      sendsNow: approval === "sent" || (ctx.actor.isOwner && Boolean(input.approveNow?.includes(key))),
    })
  }

  // Not the lowest → a reason, and only one the numbers back (G-04, R-15).
  const asEvalPicks = kept.map((p) => ({ rfqProductIndex: p.li, offerId: p.offerId }))
  const nonLowestEval = nonLowestPicks(ev, asEvalPicks)
  const nonLowest = nonLowestEval.map((p) => kept.find((k) => k.li === p.rfqProductIndex && k.offerId === p.offerId) as PinnedPick)
  const factsOf = (offerId: string, li: number): ReasonFacts => {
    const o = byId.get(offerId) as PlanOffer
    const calc = ev.byId[offerId]
    return { leadDays: calc?.leadDays ?? null, onTimeRate: o ? ctx.onTimeOf(o) : null, hasOfficialQuote: hasQuote(o), warrantyMet: o ? warrantyMet(rfq, o, li) : null }
  }
  const lowestOfferFor = (offerId: string, li: number): string | null => {
    const calc = ev.byId[offerId]
    return calc?.kind === "lump" ? ev.lowestComplete?.id ?? null : lineEvalOf(li)?.bestOfferId ?? null
  }
  const nlLines: NonLowestLine[] = nonLowest.flatMap((p) => {
    const low = lowestOfferFor(p.offerId, p.li)
    return low ? [{ awarded: factsOf(p.offerId, p.li), lowest: factsOf(low, p.li) }] : []
  })
  const awardedSuppliers = new Set(planned.map((g) => g.supplierKey)).size
  const reasonCtx = { awardedSuppliers, splitSuppliers: ev.mix?.suppliers ?? 0 }
  const whyEligible = Object.fromEntries(AWARD_WHY_CODES.map((c) => [c, nonLowest.length > 0 && awardReasonEligible(c, nlLines, reasonCtx)])) as Record<AwardWhyCode, boolean>
  if (nonLowest.length) {
    const r = awardReasonRefusal(input.why, nlLines, reasonCtx)
    if (r) refuse(r)
  }

  // Thin competition above the threshold: a reason and a tag, never a block (G-18, decision 01).
  const lowComp = lowCompetition(ev, asEvalPicks, { limit: ctx.policies.minOffers, thresholdSar: ctx.policies.competitionThreshold })
  const lc = lowCompetitionReasonRefusal(input.lowComp, lowComp)
  if (lc === "lowcomp_reason_required") refuse(lc)
  else if (lc) refuse("reason_text_short")

  const guestGroups = planned.filter((g) => g.guest)
  if (guestGroups.length && !input.acceptGuest) refuse("guest_unregistered")
  if (!ctx.actor.isOwner && (input.approveNow || []).length) refuse("approve_not_owner")

  const locks = new Set(Object.keys(ctx.locked).map(Number))
  const unawarded = products.map((p) => p.rfqProductIndex).filter((li) => !lastPerLine.has(li) && !locks.has(li))
  const netH = planned.reduce((s, g) => s + g.netH, 0)
  const grossH = planned.reduce((s, g) => s + g.grossH, 0)

  return {
    evaluation: ev,
    clean: kept,
    dropped,
    groups: planned,
    nonLowest,
    whyEligible,
    lowComp,
    unawarded: kept.length ? unawarded : [],
    netH,
    grossH,
    suppliers: awardedSuppliers,
    warnings: {
      noQuote: planned.filter((g) => g.noOfficialQuote).map((g) => g.offerId),
      firstTime: planned.filter((g) => g.firstTimeSupplier).map((g) => g.offerId),
      unawarded: kept.length ? unawarded.length : 0,
      closesEarly: kept.length > 0 && liveRfq(rfq) && awardClosesEarly(rfq, ctx.today),
      late: planned.filter((g) => g.late).map((g) => g.offerId),
    },
    refusal: refusals[0] ?? null,
    refusals,
  }
}

/** The status the picks were made on, pinned: «اختر الأقل لكل بند» and a click on a cell both make these. */
export function pinOffer(offer: PlanOffer): number {
  return offerRev(offer as unknown as Rec)
}

/** Cells that can be picked at all: not out, not expired, not carried by an order, and the offer prices the line. */
export function cellPickable(ev: Evaluation, offerId: string, li: number, ctx: Pick<PlanContext, "locked" | "liveOfferIds">): { ok: true } | { ok: false; why: "excluded" | "expired" | "locked" | "not_priced" } {
  const o: OfferEval | undefined = ev.byId[offerId]
  if (!o || !o.live) return { ok: false, why: "excluded" }
  if (ctx.locked[li]) return { ok: false, why: "locked" }
  if (o.expired) return { ok: false, why: "expired" }
  if (o.kind !== "lump" && !lineOf(o, li)) return { ok: false, why: "not_priced" }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// «اختر الأقل لكل بند» and its safe variant
// ---------------------------------------------------------------------------

export interface PickOptions {
  /** «الأقل من الموثّقين بعرض رسمي»: only suppliers for whom this is true. */
  allow?: (offerId: string) => boolean
}

export function pickLowestPerLine(ev: Evaluation, offersById: ReadonlyMap<string, PlanOffer>, ctx: Pick<PlanContext, "locked" | "liveOfferIds">, opts: PickOptions = {}): AwardPicks {
  const out: AwardPicks = {}
  for (const l of ev.lines) {
    if (ctx.locked[l.rfqProductIndex]) continue
    let best: { id: string; h: number } | null = null
    for (const o of ev.offers) {
      if (!o.live || o.kind === "lump" || (opts.allow && !opts.allow(o.id)) || !cellPickable(ev, o.id, l.rfqProductIndex, ctx).ok) continue
      const h = lineOf(o, l.rfqProductIndex)?.totalH
      if (h == null) continue
      if (!best || h < best.h) best = { id: o.id, h }
    }
    const offer = best ? offersById.get(best.id) : null
    if (best && offer) out[l.rfqProductIndex] = { offerId: best.id, rev: offerRev(offer as unknown as Rec) }
  }
  return out
}

/** «رسِّ كل ما سعّره عليه»: every unlocked line the offer prices (a lump sum or a whole-request offer takes them all). */
export function pickAllOf(ev: Evaluation, offer: PlanOffer, ctx: Pick<PlanContext, "locked" | "liveOfferIds">, current: AwardPicks = {}): AwardPicks {
  const o = ev.byId[offer.id]
  if (!o) return current
  const mine: AwardPicks = o.kind === "lump" || offer.whole ? {} : { ...current }
  for (const l of ev.lines) if (cellPickable(ev, offer.id, l.rfqProductIndex, ctx).ok) mine[l.rfqProductIndex] = { offerId: offer.id, rev: offerRev(offer as unknown as Rec) }
  return mine
}

/** Picks that still point at a standing offer version; the rest are dropped with their reason (the banner reads them). */
export function dropStale(picks: AwardPicks, offers: PlanOffer[], ev: Evaluation, ctx: Pick<PlanContext, "locked" | "liveOfferIds">): { picks: AwardPicks; dropped: Dropped[] } {
  const byId = new Map(offers.map((o) => [o.id, o]))
  const out: AwardPicks = {}
  const dropped: Dropped[] = []
  for (const p of picksToList(picks)) {
    const o = byId.get(p.offerId)
    const cell = cellPickable(ev, p.offerId, p.li, ctx)
    const why: DropWhy | null = !o ? "missing" : !cell.ok ? (cell.why === "excluded" ? "excluded" : cell.why) : offerRev(o as unknown as Rec) !== p.rev ? "changed" : null
    if (why) dropped.push({ li: p.li, offerId: p.offerId, why })
    else out[p.li] = { offerId: p.offerId, rev: p.rev }
  }
  return { picks: out, dropped }
}

// ---------------------------------------------------------------------------
// The orders
// ---------------------------------------------------------------------------

export interface OrderDraftInput {
  rfq: PlanRfq
  offer: PlanOffer
  group: PlannedGroup
  plan: AwardPlan
  offersCount: number
  lowestOfferTotal: number | null
  why?: { code: string; text?: string | null } | null
  lowComp?: { code: string; text?: string | null } | null
  /** The reason in the words the order shows (a structured reason is rendered by the caller). */
  whyText: string | null
  lowCompText: string | null
  preparer: { uid: string; name: string }
  actor: PlanActor
  policies: Pick<ResolvedPolicies, "managerApprovalLimit" | "directPurchaseCap" | "competitionThreshold" | "minOffers">
  now: string
  round: number
  site: PoSite | null
  directReason?: string | null
}

export type OrderDraft = Omit<PurchaseOrder, "id" | "docNumber"> & {
  lump?: boolean
  offerRev: number
  awardRound: number
  awardWhy?: { code: string; text: string | null } | null
  lowComp?: { n: number; threshold: number; code: string; text: string | null } | null
}

/** The order document one planned group becomes, before its number. Money in riyals; a lump sum has no line prices. */
export function draftOrder(input: OrderDraftInput): OrderDraft {
  const { rfq, offer, group, policies } = input
  const products = rfq.products || []
  const lines: PoLine[] = group.lines.map((l) => {
    const p = products[l.li] || {}
    const { materialId, specKey } = specKeyOf(p)
    const need = Math.max(0, num(p.quantity))
    const baseUnit = text(p.unitOfMeasure) || text(p.unit)
    const pack = l.packLen != null && l.pcs != null
    const packAr = l.packName || (pack ? `${baseUnit} ${l.packLen}` : "")
    return {
      id: `l${l.li + 1}`,
      name: text(p.name),
      unit: pack ? packAr : baseUnit,
      quantity: pack ? (l.pcs as number) : need,
      unitPrice: group.lump ? null : l.rate,
      accepted: 0,
      rejected: 0,
      held: 0,
      cancelled: 0,
      boqItemId: p.boqItemId ?? null,
      rfqProductIndex: l.li,
      ...(pack ? { pk: l.packLen, need, base: baseUnit, packName: { ar: packAr, en: packAr } } : {}),
      ...(specKey ? { materialId, specKey } : {}),
      ...lineSpecOf({ ...p, material: p.material as SpecMaterial | null | undefined }),
    }
  })
  const supplier = planSupplier(offer)
  const totalExVat = fromHalalas(group.netH)
  const awardWhy = group.offLowest && input.why ? { code: input.why.code, text: input.whyText } : null
  const lowComp = group.thinN != null && input.plan.lowComp.required && input.lowComp ? { n: group.thinN, threshold: policies.minOffers, code: input.lowComp.code, text: input.lowCompText } : null
  const directOver = group.approval === "direct_over"
  const city = group.site.city || text(offer.deliveryLocation) || text(rfq.city)
  const district = group.site.district || text(offer.deliveryDistrict) || (city && city === text(rfq.city) ? text(rfq.district) : "")
  const options = readDeliveryOptions(rfq.deliveryOptions)
  const siteOptions = options[group.site.key] || (group.site.id ? options[group.site.id] : undefined)
  const base: Omit<PurchaseOrder, "id" | "docNumber" | "approverKind"> = {
    organizationId: text(rfq.organizationId) || text(rfq.contractorId),
    status: "awaiting_approval",
    basis: rfq.directAward || offer.directAward ? "direct" : "rfq",
    rfqId: rfq.id,
    rfqTitle: text(rfq.title),
    offerId: offer.id,
    projectId: rfq.projectId ?? null,
    projectName: rfq.projectName ?? null,
    category: rfq.category ?? null,
    purchaseSource: rfq.purchaseSource ?? null,
    ...supplier,
    ...orderTermsOf(offer),
    ...frozenTermsOf(offer, rfq),
    lines,
    totalExVat,
    vatRate: group.vatRate,
    ...(group.vatRate === 0 ? { noVat: true } : {}),
    ver: 1,
    ...(group.site.key !== "-" ? { siteKey: group.key } : {}),
    ...(input.site ? { site: input.site } : {}),
    paymentTerms: offer.paymentTerms ?? null,
    deliveryLocation: city || null,
    deliveryDistrict: district || null,
    ...(siteOptions ? { deliveryOptions: { [group.site.key]: siteOptions } } : {}),
    leadTimeDays: offerLeadDays(offer),
    offersCount: input.offersCount,
    lowestOfferTotal: input.lowestOfferTotal,
    awardReasonCode: awardWhy ? "other" : null,
    awardReasonText: awardWhy ? awardWhy.text : directOver ? input.directReason || input.rfq.directWhy || null : null,
    shortCompetition: Boolean(lowComp),
    noOfficialQuote: group.noOfficialQuote,
    requestedDeliveryDate: group.needBy,
    tags: {
      ...(awardWhy ? { notLowest: { why: awardWhy.text || awardWhy.code } } : {}),
      ...(lowComp ? { lowComp: { n: lowComp.n, why: lowComp.text || lowComp.code } } : {}),
      ...(directOver ? { directOver: { why: input.directReason || input.rfq.directWhy || "" } } : {}),
    },
    preparedById: input.preparer.uid,
    preparedByName: input.preparer.name,
    createdAt: input.now,
    approvedById: null,
    approvedByName: null,
    approvedAt: null,
    returnedReason: null,
    sentAt: null,
    sentChannel: null,
    supplierAcceptedAt: null,
    promisedDate: null,
    acceptanceRecordedBy: null,
    rating: null,
    log: [],
  }
  const routed = { ...base, id: "", docNumber: "", approverKind: "manager" as const } as PurchaseOrder
  const needsOwnerHand = directOver || group.approval === "above_limit" || input.actor.canApprove || input.actor.isOwner
  return {
    ...base,
    approverKind: directOver ? "owner" : requiredApprover(routed, policies as Parameters<typeof requiredApprover>[1], needsOwnerHand && (input.actor.isOwner || input.actor.canApprove)),
    ...(group.lump ? { lump: true } : {}),
    offerRev: group.rev,
    awardRound: input.round,
    ...(awardWhy ? { awardWhy: { code: awardWhy.code, text: awardWhy.text } } : {}),
    ...(lowComp ? { lowComp } : {}),
  }
}

/** The text of a structured reason in Arabic — what the order, the log and the reports carry; the buyer's own words win. */
export const AWARD_WHY_AR: Record<AwardWhyCode, string> = {
  fastest: "أسرع توريداً",
  reliability: "التزامه أفضل",
  warranty: "يلبّي الضمان",
  official_quote: "عرضه الرسمي مكتمل",
  one_supplier: "مورد واحد أسهل في الاستلام",
  other: "سبب آخر",
}

export const LOW_COMP_AR: Record<string, string> = {
  urgent: "عاجل لا يحتمل الانتظار",
  no_alternatives: "لا مورّدين آخرين لهذه المادة",
  near_last_price: "السعر قريب من آخر شراء",
  other: "سبب آخر",
}

export const reasonText = (reason: { code: string; text?: string | null } | null | undefined, table: Record<string, string>): string | null => {
  if (!reason) return null
  const own = text(reason.text)
  return own || table[reason.code] || reason.code
}

/** Σ a supplier's on-time rate by key — the review and the server read the same numbers. */
export function amountOf(v: unknown): number {
  return toAmount(v)
}

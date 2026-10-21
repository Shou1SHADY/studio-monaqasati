// The one place an offer becomes numbers (Procurement 2.0: CMP-01/02/04/19, G-02/03/18, PRD §9). Pure, no I/O.
//
// Everything money-shaped here is integer HALALAS (SAR × 100) and every division rounds half-up, so a total is the
// same figure on the list, the comparison, the panel, the award review and Today. The PRD's worked example needs it:
// 3,339.50 × 1.15 is 3,840.4249999999997 in doubles, and only integer maths gives the 3,840.43 the PRD prints.
//
// Mirrored to the mobile app (mdmak-mob `scripts/check-mirrors.mjs`): keep it free of imports from this repo.

export const VAT_RATE = 0.15
export const TIE_PERCENT_DEFAULT = 0.5
export const COMPETITION_LIMIT_DEFAULT = 3
export const COMPETITION_THRESHOLD_DEFAULT = 20_000
export const OTHER_REASON_MIN_CHARS = 4

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Quantities and prices reach us as typed strings — "1,200", " 40 ", "٤٠". */
export function toAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const cleaned = String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,\s]/g, "")
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/** Half-up, shielded against 834.4999999999999 where the decimal says 834.5. */
export const roundHalfUp = (x: number): number => Math.floor(x + 0.5 + 1e-9)

export const toHalalas = (sar: unknown): number => roundHalfUp(toAmount(sar) * 100)
export const fromHalalas = (h: number): number => h / 100

/** `h × num ÷ den`, half-up — the only way a VAT or a percentage is applied to money. */
export const mulRound = (h: number, num: number, den: number): number => roundHalfUp((h * num) / den)

/** The rate the offer is taxed at: nothing for a supplier who is not registered, otherwise what the version stored, otherwise 15 %. */
export function vatRateOf(offer: { vatRegistered?: boolean | null; vatRate?: number | string | null } | null | undefined): number {
  if (!offer) return VAT_RATE
  if (offer.vatRegistered === false) return 0
  const stored = offer.vatRate
  if (stored !== null && stored !== undefined && String(stored).trim() !== "") {
    const n = Number(stored)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return VAT_RATE
}

const permille = (rate: number) => Math.round((1 + rate) * 1000)

/** Net + VAT, in halalas. */
export const withVat = (netH: number, rate: number = VAT_RATE): number => mulRound(netH, permille(rate), 1000)

/** G-18: every figure on an offer screen carries its basis. */
export const basisOf = (rate: number): "incl_vat" | "no_vat" => (rate > 0 ? "incl_vat" : "no_vat")

/** `total ≤ min × (1 + tie %)` in integer maths: ties at exactly the band count (R-31). */
export function isTie(totalH: number, minH: number, tiePercent: number = TIE_PERCENT_DEFAULT): boolean {
  const bp = Math.round(tiePercent * 100)
  return totalH * 10000 <= minH * (10000 + bp)
}

// ---------------------------------------------------------------------------
// The RFQ's own shape, as pricing sees it
// ---------------------------------------------------------------------------

export interface RfqProductLike {
  name?: string | null
  quantity?: number | string | null
  unitOfMeasure?: string | null
  unit?: string | null
}

export interface PricedRfq {
  pricingMode?: string | null
  shipmentMode?: string | null
  products?: RfqProductLike[] | null
}

export interface PricedProduct {
  rfqProductIndex: number
  name: string
  unit: string
  quantity: number
}

export function pricedProducts(rfq: PricedRfq | null | undefined): PricedProduct[] {
  return (rfq?.products || []).map((p, i) => ({
    rfqProductIndex: i,
    name: (p.name || "").trim(),
    unit: (p.unitOfMeasure || p.unit || "").trim(),
    quantity: toAmount(p.quantity),
  }))
}

export function canPriceByLine(rfq: PricedRfq | null | undefined): boolean {
  if (!rfq) return false
  if (rfq.shipmentMode === "multiple") return false
  const products = (rfq.products || []).filter((p) => p && (p.name || "").trim())
  if (!products.length) return false
  return products.every((p) => toAmount(p.quantity) > 0)
}

/** An RFQ published before this existed, or one that asked for a total, is a total. Anything unrecognised is a total too. */
export function pricingModeOf(rfq: PricedRfq | null | undefined): "line" | "total" {
  return rfq?.pricingMode === "line" && canPriceByLine(rfq) ? "line" : "total"
}

// ---------------------------------------------------------------------------
// One line: rate × quantity, or pieces × piece price (CMP-01, G-02)
// ---------------------------------------------------------------------------

export interface PackInfo {
  /** Request units in one piece — 6 for «قطعة 6 م». */
  packLen: number
  /** ⌈requested ÷ pack length⌉ */
  pcs: number
  /** pcs × pack length, in request units. */
  received: number
  /** received − requested (2 dp): the surplus you pay for. */
  extra: number
  /** total ÷ received, only when you receive more than you asked — «للمتر المستلم». */
  perReceivedH: number | null
}

export interface LineCalc {
  qty: number
  /** The price as quoted: per request unit, or per piece when `pack` is set. */
  rateH: number
  /** What the line costs, ex-VAT. */
  totalH: number
  /** total ÷ requested quantity, to the halala — the number that is compared and shown big. */
  effH: number
  /** The same, unrounded — for the G-02 identity. */
  effExactH: number
  pack: PackInfo | null
}

const validPack = (v: unknown): number | null => {
  const n = toAmount(v)
  return n > 0 ? n : null
}

export function lineCalc(qty: number, rate: unknown, packLen?: unknown): LineCalc {
  const rateH = toHalalas(rate)
  const q = qty > 0 ? qty : 0
  const len = validPack(packLen)
  if (len == null) {
    const totalH = roundHalfUp(q * rateH)
    return { qty: q, rateH, totalH, effH: rateH, effExactH: rateH, pack: null }
  }
  const pcs = Math.ceil(q / len - 1e-9)
  const totalH = pcs * rateH
  const received = Math.round(pcs * len * 1e6) / 1e6
  const extra = Math.round((received - q) * 100) / 100
  const effExactH = q > 0 ? totalH / q : rateH / len
  return {
    qty: q,
    rateH,
    totalH,
    effH: roundHalfUp(effExactH),
    effExactH,
    pack: { packLen: len, pcs, received, extra, perReceivedH: extra > 0 && received > 0 ? roundHalfUp(totalH / received) : null },
  }
}

// ---------------------------------------------------------------------------
// One offer
// ---------------------------------------------------------------------------

export interface CalcOfferLine {
  rfqProductIndex?: number | null
  unitPrice?: number | string | null
  packLen?: number | string | null
}

export interface CalcOffer {
  id?: string
  lines?: CalcOfferLine[] | null
  skippedItems?: Array<number | null> | null
  /** مبلغ إجمالي: one figure for the whole RFQ, ex-VAT. */
  lump?: number | string | null
  price?: unknown
  totalBatchesPrice?: unknown
  vatRegistered?: boolean | null
  vatRate?: number | string | null
  /** Out of the comparison and the award (the buyer's decision), still in the record. */
  excluded?: boolean | null
  leadDays?: number | string | null
  validUntil?: string | null
}

export type OfferKind = "lines" | "lump" | "total" | "none"

export interface OfferLineCalc extends LineCalc {
  rfqProductIndex: number
  /** A rate the supplier typed — false when it was divided out of a single-material total. */
  quoted: boolean
}

export interface OfferCalc {
  id: string
  kind: OfferKind
  lines: OfferLineCalc[]
  covered: number
  of: number
  partial: boolean
  uncovered: number[]
  /** Priced every material (or the whole RFQ for a lump sum) — the only offers that rank. */
  complete: boolean
  netH: number | null
  vatRate: number
  grossH: number | null
  excluded: boolean
  leadDays: number | null
  validUntil: string | null
}

const positiveH = (v: unknown): number | null => {
  const h = toHalalas(v)
  return h > 0 ? h : null
}

const quotedRates = (offer: CalcOffer): Map<number, { rate: number; packLen: number | null }> => {
  const out = new Map<number, { rate: number; packLen: number | null }>()
  for (const l of offer.lines || []) {
    const i = Number(l.rfqProductIndex)
    const rate = Math.round(toAmount(l.unitPrice) * 100) / 100
    if (Number.isInteger(i) && i >= 0 && rate > 0) out.set(i, { rate, packLen: validPack(l.packLen) })
  }
  return out
}

/**
 * Whether a COMPLETE set of quoted rates still adds up to the total the offer stands at. They stop doing so when a
 * price was revised as a total alone; rates that no longer reconcile describe an offer nobody is making any more.
 * Tolerance: a halala per line.
 */
export function ratesReconcile(products: PricedProduct[], offer: CalcOffer): boolean {
  if (!products.length) return true
  const quoted = quotedRates(offer)
  if (!products.every((p) => quoted.has(p.rfqProductIndex))) return true
  const declared = positiveH(offer.totalBatchesPrice) ?? positiveH(offer.price)
  if (declared == null) return true
  const sum = products.reduce((s, p) => {
    const q = quoted.get(p.rfqProductIndex) as { rate: number; packLen: number | null }
    return s + lineCalc(p.quantity, q.rate, q.packLen).totalH
  }, 0)
  return Math.abs(sum - declared) <= products.length + 1e-9
}

/** How much of the RFQ the offer covers — «not covered» is never zero. */
export function coverageOf(rfq: PricedRfq | null | undefined, offer: CalcOffer): { covered: number; of: number; partial: boolean; uncovered: number[] } {
  const products = pricedProducts(rfq)
  const whole = { covered: products.length, of: products.length, partial: false, uncovered: [] as number[] }
  if (products.length < 2 || pricingModeOf(rfq) !== "line") return whole
  if (positiveH(offer.lump) != null) return whole
  const quoted = new Set(quotedRates(offer).keys())
  const flagged = new Set((offer.skippedItems || []).map(Number).filter((i) => Number.isInteger(i) && i >= 0))
  const uncovered = products.filter((p) => (quoted.size ? !quoted.has(p.rfqProductIndex) : flagged.has(p.rfqProductIndex))).map((p) => p.rfqProductIndex)
  return { covered: products.length - uncovered.length, of: products.length, partial: uncovered.length > 0, uncovered }
}

const leadOf = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function calcOffer(rfq: PricedRfq | null | undefined, offer: CalcOffer): OfferCalc {
  const products = pricedProducts(rfq)
  const cov = coverageOf(rfq, offer)
  const vatRate = vatRateOf(offer)
  const lumpH = positiveH(offer.lump)
  const declaredH = positiveH(offer.totalBatchesPrice) ?? positiveH(offer.price)
  const quoted = lumpH == null && ratesReconcile(products, offer) ? quotedRates(offer) : new Map<number, { rate: number; packLen: number | null }>()

  let kind: OfferKind = "none"
  let lines: OfferLineCalc[] = []
  let netH: number | null = null
  if (lumpH != null) {
    kind = "lump"
    netH = lumpH
  } else if (quoted.size) {
    kind = "lines"
    lines = products
      .filter((p) => quoted.has(p.rfqProductIndex))
      .map((p) => {
        const q = quoted.get(p.rfqProductIndex) as { rate: number; packLen: number | null }
        return { ...lineCalc(p.quantity, q.rate, q.packLen), rfqProductIndex: p.rfqProductIndex, quoted: true }
      })
    netH = lines.reduce((s, l) => s + l.totalH, 0)
  } else if (declaredH != null) {
    netH = declaredH
    const only = products.length === 1 ? products[0] : null
    if (only && only.quantity > 0) {
      kind = "total"
      lines = [{ qty: only.quantity, rateH: roundHalfUp(declaredH / only.quantity), totalH: declaredH, effH: roundHalfUp(declaredH / only.quantity), effExactH: declaredH / only.quantity, pack: null, rfqProductIndex: only.rfqProductIndex, quoted: false }]
    } else kind = "lump"
  }

  return {
    id: offer.id || "",
    kind,
    lines,
    covered: cov.covered,
    of: cov.of,
    partial: cov.partial,
    uncovered: cov.uncovered,
    complete: netH != null && !cov.partial,
    netH,
    vatRate,
    grossH: netH == null ? null : withVat(netH, vatRate),
    excluded: Boolean(offer.excluded),
    leadDays: leadOf(offer.leadDays),
    validUntil: offer.validUntil ? String(offer.validUntil).slice(0, 10) : null,
  }
}

export const lineOf = (offer: OfferCalc, rfqProductIndex: number): OfferLineCalc | null => offer.lines.find((l) => l.rfqProductIndex === rfqProductIndex) || null

// ---------------------------------------------------------------------------
// Days: validity and arrival
// ---------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function addDaysISO(day: string, days: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const daysBetweenISO = (from: string, to: string): number => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400000)

/** CMP-18: a validity that has passed locks the offer; the last valid day is still valid. */
export const isExpired = (validUntil: string | null | undefined, today: string | null | undefined): boolean => Boolean(validUntil && today && DAY.test(validUntil.slice(0, 10)) && validUntil.slice(0, 10) < today.slice(0, 10))

export type ValidityState = "none" | "ok" | "soon" | "expired"

export function validityState(validUntil: string | null | undefined, today: string | null | undefined, soonDays = 2): ValidityState {
  if (!validUntil || !today || !DAY.test(validUntil.slice(0, 10))) return "none"
  const left = daysBetweenISO(today, validUntil)
  return left < 0 ? "expired" : left <= soonDays ? "soon" : "ok"
}

/** «يصل نحو»: today + the supplier's acceptance window + the offer's lead days. */
export function arrivalEstimate(today: string, acceptDays: number, leadDays: number | null | undefined): string | null {
  if (leadDays == null || !Number.isFinite(leadDays) || !DAY.test(today.slice(0, 10))) return null
  return addDaysISO(today, Math.max(0, Math.round(acceptDays)) + Math.max(0, Math.round(leadDays)))
}

export function arrivalVsNeed(arrival: string | null, needBy: string | null | undefined): { late: boolean; daysLate: number } | null {
  if (!arrival || !needBy) return null
  const d = daysBetweenISO(needBy, arrival)
  return { late: d > 0, daysLate: Math.max(0, d) }
}

// ---------------------------------------------------------------------------
// All offers of an RFQ side by side
// ---------------------------------------------------------------------------

export interface EvalOptions {
  /** Tie band in percent; the policy's `tieTolerancePercent` (default 0.5). */
  tiePercent?: number
  /** `YYYY-MM-DD`; without it nothing is expired. */
  today?: string | null
}

export interface OfferEval extends OfferCalc {
  live: boolean
  expired: boolean
  validity: ValidityState
  /** 1.. among live complete offers by ex-VAT total, the earlier offer first on an exact tie; null otherwise. */
  rank: number | null
  /** How far above the lowest complete offer, percent to 2 dp; 0 for the lowest, null for a partial or excluded one. */
  deltaPct: number | null
  /** Within the tie band of the lowest complete offer: «الأقل», no reason needed. */
  isLowestComplete: boolean
}

export interface LineEval {
  rfqProductIndex: number
  /** Live offers that priced this line (a lump sum prices every line): the competition count. */
  liveCount: number
  bestOfferId: string | null
  bestH: number | null
  /** Everyone within the tie band of the best — each is «الأقل». */
  lowestIds: string[]
}

export interface MixEval {
  netH: number
  grossH: number
  offerIds: string[]
  suppliers: number
  /** Lowest complete (gross) − this; null with no complete offer. */
  savingH: number | null
  savingPct: number | null
  /** The prototype only says it out loud when the saving is more than half a riyal. */
  worthSaying: boolean
}

export interface Evaluation {
  offers: OfferEval[]
  byId: Record<string, OfferEval>
  lowestComplete: OfferEval | null
  lines: LineEval[]
  mix: MixEval | null
  fastest: OfferEval | null
  thinnest: LineEval | null
  hasLive: boolean
  tiePercent: number
}

export function evaluateOffers(rfq: PricedRfq | null | undefined, offers: CalcOffer[], opts: EvalOptions = {}): Evaluation {
  const tiePercent = opts.tiePercent ?? TIE_PERCENT_DEFAULT
  const today = opts.today ?? null
  const products = pricedProducts(rfq)
  const calcs = offers.map((o) => calcOffer(rfq, o))

  const rankable = calcs.map((c, i) => ({ c, i })).filter((x) => !x.c.excluded && x.c.complete)
  const ranked = rankable.slice().sort((a, b) => (a.c.netH as number) - (b.c.netH as number) || a.i - b.i)
  const lowestC = ranked.length ? ranked[0].c : null
  const minNet = lowestC ? (lowestC.netH as number) : null
  const rankOf = new Map(ranked.map((x, k) => [x.i, k + 1]))

  const evals: OfferEval[] = calcs.map((c, i) => {
    const live = !c.excluded
    const rank = rankOf.get(i) ?? null
    return {
      ...c,
      live,
      expired: isExpired(c.validUntil, today),
      validity: validityState(c.validUntil, today),
      rank,
      deltaPct: rank == null || minNet == null || minNet === 0 ? null : Math.round(((((c.netH as number) - minNet) / minNet) * 100) * 100) / 100,
      isLowestComplete: rank != null && minNet != null && isTie(c.netH as number, minNet, tiePercent),
    }
  })

  const lowestComplete = lowestC ? evals[calcs.indexOf(lowestC)] : null

  const lines: LineEval[] = products.map((p) => {
    const cands = evals.filter((o) => o.live && lineOf(o, p.rfqProductIndex))
    let best: OfferEval | null = null
    for (const o of cands) if (best == null || (lineOf(o, p.rfqProductIndex) as OfferLineCalc).totalH < (lineOf(best, p.rfqProductIndex) as OfferLineCalc).totalH) best = o
    const bestH = best ? (lineOf(best, p.rfqProductIndex) as OfferLineCalc).totalH : null
    return {
      rfqProductIndex: p.rfqProductIndex,
      liveCount: evals.filter((o) => o.live && (o.kind === "lump" || lineOf(o, p.rfqProductIndex))).length,
      bestOfferId: best ? best.id : null,
      bestH,
      lowestIds: bestH == null ? [] : cands.filter((o) => isTie((lineOf(o, p.rfqProductIndex) as OfferLineCalc).totalH, bestH, tiePercent)).map((o) => o.id),
    }
  })

  let mix: MixEval | null = null
  if (lines.length > 0 && lines.every((l) => l.bestOfferId != null)) {
    const bestOffers = lines.map((l) => evals.find((o) => o.id === l.bestOfferId) as OfferEval)
    const netH = lines.reduce((s, l) => s + (l.bestH as number), 0)
    const grossH = roundHalfUp(lines.reduce((s, l, k) => s + (l.bestH as number) * permille(bestOffers[k].vatRate), 0) / 1000)
    const savingH = lowestComplete && lowestComplete.grossH != null ? lowestComplete.grossH - grossH : null
    mix = {
      netH,
      grossH,
      offerIds: [...new Set(lines.map((l) => l.bestOfferId as string))],
      suppliers: new Set(lines.map((l) => l.bestOfferId)).size,
      savingH,
      savingPct: savingH != null && lowestComplete && lowestComplete.grossH ? Math.round((savingH / lowestComplete.grossH) * 10000) / 100 : null,
      worthSaying: savingH != null && savingH > 50,
    }
  }

  const live = evals.filter((o) => o.live && o.netH != null)
  const pool = live.some((o) => o.complete) ? live.filter((o) => o.complete) : live
  const fastest = pool.slice().sort((a, b) => (a.leadDays ?? Infinity) - (b.leadDays ?? Infinity) || (a.netH as number) - (b.netH as number))[0] || null

  const thinnest = lines.length ? lines.reduce((m, l) => (l.liveCount < m.liveCount ? l : m)) : null

  return {
    offers: evals,
    byId: Object.fromEntries(evals.map((o) => [o.id, o])),
    lowestComplete,
    lines,
    mix,
    fastest,
    thinnest,
    hasLive: evals.some((o) => o.live),
    tiePercent,
  }
}

/** G-03: THE lowest complete offer — header, best-of card, row #1, RFQ card and Today all read this one function. */
export const lowestCompleteOffer = (rfq: PricedRfq | null | undefined, offers: CalcOffer[], opts?: EvalOptions): OfferEval | null => evaluateOffers(rfq, offers, opts).lowestComplete

/** The best offer on one line among those that pass `allow` — «الأقل من الموثّقين بعرض رسمي» is the same call with a filter. */
export function lowestOnLine(ev: Evaluation, rfqProductIndex: number, allow?: (o: OfferEval) => boolean): OfferEval | null {
  let best: OfferEval | null = null
  for (const o of ev.offers) {
    if (!o.live || !lineOf(o, rfqProductIndex) || (allow && !allow(o))) continue
    if (best == null || (lineOf(o, rfqProductIndex) as OfferLineCalc).totalH < (lineOf(best, rfqProductIndex) as OfferLineCalc).totalH) best = o
  }
  return best
}

// ---------------------------------------------------------------------------
// Competition (CMP-17, G-18): live offers per LINE against the policy limit
// ---------------------------------------------------------------------------

export interface AwardPick {
  rfqProductIndex: number
  offerId: string
}

export interface LowCompetition {
  lines: Array<{ rfqProductIndex: number; liveCount: number }>
  /** Ex-VAT value of what is being awarded. */
  netH: number
  /** Thin lines AND the value is above the threshold: a reason is owed (never a block). */
  required: boolean
}

export function awardNetH(ev: Evaluation, picks: AwardPick[]): number {
  let total = 0
  const lumpSeen = new Set<string>()
  for (const p of picks) {
    const o = ev.byId[p.offerId]
    if (!o) continue
    if (o.kind === "lump") {
      if (!lumpSeen.has(o.id)) total += o.netH ?? 0
      lumpSeen.add(o.id)
    } else total += lineOf(o, p.rfqProductIndex)?.totalH ?? 0
  }
  return total
}

export function lowCompetition(ev: Evaluation, picks: AwardPick[], policy: { limit?: number; thresholdSar?: number } = {}): LowCompetition {
  const limit = policy.limit ?? COMPETITION_LIMIT_DEFAULT
  const thresholdH = toHalalas(policy.thresholdSar ?? COMPETITION_THRESHOLD_DEFAULT)
  const thin = picks.map((p) => ev.lines.find((l) => l.rfqProductIndex === p.rfqProductIndex)).filter((l): l is LineEval => Boolean(l) && (l as LineEval).liveCount < limit)
  const netH = awardNetH(ev, picks)
  const lines = thin.map((l) => ({ rfqProductIndex: l.rfqProductIndex, liveCount: l.liveCount }))
  return { lines, netH, required: lines.length > 0 && netH > thresholdH }
}

export const LOW_COMPETITION_REASONS = ["urgent", "no_alternatives", "near_last_price", "other"] as const
export type LowCompetitionReason = (typeof LOW_COMPETITION_REASONS)[number]

// ---------------------------------------------------------------------------
// Awarding something other than the lowest (CMP-08, G-04): a reason the numbers back
// ---------------------------------------------------------------------------

export const AWARD_WHY_CODES = ["fastest", "reliability", "warranty", "official_quote", "one_supplier", "other"] as const
export type AwardWhyCode = (typeof AWARD_WHY_CODES)[number]

/** A pick is the lowest on its line when it sits within the tie band of the line's best; a lump sum, of the lowest complete offer. */
export function isLowestPick(ev: Evaluation, pick: AwardPick): boolean {
  const o = ev.byId[pick.offerId]
  if (!o) return false
  if (o.kind === "lump") return o.isLowestComplete
  const line = ev.lines.find((l) => l.rfqProductIndex === pick.rfqProductIndex)
  return Boolean(line && line.lowestIds.includes(pick.offerId))
}

export const nonLowestPicks = (ev: Evaluation, picks: AwardPick[]): AwardPick[] => picks.filter((p) => !isLowestPick(ev, p))

export interface ReasonFacts {
  leadDays: number | null
  /** The supplier's on-time rate, 0–100; null without a record. */
  onTimeRate: number | null
  hasOfficialQuote: boolean
  /** Whether the offered warranty meets the line's requirement; null when none is required. */
  warrantyMet: boolean | null
}

export interface NonLowestLine {
  awarded: ReasonFacts
  lowest: ReasonFacts
}

/**
 * A structured reason is offered only when the numbers back it (R-15):
 * fastest — faster on EVERY passed-over line · reliability — a higher on-time rate on every one ·
 * warranty — the lowest fails the warranty on at least one · official_quote — the lowest has none and ours does ·
 * one_supplier — the award uses fewer suppliers than the cheapest split would. `other` is always open (and needs text).
 */
export function awardReasonEligible(code: AwardWhyCode, lines: NonLowestLine[], ctx: { awardedSuppliers: number; splitSuppliers: number }): boolean {
  switch (code) {
    case "fastest":
      return lines.length > 0 && lines.every((l) => l.awarded.leadDays != null && l.lowest.leadDays != null && l.awarded.leadDays < l.lowest.leadDays)
    case "reliability":
      return lines.length > 0 && lines.every((l) => l.awarded.onTimeRate != null && (l.lowest.onTimeRate == null || l.awarded.onTimeRate > l.lowest.onTimeRate))
    case "warranty":
      return lines.some((l) => l.lowest.warrantyMet === false)
    case "official_quote":
      return lines.length > 0 && lines.every((l) => !l.lowest.hasOfficialQuote && l.awarded.hasOfficialQuote)
    case "one_supplier":
      return ctx.awardedSuppliers < ctx.splitSuppliers
    case "other":
      return true
  }
}

export type ReasonRefusal = "reason_required" | "reason_untrue" | "reason_text_short"

/** What a server (or the review dialog) says about the reason given for a non-lowest award; null when it stands. */
export function awardReasonRefusal(why: { code: string; text?: string | null } | null | undefined, lines: NonLowestLine[], ctx: { awardedSuppliers: number; splitSuppliers: number }): ReasonRefusal | null {
  if (!lines.length) return null
  if (!why || !(AWARD_WHY_CODES as readonly string[]).includes(why.code)) return "reason_required"
  const code = why.code as AwardWhyCode
  if (!awardReasonEligible(code, lines, ctx)) return "reason_untrue"
  if (code === "other" && (why.text || "").trim().length < OTHER_REASON_MIN_CHARS) return "reason_text_short"
  return null
}

/** The low-competition reason, same rules: required when `lowCompetition().required`, `other` needs text. */
export function lowCompetitionReasonRefusal(why: { code: string; text?: string | null } | null | undefined, low: LowCompetition): "lowcomp_reason_required" | "reason_text_short" | null {
  if (!low.required) return null
  if (!why || !(LOW_COMPETITION_REASONS as readonly string[]).includes(why.code)) return "lowcomp_reason_required"
  if (why.code === "other" && (why.text || "").trim().length < OTHER_REASON_MIN_CHARS) return "reason_text_short"
  return null
}

// The notes under an RFQ's comparison (the prototype's `dRfq` notes, PRD 3.0
// §6.2-§6.3): things the buyer should read BEFORE picking — never a stop. They
// only exist once prices are open: a sealed round says nothing about prices.
//
// What each note reads is what the offer actually carries. Several facts
// (validity, price basis, advance %, credit days, a need date per material)
// are optional fields newer offer and RFQ forms write; an offer without them
// simply produces no note on that point — silence, not a guess.
//
// Pure: no I/O. The screen passes the last-price lookup and each supplier's
// on-time record; the result is a closed vocabulary rendered from
// `Portal.Procurement.rfqNote.*`.

import { competingOffers } from "./award"
import { offerRates, pricedProducts, toAmount, type PricedRfq, type RatedOffer } from "./offer-pricing"
import { aboveLastPaid } from "./prices"
import { daysBetween, daysFromNow, dayOf, isShortCompetition, round2, todayOf } from "./po"
import { awardMode, bestPerLine, offerTotal } from "./rfq-award"
import type { ProcurementPolicies } from "./types"

export type RfqNoteTone = "bad" | "warn" | "info"

export type RfqNoteCode =
  | "outlier"
  | "above_last"
  | "omits_lines"
  | "lead_misses_need"
  | "on_time_low"
  | "guest_cash_advance"
  | "ex_works"
  | "shipment_after_need"
  | "validity_ending"
  | "short_competition"

export interface RfqNote {
  tone: RfqNoteTone
  code: RfqNoteCode
  params: Record<string, string | number>
}

export interface NoteOffer extends RatedOffer {
  id: string
  status?: string | null
  supplierName?: string | null
  companyName?: string | null
  isGuestOffer?: boolean | null
  supplierId?: string | null
  organizationId?: string | null
  supplierOrgId?: string | null
  executionDuration?: string | number | null
  executionDurationUnit?: string | null
  /** `YYYY-MM-DD` — the day the offer stops binding. */
  validUntil?: string | null
  /** "site" (delivered) | "exw" (ex-works, haulage is ours). */
  priceBasis?: string | null
  advancePercent?: number | null
  creditDays?: number | null
  deliveryBatches?: Array<{ deliveryDate?: string | null; quantity?: unknown }> | null
}

export interface NoteRfq extends PricedRfq {
  status?: string | null
  /** A need date for the whole request, when the RFQ carries one. */
  needBy?: string | null
  products?: Array<{ name?: string | null; quantity?: number | string | null; unitOfMeasure?: string | null; unit?: string | null; needBy?: string | null }> | null
}

export interface NoteContext {
  lastPaidOf: (name: string, unit: string) => { price: number } | null
  /** The supplier's on-time percent over his past orders — null when unknown. */
  onTimeOf: (offer: NoteOffer) => number | null
  /** Whether the offer comes from a supplier with a verified record (a guest never counts). */
  registeredOf?: (offer: NoteOffer) => boolean
  policies: ProcurementPolicies
  now: Date
  /** The RFQ's value for the competition threshold — an estimate, or the lowest offer. */
  value?: number | null
}

export const RFQ_NOTE_LIMIT = 6
export const OUTLIER_BELOW_AVERAGE = 0.8
export const ON_TIME_FLOOR = 80
export const VALIDITY_WARN_DAYS = 2

const nameOf = (o: NoteOffer) => (o.companyName || o.supplierName || "").trim() || "—"

function leadDays(o: NoteOffer): number | null {
  const n = parseInt(String(o.executionDuration ?? ""), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const u = o.executionDurationUnit || ""
  return n * (u === "أشهر" ? 30 : u === "أسابيع" ? 7 : 1)
}

const needOf = (rfq: NoteRfq, i: number): string | null => dayOf(rfq.products?.[i]?.needBy || rfq.needBy || "") || null

export function rfqNotes(rfq: NoteRfq, offers: NoteOffer[], ctx: NoteContext): RfqNote[] {
  const live = competingOffers(offers)
  if (!live.length) return []
  const notes: RfqNote[] = []
  const products = pricedProducts(rfq)
  const mode = awardMode(rfq)
  const today = todayOf(ctx.now)
  const rates = new Map(live.map((o) => [o.id, new Map(offerRates(rfq, o).map((r) => [r.rfqProductIndex, r.unitPrice]))]))

  for (const p of products) {
    const ps = live.map((o) => rates.get(o.id)?.get(p.rfqProductIndex)).filter((x): x is number => x != null)
    if (ps.length > 1) {
      const min = Math.min(...ps)
      const avg = ps.reduce((s, x) => s + x, 0) / ps.length
      if (min < avg * OUTLIER_BELOW_AVERAGE) notes.push({ tone: "bad", code: "outlier", params: { line: p.name } })
    }
  }
  const best = bestPerLine(rfq, live)
  for (const p of products) {
    const b = best[p.rfqProductIndex]
    const last = p.name ? ctx.lastPaidOf(p.name, p.unit) : null
    if (!b || !last) continue
    const pct = aboveLastPaid(b.unitPrice, last.price)
    if (pct != null) notes.push({ tone: "warn", code: "above_last", params: { line: p.name, best: b.unitPrice, last: last.price, percent: round2(pct) } })
  }

  for (const o of live) {
    const quoted = rates.get(o.id) || new Map<number, number>()
    const supplier = nameOf(o)
    if (mode === "lines" && products.length > 1) {
      const miss = products.filter((p) => !quoted.has(p.rfqProductIndex)).length
      if (miss > 0 && quoted.size > 0) notes.push({ tone: "info", code: "omits_lines", params: { supplier, count: miss } })
    }
    const lead = leadDays(o)
    if (lead != null) {
      const late = products.filter((p) => (mode === "whole" || quoted.has(p.rfqProductIndex)) && needOf(rfq, p.rfqProductIndex) && daysBetween(today, needOf(rfq, p.rfqProductIndex) as string) < lead)
      if (late.length) notes.push({ tone: "warn", code: "lead_misses_need", params: { supplier, days: lead } })
    }
    const onTime = o.isGuestOffer ? null : ctx.onTimeOf(o)
    if (onTime != null && onTime < ON_TIME_FLOOR) notes.push({ tone: "warn", code: "on_time_low", params: { supplier, percent: onTime } })
    const cash = toAmount(o.advancePercent) >= 100 || (o.creditDays != null && toAmount(o.creditDays) === 0 && o.advancePercent == null)
    if (o.isGuestOffer && cash) notes.push({ tone: "bad", code: "guest_cash_advance", params: { supplier } })
    if (o.priceBasis === "exw") notes.push({ tone: "warn", code: "ex_works", params: { supplier } })
    for (const sh of o.deliveryBatches || []) {
      const day = dayOf(sh.deliveryDate || "")
      if (!day) continue
      const need = products.map((p) => needOf(rfq, p.rfqProductIndex)).filter((d): d is string => Boolean(d)).sort()[0]
      if (need && day > need) {
        notes.push({ tone: "warn", code: "shipment_after_need", params: { supplier, date: day, need } })
        break
      }
    }
    const left = daysFromNow(o.validUntil, ctx.now)
    if (left != null && left >= 0 && left <= VALIDITY_WARN_DAYS && rfq.status !== "Awarded") notes.push({ tone: "bad", code: "validity_ending", params: { supplier, date: dayOf(o.validUntil), days: left } })
  }

  const registered = live.filter((o) => !o.isGuestOffer && (ctx.registeredOf ? ctx.registeredOf(o) : true)).length
  const value = ctx.value ?? live.reduce<number | null>((m, o) => {
    const t = offerTotal(o)
    return t == null ? m : m == null || t < m ? t : m
  }, null)
  if (registered < ctx.policies.minOffers && (value == null || isShortCompetition(value, registered, ctx.policies))) {
    notes.push({ tone: "warn", code: "short_competition", params: { count: registered, threshold: ctx.policies.competitionThreshold } })
  }
  return notes.slice(0, RFQ_NOTE_LIMIT)
}

// Procurement's needs desk (PRD 3.0 §7.2, the reference prototype's
// «طلبات الشراء الواردة»): every need from `./needs` cut into ONE ROW PER
// MATERIAL LINE, each with where it is now, its computed path, its estimate
// at the price we would pay, and its LAST ORDER DAY — the need-by date minus
// the supplier's lead time minus the buying cycle. The desk sorts by that
// day, not by arrival: a line that arrived last may be the one a site stops for.
//
// A project's request keeps its links (RFQ, order) on the REQUEST, not per
// line, so its lines travel together: they are selected, ordered and linked
// as one. Nothing here is stored; nothing here reads Firestore.

import { addDays, daysBetween, round2, todayOf } from "./po"
import { agreementFor, lastPaid, materialKey, type PriceAgreement, type PriceHistoryEntry } from "./prices"
import { needRoute, type NeedRoute, type RouteResult } from "./route"
import type { Need } from "./needs"
import { sampleNo } from "@/lib/pm/sample"
import { replyWindowHours } from "./policy-enforce"
import type { ProcurementPolicies, PurchaseOrder } from "./types"

/** Where a line is now. open/late/mfgl = Purchasing's move; chk/mfgw/mfg =
 * another module's; rfq/po = in hand; done/stk/cx = finished. */
export type LineState = "open" | "late" | "mfgl" | "chk" | "pmw" | "mfgw" | "mfg" | "rfq" | "po" | "done" | "stk" | "cx"
export const ACTION_STATES: LineState[] = ["open", "late", "mfgl"]
export const isActionState = (s: LineState) => ACTION_STATES.includes(s)

/** The computed path — one act per line. `mfg` = ask our workshop first. */
export type NeedPath = NeedRoute | "mfg"

export type DeskSegment = "act" | "oth" | "rfq" | "po" | "done" | "all"
export const DESK_SEGMENTS: DeskSegment[] = ["act", "oth", "rfq", "po", "done", "all"]

/** A material with no order history: the prototype's lead for an uncatalogued item. */
export const DEFAULT_LEAD_DAYS = 10

export interface MfgRequestFact {
  status: string
  /** ISO — when it was asked. */
  at: string | null
}

export interface DeskFacts {
  now: Date
  policies: ProcurementPolicies
  agreements: PriceAgreement[]
  history: PriceHistoryEntry[]
  orders: PurchaseOrder[]
  rfqs: Array<{ category?: string | null; createdAt?: unknown; products?: Array<{ name?: string; unit?: string; unitOfMeasure?: string }> | null }>
  /** What the stores hold of a material; null = not stocked or not read yet. */
  onHand: (name: string) => number | null
  /** Our workshop makes it (a product card of that name). */
  makeable: (name: string) => boolean
  mfgRequests: Record<string, MfgRequestFact>
}

export interface NeedRow {
  key: string
  needKey: string
  need: Need
  index: number
  name: string
  unit: string
  total: number
  /** Still to be sourced (the total less what the stores were relied on for). */
  open: number
  state: LineState
  path: NeedPath | null
  route: RouteResult | null
  needBy: string | null
  leadDays: number
  lastOrderDay: string | null
  /** Days from today to the last order day; negative = passed. */
  lastOrderIn: number | null
  unitEstimate: number | null
  estimate: number | null
  category: string | null
  samplePending: boolean
  /** The project's BOQ item, for a project request's line. */
  itemId: string | null
  /** Our cover in stock, as the stores read now (null = not stocked). */
  onHand: number | null
  selectable: boolean
}

const ageHours = (at: string | null | undefined, now: Date): number | null => {
  const t = at ? Date.parse(at) : NaN
  return Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : null
}

/** The state every line of one need shares. */
/** Inventory's stock check and the workshop's reply both fail OPEN after the
 * org's reply window (the prototype's POL.sla, `replyWindowDays`). */
export function needLineState(need: Need, facts: Pick<DeskFacts, "now" | "mfgRequests" | "policies">): LineState {
  const window = replyWindowHours(facts.policies)
  switch (need.state) {
    case "action":
      return "open"
    case "rfq":
      return "rfq"
    case "order":
      return "po"
    case "done":
      return need.endKind === "arrived" || need.kind === "stock" ? "done" : "cx"
    case "waiting": {
      // A PM request the project manager has not approved yet: shown, never Procurement's to act on.
      if (need.waitingOn === "project") return "pmw"
      if (need.waitingOn === "workshop") {
        const mr = need.mfgRequestId ? facts.mfgRequests[need.mfgRequestId] : undefined
        if (!mr) return "mfgw"
        if (mr.status === "rejected" || mr.status === "moved") return "open"
        if (mr.status !== "new") return "mfg"
        const age = ageHours(mr.at, facts.now)
        return age != null && age >= window ? "mfgl" : "mfgw"
      }
      const age = ageHours(need.at, facts.now)
      return age != null && age > window ? "late" : "chk"
    }
  }
}

/** The supplier's lead for a material: what the last order that said so said, else the default. */
export function leadDaysOf(orders: PurchaseOrder[], name: string, unit: string): number {
  const key = materialKey(name, unit)
  let best: { at: string; days: number } | null = null
  for (const po of orders) {
    const days = Number(po.leadTimeDays)
    if (!(days > 0) || !po.lines.some((l) => materialKey(l.name, l.unit) === key)) continue
    if (!best || po.createdAt > best.at) best = { at: po.createdAt, days }
  }
  return best ? best.days : DEFAULT_LEAD_DAYS
}

/** need − lead − (an RFQ's window and award cycle, or a day to place an order). */
export function lastOrderDayOf(needBy: string | null, leadDays: number, path: NeedPath | null, policies: Pick<ProcurementPolicies, "rfqWindowDays" | "awardCycleDays">): string | null {
  if (!needBy) return null
  const cycle = path === "rfq" ? policies.rfqWindowDays + policies.awardCycleDays : 1
  return addDays(needBy, -(leadDays + cycle))
}

/** A line's category: the source says so, else the latest order or RFQ that named the material. */
export function categoryOf(name: string, unit: string, own: string | null | undefined, facts: Pick<DeskFacts, "orders" | "rfqs">): string | null {
  if (own) return own
  const key = materialKey(name, unit)
  const nameOnly = materialKey(name, "")
  let best: { at: string; cat: string } | null = null
  const consider = (at: string, cat: string | null | undefined) => {
    if (cat && (!best || at > best.at)) best = { at, cat }
  }
  for (const po of facts.orders) if (po.lines.some((l) => materialKey(l.name, l.unit) === key)) consider(po.createdAt || "", po.category)
  for (const r of facts.rfqs) {
    if (!(r.products || []).some((p) => materialKey(p.name, p.unit || p.unitOfMeasure) === key || materialKey(p.name, "") === nameOnly)) continue
    const at = r.createdAt as { toDate?: () => Date } | string | null | undefined
    consider(typeof at === "string" ? at : at && typeof at.toDate === "function" ? at.toDate().toISOString() : "", r.category)
  }
  return (best as { at: string; cat: string } | null)?.cat ?? null
}

export function unitEstimateOf(name: string, unit: string, facts: Pick<DeskFacts, "agreements" | "history">, today: string): number | null {
  return agreementFor(facts.agreements, name, unit, today)?.price ?? lastPaid(facts.history, name, unit)?.price ?? null
}

/** The path of a whole need: its lines are ordered together. */
export function needPathOf(need: Need, state: LineState, facts: DeskFacts): { path: NeedPath; route: RouteResult | null } | null {
  if (!isActionState(state)) return null
  if (state === "mfgl") return { path: "rfq", route: null }
  if (need.kind === "project" && !need.mfgRequestId && need.decision?.kind !== "buy" && need.lines.some((l) => facts.makeable(l.name))) return { path: "mfg", route: null }
  const proceeded = need.decision?.kind === "proceed_short" || need.decision?.kind === "proceed_full"
  const route = needRoute({
    lines: need.lines.map((l, i) => ({ ...l, quantity: openOf(need, i), onHand: need.kind === "stock" || proceeded ? null : facts.onHand(l.name) })),
    agreements: facts.agreements,
    history: facts.history,
    directCap: facts.policies.directPurchaseCap,
    today: todayOf(facts.now),
  })
  return { path: route.route, route }
}

function openOf(need: Need, i: number): number {
  const q = need.lines[i]?.quantity ?? 0
  if (need.decision?.kind !== "proceed_short") return q
  return Math.max(0, round2(q - (Number(need.decision.cover?.[i]) || 0)))
}

export function buildNeedRows(needs: Need[], facts: DeskFacts): NeedRow[] {
  const today = todayOf(facts.now)
  const out: NeedRow[] = []
  for (const need of needs) {
    const state = needLineState(need, facts)
    const p = needPathOf(need, state, facts)
    need.lines.forEach((l, index) => {
      const open = openOf(need, index)
      const needBy = l.needBy || need.needBy
      const leadDays = leadDaysOf(facts.orders, l.name, l.unit)
      const lastOrderDay = isActionState(state) ? lastOrderDayOf(needBy, leadDays, p?.path ?? null, facts.policies) : null
      const unitEstimate = unitEstimateOf(l.name, l.unit, facts, today)
      const samplePending = Boolean(l.samplePending)
      out.push({
        key: `${need.key}#${index}`,
        needKey: need.key,
        need,
        index,
        name: l.name,
        unit: l.unit,
        total: l.quantity,
        open,
        state,
        path: p?.path ?? null,
        route: p?.route ?? null,
        needBy,
        leadDays,
        lastOrderDay,
        lastOrderIn: lastOrderDay ? daysBetween(today, lastOrderDay) : null,
        unitEstimate,
        estimate: unitEstimate == null ? null : round2(unitEstimate * open),
        category: categoryOf(l.name, l.unit, l.category, facts),
        samplePending,
        itemId: l.itemId ?? null,
        onHand: need.kind === "stock" ? need.stock?.onHand ?? null : facts.onHand(l.name),
        selectable: (state === "open" || state === "mfgl") && p?.path !== "mfg" && p?.path !== "stock",
      })
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The RFQ form's «من الاحتياج المفتوح» (R-19): open needs the request can
// take — in the lines' categories, inside a buyer's scope, never one whose
// path is our own workshop — nearest last order day first, eight at most.
// ---------------------------------------------------------------------------

export const FORM_NEED_CHOICES = 8

/** A project need our workshop makes and nobody has asked it yet — its path is the workshop, not an RFQ. */
export const goesToWorkshop = (need: Need, makeable: (name: string) => boolean): boolean =>
  need.kind === "project" && !need.mfgRequestId && need.decision?.kind !== "buy" && need.lines.some((l) => makeable(l.name))

export function formNeedChoices(
  needs: Need[],
  opts: {
    exclude: (need: Need) => boolean
    /** The categories already on the form's lines; none = any. */
    categories: string[]
    /** A buyer's categories; null or empty = everything. */
    buyerCategories: string[] | null
    makeable: (name: string) => boolean
    facts: Pick<DeskFacts, "orders" | "rfqs" | "policies">
    max?: number
  }
): Need[] {
  const far = "9999-12-31"
  const scored = needs
    .filter((n) => !opts.exclude(n) && !goesToWorkshop(n, opts.makeable))
    .map((n) => {
      const cats = Array.from(new Set(n.lines.map((l) => categoryOf(l.name, l.unit, l.category, opts.facts)).filter((c): c is string => Boolean(c))))
      const days = n.lines.map((l) => lastOrderDayOf(l.needBy || n.needBy, leadDaysOf(opts.facts.orders, l.name, l.unit), "rfq", opts.facts.policies)).filter((d): d is string => Boolean(d))
      return { n, cats, last: days.length ? days.sort()[0] : far }
    })
    .filter(({ cats }) => !cats.length || !opts.categories.length || cats.some((c) => opts.categories.includes(c)))
    .filter(({ cats }) => !cats.length || !opts.buyerCategories?.length || cats.some((c) => (opts.buyerCategories as string[]).includes(c)))
  return scored
    .sort((a, b) => a.last.localeCompare(b.last) || (a.n.needBy || far).localeCompare(b.n.needBy || far) || a.n.key.localeCompare(b.n.key))
    .slice(0, opts.max ?? FORM_NEED_CHOICES)
    .map(({ n }) => n)
}

// ---------------------------------------------------------------------------
// The list: segments, order, scope
// ---------------------------------------------------------------------------

export function inSegment(row: Pick<NeedRow, "state">, seg: DeskSegment): boolean {
  const s = row.state
  if (seg === "all") return true
  if (seg === "act") return isActionState(s)
  if (seg === "oth") return s === "chk" || s === "pmw" || s === "mfgw" || s === "mfg"
  if (seg === "rfq") return s === "rfq"
  if (seg === "po") return s === "po"
  return s === "done" || s === "stk" || s === "cx"
}

export function segmentCounts(rows: NeedRow[]): Record<DeskSegment, number> {
  const out = { act: 0, oth: 0, rfq: 0, po: 0, done: 0, all: rows.length }
  for (const r of rows) for (const s of ["act", "oth", "rfq", "po", "done"] as const) if (inSegment(r, s)) out[s]++
  return out
}

/** Needs action: by the last order day (none last). Elsewhere: by the need date. */
export function sortRows(rows: NeedRow[], seg: DeskSegment): NeedRow[] {
  const far = 1e6
  return [...rows].sort((a, b) =>
    seg === "act"
      ? (a.lastOrderIn ?? far) - (b.lastOrderIn ?? far) || (a.needBy || "9999").localeCompare(b.needBy || "9999") || a.key.localeCompare(b.key)
      : (a.needBy || "9999").localeCompare(b.needBy || "9999") || a.key.localeCompare(b.key)
  )
}

/** A buyer sees his categories; no categories set = all; a line of unknown
 * category is everyone's — a hidden need is a site that stops. */
export function inBuyerScope(row: Pick<NeedRow, "category">, categories: string[] | null | undefined): boolean {
  if (!categories || !categories.length || !row.category) return true
  return categories.includes(row.category)
}

/** The number of an item's sample now with the consultant: its latest submittal (highest revision, then sequence). */
export function latestSampleNo(submittals: Array<{ seq: number; rev: number }>): string | null {
  const latest = submittals.slice().sort((a, b) => b.rev - a.rev || b.seq - a.seq)[0]
  return latest ? sampleNo(latest.seq) : null
}

/** A bare material (a workshop shortfall) against a buyer's categories — read as the desk reads a line. */
export function materialInScope(name: string, unit: string, categories: string[] | null | undefined, facts: Pick<DeskFacts, "orders" | "rfqs">): boolean {
  return inBuyerScope({ category: categoryOf(name, unit, null, facts) }, categories)
}

// ---------------------------------------------------------------------------
// Selection: several lines, one act
// ---------------------------------------------------------------------------

export interface MergeHint {
  by: "category" | "project"
  label: string
  needKeys: string[]
  lines: number
}

/** Lines going to an RFQ that share a category (else a project) and are not
 * all selected yet — the volume improves the price, each line stays its own. */
export function mergeHint(rows: NeedRow[], selected: Set<string>, opts: { project?: boolean } = {}): MergeHint | null {
  const pool = rows.filter((r) => r.state === "open" && r.path === "rfq" && r.selectable)
  for (const by of opts.project === false ? (["category"] as const) : (["category", "project"] as const)) {
    const groups = new Map<string, NeedRow[]>()
    for (const r of pool) {
      const k = by === "category" ? r.category : r.need.projectName
      if (k) groups.set(k, [...(groups.get(k) || []), r])
    }
    for (const [label, list] of Array.from(groups.entries())) {
      const keys = Array.from(new Set(list.map((r) => r.needKey)))
      if (list.length > 1 && !keys.every((k) => selected.has(k))) return { by, label, needKeys: keys, lines: list.length }
    }
  }
  return null
}

export interface SelectionSummary {
  rows: NeedRow[]
  needs: Need[]
  lines: number
  /** ≈ the open quantities at the agreement / last price; null when a line has none. */
  value: number | null
  /** Every line is covered by ONE live agreement. */
  agreement: PriceAgreement | null
  /** Under the direct-order cap and not an agreement order. */
  directOk: boolean
}

export function selectionSummary(rows: NeedRow[], selected: Set<string>, facts: Pick<DeskFacts, "agreements" | "policies" | "now">): SelectionSummary {
  const picked = rows.filter((r) => selected.has(r.needKey) && r.selectable && r.open > 0)
  const needs = Array.from(new Map(picked.map((r) => [r.needKey, r.need])).values())
  const value = picked.length && picked.every((r) => r.estimate != null) ? round2(picked.reduce((s, r) => s + (r.estimate ?? 0), 0)) : null
  const today = todayOf(facts.now)
  const matches = picked.map((r) => agreementFor(facts.agreements, r.name, r.unit, today)?.agreement ?? null)
  const agreement = picked.length && matches.every((a) => a && a.id === matches[0]?.id) ? matches[0] : null
  return { rows: picked, needs, lines: picked.length, value, agreement, directOk: !agreement && value != null && value <= facts.policies.directPurchaseCap }
}

// ---------------------------------------------------------------------------
// What Today reads
// ---------------------------------------------------------------------------

export interface BuyerScope {
  uid: string
  name: string
  categories: string[]
}

export interface BuyerRollup {
  buyer: BuyerScope | null
  count: number
  overdue: number
  /** The nearest last order day, days from today (null when no line has one). */
  nearest: number | null
}

export const actionRows = (rows: NeedRow[]) => rows.filter((r) => isActionState(r.state))

/** A manager does not see every buyer's lines: one row per buyer with what is
 * his, and the lines no buyer's categories cover (the manager's own). */
export function buyerRollups(rows: NeedRow[], buyers: BuyerScope[]): { rollups: BuyerRollup[]; uncovered: NeedRow[] } {
  const act = actionRows(rows)
  const withCats = buyers.filter((b) => b.categories.length)
  const covered = new Set<string>()
  const rollups: BuyerRollup[] = []
  for (const b of withCats) {
    const mine = act.filter((r) => r.category && b.categories.includes(r.category))
    mine.forEach((r) => covered.add(r.key))
    if (!mine.length) continue
    const days = mine.map((r) => r.lastOrderIn).filter((d): d is number => d != null)
    rollups.push({ buyer: b, count: mine.length, overdue: days.filter((d) => d < 0).length, nearest: days.length ? Math.min(...days) : null })
  }
  return { rollups, uncovered: act.filter((r) => !covered.has(r.key)) }
}

export function rollupOf(rows: NeedRow[]): BuyerRollup | null {
  if (!rows.length) return null
  const days = rows.map((r) => r.lastOrderIn).filter((d): d is number => d != null)
  return { buyer: null, count: rows.length, overdue: days.filter((d) => d < 0).length, nearest: days.length ? Math.min(...days) : null }
}

/** «احتياج بلا أمر شراء» and «فات آخر يوم لطلبها». */
export function needKpi(rows: NeedRow[]): { need: number; overdue: number } {
  const act = actionRows(rows)
  return { need: act.length, overdue: act.filter((r) => r.lastOrderIn != null && r.lastOrderIn < 0).length }
}

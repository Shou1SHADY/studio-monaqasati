// «طلبات العروض» — the list (Procurement 2.0 screens table, NFR-03, G-03): tiles or rows over the company's RFQs with one method.
// States are the RFQ page's (`pageState`: open · comparing · awarded · cancelled; a draft lives apart), filters are the prototype's —
// search · delivery site · category · who it reaches · sort — and every option carries the count it would leave. The lowest complete
// offer is the evaluation's own (`lowestCompleteOffer`), so the card, the page header, «أفضل ما وصل» and Today print one number.
// Dozens or hundreds of RFQs: filter, sort, then cut to the first 24 and offer «عرض N أخرى». Pure: no I/O, no clock but `today`.

import { foldSearchText } from "../search-text"
import { toCalcOffer, type PlanOffer } from "./award-plan"
import { displayDocNumber } from "./format"
import { projectSiteId } from "./delivery-sites"
import type { DecisionMap } from "./offer-decisions"
import { basisOf, daysBetweenISO, lowestCompleteOffer, type PricedRfq } from "./offer-calc"
import { originOf, supplierNameOfOffer, type RowOffer } from "./rfq-offers-view"
import { noLiveOffer, type NoLive } from "./rfq-no-live"
import { pageState, type PageStage } from "./rfq-path"
import { GENERAL_STOCK, WORKSHOP, rfqCategories, type RfqListLike } from "./rfq-view"

export const RFQ_LIST_PAGE = 24

export type ListState = PageStage
export const LIST_SEGMENTS = ["open", "compare", "awarded", "cancelled", "all"] as const
export type ListSegment = (typeof LIST_SEGMENTS)[number]
export type ListView = ListSegment | "draft"

export type ListReach = "public" | "private" | "direct"
export const LIST_REACHES: readonly ListReach[] = ["public", "private", "direct"]

export const LIST_SORTS = ["close", "new", "offers"] as const
export type ListSort = (typeof LIST_SORTS)[number]

export type ListLayout = "cards" | "rows"
export const LIST_LAYOUTS: readonly ListLayout[] = ["cards", "rows"]

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

const msOf = (v: unknown): number => {
  if (!v) return 0
  if (typeof v === "string" || typeof v === "number") return new Date(v).getTime() || 0
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === "function") return o.toDate().getTime()
  if (typeof o.seconds === "number") return o.seconds * 1000
  return 0
}

export type ListRfq = Omit<RfqListLike, "products"> & {
  title?: string | null
  rfqNumber?: string | null
  district?: string | null
  audience?: string | null
  visibility?: string | null
  allowedSupplierOrgIds?: string[] | null
  reachedCount?: number | null
  closedEarly?: { at?: string | null; originalDeadline?: string | null; reason?: string | null } | null
  earlyClosed?: { at?: string | null; originalDeadline?: string | null } | null
  awardReopened?: unknown
  cancellation?: { code?: string | null; at?: string | null } | null
  createdAt?: unknown
  publishedAt?: unknown
  description?: string | null
  subCategory?: string | null
  pricingMode?: string | null
  shipmentMode?: string | null
  products?: Array<{ description?: string | null; name?: string | null; quantity?: string | number | null; unit?: string | null; category?: string | null; projectId?: string | null; projectName?: string | null; deliverySiteId?: string | null; deliveryCity?: string | null; materialPath?: string | null }> | null
}

export type ListOffer = PlanOffer & RowOffer

export interface RfqListRow<T extends ListRfq = ListRfq> {
  id: string
  rfq: T
  state: ListState
  closedEarly: boolean
  direct: boolean
  number: string | null
  reach: ListReach
  reachCount: number | null
  siteKeys: string[]
  siteLabels: string[]
  categoryKeys: string[]
  /** Days from today to the deadline (negative once it passed); null with none. */
  daysLeft: number | null
  /** The day the round closes or closed: the early close when there was one, else the deadline. */
  endDay: string | null
  offers: number
  offPlatform: number
  live: number
  lowest: { grossH: number; basis: "incl_vat" | "no_vat" } | null
  noLive: NoLive | null
  orders: number
  publishedMs: number
  hay: string
}

/** Who an RFQ reaches: direct award, a private list, or everyone in the field. */
export function reachOf(rfq: Pick<ListRfq, "directAward" | "audience" | "visibility">): ListReach {
  if (rfq.directAward) return "direct"
  const a = text(rfq.audience) || text(rfq.visibility)
  if (a === "direct") return "direct"
  return a === "private" ? "private" : "public"
}

export function reachCountOf(rfq: Pick<ListRfq, "directAward" | "audience" | "visibility" | "allowedSupplierOrgIds" | "reachedCount">): number | null {
  const reach = reachOf(rfq)
  if (reach === "direct") return 1
  const allowed = Array.isArray(rfq.allowedSupplierOrgIds) ? rfq.allowedSupplierOrgIds.length : 0
  if (reach === "private") return allowed || (typeof rfq.reachedCount === "number" ? rfq.reachedCount : null)
  return typeof rfq.reachedCount === "number" ? rfq.reachedCount : null
}

/** The places the lines are delivered to: each line's own site, else the project's site, else the RFQ's (general stock, the workshop). */
export function rfqSiteKeys(rfq: Pick<ListRfq, "projectId" | "purchaseSource" | "products">): string[] {
  const whole = rfq.projectId ? projectSiteId(rfq.projectId) : rfq.purchaseSource?.kind === "mfg_purchase" ? WORKSHOP : GENERAL_STOCK
  const lines = Array.isArray(rfq.products) ? rfq.products : []
  if (!lines.length) return [whole]
  return Array.from(new Set(lines.map((p) => text(p?.deliverySiteId) || (p?.projectId ? projectSiteId(p.projectId) : whole))))
}

/** What it is filtered by: the material tree's sub-categories, or — written before the tree — the old category names. */
export function rfqCategoryKeys(rfq: Pick<ListRfq, "category" | "products" | "subCategoryIds">): string[] {
  const subs = Array.isArray(rfq.subCategoryIds) ? rfq.subCategoryIds.filter((s): s is string => typeof s === "string" && s.length > 0) : []
  return subs.length ? subs : rfqCategories(rfq)
}

export interface RowsInput<T extends ListRfq> {
  rfqs: readonly T[]
  /** The company's offers, every RFQ's (queried by `contractorOrgId`). */
  offers: readonly ListOffer[]
  decisions: DecisionMap
  orders: ReadonlyArray<{ rfqId?: string | null; status?: string | null }>
  today: string
  /** Policies' tie band, percent. */
  tiePercent: number
  locale: string
  siteLabel: (key: string, rfq: T) => string
  categoryLabel: (key: string) => string
}

export function buildRfqRows<T extends ListRfq>(input: RowsInput<T>): RfqListRow<T>[] {
  const byRfq = new Map<string, ListOffer[]>()
  for (const o of input.offers) {
    const id = text(o.rfqId)
    if (id) byRfq.set(id, [...(byRfq.get(id) || []), o])
  }
  const ordersBy = new Map<string, number>()
  for (const o of input.orders) if (o.rfqId && o.status !== "cancelled") ordersBy.set(o.rfqId, (ordersBy.get(o.rfqId) || 0) + 1)
  const [y, m, d] = input.today.split("-").map(Number)
  const now = new Date(y, m - 1, d, 12)

  return input.rfqs.map((rfq) => {
    const st = pageState(rfq, input.today)
    const offers = byRfq.get(rfq.id) || []
    const live = offers.filter((o) => !toCalcOffer(o, input.decisions[o.id]).excluded)
    const lowestOffer = st.stage === "draft" || !offers.length ? null : lowestCompleteOffer(rfq as unknown as PricedRfq, offers.map((o) => toCalcOffer(o, input.decisions[o.id])), { tiePercent: input.tiePercent, today: input.today })
    const early = rfq.closedEarly || rfq.earlyClosed
    const deadline = day(rfq.deadline)
    const siteKeys = rfqSiteKeys(rfq)
    const categoryKeys = rfqCategoryKeys(rfq)
    const siteLabels = siteKeys.map((k) => input.siteLabel(k, rfq))
    const reach = reachOf(rfq)
    const number = text(rfq.rfqNumber) || null
    const lines = Array.isArray(rfq.products) ? rfq.products : []
    return {
      id: rfq.id,
      rfq,
      state: st.stage,
      closedEarly: st.closedEarly,
      direct: st.direct,
      number,
      reach,
      reachCount: reachCountOf(rfq),
      siteKeys,
      siteLabels,
      categoryKeys,
      daysLeft: deadline ? daysBetweenISO(input.today, deadline) : null,
      endDay: day(early?.at) || deadline,
      offers: offers.length || Math.max(0, Number(rfq.offersCount) || 0),
      offPlatform: offers.filter((o) => originOf(o) === "guest").length,
      live: live.length,
      lowest: lowestOffer && lowestOffer.grossH != null ? { grossH: lowestOffer.grossH, basis: basisOf(lowestOffer.vatRate) } : null,
      noLive: st.stage === "open" || st.stage === "compare" ? noLiveOffer(rfq, offers, input.decisions, now) : null,
      orders: ordersBy.get(rfq.id) || 0,
      publishedMs: msOf(rfq.publishedAt) || msOf(rfq.createdAt),
      hay: foldSearchText(
        [
          rfq.title,
          number,
          number ? displayDocNumber(number, input.locale) : "",
          rfq.id,
          `#${rfq.id.slice(0, 6)}`,
          rfq.city,
          rfq.district,
          rfq.description,
          ...siteLabels,
          ...categoryKeys.map(input.categoryLabel),
          ...lines.flatMap((p) => [p?.name, p?.description, p?.materialPath]),
          ...offers.map((o) => supplierNameOfOffer(o)),
        ]
          .filter(Boolean)
          .join(" "),
      ),
    }
  })
}

// ---------------------------------------------------------------------------
// Filter, count, sort, page
// ---------------------------------------------------------------------------

export interface RfqListFilter {
  q: string
  view: ListView
  /** A delivery-site key (`rfqSiteKeys`), or "" for all. */
  site: string
  category: string
  reach: ListReach | ""
  sort: ListSort
}

export const EMPTY_LIST_FILTER: RfqListFilter = { q: "", view: "open", site: "", category: "", reach: "", sort: "close" }

/** Any narrowing applied — the sort and the status chip do not count. */
export const listFilterActive = (f: RfqListFilter): boolean => Boolean(f.q.trim() || f.site || f.category || f.reach)

export const sortOf = (raw: string | null | undefined): ListSort => ((LIST_SORTS as readonly string[]).includes(raw || "") ? (raw as ListSort) : "close")

const inView = (row: RfqListRow, view: ListView): boolean => (view === "all" ? row.state !== "draft" : view === "draft" ? row.state === "draft" : row.state === view)

type Skip = "site" | "category" | "reach" | "view" | null

const words = (q: string): string[] => foldSearchText(q).split(" ").filter(Boolean)

function passes(row: RfqListRow, f: RfqListFilter, w: string[], skip: Skip = null): boolean {
  if (skip !== "site" && f.site && !row.siteKeys.includes(f.site)) return false
  if (skip !== "category" && f.category && !row.categoryKeys.includes(f.category)) return false
  if (skip !== "reach" && f.reach && row.reach !== f.reach) return false
  if (w.length && !w.every((x) => row.hay.includes(x))) return false
  // A search looks in every status: whoever types a name does not know — and should not need to know — what stage it is in.
  if (skip !== "view" && !w.length && !inView(row, f.view)) return false
  return true
}

export interface ListCounts {
  open: number
  compare: number
  awarded: number
  cancelled: number
  all: number
  draft: number
}

/** The chips' counts: every state, after the filters and the search but whatever chip is pressed. */
export function listCounts(rows: readonly RfqListRow[], f: RfqListFilter): ListCounts {
  const w = words(f.q)
  const kept = rows.filter((r) => passes(r, f, w, "view"))
  const n = (state: ListState) => kept.filter((r) => r.state === state).length
  const draft = n("draft")
  return { open: n("open"), compare: n("compare"), awarded: n("awarded"), cancelled: n("cancelled"), all: kept.length - draft, draft }
}

/** The chip a first visit lands on: open work if there is any, then rounds to compare, then everything. */
export function defaultView(counts: ListCounts): ListView {
  return counts.open > 0 ? "open" : counts.compare > 0 ? "compare" : "all"
}

export interface ListFacets {
  /** Each option with the count it would leave given every OTHER filter, so a choice that empties the list is seen before it is made. */
  sites: Array<[string, number]>
  categories: Array<[string, number]>
  reaches: Array<[ListReach, number]>
}

export function listFacets(rows: readonly RfqListRow[], f: RfqListFilter): ListFacets {
  const w = words(f.q)
  const sites = new Map<string, number>()
  const cats = new Map<string, number>()
  const reaches = new Map<ListReach, number>(LIST_REACHES.map((r) => [r, 0]))
  for (const r of rows) {
    if (passes(r, f, w, "site")) for (const k of r.siteKeys) sites.set(k, (sites.get(k) || 0) + 1)
    if (passes(r, f, w, "category")) for (const k of r.categoryKeys) cats.set(k, (cats.get(k) || 0) + 1)
    if (passes(r, f, w, "reach")) reaches.set(r.reach, (reaches.get(r.reach) || 0) + 1)
  }
  const ordered = <K extends string>(m: Map<K, number>): Array<[K, number]> => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"))
  return { sites: ordered(sites), categories: ordered(cats), reaches: LIST_REACHES.map((r) => [r, reaches.get(r) || 0] as [ListReach, number]) }
}

const absDays = (r: RfqListRow, today: string): number => {
  const d = r.endDay ? Math.abs(daysBetweenISO(today, r.endDay)) : Number.POSITIVE_INFINITY
  return d
}

const SORTERS: Record<ListSort, (a: RfqListRow, b: RfqListRow, today: string) => number> = {
  close: (a, b, today) => absDays(a, today) - absDays(b, today) || b.publishedMs - a.publishedMs,
  new: (a, b) => b.publishedMs - a.publishedMs,
  offers: (a, b, today) => b.offers - a.offers || absDays(a, today) - absDays(b, today),
}

export function sortRows<T extends RfqListRow>(rows: readonly T[], sort: ListSort, today: string): T[] {
  return [...rows].sort((a, b) => {
    const d = SORTERS[sort](a, b, today)
    return Number.isNaN(d) || d === 0 ? a.id.localeCompare(b.id) : d
  })
}

export interface RfqListPage<T extends RfqListRow> {
  rows: T[]
  /** How many match the filters — the «N» of «N من M». */
  matched: number
  /** How many there are before any filter (the status chip is part of the view, not a filter). */
  total: number
  remaining: number
  /** N on «عرض N أخرى»: the next page, or what is left if less. */
  more: number
  counts: ListCounts
}

/** Filter, sort, and cut to the first `limit` rows (24 by default). */
export function listRfqs<T extends RfqListRow>(rows: readonly T[], f: RfqListFilter, today: string, limit: number = RFQ_LIST_PAGE): RfqListPage<T> {
  const w = words(f.q)
  const matched = sortRows(rows.filter((r) => passes(r, f, w)), f.sort, today)
  const cap = Math.max(1, limit)
  const remaining = Math.max(0, matched.length - cap)
  const universe = w.length ? rows.length : rows.filter((r) => (f.view === "draft") === (r.state === "draft")).length
  return { rows: matched.slice(0, cap), matched: matched.length, total: universe, remaining, more: Math.min(RFQ_LIST_PAGE, remaining), counts: listCounts(rows, f) }
}

// ---------------------------------------------------------------------------
// The one thing a card offers
// ---------------------------------------------------------------------------

export type PrimaryAction = "complete" | "compare" | "reopen" | "open"

/** Draft → finish it; a round with a live offer → compare and award; nothing live → reopen it (WF-26); else just open it. */
export function primaryAction(row: Pick<RfqListRow, "state" | "live" | "noLive">, canAct: boolean): PrimaryAction {
  if (row.state === "draft") return "complete"
  if (row.noLive) return canAct ? "reopen" : "open"
  if ((row.state === "open" || row.state === "compare") && row.live > 0) return "compare"
  return "open"
}

/** Where a card's primary action goes. `reopen` opens the RFQ's own lifecycle dialog, so it has no link. */
export function actionHref(row: Pick<RfqListRow, "id">, action: PrimaryAction, reviewHref: (id: string) => string): string | null {
  if (action === "complete") return reviewHref(row.id)
  if (action === "reopen") return null
  return action === "compare" ? `/contractor/rfqs/${row.id}/offers?tab=compare` : `/contractor/rfqs/${row.id}/offers`
}

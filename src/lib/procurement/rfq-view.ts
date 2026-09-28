// Procurement › RFQs — what each RFQ card and row shows (PRD 3.0 §7.2 tab 3,
// the reference prototype's RFQ list). The stored status is Draft · New ·
// Awarded · Cancelled; the stage the buyer reads is derived from it and the
// deadline: open while the deadline has not passed, then ready to compare if
// offers came in, closed without offers if none did. The segments, filters and
// their counts follow the prototype: every count is taken AFTER the other
// filters, "completed" is awarded + cancelled, and a filter option shows how
// many RFQs it would leave. Nothing here is stored. Pure: no I/O.

import { lastPaid, type PriceHistoryEntry } from "./prices"

export type RfqStage = "draft" | "open" | "compare" | "closed_empty" | "awarded" | "direct" | "cancelled"
export type RfqStatusChip = "all" | "Draft" | "New" | "Awarded"

export interface RfqLike {
  status?: string | null
  directAward?: boolean | null
  deadline?: string | null
  offersCount?: number | null
  products?: Array<{ description?: string | null; name?: string | null; quantity?: string | number | null; unit?: string | null }> | null
  quantity?: string | number | null
  unitOfMeasure?: string | null
  title?: string | null
}

const dayOf = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null)
const todayOf = (now: Date) => {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 10)
}

/** Whole days from today to the deadline (negative once it passed); null without one. */
export function daysToDeadline(rfq: Pick<RfqLike, "deadline">, now: Date): number | null {
  const day = dayOf(rfq.deadline)
  if (!day) return null
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayOf(now)}T00:00:00Z`)) / 86_400_000)
}

/**
 * The prototype's RFST: a direct award reads «إسناد مباشر»; an open round is
 * «مفتوحة للتقديم» while its prices are sealed (or nothing came in yet) and
 * «جاهز للمقارنة» once offers are visible — a round without the seal, or one a
 * manager closed early. `sealed` undefined keeps the deadline-only reading.
 */
export function rfqStage(rfq: RfqLike, now: Date, sealed?: boolean): RfqStage {
  if (rfq.status === "Draft") return "draft"
  if (rfq.status === "Awarded") return rfq.directAward ? "direct" : "awarded"
  if (rfq.status === "Cancelled") return "cancelled"
  const offers = rfq.offersCount ?? 0
  const days = daysToDeadline(rfq, now)
  if (days === null || days >= 0) return sealed === false && offers > 0 ? "compare" : "open"
  return offers > 0 ? "compare" : "closed_empty"
}

/** The tone of the stage — the card's top edge and its pill share it. */
export const STAGE_TONE: Record<RfqStage, "mute" | "info" | "warn" | "bad" | "ok"> = {
  draft: "mute",
  open: "info",
  compare: "warn",
  closed_empty: "bad",
  awarded: "ok",
  direct: "ok",
  cancelled: "mute",
}

export type DeadlinePill = { kind: "passed" } | { kind: "soon"; days: number } | null

/** The deadline's pill: passed (red) while it still matters, or two days or less left (amber). */
export function deadlinePill(rfq: RfqLike, now: Date): DeadlinePill {
  const stage = rfqStage(rfq, now)
  if (stage === "draft" || stage === "awarded" || stage === "direct" || stage === "cancelled" || rfq.directAward) return null
  const days = daysToDeadline(rfq, now)
  if (days === null) return null
  if (days < 0) return { kind: "passed" }
  if (days <= 2) return { kind: "soon", days }
  return null
}

/** The status chips' counts: all · drafts · active (open, comparing or closed empty) · awarded. */
export function chipCounts(rfqs: RfqLike[]): Record<RfqStatusChip, number> {
  return {
    all: rfqs.length,
    Draft: rfqs.filter((r) => r.status === "Draft").length,
    New: rfqs.filter((r) => r.status === "New").length,
    Awarded: rfqs.filter((r) => r.status === "Awarded").length,
  }
}

/** How many products the RFQ asks for — a single-material RFQ counts one. */
export const productCount = (rfq: RfqLike) => (Array.isArray(rfq.products) && rfq.products.length ? rfq.products.length : 1)

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

/**
 * An estimate at the last price we paid for each material (excl. VAT): a
 * number only when EVERY line has a history — a partial sum would read as the
 * whole RFQ's value and understate it.
 */
export function estimateAtLastPrice(rfq: RfqLike, history: PriceHistoryEntry[]): number | null {
  const lines = Array.isArray(rfq.products) && rfq.products.length
    ? rfq.products.map((p) => ({ name: p.description || p.name || "", qty: num(p.quantity), unit: p.unit || "" }))
    : [{ name: rfq.title || "", qty: num(rfq.quantity), unit: rfq.unitOfMeasure || "" }]
  let total = 0
  for (const l of lines) {
    const last = l.name && l.qty > 0 ? lastPaid(history, l.name, l.unit) : null
    if (!last) return null
    total += l.qty * last.price
  }
  return Math.round(total * 100) / 100
}

// ---------------------------------------------------------------------------
// The list's segments, filters and counts (R-33 … R-36)
// ---------------------------------------------------------------------------

export type RfqSegment = "all" | "draft" | "open" | "done"
export const RFQ_SEGMENTS: RfqSegment[] = ["all", "draft", "open", "done"]

/** Completed = awarded + cancelled: nothing is left to do on either. */
export function inRfqSegment(rfq: RfqLike, segment: RfqSegment): boolean {
  if (segment === "all") return true
  if (segment === "draft") return rfq.status === "Draft"
  if (segment === "open") return rfq.status === "New"
  return rfq.status === "Awarded" || rfq.status === "Cancelled"
}

export type DeadlineFilter = "soon" | "later" | "past"
export const DEADLINE_FILTERS: DeadlineFilter[] = ["soon", "later", "past"]

/** Only an open RFQ that asked for offers has a deadline that matters: ends
 * within three days · more than three left · passed and waiting to be awarded. */
export function matchesDeadline(rfq: RfqLike, filter: DeadlineFilter, now: Date): boolean {
  if (rfq.status !== "New" || rfq.directAward) return false
  const days = daysToDeadline(rfq, now)
  if (days === null) return false
  if (filter === "soon") return days >= 0 && days <= 3
  if (filter === "later") return days > 3
  return days < 0
}

/** A project, or the two places an RFQ without one buys for: general stock and
 * the workshop (a work order's shortfall). */
export const GENERAL_STOCK = "__gen"
export const WORKSHOP = "__mfg"

export interface RfqListLike extends RfqLike {
  id: string
  projectId?: string | null
  category?: string | null
  city?: string | null
  createdByUserId?: string | null
  contractorId?: string | null
  purchaseSource?: { kind?: string | null } | null
  products?: Array<{ description?: string | null; name?: string | null; quantity?: string | number | null; unit?: string | null; category?: string | null }> | null
}

export function rfqProjectKey(rfq: Pick<RfqListLike, "projectId" | "purchaseSource">): string {
  if (rfq.projectId) return rfq.projectId
  return rfq.purchaseSource?.kind === "mfg_purchase" ? WORKSHOP : GENERAL_STOCK
}

/** The categories come from the lines: a multi-category request shows each. */
export function rfqCategories(rfq: Pick<RfqListLike, "category" | "products">): string[] {
  const out = new Set<string>()
  for (const p of rfq.products || []) if (p?.category) out.add(p.category)
  if (!out.size && rfq.category) out.add(rfq.category)
  return Array.from(out)
}

export interface RfqFilters {
  project?: string | null
  category?: string | null
  city?: string | null
  deadline?: DeadlineFilter | null
}
export type RfqFilterKey = keyof RfqFilters

function passes(rfq: RfqListLike, key: RfqFilterKey, value: string, now: Date): boolean {
  if (key === "project") return rfqProjectKey(rfq) === value
  if (key === "category") return rfqCategories(rfq).includes(value)
  if (key === "city") return (rfq.city || "") === value
  return matchesDeadline(rfq, value as DeadlineFilter, now)
}

/** Every filter but `except` — how the prototype counts one filter's options. */
export function passesFilters(rfq: RfqListLike, filters: RfqFilters, now: Date, except?: RfqFilterKey): boolean {
  return (Object.keys(filters) as RfqFilterKey[]).every((k) => k === except || !filters[k] || passes(rfq, k, filters[k] as string, now))
}

/** The segment chips, each counted after the filters. */
export function segmentCounts(rfqs: RfqListLike[], filters: RfqFilters, now: Date): Record<RfqSegment, number> {
  const kept = rfqs.filter((r) => passesFilters(r, filters, now))
  return {
    all: kept.length,
    draft: kept.filter((r) => inRfqSegment(r, "draft")).length,
    open: kept.filter((r) => inRfqSegment(r, "open")).length,
    done: kept.filter((r) => inRfqSegment(r, "done")).length,
  }
}

/** How many RFQs one option of a filter would leave, inside the segment and the other filters. */
export function optionCount(rfqs: RfqListLike[], segment: RfqSegment, filters: RfqFilters, key: RfqFilterKey, value: string, now: Date): number {
  return rfqs.filter((r) => inRfqSegment(r, segment) && passesFilters(r, filters, now, key) && passes(r, key, value, now)).length
}

/** The deadline column: a direct award has none; otherwise "n left" always, amber at two days or less, red once passed. */
export type DeadlineTag = { kind: "direct" } | { kind: "passed" } | { kind: "left"; days: number; urgent: boolean } | null
export function deadlineTag(rfq: RfqLike, now: Date): DeadlineTag {
  if (rfq.directAward) return { kind: "direct" }
  if (rfq.status !== "New") return null
  const days = daysToDeadline(rfq, now)
  if (days === null) return null
  if (days < 0) return { kind: "passed" }
  return { kind: "left", days, urgent: days <= 2 }
}

// ---------------------------------------------------------------------------
// A buyer's scope (R-18) — the prototype's `rfqMine` and the PO list's filter
// ---------------------------------------------------------------------------

type ScopeActor = { uid: string; isOwner: boolean; canApprove: boolean; canPrepare: boolean }

/** A buyer prepares and never approves; the owner and approvers see everything. */
export const isBuyer = (actor: Omit<ScopeActor, "uid">) => !actor.isOwner && !actor.canApprove && actor.canPrepare

/** A buyer sees the RFQs he raised, and — when his member record names
 * categories — the RFQs in them. Everyone else sees the whole list. */
export function rfqInScope(rfq: Pick<RfqListLike, "createdByUserId" | "contractorId" | "category" | "products">, actor: ScopeActor, categories?: string[] | null): boolean {
  if (!isBuyer(actor)) return true
  if ((rfq.createdByUserId || rfq.contractorId) === actor.uid) return true
  return Boolean(categories?.length) && rfqCategories(rfq).some((c) => (categories as string[]).includes(c))
}

/** A buyer's orders: the ones he prepared, and those in his categories. */
export function poInScope(po: { preparedById: string; category?: string | null }, actor: ScopeActor, categories?: string[] | null): boolean {
  if (!isBuyer(actor)) return true
  if (po.preparedById === actor.uid) return true
  return Boolean(categories?.length && po.category && categories.includes(po.category))
}

// ---------------------------------------------------------------------------
// The whole list (R-33): every org RFQ is loaded so the chips, the option
// counts and «n من m» count all of them; only the rendering is paged.
// ---------------------------------------------------------------------------

export const RFQ_PAGE_SIZE = 24

const tsOf = (v: unknown): number => {
  if (!v) return 0
  if (typeof v === "string" || typeof v === "number") return new Date(v).getTime() || 0
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === "function") return o.toDate().getTime()
  if (typeof o.seconds === "number") return o.seconds * 1000
  return 0
}

/** Newest first, the id breaking ties — the same order on every render. */
export function sortRfqs<T extends { id: string; createdAt?: unknown }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => tsOf(b.createdAt) - tsOf(a.createdAt) || a.id.localeCompare(b.id))
}

export function rfqPage<T>(rows: T[], pages: number, size = RFQ_PAGE_SIZE): { shown: T[]; hasMore: boolean } {
  const n = Math.max(1, pages) * size
  return { shown: rows.slice(0, n), hasMore: rows.length > n }
}

// ---------------------------------------------------------------------------
// Bulk acts on the list (R-12): only a draft is deleted; a published RFQ is
// withdrawn with «ألغِ الطلب» and a reason on its own page. Publishing keeps
// the draft's audience — a private draft stays private.
// ---------------------------------------------------------------------------

export interface BulkRfqLike {
  id: string
  status?: string | null
  visibility?: string | null
}

export function bulkDeleteSplit<T extends BulkRfqLike>(rows: T[]): { drafts: T[]; toCancel: T[]; skipped: T[] } {
  return {
    drafts: rows.filter((r) => r.status === "Draft"),
    toCancel: rows.filter((r) => r.status === "New"),
    skipped: rows.filter((r) => r.status !== "Draft" && r.status !== "New"),
  }
}

export function bulkPublishPatch(rfq: BulkRfqLike, at: string): { status: "New"; visibility: "public" | "private"; publishedAt: string } | null {
  if (rfq.status !== "Draft") return null
  return { status: "New", visibility: rfq.visibility === "private" ? "private" : "public", publishedAt: at }
}

/** The RFQ page's tab from `?tab=` — the card's «الاستفسارات» opens the queries. */
export type RfqPageTab = "list" | "compare" | "inquiries" | "details"
const TAB_ALIASES: Record<string, RfqPageTab> = { list: "list", offers: "list", off: "list", compare: "compare", cmp: "compare", inquiries: "inquiries", queries: "inquiries", qa: "inquiries", details: "details", det: "details" }
export const rfqPageTab = (param: string | null | undefined): RfqPageTab => TAB_ALIASES[(param || "").toLowerCase()] ?? "list"

/** Every file the RFQ carries: the form's attachments, then the legacy single PDF — each once. */
export function rfqFiles(rfq: { attachments?: Array<{ url?: string | null; name?: string | null } | string> | null; pdfUrl?: string | null }): Array<{ url: string; name: string | null }> {
  const out: Array<{ url: string; name: string | null }> = []
  for (const a of rfq.attachments || []) {
    const url = typeof a === "string" ? a : a?.url || ""
    if (url && !out.some((f) => f.url === url)) out.push({ url, name: typeof a === "string" ? null : a?.name || null })
  }
  if (rfq.pdfUrl && !out.some((f) => f.url === rfq.pdfUrl)) out.push({ url: rfq.pdfUrl, name: null })
  return out
}

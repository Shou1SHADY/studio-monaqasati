// The RFQ page's three-segment path (Procurement 2.0 RFQ-01, FLW-03, the prototype's `rfqLife`): الطلب (who asked, until when) ·
// المشتريات (published → offers → award) · التوريد والاستلام (orders → receipt). The page's STATE is derived here too —
// open / comparing / awarded / cancelled, never stored beyond `status` — so the path, the pill and the default tab agree.
// Pure: no I/O, no clock but the day passed in.

import { addDaysISO, daysBetweenISO } from "./offer-calc"
import { poStatus } from "./po"
import type { IncomingDoc, IncomingSrc } from "./incoming-state"
import type { PurchaseOrder } from "./types"

const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

// ---------------------------------------------------------------------------
// The page's state
// ---------------------------------------------------------------------------

export type PageStage = "draft" | "open" | "compare" | "awarded" | "cancelled"

export interface StageRfq {
  status?: string | null
  directAward?: boolean | null
  deadline?: string | null
  closedEarly?: { at?: string | null; originalDeadline?: string | null; reason?: string | null } | null
  earlyClosed?: { at?: string | null; originalDeadline?: string | null } | null
  awardReopened?: unknown
  cancellation?: { code?: string | null; at?: string | null } | null
}

export interface PageState {
  stage: PageStage
  /** Awarded before the deadline: «رُسّي» / «أُغلق مبكراً» both read this. */
  closedEarly: boolean
  direct: boolean
}

/** Open until the deadline passes or the award; comparing after the deadline (or after an order was cancelled for a re-award); then awarded or cancelled. */
export function pageState(rfq: StageRfq, today: string): PageState {
  const direct = Boolean(rfq.directAward)
  const closedEarly = Boolean(rfq.closedEarly || rfq.earlyClosed)
  if (rfq.status === "Draft") return { stage: "draft", closedEarly, direct }
  if (rfq.status === "Cancelled") return { stage: "cancelled", closedEarly, direct }
  if (rfq.status === "Awarded") return { stage: "awarded", closedEarly, direct }
  const d = day(rfq.deadline)
  if (rfq.awardReopened) return { stage: "compare", closedEarly, direct }
  if (!direct && d && d < today) return { stage: "compare", closedEarly, direct }
  return { stage: "open", closedEarly, direct }
}

// ---------------------------------------------------------------------------
// The path
// ---------------------------------------------------------------------------

export interface PathRequest {
  /** The numbers of the requests this RFQ answers (`MR 04`, `MAT-2026/014`); empty = «من المشتريات مباشرة». */
  refs: string[]
  /** The first request's source and who asked. */
  source: IncomingSrc | null
  requester: string | null
  needBy: string | null
}

export type AwardStep =
  | { kind: "cancelled"; reason: string | null }
  | { kind: "awarded"; on: string | null; early: boolean }
  | { kind: "can"; before: string | null }
  | { kind: "comparing"; by: string | null; daysLeft: number | null }
  | { kind: "waiting" }

export interface PathModel {
  request: PathRequest
  published: string | null
  offers: { count: number; until: string | null; closedOn: string | null; closedEarly: boolean; closed: boolean }
  award: AwardStep
  orders: number
  receipt: { done: number; total: number } | null
  /** The segment the page stands in. */
  current: "request" | "procurement" | "supply"
}

export interface PathRfq extends StageRfq {
  id: string
  createdAt?: unknown
  publishedAt?: unknown
  needBy?: string | null
  products?: Array<{ needBy?: string | null }> | null
  log?: Array<{ action?: string; at?: string }> | null
}

const asIso = (v: unknown): string | null => {
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date } | null
  return ts && typeof ts.toDate === "function" ? ts.toDate().toISOString() : null
}

/** The incoming requests whose lines this RFQ carries (a line stamped with its id). */
export const requestsOfRfq = (docs: readonly IncomingDoc[], rfqId: string): IncomingDoc[] => docs.filter((d) => (d.lines || []).some((l) => l.rfqId === rfqId)).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))

export function pathModel(input: { rfq: PathRfq; today: string; offerCount: number; requests: readonly IncomingDoc[]; orders: readonly PurchaseOrder[]; awardWindowDays: number; reasonOf?: (code: string) => string | null }): PathModel {
  const { rfq, today, requests, orders } = input
  const st = pageState(rfq, today)
  const needs = [...requests.map((r) => day(r.needBy)), day(rfq.needBy), ...(rfq.products || []).map((p) => day(p.needBy))].filter((d): d is string => Boolean(d)).sort()
  const first = requests[0] || null
  const request: PathRequest = {
    refs: requests.map((r) => r.no),
    source: first ? first.src : null,
    requester: first ? first.requestedFor?.name || first.requestedBy?.name || null : null,
    needBy: needs[0] || null,
  }
  const published = day(rfq.publishedAt) || day((rfq.log || []).find((e) => e.action === "published")?.at) || day(asIso(rfq.createdAt))
  const deadline = day(rfq.deadline)
  const early = rfq.closedEarly || rfq.earlyClosed
  const closedOn = early ? day(early.at) : st.stage === "compare" || st.stage === "awarded" ? deadline : null
  const closed = st.stage === "compare" || st.stage === "awarded" || st.stage === "cancelled"

  let award: AwardStep
  if (st.stage === "cancelled") award = { kind: "cancelled", reason: rfq.cancellation?.code ? input.reasonOf?.(rfq.cancellation.code) ?? rfq.cancellation.code : null }
  else if (st.stage === "awarded") award = { kind: "awarded", on: null, early: st.closedEarly }
  else if (st.stage === "compare") {
    const by = deadline ? addDaysISO(deadline, input.awardWindowDays) : null
    award = { kind: "comparing", by, daysLeft: by ? daysBetweenISO(today, by) : null }
  } else if (input.offerCount > 0) award = { kind: "can", before: deadline }
  else award = { kind: "waiting" }

  const live = orders.filter((o) => o.status !== "cancelled")
  const done = live.filter((o) => {
    const s = poStatus({ ...o, lines: o.lines || [], log: o.log || [] })
    return s === "received" || o.status === "closed"
  }).length
  const current: PathModel["current"] = live.length > 0 ? "supply" : "procurement"
  return {
    request,
    published,
    offers: { count: input.offerCount, until: deadline, closedOn, closedEarly: st.closedEarly, closed },
    award,
    orders: live.length,
    receipt: live.length ? { done, total: live.length } : null,
    current,
  }
}

export type StepClass = "done" | "on" | "can" | ""

/** ① published · ② offers · ③ award · ④ orders · ⑤ receipt, as the prototype's step classes. */
export function stepClasses(p: PathModel, stage: PageStage): Record<"published" | "offers" | "award" | "orders" | "receipt", StepClass> {
  const awarded = stage === "awarded"
  return {
    published: stage === "draft" ? "" : "done",
    offers: p.offers.closed ? "done" : "on",
    award: stage === "cancelled" ? "" : awarded ? "done" : p.award.kind === "waiting" ? "" : "can",
    orders: p.orders > 0 ? "done" : awarded ? "on" : "",
    receipt: p.receipt && p.receipt.total > 0 && p.receipt.done === p.receipt.total ? "done" : p.orders > 0 ? "on" : "",
  }
}


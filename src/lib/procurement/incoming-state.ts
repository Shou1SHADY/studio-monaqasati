// «الطلب الوارد» as a STORED entity (Procurement 2.0 INC-02/07..11, G-01, G-13, NFR-02/08). One document per request —
// `procIncoming/{orgId}__{mrKey}` — whose LINES carry their own place (للشراء · ينتظر ردّاً · في عروض · في أمر · تعذّر), and
// whose state is DERIVED from the lines (the prototype's `reqSync`), never typed. A line is in exactly one place (G-13), so a
// material is neither lost after a partial award nor bought twice. Pure: no I/O, no clock but the one passed in.

import { addDays, dayOf, todayOf } from "./po"
import { materialKey } from "./prices"
import type { MaterialPick } from "../materials/types"
import type { ProjectChange } from "./project-change"

export const PROC_INCOMING = "procIncoming"

export type IncomingSrc = "pm" | "team" | "inv" | "mfg"
export const INCOMING_SOURCES: readonly IncomingSrc[] = ["pm", "team", "inv", "mfg"]

/** new · prepared (a draft RFQ names it) · part (some lines in hand, some still to buy) · in RFQ · in PO · completed · could not buy · withdrawn. */
export type RequestSt = "new" | "prep" | "part" | "rfq" | "po" | "done" | "fail" | "wd"
export const REQUEST_STATES: readonly RequestSt[] = ["new", "prep", "part", "rfq", "po", "done", "fail", "wd"]

/** Where a line that Procurement took in hand stands. */
export type LinePs = "rfq" | "po" | "fail"

export const FAIL_REASONS = ["nooff", "price", "avail", "other"] as const
export type FailReason = (typeof FAIL_REASONS)[number]
/** «سبب آخر» is written by the user and needs this many characters. */
export const FAIL_OTHER_MIN = 4

/** How a «قبل الشراء» question ended without an answer: its window lapsed (the line is bought in full) or the connector closed (the workshop's unanswered question returns to the buyer). */
export type AutoResolve = "timeout" | "closed"

export interface StockReply {
  /** wait · issue (all) · part · tied (committed to another purpose) · none (no stock). */
  st: "wait" | "issue" | "part" | "tied" | "none"
  /** What the stores give (issue / part). */
  give?: number
  at: string
  by?: string | null
  why?: string | null
  /** The last day Inventory may reply: the day asked + the window, never beyond the last day to order and never before the day asked. Absent = the window from `at`. */
  until?: string | null
  /** The warehouse the stores give from. */
  wh?: { id: string; name: string } | null
  /** The day it was answered. */
  on?: string | null
  /** Version of the reply for the `inv:CHK` key. */
  rv?: number
  /** Asked and answered through Procurement's own line act (a source request that keeps its own reply is not marked). */
  src?: "proc"
  auto?: AutoResolve
}

export interface WorkshopReply {
  st: "ask" | "make" | "part" | "buy"
  /** What the workshop makes (make / part). */
  make?: number
  wo?: string | null
  at: string
  by?: string | null
  why?: string | null
  note?: string | null
  /** The reference purchase price sent with the question: the last we paid for it. */
  ref?: { price: number; po: string | null; day: string | null } | null
  on?: string | null
  rv?: number
  src?: "proc"
  auto?: AutoResolve
}

export interface LineFail {
  code: FailReason
  why: string
  alt: string
  at: string
  by: string
}

export interface IncomingLine {
  /** 1-based, stable: the line number of the event key. */
  no: number
  name: string
  unit: string
  qty: number
  material?: MaterialPick | null
  warrantyMonths?: number | null
  boqItemId?: string | null
  needBy?: string | null
  stk?: StockReply | null
  mk?: WorkshopReply | null
  ps?: LinePs | null
  rfqId?: string | null
  rfqNumber?: string | null
  poId?: string | null
  poNumber?: string | null
  /** RFQs that let this line go (a partial award, a cancelled RFQ): they no longer hold it. */
  rel?: string[]
  /** It arrived: the order that carries it was received in full, or the workshop's shortfall was marked arrived. */
  rcv?: boolean
  /** The purchasing category and a pending sample, as the source request wrote them (the desk's buyer scope and its warning). */
  category?: string | null
  samplePending?: boolean
  fail?: LineFail | null
  /** Taken out by the source: the project withdrew it, a change was refused, or it was closed with nothing received. */
  gone?: { kind: "withdrawn" | "refused" | "held" | "closed"; on?: string | null; by?: string | null } | null
  /** Version of the line's status for the `proc:ST` key: grows with every change a requester should hear of. */
  v: number
}

export interface IncomingLogEntry {
  at: string
  by: string
  act: string
  line?: number
  note?: string | null
}

export interface IncomingPerson {
  kind: "member" | "receiver" | "system"
  id?: string | null
  name: string
  phone?: string | null
}

export interface IncomingDoc {
  organizationId: string
  mrKey: string
  src: IncomingSrc
  /** `MR 03` (a project's own) or `MAT-2026/014`. */
  no: string
  seq?: number | null
  siteId?: string | null
  place: { label: string; city: string; district: string }
  projectId?: string | null
  projectName?: string | null
  workOrderNo?: string | null
  workOrderId?: string | null
  productName?: string | null
  /** A project request routed to our workshop («اسأل الورشة»): its manufacturing request, read back by the sync. */
  mfgRequestId?: string | null
  /** What the project did to the request after it reached us (PUR-01 p.5), and the withdrawal of all of it. */
  changes?: ProjectChange[]
  withdrawal?: { on: string | null; byName: string | null } | null
  requestedFor: IncomingPerson
  requestedBy: { id: string; name: string }
  approvedBy?: { name: string; on: string } | null
  needBy: string | null
  note: string | null
  createdAt: string
  st: RequestSt
  /** The lines' fact, flat, for the queries and rules: `open` while the request is alive, `closed` once it ended. */
  status: "open" | "closed"
  /** The team member who asked: the flat copies `useWorkQueue` and the requester's list read. */
  requestedById?: string | null
  /** Everyone who may read it as «طلباتي»: whoever asked and, on behalf, the member it was raised for. */
  requesterIds: string[]
  lines: IncomingLine[]
  log: IncomingLogEntry[]
  /** The requester took it back before anything was in hand. */
  withdrawn?: { at: string; by: string; name: string } | null
  notifiedState?: string | null
  stateAt?: string | null
  /** Set when the source request is read from a legacy document (`procTeamRequests/{id}`). */
  legacyId?: string | null
}

export const incomingDocId = (organizationId: string, mrKey: string): string => `${organizationId}__${mrKey}`

/** The segment of a request the way the key is written: `pm:{projectId}:{requestId}` · `team:{id}` · `inv:{needId}` · `mfg:{workOrderId}:{prqId}`. */
export function mrKeyParts(mrKey: string): { src: IncomingSrc; a: string; b: string } | null {
  const [src, a, b] = mrKey.split(":")
  if (!a || !(INCOMING_SOURCES as readonly string[]).includes(src)) return null
  if ((src === "pm" || src === "mfg") && !b) return null
  return { src: src as IncomingSrc, a, b: b ?? "" }
}

export const pmMrKey = (projectId: string, requestId: string) => `pm:${projectId}:${requestId}`
export const teamMrKey = (id: string) => `team:${id}`
export const mfgMrKey = (workOrderId: string, purchaseRequestId: string) => `mfg:${workOrderId}:${purchaseRequestId}`

/** The id an event key carries for this request: colon-free, and unique within the organisation (a project's «MR 03» repeats across projects). */
export const eventRefOf = (mrKey: string): string => mrKey.replace(/:/g, ".")

const EPS = 0.005
const r3 = (n: number) => Math.round(n * 1000) / 1000

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

export interface ReplyClock {
  now: Date
  /** Inventory's and the workshop's windows (policies `inventoryReplyDays` / `workshopReplyDays`). */
  stockDays: number
  workshopDays: number
}

const lapsed = (askedAt: string | null | undefined, days: number, now: Date, until?: string | null): boolean => {
  const last = dayOf(until) || (dayOf(askedAt) ? addDays(dayOf(askedAt), Math.max(0, days)) : "")
  return !!last && todayOf(now) > last
}

/** The last day the stores may reply to a question asked on `askedAt`. */
export const stockUntil = (s: Pick<StockReply, "at" | "until">, days: number): string => dayOf(s.until) || addDays(dayOf(s.at), Math.max(0, days))
/** The last day the workshop may reply. */
export const workshopUntil = (m: Pick<WorkshopReply, "at">, days: number): string => addDays(dayOf(m.at), Math.max(0, days))

/** Waiting for Inventory's or the workshop's answer inside its window: such a line is NOT published until they answer or the window
 * lapses — after that it fails open and is bought in full (INC-07/08). */
export function lineHeld(l: IncomingLine, clock: ReplyClock): "stock" | "workshop" | null {
  if (l.stk?.st === "wait" && !lapsed(l.stk.at, clock.stockDays, clock.now, l.stk.until)) return "stock"
  if (l.mk?.st === "ask" && !lapsed(l.mk.at, clock.workshopDays, clock.now)) return "workshop"
  return null
}

export const lineGive = (l: IncomingLine): number => (l.stk && (l.stk.st === "issue" || l.stk.st === "part") ? Math.max(0, Number(l.stk.give) || 0) : 0)
export const lineMake = (l: IncomingLine): number => (l.mk && (l.mk.st === "make" || l.mk.st === "part") ? Math.max(0, Number(l.mk.make) || 0) : 0)

/** In hand: published (rfq), ordered (po) or closed as could-not-buy. A busy line is never bought again. */
export const lineBusy = (l: IncomingLine): boolean => l.ps === "rfq" || l.ps === "po" || l.ps === "fail" || Boolean(l.rcv)

/** What is still to buy of a line: the quantity less what the stores give and the workshop makes; nothing while it waits on an answer, is in hand or is gone. */
export function lineBuyQty(l: IncomingLine, clock: ReplyClock): number {
  if (l.gone || lineBusy(l) || lineHeld(l, clock)) return 0
  return Math.max(0, r3((Number(l.qty) || 0) - lineGive(l) - lineMake(l)))
}

export type LineKind = "buy" | "wait" | "rfq" | "po" | "fail" | "covered" | "gone" | "done"

/** The ONE place a line is in (G-13). */
export function lineKind(l: IncomingLine, clock: ReplyClock): LineKind {
  if (l.gone) return "gone"
  if (l.ps === "fail") return "fail"
  if (l.rcv) return "done"
  if (l.ps === "po") return "po"
  if (l.ps === "rfq") return "rfq"
  if (lineHeld(l, clock)) return "wait"
  return lineBuyQty(l, clock) > EPS ? "buy" : "covered"
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export interface DeriveOptions {
  /** A draft RFQ names the request. */
  prep?: boolean
  clock: ReplyClock
}

/** The request's state from its lines (`reqSync`): what is left to buy keeps it in «جديدة» with the tag «الباقي منه». */
export function deriveRequest(lines: readonly IncomingLine[], opts: DeriveOptions): RequestSt {
  const live = lines.filter((l) => !l.gone)
  if (!live.length) return "wd"
  const kinds = live.map((l) => lineKind(l, opts.clock))
  const any = (k: LineKind) => kinds.includes(k)
  const open = any("buy") || any("wait")
  const inHand = any("rfq") || any("po")
  if (open) return inHand ? "part" : opts.prep ? "prep" : "new"
  if (any("rfq")) return "rfq"
  if (any("po")) return "po"
  if (any("fail") && !any("done")) return "fail"
  return "done"
}

/** Anything left to publish (new, prepared, or the remainder of a partly handled request). */
export const buyLineIndexes = (lines: readonly IncomingLine[], clock: ReplyClock): number[] => lines.flatMap((l, i) => (lineBuyQty(l, clock) > EPS ? [i] : []))

/** The inbox's segments: قادمة · جديدة · مُجهَّزة · في عروض · في أوامر · اكتملت · انتهت. */
export type IncomingSegment = "upcoming" | "new" | "prepared" | "rfq" | "order" | "done" | "ended" | "all"
export const INCOMING_SEGMENTS: readonly IncomingSegment[] = ["upcoming", "new", "prepared", "rfq", "order", "done", "ended", "all"]

/** `reqSeg`: a partly handled request is «جديدة» while something is left to buy, else it follows what is in hand. */
export function segmentOfRequest(st: RequestSt, buyLines: number): Exclude<IncomingSegment, "all" | "upcoming"> {
  if (st === "part") return buyLines > 0 ? "new" : "rfq"
  return ({ new: "new", prep: "prepared", rfq: "rfq", po: "order", done: "done", fail: "ended", wd: "ended" } as const)[st]
}

/** The tag «الباقي منه» on a card of «جديدة» whose other lines are already in an RFQ or an order. */
export const isRemainder = (st: RequestSt, buyLines: number): boolean => st === "part" && buyLines > 0

export const requestOpen = (st: RequestSt): boolean => st !== "done" && st !== "fail" && st !== "wd"

// ---------------------------------------------------------------------------
// What the world says about a line: RFQs and orders that name it
// ---------------------------------------------------------------------------

export interface LinkRfq {
  id: string
  status?: string | null
  rfqNumber?: string | null
  needSources?: Array<Record<string, unknown>> | null
  purchaseSource?: Record<string, unknown> | null
  products?: Array<{ name?: string | null; unit?: string | null; unitOfMeasure?: string | null; needSource?: Record<string, unknown> | null; needLine?: number | null } | null> | null
  unawardedLines?: number[] | null
}

export interface LinkOrder {
  id: string
  status?: string
  docNumber?: string
  rfqId?: string | null
  purchaseSource?: Record<string, unknown> | null
  lines: Array<{ name?: string; unit?: string; rfqProductIndex?: number | null; quantity?: number; accepted?: number; cancelled?: number }>
  /** `poStatus(po)` — the derived state, so an order that arrived in full reads «received». */
  derived?: string
  /** The day the supplier promised (a requester reads dates, never prices). */
  promisedDate?: string | null
}

export interface LineLink {
  ps: "rfq" | "po"
  rfqId?: string | null
  rfqNumber?: string | null
  poId?: string | null
  poNumber?: string | null
  rcv?: boolean
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** The need key a source names (`project:{p}:{r}` · `team:{id}` · `mfg:{wo}:{prq}`), without any `line`. */
function sourceMr(s: Record<string, unknown> | null | undefined): string | null {
  if (!s) return null
  if (s.kind === "project_request" && str(s.projectId) && str(s.purchaseRequestId)) return pmMrKey(str(s.projectId), str(s.purchaseRequestId))
  if (s.kind === "team_request" && str(s.purchaseRequestId)) return teamMrKey(str(s.purchaseRequestId))
  if (s.kind === "mfg_purchase" && str(s.workOrderId) && str(s.purchaseRequestId)) return mfgMrKey(str(s.workOrderId), str(s.purchaseRequestId))
  return null
}

const lineOfMaterial = (lines: readonly IncomingLine[], name: string | null | undefined, unit: string | null | undefined, taken: Set<number>): number | null => {
  const want = materialKey(name, unit)
  const i = lines.findIndex((l, k) => !taken.has(k) && !l.gone && materialKey(l.name, l.unit) === want)
  return i >= 0 ? i : null
}

/** The doc line an RFQ product answers, or null: the product's own source (and its `line`/`needLine`), else the RFQ's only source matched by material. */
function productLine(doc: IncomingDoc, rfq: LinkRfq, p: NonNullable<LinkRfq["products"]>[number], taken: Set<number>): number | null {
  if (!p) return null
  const products = rfq.products || []
  const own = p.needSource ?? null
  const whole = products.some((x) => x?.needSource) ? null : rfq.purchaseSource ?? ((rfq.needSources || []).length === 1 ? rfq.needSources?.[0] ?? null : null)
  const src = own ?? whole
  if (!src || sourceMr(src) !== doc.mrKey) return null
  const unit = p.unitOfMeasure ?? p.unit
  const hint = typeof src.line === "number" ? src.line : own && typeof p.needLine === "number" ? p.needLine : null
  if (hint != null && hint >= 0 && hint < doc.lines.length && !taken.has(hint)) {
    const at = doc.lines[hint]
    if (!at.gone && (materialKey(at.name, at.unit) === materialKey(p.name, unit) || !p.name)) return hint
  }
  return lineOfMaterial(doc.lines, p.name, unit, taken)
}

const ALIVE_RFQ = (r: LinkRfq): boolean => r.status !== "Cancelled" && r.status !== "Draft"

export interface LinkReading {
  links: Map<number, LineLink>
  /** Lines an RFQ named and let go (a partial award, `rel`): such a line is not held by that RFQ any more. */
  released: Set<number>
}

/**
 * The RFQ or order each line is in, read from the RFQs and orders that name the request — the SAME reading the server stores
 * and the screen overlays, so the two never disagree. A line an RFQ let go (`rel`, or listed in its `unawardedLines`) is not held
 * by it; an order of a line outranks the RFQ it came from.
 */
export function readLineLinks(doc: IncomingDoc, world: { rfqs: readonly LinkRfq[]; orders: readonly LinkOrder[] }): LinkReading {
  const out = new Map<number, LineLink>()
  const released = new Set<number>()
  const rfqById = new Map(world.rfqs.map((r) => [r.id, r]))
  const rfqLines = new Map<string, Map<number, number>>()
  for (const rfq of world.rfqs) {
    if (!ALIVE_RFQ(rfq)) continue
    const taken = new Set<number>()
    const byProduct = new Map<number, number>()
    ;(rfq.products || []).forEach((p, i) => {
      const at = productLine(doc, rfq, p, taken)
      if (at == null) return
      taken.add(at)
      byProduct.set(i, at)
    })
    rfqLines.set(rfq.id, byProduct)
    const letGo = new Set(rfq.unawardedLines || [])
    byProduct.forEach((at, i) => {
      if (doc.lines[at].gone || doc.lines[at].ps === "fail") return
      if (letGo.has(i) || doc.lines[at].rel?.includes(rfq.id)) {
        released.add(at)
        return
      }
      if (!out.has(at)) out.set(at, { ps: "rfq", rfqId: rfq.id, rfqNumber: rfq.rfqNumber ?? null })
    })
  }
  for (const po of world.orders) {
    if (po.status === "cancelled") continue
    const derived = po.derived ?? po.status
    const rcv = derived === "received" || derived === "closed"
    const mark = (at: number) => {
      if (doc.lines[at].gone || doc.lines[at].ps === "fail") return
      const prior = out.get(at)
      out.set(at, { ps: "po", rfqId: prior?.rfqId ?? po.rfqId ?? null, rfqNumber: prior?.rfqNumber ?? (po.rfqId ? rfqById.get(po.rfqId)?.rfqNumber ?? null : null), poId: po.id, poNumber: po.docNumber ?? null, rcv })
    }
    const map = po.rfqId ? rfqLines.get(po.rfqId) : undefined
    let matched = false
    if (map) {
      for (const pl of po.lines) {
        if (pl.rfqProductIndex == null) continue
        const at = map.get(pl.rfqProductIndex)
        if (at == null) continue
        matched = true
        mark(at)
      }
    }
    if (matched || po.rfqId) continue
    // A direct order or an agreement order has no RFQ: its `purchaseSource` names the request, its lines are matched by material.
    if (sourceMr(po.purchaseSource) !== doc.mrKey) continue
    const taken = new Set<number>()
    let named = false
    for (const pl of po.lines) {
      const at = lineOfMaterial(doc.lines, pl.name, pl.unit, taken)
      if (at == null) continue
      taken.add(at)
      named = true
      mark(at)
    }
    if (!named) doc.lines.forEach((_, at) => mark(at))
  }
  return { links: out, released }
}

/** The lines as the world leaves them: a stored link whose RFQ was cancelled, let the line go, or whose order is gone is dropped (the line is to buy again); a link the world shows is added. Never touches a closed-as-could-not-buy or a gone line. */
export function overlayLinks(doc: IncomingDoc, world: { rfqs: readonly LinkRfq[]; orders: readonly LinkOrder[] }): IncomingLine[] {
  const { links, released } = readLineLinks(doc, world)
  const rfqs = new Map(world.rfqs.map((r) => [r.id, r]))
  const orders = new Map(world.orders.map((o) => [o.id, o]))
  return doc.lines.map((l, i) => {
    if (l.gone || l.ps === "fail") return l
    const found = links.get(i)
    if (found) {
      if (l.ps === found.ps && l.rfqId === (found.rfqId ?? null) && l.poId === (found.poId ?? null) && !!l.rcv === !!found.rcv) return l
      return { ...l, ps: found.ps, rfqId: found.rfqId ?? null, rfqNumber: found.rfqNumber ?? null, poId: found.poId ?? null, poNumber: found.poNumber ?? null, rcv: found.rcv ?? false, v: l.v + 1 }
    }
    // Stored but not shown by the world: an explicit link (link-rfq / link-po) stays while its holder is alive and has not let the line go.
    if (l.ps === "po" && l.poId) {
      const po = orders.get(l.poId)
      if (po && po.status !== "cancelled") return l
    }
    if (l.ps === "rfq" && l.rfqId && !released.has(i)) {
      const r = rfqs.get(l.rfqId)
      if (r && ALIVE_RFQ(r) && !l.rel?.includes(r.id)) return l
    }
    if (!l.ps) return l
    return { ...l, ps: null, rfqId: null, rfqNumber: null, poId: null, poNumber: null, rcv: false, v: l.v + 1 }
  })
}

/** A draft RFQ that names the request (it is «مُجهَّز»). */
export function hasDraft(doc: Pick<IncomingDoc, "mrKey">, rfqs: readonly LinkRfq[]): boolean {
  return rfqs.some((r) => {
    if (r.status !== "Draft") return false
    const list = [r.purchaseSource, ...(r.needSources || []), ...(r.products || []).map((p) => p?.needSource)]
    return list.some((s) => sourceMr(s ?? null) === doc.mrKey)
  })
}

export function replyClockOf(now: Date, policies: { inventoryReplyDays: number; workshopReplyDays: number }): ReplyClock {
  return { now, stockDays: policies.inventoryReplyDays, workshopDays: policies.workshopReplyDays }
}

/** The request after the world was read: its lines overlaid and its state derived. A request its requester took back stays withdrawn. */
export function settle(doc: IncomingDoc, world: { rfqs: readonly LinkRfq[]; orders: readonly LinkOrder[] }, clock: ReplyClock): IncomingDoc {
  if (doc.withdrawn) return { ...doc, st: "wd", status: "closed" }
  const lines = overlayLinks(doc, world)
  const st = deriveRequest(lines, { clock, prep: hasDraft(doc, world.rfqs) })
  return { ...doc, lines, st, status: requestOpen(st) ? "open" : "closed" }
}

// ---------------------------------------------------------------------------
// Acts on the lines (pure: each returns the new lines or a refusal)
// ---------------------------------------------------------------------------

export type ActRefusal =
  | "no_lines"
  | "already_in_hand"
  | "not_buyable"
  | "reason"
  | "nothing_to_close"
  | "in_rfq"
  | "closed"
  | "not_yours"
  | "holder_missing"
  | "no_line"
  | "not_asked"
  | "already_asked"
  | "window_lapsed"
  | "bad_qty"
  | "no_warehouse"
  | "no_reason"
  | "no_work_order"
  | "not_makeable"
  | "connector_off"

export interface FailInput {
  code: FailReason
  note?: string | null
  alt?: string | null
}

export const failWhy = (input: FailInput, label: (code: Exclude<FailReason, "other">) => string): string => (input.code === "other" ? (input.note || "").trim() : label(input.code))

/** «تعذّر الشراء»: closes the lines still to be bought and ONLY those — what is in an RFQ or an order carries on (WF-27). */
export function failLines(lines: readonly IncomingLine[], input: FailInput & { why: string; at: string; by: string }, clock: ReplyClock): { lines: IncomingLine[]; closed: number[] } | ActRefusal {
  if (input.code === "other" ? input.why.trim().length < FAIL_OTHER_MIN : !input.why.trim()) return "reason"
  const closed = buyLineIndexes(lines, clock)
  if (!closed.length) return "nothing_to_close"
  const next = lines.map((l, i) => (closed.includes(i) ? { ...l, ps: "fail" as const, fail: { code: input.code, why: input.why.trim(), alt: (input.alt || "").trim(), at: input.at, by: input.by }, v: l.v + 1 } : l))
  return { lines: next, closed }
}

/** An RFQ takes these lines (a publish): refused for a line already in hand — one line, one place. */
export function linkRfqLines(lines: readonly IncomingLine[], idx: readonly number[], rfq: { id: string; number: string | null }): { lines: IncomingLine[] } | ActRefusal {
  if (!idx.length || idx.some((i) => !lines[i])) return "no_lines"
  if (idx.some((i) => lines[i].gone || lines[i].ps === "fail")) return "not_buyable"
  if (idx.some((i) => lines[i].ps && !(lines[i].ps === "rfq" && lines[i].rfqId === rfq.id))) return "already_in_hand"
  return { lines: lines.map((l, i) => (idx.includes(i) ? { ...l, ps: "rfq" as const, rfqId: rfq.id, rfqNumber: rfq.number, rel: (l.rel || []).filter((r) => r !== rfq.id), v: l.ps === "rfq" ? l.v : l.v + 1 } : l)) }
}

/** An RFQ lets these lines go (an award left them out, the RFQ was cancelled or deleted): they are to be bought again. An order is not taken back. */
export function releaseLines(lines: readonly IncomingLine[], idx: readonly number[], rfqId: string | null): IncomingLine[] {
  return lines.map((l, i) => {
    if (!idx.includes(i) || l.ps !== "rfq") return l
    if (rfqId && l.rfqId !== rfqId) return l
    return { ...l, ps: null, rfqId: null, rfqNumber: null, rel: rfqId ? Array.from(new Set([...(l.rel || []), rfqId])) : l.rel, v: l.v + 1 }
  })
}

/** An order carries these lines (an award, a direct order). */
export function linkPoLines(lines: readonly IncomingLine[], idx: readonly number[], po: { id: string; number: string }): { lines: IncomingLine[] } | ActRefusal {
  if (!idx.length || idx.some((i) => !lines[i])) return "no_lines"
  if (idx.some((i) => lines[i].gone || lines[i].ps === "fail")) return "not_buyable"
  if (idx.some((i) => lines[i].ps === "po" && lines[i].poId !== po.id)) return "already_in_hand"
  return { lines: lines.map((l, i) => (idx.includes(i) ? { ...l, ps: "po" as const, poId: po.id, poNumber: po.number, v: l.ps === "po" && l.poId === po.id ? l.v : l.v + 1 } : l)) }
}

// ---------------------------------------------------------------------------
// Counts for the frame (the rail's «2 جديدة») and the segments
// ---------------------------------------------------------------------------

export interface IncomingFact {
  st: RequestSt
  buyLines: number
}

export function incomingSegmentCounts(facts: readonly IncomingFact[], upcoming = 0): Record<IncomingSegment, number> {
  const out: Record<IncomingSegment, number> = { upcoming, new: 0, prepared: 0, rfq: 0, order: 0, done: 0, ended: 0, all: facts.length }
  for (const f of facts) out[segmentOfRequest(f.st, f.buyLines)] += 1
  return out
}

/** What the frame shows: the new requests (a remainder of a partly handled one is new again). */
export const incomingCounts = (facts: readonly IncomingFact[]): { new: number; open: number } => ({
  new: facts.filter((f) => segmentOfRequest(f.st, f.buyLines) === "new").length,
  open: facts.filter((f) => requestOpen(f.st)).length,
})

export function summaryOf(doc: IncomingDoc, clock: ReplyClock): IncomingFact {
  return { st: doc.st, buyLines: buyLineIndexes(doc.lines, clock).length }
}

/** The requester's four steps (REQ-01): عند المشتريات · في عروض · في أمر · وصلت — plus the end «تعذّر الشراء». */
export type RequesterStep = "placed" | "rfq" | "order" | "arrived" | "failed" | "withdrawn"
export const REQUESTER_STEPS: readonly Exclude<RequesterStep, "failed" | "withdrawn">[] = ["placed", "rfq", "order", "arrived"]

export function requesterStep(st: RequestSt): RequesterStep {
  switch (st) {
    case "rfq":
      return "rfq"
    case "po":
      return "order"
    case "done":
      return "arrived"
    case "fail":
      return "failed"
    case "wd":
      return "withdrawn"
    default:
      return "placed"
  }
}

// ── The requester's own list («طلباتي»): where each request stands — quantities and dates, never a price or a supplier ──

export interface MyRequest {
  id: string
  mrKey: string
  no: string
  src: IncomingSrc
  place: IncomingDoc["place"]
  needBy: string | null
  createdAt: string
  requestedFor: { kind: IncomingPerson["kind"]; name: string }
  requestedBy: string
  note: string | null
  st: RequestSt
  step: RequesterStep
  lines: Array<{ name: string; unit: string; qty: number; kind: LineKind }>
  rfqNumber: string | null
  poNumber: string | null
  promisedDate: string | null
  /** When the RFQ it is in closes, and the earliest open delivery notice on its order («في الطريق — يصل …»). Never a price, never a supplier. */
  rfqDeadline?: string | null
  transitDate?: string | null
  failed: { why: string; alt: string } | null
  withdrawable: boolean
}


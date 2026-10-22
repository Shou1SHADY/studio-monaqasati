// «قبل الشراء» (Procurement 2.0, WP-S2-04, INC-07/08/09, ED-09, WF-04/05): before a request's material is published, the stores are
// asked for it (`proc:ISS`) and — for stone the workshop cuts — the workshop may be asked to make it (`proc:MK`). What the stores
// give and the workshop makes is NOT bought (`buyQ = qty − give − make`); a material waiting for either answer is not published
// until it comes or its window lapses, and then the line fails OPEN — bought in full, with no button to press. An answer that
// comes after that never takes the material back (R-xx). Pure: no I/O, no clock but the one passed in.

import { addDays, dayOf, todayOf } from "./po"
import { lastOrderDayOf } from "./need-desk"
import type { MaterialPick } from "../materials/types"
import type { ProcurementPolicies } from "./types"
import {
  lineBusy,
  lineBuyQty,
  lineGive,
  lineHeld,
  lineKind,
  lineMake,
  requestOpen,
  stockUntil,
  workshopUntil,
  type ActRefusal,
  type IncomingDoc,
  type IncomingLine,
  type ReplyClock,
  type StockReply,
  type WorkshopReply,
} from "./incoming-state"

/** The sub-categories the workshop cuts — الرخام · جرانيت · الأحجار الطبيعية — by their tree ids, never by name. */
export const WORKSHOP_MAKE_SUBS: readonly string[] = [
  "3bd2e92c-c578-4daa-8bfd-5cff218cb7f4",
  "33622c55-bfd9-4444-8602-d4c09fe13b67",
  "21b0421e-dc12-49f2-a088-3fcf5fcdeeae",
]

export const isMakeMaterial = (m: Pick<MaterialPick, "subId"> | null | undefined): boolean => Boolean(m?.subId) && WORKSHOP_MAKE_SUBS.includes(m?.subId as string)

/** A reason typed by the replier must be at least this long. */
export const REPLY_REASON_MIN = 2
/** A work order number must be at least this long. */
export const WORK_ORDER_MIN = 3

export type CheckPolicies = Pick<ProcurementPolicies, "supplyLeadDays" | "rfqWindowDays" | "awardCycleDays" | "inventoryReplyDays" | "workshopReplyDays">

export interface CheckContext {
  now: Date
  policies: CheckPolicies
}

const iso = (now: Date) => now.toISOString()

/** The last day Inventory may reply: the day asked + the window, never beyond the request's last day to order, never before today. */
export function stockDeadline(needBy: string | null | undefined, ctx: CheckContext): string {
  const today = todayOf(ctx.now)
  const plain = addDays(today, Math.max(0, ctx.policies.inventoryReplyDays))
  const last = lastOrderDayOf(needBy ? dayOf(needBy) : null, ctx.policies)
  const capped = last && last < plain ? last : plain
  return capped < today ? today : capped
}

/** A version bump when the line's place changed (what a requester or a project is told of). */
function bumped(before: IncomingLine, after: IncomingLine, clock: ReplyClock): IncomingLine {
  return lineKind(before, clock) === lineKind(after, clock) ? after : { ...after, v: before.v + 1 }
}

const replaceAt = (lines: readonly IncomingLine[], i: number, next: IncomingLine): IncomingLine[] => lines.map((l, k) => (k === i ? next : l))
const indexOfNo = (lines: readonly IncomingLine[], no: number): number => lines.findIndex((l) => l.no === no)

// ── Asking the stores ───────────────────────────────────────────────────────

/** Stock is asked for the team's and the project's requests only: a workshop's shortfall was checked inside Manufacturing, and a stock gap IS the stores' own. */
export const asksStock = (doc: Pick<IncomingDoc, "src">): boolean => doc.src === "pm" || doc.src === "team"

/** The lines a stock check can still be asked for: a live material with no answer from the stores, not in hand. */
export function unaskedLines(doc: IncomingDoc): number[] {
  if (!asksStock(doc) || !requestOpen(doc.st) || doc.withdrawn) return []
  return doc.lines.flatMap((l, i) => (!l.gone && !lineBusy(l) && !l.stk && l.qty > 0 ? [i] : []))
}

/** `proc:ISS` for every material line (or the given line numbers): the line waits for Inventory, until the day its window ends. */
export function askStock(doc: IncomingDoc, ctx: CheckContext, only?: readonly number[]): { lines: IncomingLine[]; asked: IncomingLine[] } | ActRefusal {
  const open = unaskedLines(doc).filter((i) => !only || only.includes(doc.lines[i].no))
  if (!open.length) return only ? "already_asked" : { lines: doc.lines, asked: [] }
  const lines = doc.lines.map((l, i) => {
    if (!open.includes(i)) return l
    const stk: StockReply = { st: "wait", at: iso(ctx.now), until: stockDeadline(l.needBy || doc.needBy, ctx), src: "proc", rv: 0 }
    return { ...l, stk }
  })
  return { lines, asked: open.map((i) => lines[i]) }
}

// ── The stores' reply (inv:CHK) ─────────────────────────────────────────────

export const STOCK_KINDS = ["issue", "part", "tied", "none"] as const
export type StockKind = (typeof STOCK_KINDS)[number]

export interface StockReplyInput {
  /** The line's number (1-based) on the request. */
  line: number
  kind: StockKind
  /** part: what the stores give. */
  give?: number | null
  warehouse?: { id: string; name: string } | null
  /** tied: why it is committed to another purpose; part / none: why not all of it. */
  why?: string | null
}

/** What the stores' answer does to a line: refused after the window lapsed, for a line already in hand, or without what its kind needs. */
export function applyStockReply(doc: IncomingDoc, input: StockReplyInput, ctx: { now: Date; clock: ReplyClock; by: string }): { lines: IncomingLine[]; line: IncomingLine } | ActRefusal {
  const i = indexOfNo(doc.lines, input.line)
  if (i < 0) return "no_line"
  const l = doc.lines[i]
  if (l.gone) return "not_buyable"
  if (lineBusy(l)) return "already_in_hand"
  const asked = l.stk
  if (!asked || asked.src !== "proc") return "not_asked"
  if (asked.auto === "timeout" || (asked.st === "wait" && lineHeld({ ...l, mk: null }, ctx.clock) !== "stock")) return "window_lapsed"
  const why = (input.why || "").trim()
  const give = input.kind === "issue" ? l.qty : input.kind === "part" ? Math.round((Number(input.give) || 0) * 1000) / 1000 : 0
  if (input.kind === "part" && !(give > 0 && give < l.qty)) return "bad_qty"
  if (input.kind === "tied" && why.length < REPLY_REASON_MIN) return "no_reason"
  if (give > 0 && !input.warehouse?.id) return "no_warehouse"
  const reply: StockReply = {
    st: input.kind,
    at: asked.at,
    until: asked.until ?? null,
    src: "proc",
    rv: (asked.rv || 0) + 1,
    by: ctx.by,
    on: iso(ctx.now),
    ...(give > 0 ? { give, wh: input.warehouse ?? null } : {}),
    ...(why ? { why } : {}),
  }
  const next = bumped(l, { ...l, stk: reply }, ctx.clock)
  return { lines: replaceAt(doc.lines, i, next), line: next }
}

// ── The workshop (proc:MK / mfg:MK) ─────────────────────────────────────────

/** «اسأل الورشة» is offered for stone the workshop cuts, with the Manufacturing connector on, on a request that is not the workshop's own and has not been published. */
export function canAskWorkshop(doc: Pick<IncomingDoc, "src" | "st" | "withdrawn">, l: IncomingLine, mfgOn: boolean): boolean {
  if (!mfgOn || doc.src === "mfg" || doc.withdrawn) return false
  if (doc.st !== "new" && doc.st !== "prep" && doc.st !== "part") return false
  return !l.gone && !lineBusy(l) && !l.mk && isMakeMaterial(l.material)
}

export interface AskWorkshopInput {
  lines: number[]
  note?: string | null
  /** The last purchase price of each material, by its line number — sent with the question. */
  refs?: Record<number, { price: number; po: string | null; day: string | null } | null>
}

export function askWorkshop(doc: IncomingDoc, input: AskWorkshopInput, ctx: { now: Date; clock: ReplyClock; by: string; mfgOn: boolean }): { lines: IncomingLine[]; asked: IncomingLine[] } | ActRefusal {
  if (!ctx.mfgOn) return "connector_off"
  if (!input.lines.length) return "no_lines"
  const idx = input.lines.map((no) => indexOfNo(doc.lines, no))
  if (idx.some((i) => i < 0)) return "no_line"
  if (idx.some((i) => doc.lines[i].mk)) return "already_asked"
  if (idx.some((i) => !isMakeMaterial(doc.lines[i].material))) return "not_makeable"
  if (idx.some((i) => !canAskWorkshop(doc, doc.lines[i], true))) return "not_buyable"
  const lines = doc.lines.map((l, i) => {
    if (!idx.includes(i)) return l
    const mk: WorkshopReply = { st: "ask", at: iso(ctx.now), src: "proc", rv: 0, by: ctx.by, ref: input.refs?.[l.no] ?? null, ...(input.note?.trim() ? { note: input.note.trim() } : {}) }
    return bumped(l, { ...l, mk }, ctx.clock)
  })
  return { lines, asked: idx.map((i) => lines[i]) }
}

export const WORKSHOP_KINDS = ["make", "part", "buy"] as const
export type WorkshopKind = (typeof WORKSHOP_KINDS)[number]

export interface WorkshopReplyInput {
  line: number
  kind: WorkshopKind
  /** part: what the workshop makes. */
  make?: number | null
  wo?: string | null
  why?: string | null
}

export function applyWorkshopReply(doc: IncomingDoc, input: WorkshopReplyInput, ctx: { now: Date; clock: ReplyClock; by: string }): { lines: IncomingLine[]; line: IncomingLine } | ActRefusal {
  const i = indexOfNo(doc.lines, input.line)
  if (i < 0) return "no_line"
  const l = doc.lines[i]
  if (l.gone) return "not_buyable"
  if (lineBusy(l)) return "already_in_hand"
  const asked = l.mk
  if (!asked || asked.src !== "proc") return "not_asked"
  if (asked.auto || (asked.st === "ask" && lineHeld({ ...l, stk: null }, ctx.clock) !== "workshop")) return "window_lapsed"
  const left = Math.max(0, Math.round((l.qty - lineGive(l)) * 1000) / 1000)
  const why = (input.why || "").trim()
  const wo = (input.wo || "").trim()
  if (input.kind === "buy" && why.length < REPLY_REASON_MIN) return "no_reason"
  if (input.kind !== "buy" && wo.length < WORK_ORDER_MIN) return "no_work_order"
  const make = input.kind === "make" ? left : Math.round((Number(input.make) || 0) * 1000) / 1000
  if (input.kind === "part" && !(make > 0 && make < left)) return "bad_qty"
  const reply: WorkshopReply = {
    st: input.kind,
    at: asked.at,
    src: "proc",
    rv: (asked.rv || 0) + 1,
    by: ctx.by,
    on: iso(ctx.now),
    ref: asked.ref ?? null,
    ...(asked.note ? { note: asked.note } : {}),
    ...(input.kind === "buy" ? { why } : { make, wo, ...(why ? { why } : {}) }),
  }
  const next = bumped(l, { ...l, mk: reply }, ctx.clock)
  return { lines: replaceAt(doc.lines, i, next), line: next }
}

// ── Failing open ────────────────────────────────────────────────────────────

/** A question whose window lapsed with no answer is closed «buy everything» and written so: nobody presses «امضِ بالشراء». Returns the line numbers it closed. */
export function proceedLapsed(lines: readonly IncomingLine[], clock: ReplyClock): { lines: IncomingLine[]; closed: number[] } {
  const closed: number[] = []
  const next = lines.map((l) => {
    if (l.gone || lineBusy(l)) return l
    const stockLapsed = l.stk?.st === "wait" && lineHeld({ ...l, mk: null }, clock) !== "stock"
    const workshopLapsed = l.mk?.st === "ask" && lineHeld({ ...l, stk: null }, clock) !== "workshop"
    if (!stockLapsed && !workshopLapsed) return l
    closed.push(l.no)
    const out: IncomingLine = { ...l }
    if (stockLapsed && l.stk) out.stk = { ...l.stk, st: "none", auto: "timeout", on: iso(clock.now) }
    if (workshopLapsed && l.mk) out.mk = { ...l.mk, st: "buy", auto: "timeout", on: iso(clock.now) }
    return { ...out, v: l.v + 1 }
  })
  return { lines: next, closed }
}

/** The Manufacturing connector closed: what the workshop was asked and has not answered returns to the buyer; what it already answered (a work order exists) stands (NFR-08). */
export function closeWorkshopQuestions(lines: readonly IncomingLine[], clock: ReplyClock): { lines: IncomingLine[]; closed: number[] } {
  const closed: number[] = []
  const next = lines.map((l) => {
    if (l.mk?.st !== "ask" || lineBusy(l) || l.gone) return l
    closed.push(l.no)
    return bumped(l, { ...l, mk: { ...l.mk, st: "buy", auto: "closed", on: iso(clock.now) } }, clock)
  })
  return { lines: next, closed }
}

const tracked = (l: IncomingLine) => JSON.stringify([l.qty, l.gone ?? null, l.stk ?? null, l.mk ?? null, Boolean(l.rcv), Boolean(l.samplePending)])

/**
 * The lines after their source was read again, with the answers Procurement already holds put back: an answer given through the
 * line (`src: "proc"`) stands over a source that has none; a question closed for want of an answer stays closed — a reply that
 * arrives afterwards never takes the material back; a source's own answer wins over a question still waiting. The line's version
 * moves only when something the requester or the project reads moved.
 */
export function settleReplies(prev: readonly IncomingLine[], refreshed: readonly IncomingLine[]): IncomingLine[] {
  return refreshed.map((l, i) => {
    const own = prev[i]
    if (!own || own.no !== l.no) return l
    let stk = l.stk ?? null
    let mk = l.mk ?? null
    if (own.stk?.auto) stk = own.stk
    else if (own.stk?.src === "proc") stk = own.stk.st !== "wait" ? own.stk : stk ?? own.stk
    if (own.mk?.auto) mk = own.mk
    else if (own.mk?.src === "proc") mk = own.mk.st !== "ask" ? own.mk : mk ?? own.mk
    const out: IncomingLine = { ...l, stk, mk }
    const v = tracked(out) === tracked(own) ? own.v : tracked(out) === tracked(l) ? l.v : own.v + 1
    return { ...out, v }
  })
}

// ── What a line says before buying (the column, the chips, Today's «ننتظره من غيرنا») ──

export type StockView =
  | { kind: "wait"; until: string }
  | { kind: "issue" | "part"; give: number; warehouse: string | null }
  | { kind: "tied"; why: string }
  | { kind: "none" }
  | { kind: "timeout" }

export type WorkshopView =
  | { kind: "ask"; at: string; until: string }
  | { kind: "make" | "part"; make: number; wo: string }
  | { kind: "buy"; why: string }
  | { kind: "closed" }
  | { kind: "timeout" }

/** `wait` = held for an answer · `buy` = N to publish · `zero` = nothing left to buy · `in_hand` = in an RFQ, an order or closed · `gone`. */
export interface BuyView {
  kind: "wait" | "buy" | "zero" | "in_hand" | "gone"
  qty: number
  of: number
}

export interface BeforeView {
  stock: StockView | null
  workshop: WorkshopView | null
  buy: BuyView
  canAsk: boolean
}

export function stockViewOf(l: IncomingLine, clock: ReplyClock): StockView | null {
  const s = l.stk
  if (!s) return null
  if (s.st === "wait") return lineHeld({ ...l, mk: null }, clock) === "stock" ? { kind: "wait", until: stockUntil(s, clock.stockDays) } : { kind: "timeout" }
  if (s.auto === "timeout") return { kind: "timeout" }
  if (s.st === "issue" || s.st === "part") return { kind: s.st, give: lineGive(l), warehouse: s.wh?.name ?? null }
  if (s.st === "tied") return { kind: "tied", why: s.why || "" }
  return { kind: "none" }
}

export function workshopViewOf(l: IncomingLine, clock: ReplyClock): WorkshopView | null {
  const m = l.mk
  if (!m) return null
  if (m.st === "ask") return lineHeld({ ...l, stk: null }, clock) === "workshop" ? { kind: "ask", at: m.at, until: workshopUntil(m, clock.workshopDays) } : { kind: "timeout" }
  if (m.auto === "closed") return { kind: "closed" }
  if (m.auto === "timeout") return { kind: "timeout" }
  if (m.st === "buy") return { kind: "buy", why: m.why || "" }
  return { kind: m.st, make: lineMake(l), wo: m.wo || "" }
}

export function beforeBuying(doc: Pick<IncomingDoc, "src" | "st" | "withdrawn">, l: IncomingLine, clock: ReplyClock, mfgOn: boolean): BeforeView {
  const kind = lineKind(l, clock)
  const buy: BuyView =
    kind === "gone" ? { kind: "gone", qty: 0, of: l.qty } : kind === "wait" ? { kind: "wait", qty: 0, of: l.qty } : kind === "buy" ? { kind: "buy", qty: lineBuyQty(l, clock), of: l.qty } : kind === "covered" ? { kind: "zero", qty: 0, of: l.qty } : { kind: "in_hand", qty: 0, of: l.qty }
  return { stock: stockViewOf(l, clock), workshop: workshopViewOf(l, clock), buy, canAsk: canAskWorkshop(doc, l, mfgOn) }
}

/** The column shows where there is an answer or a category the workshop makes; elsewhere it stays out of the way. */
export const hasBeforeColumn = (v: BeforeView): boolean => v.stock != null || v.workshop != null || v.canAsk

export interface BeforeSummary {
  waitingStock: number
  waitingWorkshop: number
  issues: number
  makes: number
  askable: number
}

/** The card's one-line summary: awaiting Inventory · awaiting the workshop · Inventory issues N · the workshop makes part · ask the workshop. */
export function beforeSummary(doc: Pick<IncomingDoc, "src" | "st" | "withdrawn" | "lines">, clock: ReplyClock, mfgOn: boolean): BeforeSummary {
  const out: BeforeSummary = { waitingStock: 0, waitingWorkshop: 0, issues: 0, makes: 0, askable: 0 }
  if (!(doc.st === "new" || doc.st === "prep" || doc.st === "part") || doc.withdrawn) return out
  for (const l of doc.lines) {
    if (l.gone) continue
    const held = lineHeld(l, clock)
    if (held === "stock") out.waitingStock++
    else if (held === "workshop") out.waitingWorkshop++
    if (lineGive(l) > 0) out.issues++
    if (lineMake(l) > 0) out.makes++
    if (canAskWorkshop(doc, l, mfgOn)) out.askable++
  }
  return out
}

export interface WaitingLine {
  mrKey: string
  no: string
  line: number
  name: string
  qty: number
  unit: string
  who: "inventory" | "workshop"
  until: string
}

/** «ننتظره من غيرنا»: every line held for the stores' or the workshop's answer, with the day their window ends. */
export function waitingLines(docs: readonly IncomingDoc[], clock: ReplyClock): WaitingLine[] {
  const out: WaitingLine[] = []
  for (const d of docs) {
    if (!requestOpen(d.st) || d.withdrawn) continue
    for (const l of d.lines) {
      if (l.gone) continue
      const held = lineHeld(l, clock)
      if (!held) continue
      const until = held === "stock" ? stockUntil(l.stk as StockReply, clock.stockDays) : workshopUntil(l.mk as WorkshopReply, clock.workshopDays)
      out.push({ mrKey: d.mrKey, no: d.no, line: l.no, name: l.name, qty: l.qty, unit: l.unit, who: held === "stock" ? "inventory" : "workshop", until })
    }
  }
  return out.sort((a, b) => a.until.localeCompare(b.until) || a.no.localeCompare(b.no) || a.line - b.line)
}

/** Lines of team requests waiting for the stores, for Inventory's desk. */
export const stockQuestions = (docs: readonly IncomingDoc[], clock: ReplyClock): WaitingLine[] => waitingLines(docs.filter((d) => d.src === "team"), clock).filter((w) => w.who === "inventory")

/** Lines the workshop was asked about and has not answered, for Manufacturing's desk. */
export const workshopQuestions = (docs: readonly IncomingDoc[], clock: ReplyClock): WaitingLine[] => waitingLines(docs, clock).filter((w) => w.who === "workshop")

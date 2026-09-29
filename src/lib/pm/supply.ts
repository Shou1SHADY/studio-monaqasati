// PM 1.0 — material requests on a project (prototype Supply › Requests & needs,
// PRD §4 supply.request / request.decide / change.decide / supply.stopUnarrived /
// supply.receive). The engineer asks for a material on a BOQ item, its quantity,
// its need-by date and its specification; where it comes from is Inventory's and
// Procurement's. The project manager's approval is technical (item, material,
// quantity, date); the money is approved later on the purchase order.
//
// The request still lives at `projects/{id}/purchaseRequests/{NN}` — the
// document Procurement's needs desk already reads. Its `items` (name, quantity,
// unit) are what Procurement sees: they are written from the lines on approval
// and kept in step as lines are decided, stopped or received. A line whose
// material is not among its item's materials is a change request the manager
// decides (on us · on the client · rejected); the rest of the request is not
// held for it. Received quantities come from the project-side receipt, which is
// the project's own act. Pure.

import type { PmAttachment } from "./attachments"
import { sampleStateOf } from "./sample"
import { itemProgress, materialKeyOf, r2, ratedOn, storeBalance, type PmStoreLine, type StoreItem } from "./store"

export const PURCHASE_REQUESTS = "purchaseRequests"
export const PM_PETTY = "pmPetty"
export const PM_PLANT = "pmPlantRequests"

export const reqNo = (seq: number) => String(seq).padStart(2, "0")

export type ChangeState = "wait" | "us" | "own" | "no"
export interface ReqChange {
  st: ChangeState
  why?: string | null
  by?: string | null
  byName?: string | null
  on?: string | null
  voSeq?: number | null
  ref?: string | null
}

export const CLOSE_WHY = ["need", "alt", "over", "dsg", "oth"] as const
export type CloseWhy = (typeof CLOSE_WHY)[number]
export type CloseKind = "full" | "short" | "cancel"
export interface ReqClose {
  t: CloseKind
  on: string
  by: string
  byName?: string | null
  why?: CloseWhy | "chg" | null
  whyNote?: string | null
}

export interface ReqReceipt {
  grn: string
  q: number
  rej: number
  on: string
  by: string
  byName?: string | null
  dn?: string | null
  note?: string | null
  short?: boolean
  /** The delivery note photographed, or the material itself. */
  files?: PmAttachment[]
}

/** Inventory's reply on a line, through Procurement: issued from a main store,
 * or not — with the reason, and then it is bought. Written by Inventory's desk. */
export interface ReqInventoryReply {
  k: "issue" | "none"
  q?: number | null
  /** Not issued (a partial issue's rest, or all of it) — Procurement buys it. */
  kept?: number | null
  /** The reason, rendered in the keeper's language; `whyK` its code (linked · none · dir). */
  why?: string | null
  whyK?: string | null
  /** The main store it is issued from. */
  warehouseId?: string | null
  warehouseName?: string | null
  note?: string | null
  on: string
  by?: string | null
  byName?: string | null
}

export interface ReqLine {
  /** null = general site consumables (expensed on arrival, not tracked). */
  itemId: string | null
  code: string | null
  key: string
  name: string
  unit: string
  qty: number
  /** Built the material list of an item that had none (not a change). */
  first?: boolean
  chg?: ReqChange | null
  cl?: ReqClose | null
  receipts?: ReqReceipt[]
  inv?: ReqInventoryReply | null
}

export type ReqStatus = "pending" | "approved" | "rejected"

export interface PmMaterialRequest {
  id: string
  pm?: boolean
  seq?: number
  title: string
  needBy?: string | null
  notes?: string | null
  lines: ReqLine[]
  status: ReqStatus
  withdrawn?: boolean
  requestedByUserId: string
  requestedByUserName?: string | null
  day?: string | null
  approvedOn?: string | null
  approvedByName?: string | null
  decidedByUserName?: string | null
  items?: Array<{ name: string; quantity: number; unit: string }>
  rfqId?: string | null
  rfqNumber?: string | null
  poId?: string | null
  poNumber?: string | null
  mfgRequestId?: string | null
}

type Raw = Record<string, unknown> & { id: string }
const str = (v: unknown) => (typeof v === "string" ? v : "")
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}
const iso = (v: unknown): string => {
  if (typeof v === "string") return v.slice(0, 10)
  const t = v as { toDate?: () => Date } | null
  return t && typeof t.toDate === "function" ? t.toDate().toISOString().slice(0, 10) : ""
}

/** A stored request, PM or legacy: a legacy one's `items` become lines on no item. */
export function requestOf(d: Raw): PmMaterialRequest {
  const lines: ReqLine[] = Array.isArray(d.lines)
    ? (d.lines as ReqLine[])
    : ((d.items as Array<{ name?: string; quantity?: unknown; unit?: string }>) || [])
        .map((i) => ({ itemId: null, code: null, key: materialKeyOf(str(i.name), str(i.unit)), name: str(i.name).trim(), unit: str(i.unit).trim(), qty: num(i.quantity) }))
        .filter((l) => l.name && l.qty > 0)
  const status = (["pending", "approved", "rejected"] as const).find((s) => s === d.status) ?? "pending"
  return {
    id: d.id,
    pm: Boolean(d.pm),
    seq: typeof d.seq === "number" ? d.seq : undefined,
    title: str(d.title),
    needBy: str(d.needBy) || null,
    notes: str(d.notes) || null,
    lines,
    status,
    withdrawn: Boolean(d.withdrawn),
    requestedByUserId: str(d.requestedByUserId),
    requestedByUserName: str(d.requestedByUserName) || null,
    day: str(d.day) || iso(d.createdAt) || null,
    approvedOn: str(d.approvedOn) || null,
    approvedByName: str(d.approvedByName) || str(d.decidedByUserName) || null,
    decidedByUserName: str(d.decidedByUserName) || null,
    rfqId: str(d.rfqId) || null,
    rfqNumber: str(d.rfqNumber) || null,
    poId: str(d.poId) || null,
    poNumber: str(d.poNumber) || null,
    mfgRequestId: str(d.mfgRequestId) || null,
  }
}

// ── The request's state ─────────────────────────────────────────────────────

/** wait awaiting technical approval · rej rejected · go in progress · done fully
 * delivered · shut rest stopped · cx cancelled (withdrawn, or every line cancelled). */
export type ReqState = "wait" | "rej" | "go" | "done" | "shut" | "cx"

export function reqState(r: Pick<PmMaterialRequest, "status" | "withdrawn" | "lines">): ReqState {
  if (r.status === "pending") return "wait"
  if (r.status === "rejected") return r.withdrawn ? "cx" : "rej"
  if (!r.lines.length || !r.lines.every((l) => l.cl)) return "go"
  if (r.lines.every((l) => l.cl?.t === "cancel")) return "cx"
  return r.lines.every((l) => l.cl?.t !== "short") ? "done" : "shut"
}

export const reqLive = (r: Pick<PmMaterialRequest, "status" | "withdrawn" | "lines">) => {
  const s = reqState(r)
  return s === "wait" || s === "go"
}

export const lineGot = (l: ReqLine) => r2((l.receipts || []).reduce((a, x) => a + x.q, 0))
export const lineRejected = (l: ReqLine) => r2((l.receipts || []).reduce((a, x) => a + (x.rej || 0), 0))
const held = (l: ReqLine) => l.chg?.st === "wait"
const refused = (l: ReqLine) => l.chg?.st === "no"

/** Still owed on the line: requested − received, unless it was closed. */
export const lineOut = (l: ReqLine) => (l.cl || refused(l) ? 0 : Math.max(0, r2(l.qty - lineGot(l))))

/** Issued from a main store and not yet received on the project — on the way
 * (the prototype's lnTransit: authorised portions less what arrived). */
export const lineInTransit = (l: ReqLine) => (l.cl ? 0 : l.inv?.k === "issue" ? Math.max(0, r2(Math.min(Number(l.inv.q) || 0, l.qty) - lineGot(l))) : 0)

/** Share received, over the lines not cancelled. */
export function reqPct(r: Pick<PmMaterialRequest, "lines">): number {
  const ls = r.lines.filter((l) => l.cl?.t !== "cancel" && !refused(l))
  return ls.length ? ls.reduce((a, l) => a + Math.min(1, l.qty > 0 ? lineGot(l) / l.qty : 0), 0) / ls.length : 0
}

export const openChanges = (r: Pick<PmMaterialRequest, "lines">) => r.lines.filter(held)

/** What a change line offers its decider. A line put on the client waits on the
 * client: «على حسابنا» and «أوقِف» come back only once the client rejected its
 * variation. Above the decider's riyal limit «على حسابنا» is the owner's. */
export function changeOptions(input: { line: ReqLine; voStatus: string | null; estimate: number | null; limit: number }): { decide: boolean; clientRejected: boolean; usOverLimit: boolean } {
  const st = input.line.chg?.st
  const clientRejected = st === "own" && input.voStatus === "rej"
  return { decide: st === "wait", clientRejected, usOverLimit: input.estimate !== null && input.estimate > input.limit }
}

/** Where one line stands. prop expected (awaiting approval) · held a change
 * awaiting the manager · refused the change was rejected · ask with Procurement ·
 * rfq with Procurement, an RFQ is out · mfg routed to our workshop · po an order is
 * with the supplier · part part received · done received · cx cancelled. */
export type LinePhase = "prop" | "held" | "refused" | "ask" | "rfq" | "mfg" | "po" | "part" | "done" | "cx"

export function linePhase(r: Pick<PmMaterialRequest, "status" | "withdrawn" | "rfqId" | "poId" | "mfgRequestId">, l: ReqLine): LinePhase {
  if (refused(l)) return "refused"
  if (r.status === "pending") return "prop"
  if (r.status === "rejected") return "cx"
  if (held(l)) return "held"
  const got = lineGot(l)
  if (l.cl) return l.cl.t === "cancel" ? "cx" : "done"
  if (got >= l.qty - 0.005) return "done"
  if (got > 0) return "part"
  if (r.poId) return "po"
  if (r.mfgRequestId) return "mfg"
  if (r.rfqId) return "rfq"
  return "ask"
}

/** A line can be received on the project once someone is bringing it: an order
 * with the supplier, a workshop order, or a part already in. */
export const receivable = (r: Pick<PmMaterialRequest, "status" | "withdrawn" | "rfqId" | "poId" | "mfgRequestId">, l: ReqLine) => {
  const p = linePhase(r, l)
  // What a main store issued is received on the project like what a supplier sends.
  return (p === "po" || p === "mfg" || p === "part" || lineInTransit(l) > 0) && lineOut(l) > 0
}

/** What Procurement sees: every approved line not held or refused — a closed line
 * at what arrived (none when nothing did). */
export function procurementItems(r: Pick<PmMaterialRequest, "lines">): Array<{ name: string; quantity: number; unit: string }> {
  return r.lines
    .filter((l) => !held(l) && !refused(l))
    .map((l) => ({ name: l.name, unit: l.unit, quantity: l.cl ? lineGot(l) : l.qty }))
    .filter((i) => i.quantity > 0)
}

export const reqTitle = (lines: Array<Pick<ReqLine, "name">>, fallback: string) => {
  const names = [...new Set(lines.map((l) => l.name.trim()).filter(Boolean))]
  return names.length ? names.slice(0, 2).join(" · ") + (names.length > 2 ? ` +${names.length - 2}` : "") : fallback
}

// ── Composing a request ─────────────────────────────────────────────────────

export interface LineDraft {
  itemId: string | null
  name: string
  unit: string
  qty: number
  why?: string | null
}

/** An item's materials: every store line with a rate entry on it. */
export function itemMaterials(stores: Array<Pick<PmStoreLine, "key" | "name" | "unit" | "rates">>, itemId: string) {
  return stores.filter((s) => s.rates && itemId in s.rates).map((s) => ({ key: s.key, name: s.name, unit: s.unit, rate: s.rates[itemId] }))
}

/** How a drafted line enters: general (no item) · first (the item has no material
 * list yet — this builds it) · own (one of the item's materials) · change. */
export function lineKind(stores: Array<Pick<PmStoreLine, "key" | "name" | "unit" | "rates">>, d: Pick<LineDraft, "itemId" | "name" | "unit">): "general" | "first" | "own" | "change" {
  if (!d.itemId) return "general"
  const mats = itemMaterials(stores, d.itemId)
  if (!mats.length) return "first"
  return mats.some((m) => m.key === materialKeyOf(d.name, d.unit)) ? "own" : "change"
}

export type RequestBlock = "archived" | "no_lines" | "bad_line" | "bad_date"

export function requestBlocks(input: { archived: boolean; lines: LineDraft[]; needBy: string | null; today: string }): RequestBlock[] {
  const out: RequestBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.lines.length) out.push("no_lines")
  if (input.lines.some((l) => !l.name.trim() || !l.unit.trim() || !(Number.isFinite(l.qty) && l.qty > 0))) out.push("bad_line")
  if (input.needBy && input.needBy < input.today) out.push("bad_date")
  return out
}

export function buildLines(stores: Array<Pick<PmStoreLine, "key" | "name" | "unit" | "rates">>, items: Array<Pick<StoreItem, "id" | "code">>, drafts: LineDraft[]): ReqLine[] {
  return drafts.map((d) => {
    const kind = lineKind(stores, d)
    const base: ReqLine = { itemId: d.itemId, code: d.itemId ? items.find((i) => i.id === d.itemId)?.code ?? null : null, key: materialKeyOf(d.name, d.unit), name: d.name.trim(), unit: d.unit.trim(), qty: d.qty, receipts: [] }
    if (kind === "change") return { ...base, chg: { st: "wait", why: d.why?.trim() || null } }
    if (kind === "first") return { ...base, first: true }
    return base
  })
}

// ── What the project still needs ────────────────────────────────────────────

const itemById = (items: StoreItem[], id: string | null | undefined) => (id ? items.find((i) => i.id === id) : undefined)

/** Outstanding on live approved requests for this material. */
export const onTheWay = (requests: PmMaterialRequest[], key: string, except?: string) =>
  r2(requests.filter((r) => r.id !== except && r.status === "approved" && reqLive(r)).reduce((a, r) => a + r.lines.filter((l) => l.key === key && !held(l)).reduce((c, l) => c + lineOut(l), 0), 0))

/** The project's items still need this much of the material after what is on
 * site and on the way: Σ remaining × rate × (1 + waste) over the rated, unfinished
 * items − balance − on the way. Null when no item carries a rate for it. */
export function lineNeed(input: { key: string; stores: PmStoreLine[]; items: StoreItem[]; requests: PmMaterialRequest[]; except?: string }): number | null {
  const s = input.stores.find((x) => x.key === input.key)
  if (!s) return null
  const rated = Object.keys(s.rates || {}).filter((id) => ratedOn(s, id) && itemById(input.items, id))
  if (!rated.length) return null
  const need = rated.reduce((a, id) => {
    const it = itemById(input.items, id) as StoreItem
    const r = ratedOn(s, id) as { r: number; w: number }
    return a + (itemProgress(it) < 99.5 ? Math.max(0, it.quantity - it.executed) * r.r * (1 + r.w / 100) : 0)
  }, 0)
  return r2(Math.max(0, need - Math.max(0, storeBalance(s, input.items)) - onTheWay(input.requests, input.key, input.except)))
}

const DAY = 86_400_000
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY)

/** Days of work the quantity covers at the item's current pace — a request that
 * covers months ties up cash and ground. */
export function lineDays(input: { stores: PmStoreLine[]; items: StoreItem[]; itemId: string | null; key: string; qty: number; startOn: string | null; today: string }): number | null {
  const it = itemById(input.items, input.itemId)
  const s = input.stores.find((x) => x.key === input.key)
  const r = s && it ? ratedOn(s, it.id) : null
  if (!r || !it || !(it.executed > 0)) return null
  const elapsed = input.startOn ? daysBetween(input.startOn, input.today) : 0
  const perDay = it.executed / Math.max(30, elapsed)
  return perDay > 0 ? Math.round(input.qty / ((r.r as number) * (1 + r.w / 100)) / perDay) : null
}

export const lineOver = (need: number | null, qty: number) => (need !== null && qty > need * 1.05 ? r2(qty - need) : 0)

// ── Technical approval ──────────────────────────────────────────────────────

export type SampleVerdict = "ok" | "pend" | "rej" | "none" | null

/** The worst sample state over the request's items (null = no item requires one). */
export function requestSample(r: Pick<PmMaterialRequest, "lines">, items: Array<{ id: string; pmSample?: boolean | null; pmSub?: string | null }>): SampleVerdict {
  const rank = { ok: 0, pend: 1, none: 2, rej: 3 } as const
  let worst: SampleVerdict = null
  for (const id of new Set(r.lines.filter((l) => l.itemId && !refused(l)).map((l) => l.itemId as string))) {
    const it = items.find((i) => i.id === id)
    if (!it) continue
    const s = sampleStateOf(it)
    if (s === "free") continue
    const v = s === "approved" ? "ok" : s === "with_consultant" ? "pend" : s === "rejected" ? "rej" : "none"
    if (worst === null || rank[v] > rank[worst]) worst = v
  }
  return worst
}

export interface ApprovalChecks {
  sample: SampleVerdict
  held: number
  over: ReqLine[]
  long: Array<{ line: ReqLine; days: number }>
  dup: number
  daysToNeed: number | null
}

export function approvalChecks(input: { request: PmMaterialRequest; requests: PmMaterialRequest[]; stores: PmStoreLine[]; items: Array<StoreItem & { pmSample?: boolean | null; pmSub?: string | null }>; startOn: string | null; today: string }): ApprovalChecks {
  const r = input.request
  const over = r.lines.filter((l) => l.itemId && !held(l) && lineOver(lineNeed({ key: l.key, stores: input.stores, items: input.items, requests: input.requests, except: r.id }), l.qty) > 0)
  const long = r.lines
    .map((l) => ({ line: l, days: lineDays({ stores: input.stores, items: input.items, itemId: l.itemId, key: l.key, qty: l.qty, startOn: input.startOn, today: input.today }) }))
    .filter((x): x is { line: ReqLine; days: number } => x.days !== null && x.days > 45)
  const near = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.abs(daysBetween(a, b)) <= 7 : !a && !b)
  const dup = r.lines.filter((l) => l.itemId && input.requests.some((x) => x.id !== r.id && reqLive(x) && near(x.needBy, r.needBy) && x.lines.some((m) => m.key === l.key && !m.cl))).length
  return {
    sample: requestSample(r, input.items),
    held: openChanges(r).length,
    over,
    long,
    dup,
    daysToNeed: r.needBy ? daysBetween(input.today, r.needBy) : null,
  }
}

export type ApproveBlock = "archived" | "not_pending" | "sample_rejected" | "sample_missing" | "all_changes"

export function approveBlocks(input: { archived: boolean; request: Pick<PmMaterialRequest, "status" | "lines">; sample: SampleVerdict }): ApproveBlock[] {
  const out: ApproveBlock[] = []
  if (input.archived) out.push("archived")
  if (input.request.status !== "pending") out.push("not_pending")
  if (input.sample === "rej") out.push("sample_rejected")
  if (input.sample === "none") out.push("sample_missing")
  if (input.request.lines.length && input.request.lines.every(held)) out.push("all_changes")
  return out
}

// ── Stopping what has not arrived ───────────────────────────────────────────

export type StopBlock = "archived" | "not_open" | "closed" | "nothing_left" | "why_text" | "in_transit"

/** Stop the rest: what nobody started on is withdrawn; an order's remainder is
 * cancelled by Procurement with the supplier. What arrived stays in the store. */
export function stopBlocks(input: { archived: boolean; request: Pick<PmMaterialRequest, "status" | "withdrawn" | "lines">; line: ReqLine; why: CloseWhy | null; whyNote: string | null }): StopBlock[] {
  const out: StopBlock[] = []
  if (input.archived) out.push("archived")
  if (reqState(input.request) !== "go") out.push("not_open")
  if (input.line.cl) out.push("closed")
  else if (lineOut(input.line) <= 0) out.push("nothing_left")
  // What left a main store is not cancelled — it is received, then returned if unwanted.
  if (lineInTransit(input.line) > 0) out.push("in_transit")
  if (input.why === "oth" && !input.whyNote?.trim()) out.push("why_text")
  return out
}

export const stoppedLine = (l: ReqLine, c: Omit<ReqClose, "t">): ReqLine => ({ ...l, cl: { ...c, t: lineGot(l) > 0 ? "short" : "cancel" } })

// ── Receiving on the project ────────────────────────────────────────────────

export type ReceiveBlock = "archived" | "not_receivable" | "bad_qty" | "over_remaining"

export function receiveBlocks(input: { archived: boolean; receivable: boolean; remaining: number; acc: number; rej: number }): ReceiveBlock[] {
  const out: ReceiveBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.receivable) out.push("not_receivable")
  if (!(input.acc >= 0 && input.rej >= 0 && input.acc + input.rej > 0)) out.push("bad_qty")
  else if (input.acc > input.remaining + 0.005) out.push("over_remaining")
  return out
}

/** The line after a receipt: fully in closes it; "the rest will not arrive" closes it short. */
export function receivedLine(l: ReqLine, receipt: ReqReceipt, on: string, by: string): ReqLine {
  const next: ReqLine = { ...l, receipts: [...(l.receipts || []), receipt] }
  const got = lineGot(next)
  if (got >= l.qty * 0.995) return { ...next, cl: { t: "full", on, by: "sys" } }
  if (receipt.short) return { ...next, cl: { t: got > 0 ? "short" : "cancel", on, by, byName: receipt.byName ?? null, why: null } }
  return next
}

// ── The change decision ─────────────────────────────────────────────────────

export type ChangeBlock = "archived" | "not_a_change" | "decided" | "wrong_state"

/** A pending change is decided while the request is pending or in progress; an
 * "on the client" whose variation the client rejected comes back to "on us". */
export function changeBlocks(input: { archived: boolean; request: Pick<PmMaterialRequest, "status" | "withdrawn" | "lines">; line: ReqLine; decision: "us" | "own" | "no"; voRejected: boolean }): ChangeBlock[] {
  const out: ChangeBlock[] = []
  if (input.archived) out.push("archived")
  const st = reqState(input.request)
  if (st !== "wait" && st !== "go") out.push("wrong_state")
  if (!input.line.chg) out.push("not_a_change")
  else if (input.line.chg.st !== "wait" && !(input.line.chg.st === "own" && input.voRejected && input.decision === "us")) out.push("decided")
  return out
}

// ── Needs within 30 days (the «يحتاج طلباً» side panel) ────────────────────

export interface NeedRow {
  key: string
  name: string
  unit: string
  itemId: string
  code: string
  need: number
  gap: number
}

/** For every rated material × unfinished item: what the next 30 days of work on
 * the item consume — the share of its remaining work that falls in the window
 * (from its activity's dates, else its current pace) — less what is on site and
 * on the way. A row is covered when a live request names the material. */
export function needsWithin(input: {
  stores: PmStoreLine[]
  items: StoreItem[]
  requests: PmMaterialRequest[]
  activities: Array<{ from: string; to: string; itemIds: string[] }>
  startOn: string | null
  today: string
  window?: number
}): { gaps: NeedRow[]; covered: number } {
  const win = input.window ?? 30
  const rows: NeedRow[] = []
  for (const s of input.stores) {
    for (const id of Object.keys(s.rates || {})) {
      const r = ratedOn(s, id)
      const it = itemById(input.items, id)
      if (!r || !it || itemProgress(it) >= 99.5) continue
      const remaining = Math.max(0, it.quantity - it.executed)
      const acts = input.activities.filter((a) => a.itemIds.includes(id) && a.to >= input.today && a.from <= addDays(input.today, win))
      let share = 0
      if (acts.length) {
        const to = acts.reduce((m, a) => (a.to > m ? a.to : m), acts[0].to)
        const from = acts.reduce((m, a) => (a.from < m ? a.from : m), acts[0].from)
        const left = Math.max(1, daysBetween(from > input.today ? from : input.today, to) + 1)
        const inWin = Math.max(0, Math.min(left, win - Math.max(0, daysBetween(input.today, from))))
        share = Math.min(1, inWin / left)
      } else if (it.executed > 0) {
        const elapsed = input.startOn ? daysBetween(input.startOn, input.today) : 0
        const perDay = it.executed / Math.max(30, elapsed)
        share = perDay > 0 ? Math.min(1, (perDay * win) / Math.max(remaining, 1e-9)) : 0
      }
      const need = r2(remaining * share * (r.r as number) * (1 + r.w / 100))
      if (need > 0) rows.push({ key: s.key, name: s.name, unit: s.unit, itemId: id, code: it.code, need, gap: 0 })
    }
  }
  const byKey = new Map<string, NeedRow[]>()
  for (const n of rows) byKey.set(n.key, [...(byKey.get(n.key) || []), n])
  const gaps: NeedRow[] = []
  let covered = 0
  for (const [key, list] of byKey) {
    const s = input.stores.find((x) => x.key === key) as PmStoreLine
    let avail = Math.max(0, storeBalance(s, input.items)) + onTheWay(input.requests, key)
    for (const n of list.sort((a, b) => a.code.localeCompare(b.code))) {
      const gap = r2(Math.max(0, n.need - avail))
      avail = Math.max(0, avail - n.need)
      const requested = input.requests.some((r) => reqLive(r) && r.lines.some((l) => !l.cl && l.key === key))
      if (gap > 0 && !requested) gaps.push({ ...n, gap })
      else covered++
    }
  }
  return { gaps: gaps.sort((a, b) => b.gap - a.gap), covered }
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

// ── Direct purchases under a cap ────────────────────────────────────────────

/** PRD §13 defaults: per purchase and per rolling 30 days. */
export const PETTY_CAP = { one: 3000, month: 15000 } as const

export interface PmPetty {
  id: string
  seq: number
  what: string
  supplier: string
  amount: number
  receipt: string | null
  files?: PmAttachment[]
  day: string
  by: string
  byName?: string | null
}

export const pettyNo = (seq: number) => String(seq).padStart(2, "0")

export const pettyMonth = (list: Array<Pick<PmPetty, "day" | "amount">>, today: string) => r2(list.filter((x) => daysBetween(x.day, today) <= 30 && daysBetween(x.day, today) >= 0).reduce((a, x) => a + x.amount, 0))

export type PettyBlock = "archived" | "no_what" | "no_supplier" | "bad_amount" | "over_one" | "future"

export function pettyBlocks(input: { archived: boolean; what: string; supplier: string; amount: number; day: string; today: string }): PettyBlock[] {
  const out: PettyBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.what.trim()) out.push("no_what")
  if (!input.supplier.trim()) out.push("no_supplier")
  if (!(Number.isFinite(input.amount) && input.amount > 0)) out.push("bad_amount")
  else if (input.amount > PETTY_CAP.one) out.push("over_one")
  if (input.day > input.today) out.push("future")
  return out
}

// ── Equipment requests ──────────────────────────────────────────────────────

export const PLANT_CATEGORIES = ["tool", "light", "heavy", "lift"] as const
export type PlantCategory = (typeof PLANT_CATEGORIES)[number]
/** Whether the category is run with an operator question (heavy and lifting plant). */
export const plantHasOperator = (c: PlantCategory) => c === "heavy" || c === "lift"
export const PLANT_WHY = ["scope", "rate", "site", "safe", "down", "oth"] as const
export type PlantWhy = (typeof PLANT_WHY)[number]

export interface PmPlantRequest {
  id: string
  seq: number
  category: PlantCategory
  what: string
  activityId: string | null
  activityName?: string | null
  from: string
  to: string
  qty: number
  operator: boolean
  whyK: PlantWhy
  why: string | null
  status: "wait" | "go" | "rej"
  day: string
  by: string
  byName?: string | null
  decidedBy?: string | null
  decidedByName?: string | null
  decidedOn?: string | null
  /** The plant desk's reply as the site recorded it (there is no desk module yet). */
  rep?: PlantReply | null
  /** Received on site: the unit it became in `pmPlant`. */
  got?: { plantSeq: number; on: string; by: string; byName?: string | null } | null
}

/** alloc a unit of our fleet · late busy until a date · alt an alternative offered ·
 * none not in our fleet · hire sent to Procurement as a timed hire. */
export const PLANT_REPLIES = ["alloc", "late", "alt", "none"] as const
export type PlantReplyKind = (typeof PLANT_REPLIES)[number] | "hire"

export interface PlantReply {
  k: PlantReplyKind
  /** alloc: the unit's tag · late: free from (date) · alt: what was offered. */
  unit?: string | null
  free?: string | null
  text?: string | null
  on: string
  by: string
  byName?: string | null
}

export type PlantReplyBlock = "archived" | "not_with_desk" | "replied" | "no_kind" | "no_unit" | "no_free" | "no_text" | "future"

/** Recording the desk's reply: once, on an approved request not yet replied to. */
export function plantReplyBlocks(input: { archived: boolean; r: Pick<PmPlantRequest, "status" | "rep">; k: PlantReplyKind | null; unit?: string | null; free?: string | null; text?: string | null; on: string; today: string }): PlantReplyBlock[] {
  const out: PlantReplyBlock[] = []
  if (input.archived) out.push("archived")
  if (input.r.status !== "go") out.push("not_with_desk")
  else if (input.r.rep) out.push("replied")
  if (!input.k || input.k === "hire") out.push("no_kind")
  else if (input.k === "alloc" && !input.unit?.trim()) out.push("no_unit")
  else if (input.k === "late" && !input.free) out.push("no_free")
  else if (input.k === "alt" && !input.text?.trim()) out.push("no_text")
  if (!input.on || input.on > input.today) out.push("future")
  return out
}

/** Received on site once allocated from our fleet or hired in its place. */
export const plantReceivable = (r: Pick<PmPlantRequest, "status" | "rep" | "got">) => r.status === "go" && !r.got && (r.rep?.k === "alloc" || r.rep?.k === "alt" || r.rep?.k === "hire")

/** «استأجر بدلها»: the fleet cannot serve it (busy or none) — the approver sends it to Procurement. */
export const plantHireable = (r: Pick<PmPlantRequest, "status" | "rep" | "got">) => r.status === "go" && !r.got && (r.rep?.k === "late" || r.rep?.k === "none")

/** The pill a request shows. */
export function plantState(r: Pick<PmPlantRequest, "status" | "rep" | "got">): "wait" | "rej" | "desk" | "alloc" | "late" | "alt" | "none" | "hire" | "got" {
  if (r.status === "wait") return "wait"
  if (r.status === "rej") return "rej"
  if (r.got) return "got"
  return r.rep?.k ?? "desk"
}

export const plantNo = (seq: number) => String(seq).padStart(2, "0")
export const plantDays = (from: string, to: string) => daysBetween(from, to) + 1

export type PlantBlock = "archived" | "no_category" | "no_what" | "no_activity" | "bad_dates" | "bad_qty" | "no_why" | "why_text"

export function plantBlocks(input: { archived: boolean; category: PlantCategory | null; what: string; activityId: string | null; hasActivities: boolean; from: string; to: string; qty: number; whyK: PlantWhy | null; why: string | null }): PlantBlock[] {
  const out: PlantBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.category) out.push("no_category")
  if (!input.what.trim()) out.push("no_what")
  if (input.hasActivities && !input.activityId) out.push("no_activity")
  if (!input.from || !input.to || input.to < input.from) out.push("bad_dates")
  if (!(Number.isInteger(input.qty) && input.qty >= 1)) out.push("bad_qty")
  if (!input.whyK) out.push("no_why")
  else if (input.whyK === "oth" && !input.why?.trim()) out.push("why_text")
  return out
}

// ── The project's purchase orders (read from Procurement) ───────────────────

export interface ProjectPoLine {
  name: string
  unit: string
  quantity: number
  unitPrice: number | null
  accepted: number
  cancelled: number
  boqItemId?: string | null
}

/** Received share of an order, by quantity, over what was not cancelled. */
export function poReceivedShare(lines: ProjectPoLine[]): number {
  const ordered = lines.reduce((a, l) => a + Math.max(0, l.quantity - (l.cancelled || 0)), 0)
  return ordered > 0 ? Math.min(1, lines.reduce((a, l) => a + (l.accepted || 0), 0) / ordered) : 0
}

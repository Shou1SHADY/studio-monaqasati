// PM 1.0 — the project store (prototype «مستودع المشروع»): a ledger, not a
// building. One line per material on the project, one heap serving all its BOQ
// items, from the day it arrives until it is used, returned, moved or written
// off. Use is computed per item: (executed now − executed when tracking began)
// × the material's rate on that item; an item without a rate is declared, and a
// declaration is approved by someone other than the person who logged it.
//
// `projects/{id}/pmStore/{storeId}` — the id is derived from the material key
// (folded name + unit), so a receipt and a request always meet the same line.
// Moves are appended, never edited except for their approval state. Pure.

import { materialKey } from "../procurement/prices"

export const PM_STORE = "pmStore"

/** op opening balance · rc received on the project · rx inbound without a document
 * (approved) · use declared use (approved) · ret returned to the main store · xo
 * moved to another project · xi moved in from another project · loss loss or
 * damage (approved) · sret back to the supplier. */
export const MOVE_TYPES = ["op", "rc", "rx", "use", "ret", "xo", "xi", "loss", "sret"] as const
export type MoveType = (typeof MOVE_TYPES)[number]
export type MoveState = "wait" | "ok" | "rej" | "done"

export const LOSS_WHY = ["waste", "dmg", "nc", "theft", "oth"] as const
export type LossWhy = (typeof LOSS_WHY)[number]
export const RX_FROM = ["cash", "owner", "prj", "prior", "oth"] as const
export type RxFrom = (typeof RX_FROM)[number]

export interface StoreMove {
  t: MoveType
  q: number
  on: string
  by: string
  byName?: string | null
  st?: MoveState | null
  itemId?: string | null
  code?: string | null
  /** rc: the request, the project receipt number and the delivery note. */
  reqId?: string | null
  reqSeq?: number | null
  grn?: string | null
  dn?: string | null
  rej?: number | null
  source?: string | null
  /** ret: the main store it goes back to. */
  warehouseId?: string | null
  warehouseName?: string | null
  /** xo / xi: the other project. */
  otherProjectId?: string | null
  otherProjectName?: string | null
  /** xi: the source project's store line and the index of its xo move. */
  srcStoreId?: string | null
  srcMove?: number | null
  why?: LossWhy | null
  from?: RxFrom | null
  note?: string | null
  /** sret: charged to the supplier (a loss converted by the approver). */
  sup?: boolean | null
  appr?: string | null
  apprName?: string | null
  apprOn?: string | null
  /** Approved by the person who logged it — the owner only, flagged. */
  self?: boolean | null
}

/** The material's rate on one BOQ item: `r` per unit of the item (null =
 * declared), allowed waste %, and the item's executed quantity when tracking
 * began (`ex0`). `src`: first = built by the first request on an item with no
 * price analysis · chg = a change decided on us / on the client · rate = set here. */
export interface ItemRate {
  r: number | null
  w: number
  ex0: number
  src: "first" | "chg" | "rate"
  ref?: string | null
  voSeq?: number | null
}

export interface PmStoreLine {
  id: string
  key: string
  name: string
  unit: string
  rates: Record<string, ItemRate>
  moves: StoreMove[]
}

export interface StoreItem {
  id: string
  code: string
  description: string
  unit: string
  quantity: number
  executed: number
}

export const r2 = (n: number) => Math.round(n * 100) / 100
export const r3 = (n: number) => Math.round(n * 1000) / 1000

/** The material's identity on the project: folded name and unit — the same key
 * Procurement's price history files its prices under. */
export const materialKeyOf = (name: string, unit: string) => materialKey(name, unit)

/** A Firestore-safe, deterministic id for a material key. */
export function storeIdOf(key: string): string {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  let h2 = 52711
  for (let i = key.length - 1; i >= 0; i--) h2 = ((h2 << 5) + h2 + key.charCodeAt(i)) >>> 0
  return `m${h.toString(36)}${h2.toString(36)}`
}

const sum = (x: Pick<PmStoreLine, "moves">, t: MoveType, f?: (m: StoreMove) => boolean) => r2(x.moves.filter((m) => m.t === t && (!f || f(m))).reduce((a, m) => a + m.q, 0))

export const itemProgress = (item: Pick<StoreItem, "quantity" | "executed"> | undefined) => (item && item.quantity > 0 ? (item.executed / item.quantity) * 100 : 0)
const itemDone = (item: StoreItem | undefined) => itemProgress(item) >= 99.5

/** The items that use the material: those with a rate entry, and those a move names. */
export function storeCodes(x: Pick<PmStoreLine, "rates" | "moves">, items: StoreItem[]): string[] {
  const ids = new Set<string>(Object.keys(x.rates || {}))
  for (const m of x.moves) if (m.itemId) ids.add(m.itemId)
  return [...ids].filter((id) => items.some((i) => i.id === id))
}

export const ratedOn = (x: Pick<PmStoreLine, "rates">, itemId: string): ItemRate | null => {
  const r = x.rates?.[itemId]
  return r && r.r != null ? r : null
}

/** Computed use on one item: executed since tracking began × rate. */
export function itemCalc(x: Pick<PmStoreLine, "rates">, item: StoreItem | undefined): number {
  if (!item) return 0
  const r = ratedOn(x, item.id)
  return r ? r2(Math.max(0, item.executed - r.ex0) * (r.r as number)) : 0
}

export const itemUse = (x: PmStoreLine, item: StoreItem | undefined) => (item ? r2(itemCalc(x, item) + sum(x, "use", (m) => m.itemId === item.id && m.st === "ok")) : 0)

export const storeReceived = (x: PmStoreLine) => r2(sum(x, "op") + sum(x, "rc") + sum(x, "rx", (m) => m.st === "ok") + sum(x, "xi", (m) => m.st === "done"))
export const storeUsed = (x: PmStoreLine, items: StoreItem[]) => r2(storeCodes(x, items).reduce((a, id) => a + itemUse(x, items.find((i) => i.id === id)), 0))
export const storeOut = (x: PmStoreLine) => r2(sum(x, "ret") + sum(x, "xo") + sum(x, "sret") + sum(x, "loss", (m) => m.st === "ok"))
export const storeBalance = (x: PmStoreLine, items: StoreItem[]) => r2(storeReceived(x) - storeUsed(x, items) - storeOut(x))
export const pendingMoves = (x: PmStoreLine) => x.moves.filter((m) => (m.t === "loss" || m.t === "use" || m.t === "rx") && m.st === "wait")

export const storeAllowance = (x: PmStoreLine, items: StoreItem[]) =>
  r2(
    storeCodes(x, items).reduce((a, id) => {
      const r = ratedOn(x, id)
      return a + (r ? (itemCalc(x, items.find((i) => i.id === id)) * r.w) / 100 : 0)
    }, 0)
  )

/** What the open items still need: remaining × rate × (1 + waste). */
export const storeNeedLeft = (x: PmStoreLine, items: StoreItem[]) =>
  r2(
    storeCodes(x, items).reduce((a, id) => {
      const r = ratedOn(x, id)
      const it = items.find((i) => i.id === id)
      return a + (r && it && !itemDone(it) ? Math.max(0, it.quantity - it.executed) * (r.r as number) * (1 + r.w / 100) : 0)
    }, 0)
  )

export const storeAllDone = (x: PmStoreLine, items: StoreItem[]) => {
  const cs = storeCodes(x, items)
  return cs.length > 0 && cs.every((id) => itemDone(items.find((i) => i.id === id)))
}

/** open on the project · close needs closing (items done, more than the allowance
 * left) · done closed · zero nothing on hand · neg used more than received · pend
 * a move awaits approval. */
export type StoreState = "open" | "close" | "done" | "zero" | "neg" | "pend"

export function storeState(x: PmStoreLine, items: StoreItem[]): StoreState {
  const bal = storeBalance(x, items)
  if (bal < -0.005) return "neg"
  if (pendingMoves(x).length) return "pend"
  if (storeAllDone(x, items)) return bal <= storeAllowance(x, items) + 0.005 ? "done" : "close"
  return bal <= 0.005 ? "zero" : "open"
}

export type StoreFilter = "act" | "open" | "done"
export const storeGroup = (st: StoreState): StoreFilter => (st === "close" || st === "neg" || st === "pend" ? "act" : st === "open" ? "open" : "done")

// ── Where the materials went (at cost) ───────────────────────────────────────

export interface WhereWent {
  received: number
  measured: number
  declared: number
  losses: number
  out: number
  now: number
  idle: number
  /** Materials on hand with no known cost, left out of the figures. */
  uncosted: number
}

export function whereWent(lines: PmStoreLine[], items: StoreItem[], costOf: (x: PmStoreLine) => number | null): WhereWent {
  const out: WhereWent = { received: 0, measured: 0, declared: 0, losses: 0, out: 0, now: 0, idle: 0, uncosted: 0 }
  for (const x of lines) {
    const c = costOf(x)
    const bal = storeBalance(x, items)
    if (c == null || !(c > 0)) {
      if (bal > 0) out.uncosted++
      continue
    }
    const measured = storeCodes(x, items).reduce((a, id) => a + itemCalc(x, items.find((i) => i.id === id)), 0)
    out.received += storeReceived(x) * c
    out.measured += measured * c
    out.declared += sum(x, "use", (m) => m.st === "ok") * c
    out.losses += sum(x, "loss", (m) => m.st === "ok") * c
    out.out += (sum(x, "ret") + sum(x, "sret") + sum(x, "xo")) * c
    const now = Math.max(0, bal) * c
    out.now += now
    if (storeAllDone(x, items)) out.idle += now
  }
  return { ...out, received: r2(out.received), measured: r2(out.measured), declared: r2(out.declared), losses: r2(out.losses), out: r2(out.out), now: r2(out.now), idle: r2(out.idle) }
}

// ── Moves ────────────────────────────────────────────────────────────────────

/** Moves logged on the ledger itself (a receipt comes from a request). */
export const LOGGED_MOVES = ["use", "ret", "xo", "loss", "rx"] as const
export type LoggedMove = (typeof LOGGED_MOVES)[number]

export type MoveBlock = "archived" | "bad_qty" | "over_balance" | "no_item" | "item_rated" | "no_warehouse" | "no_project" | "no_reason" | "reason_text" | "no_source" | "source_text"

export function moveBlocks(input: {
  archived: boolean
  t: LoggedMove
  q: number
  balance: number
  itemId?: string | null
  itemRated?: boolean
  warehouseId?: string | null
  toProjectId?: string | null
  why?: LossWhy | null
  from?: RxFrom | null
  note?: string | null
}): MoveBlock[] {
  const out: MoveBlock[] = []
  if (input.archived) out.push("archived")
  if (!(Number.isFinite(input.q) && input.q > 0)) out.push("bad_qty")
  else if (input.t !== "rx" && input.q > input.balance + 0.005) out.push("over_balance")
  if (input.t === "use") {
    if (!input.itemId) out.push("no_item")
    else if (input.itemRated) out.push("item_rated")
  }
  if (input.t === "ret" && !input.warehouseId) out.push("no_warehouse")
  if (input.t === "xo" && !input.toProjectId) out.push("no_project")
  if (input.t === "loss") {
    if (!input.why) out.push("no_reason")
    else if (input.why === "oth" && !input.note?.trim()) out.push("reason_text")
  }
  if (input.t === "rx") {
    if (!input.from) out.push("no_source")
    else if (input.from === "oth" && !input.note?.trim()) out.push("source_text")
  }
  return out
}

/** A logged move as stored: a non-conforming "loss" is not a loss — it goes back
 * to the supplier. Use, loss and inbound wait for approval; ret waits for
 * Inventory, xo for the other project. */
export function newMove(input: { t: LoggedMove; q: number; on: string; by: string; byName: string | null; itemId?: string | null; code?: string | null; warehouseId?: string | null; warehouseName?: string | null; toProjectId?: string | null; toProjectName?: string | null; why?: LossWhy | null; from?: RxFrom | null; fromProjectId?: string | null; fromProjectName?: string | null; note?: string | null }): StoreMove {
  const base = { q: r3(input.q), on: input.on, by: input.by, byName: input.byName, st: "wait" as MoveState, note: input.note?.trim() || null }
  if (input.t === "use") return { ...base, t: "use", itemId: input.itemId ?? null, code: input.code ?? null }
  if (input.t === "ret") return { ...base, t: "ret", warehouseId: input.warehouseId ?? null, warehouseName: input.warehouseName ?? null }
  if (input.t === "xo") return { ...base, t: "xo", otherProjectId: input.toProjectId ?? null, otherProjectName: input.toProjectName ?? null }
  if (input.t === "loss") return input.why === "nc" ? { ...base, t: "sret", why: "nc" } : { ...base, t: "loss", why: input.why ?? null }
  return { ...base, t: "rx", from: input.from ?? null, otherProjectId: input.from === "prj" ? input.fromProjectId ?? null : null, otherProjectName: input.from === "prj" ? input.fromProjectName ?? null : null }
}

export const approvable = (m: StoreMove) => (m.t === "loss" || m.t === "use" || m.t === "rx") && m.st === "wait"

export type MoveDecision = "ok" | "rej" | "sup"
export type DecideRefusal = "not_waiting" | "self" | "sup_not_loss"

/** Approving a logged move: the store approver, never the person who logged it
 * (the owner may, flagged). "On the supplier" turns a loss (not theft) into a
 * return to the supplier. */
export function decideRefusal(m: StoreMove, decision: MoveDecision, actorUid: string, isOwner: boolean): DecideRefusal | null {
  if (!approvable(m)) return "not_waiting"
  if (m.by === actorUid && !isOwner) return "self"
  if (decision === "sup" && (m.t !== "loss" || m.why === "theft")) return "sup_not_loss"
  return null
}

export function decidedMove(m: StoreMove, decision: MoveDecision, actor: { uid: string; name: string | null }, on: string): StoreMove {
  const stamp = { appr: actor.uid, apprName: actor.name, apprOn: on, self: m.by === actor.uid ? true : null }
  if (decision === "sup") return { ...m, ...stamp, t: "sret", sup: true, st: "wait" }
  return { ...m, ...stamp, st: decision }
}

export type RateBlock = "archived" | "bad_rate" | "bad_waste" | "no_item"

export function rateBlocks(input: { archived: boolean; itemId: string | null; r: number; w: number }): RateBlock[] {
  const out: RateBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.itemId) out.push("no_item")
  if (!(Number.isFinite(input.r) && input.r > 0)) out.push("bad_rate")
  if (!(Number.isFinite(input.w) && input.w >= 0 && input.w <= 30)) out.push("bad_waste")
  return out
}

/** Correcting an existing rate recomputes since tracking began; a new rate starts now. */
export function withRate(x: Pick<PmStoreLine, "rates">, itemId: string, r: number, w: number, executedNow: number): Record<string, ItemRate> {
  const had = x.rates?.[itemId]
  const keepEx0 = had && had.r != null
  return { ...(x.rates || {}), [itemId]: { ...(had ?? { src: "rate" as const }), r: r3(r), w, ex0: keepEx0 ? had.ex0 : executedNow, src: had?.src ?? "rate" } }
}

/** A stored ledger line with its lists defaulted (a fresh line has none yet). */
export function storeLineOf(id: string, d: Partial<Omit<PmStoreLine, "id">>): PmStoreLine {
  return { id, key: d.key ?? "", name: d.name ?? "", unit: d.unit ?? "", rates: d.rates ?? {}, moves: d.moves ?? [] }
}

// PM 1.0 — measurement sheets (PRD MS-01, MS-02, MS-04, CON-02, CON-05, WF-04).
// A sheet is written by whoever measures and approved by whoever approves; a
// person holding both self-approves, and that is recorded, not assumed.
// "Executed" moves only when a sheet is approved — and it is capped at the
// item's remaining quantity at APPROVAL time, not at writing time, on a
// lump-sum contract (any extra quantity there needs a variation). On a
// re-measurement contract extra quantity is measured without a variation;
// beyond 25% over the contract quantity the excess is re-rated. An unpriced
// item is measured and moves, but adds no money until priced. The first
// approved sheet moves the project from planning to live. Pure: no I/O.

import type { PricingBasis } from "./terms"

/** `projects/{id}/pmSheets/{NN}` — numbered by the project's `pm.sheetCount`. */
export const PM_SHEETS = "pmSheets"

export const SHEET_STATUSES = ["wait", "ok", "no"] as const
export type SheetStatus = (typeof SHEET_STATUSES)[number]

/** Over this share of the contract quantity, a re-measured item's excess is re-rated (§13). */
export const RERATE_SHARE = 0.25

export interface SheetLine {
  itemId: string
  /** The item's code as the sheet was written (read, not relied on). */
  code?: string | null
  qty: number
  /** Set at approval: what actually moved "executed" after the cap. */
  approved?: number | null
}

export interface PmSheet {
  id: string
  seq: number
  status: SheetStatus
  /** The measuring day, `YYYY-MM-DD`. */
  day: string
  by: string
  byName?: string | null
  lines: SheetLine[]
  note?: string | null
  okBy?: string | null
  okByName?: string | null
  okAt?: string | null
  /** The writer held `approve` and approved their own sheet — recorded (MS-01). */
  self?: boolean
  returnNote?: string | null
}

/** What the rules need of a BOQ item. */
export interface MeasuredItem {
  id: string
  quantity: number
  /** 0 = unpriced (CON-02). */
  rate: number
  executed: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export const sheetNo = (seq: number) => String(seq).padStart(2, "0")

/** Left to execute on an item. */
export const remainingOf = (item: Pick<MeasuredItem, "quantity" | "executed">) => r2(Math.max(0, item.quantity - item.executed))

export type SheetBlock = "archived" | "no_lines" | "bad_qty" | "unknown_item"

/** What stops writing a sheet. Over-remaining on a lump sum is a warning here
 * (the cap applies at approval); a blocked item is refused by the gate (MS-03). */
export function sheetBlocks(input: { archived: boolean; lines: Pick<SheetLine, "itemId" | "qty">[]; items: Pick<MeasuredItem, "id">[] }): SheetBlock[] {
  const out: SheetBlock[] = []
  if (input.archived) out.push("archived")
  const lines = input.lines.filter((l) => l.qty !== 0)
  if (!lines.length) out.push("no_lines")
  if (lines.some((l) => !Number.isFinite(l.qty) || l.qty < 0)) out.push("bad_qty")
  const known = new Set(input.items.map((i) => i.id))
  if (lines.some((l) => !known.has(l.itemId))) out.push("unknown_item")
  return out
}

/** A measured quantity over the remaining, on a lump-sum contract: it will be
 * cut at approval — the extra needs a variation (CON-05). */
export const overRemaining = (basis: PricingBasis, item: Pick<MeasuredItem, "quantity" | "executed">, qty: number) => (basis === "lump" ? r2(Math.max(0, qty - remainingOf(item))) : 0)

/** On re-measurement: the executed quantity beyond 125% of the contract quantity — re-rated. */
export const rerateExcess = (item: Pick<MeasuredItem, "quantity">, executed: number) => r2(Math.max(0, executed - item.quantity * (1 + RERATE_SHARE)))

export interface AppliedSheet {
  lines: SheetLine[]
  /** item id → executed after approval. */
  executed: Record<string, number>
  /** Items that actually moved. */
  moved: number
  /** Σ moved × rate — unpriced items move but add nothing (CON-02). */
  value: number
}

/** Apply a sheet at approval: each line moves "executed" by its quantity —
 * capped at the remaining NOW on a lump sum (MS-02). */
export function applySheet(lines: SheetLine[], items: MeasuredItem[], basis: PricingBasis): AppliedSheet {
  const byId = new Map(items.map((i) => [i.id, { ...i }]))
  let moved = 0
  let value = 0
  const out = lines.map((l) => {
    const item = byId.get(l.itemId)
    if (!item || !(l.qty > 0)) return { ...l, approved: 0 }
    const got = basis === "lump" ? Math.min(l.qty, remainingOf(item)) : l.qty
    const approved = r2(Math.max(0, got))
    if (approved > 0) {
      item.executed = r2(item.executed + approved)
      moved += 1
      value += approved * (item.rate > 0 ? item.rate : 0)
    }
    return { ...l, approved }
  })
  const executed: Record<string, number> = {}
  for (const l of out) {
    const item = byId.get(l.itemId)
    if (item) executed[item.id] = item.executed
  }
  return { lines: out, executed, moved, value: r2(value) }
}

/** The value a sheet would add if approved now (for the approver's decision). */
export const sheetValue = (lines: SheetLine[], items: MeasuredItem[], basis: PricingBasis) => applySheet(lines, items, basis).value

/** Days a sheet has waited for the PM — its decision's age. */
export function sheetAge(day: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0
}

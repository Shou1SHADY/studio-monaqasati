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

import type { PmAttachment } from "./attachments"
import { measurable, type GateFields } from "./inspection"
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
  /** The delivery unit measured — approval moves that unit's executed too. */
  unit?: string | null
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
  /** «وصف الفترة» — what the sheet covers ("fortnightly — villas 1 & 2"). */
  note?: string | null
  /** The take-off, a survey or photos of the measured work (optional). */
  files?: PmAttachment[]
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
  /** Inspection gate fields of the line (MS-03). */
  gate?: GateFields
}

const r2 = (n: number) => Math.round(n * 100) / 100

export const sheetNo = (seq: number) => String(seq).padStart(2, "0")

/** Left to execute on an item. */
export const remainingOf = (item: Pick<MeasuredItem, "quantity" | "executed">) => r2(Math.max(0, item.quantity - item.executed))

export type SheetBlock = "archived" | "no_lines" | "bad_qty" | "unknown_item" | "not_measurable"

/** What stops writing — or approving — a sheet. Over-remaining on a lump sum is
 * a warning here (the cap applies at approval). An item that requires
 * inspection without a passed last attempt is refused (MS-03). */
export function sheetBlocks(input: { archived: boolean; lines: Pick<SheetLine, "itemId" | "qty">[]; items: Pick<MeasuredItem, "id" | "gate">[] }): SheetBlock[] {
  const out: SheetBlock[] = []
  if (input.archived) out.push("archived")
  const lines = input.lines.filter((l) => l.qty !== 0)
  if (!lines.length) out.push("no_lines")
  if (lines.some((l) => !Number.isFinite(l.qty) || l.qty < 0)) out.push("bad_qty")
  const known = new Set(input.items.map((i) => i.id))
  if (lines.some((l) => !known.has(l.itemId))) out.push("unknown_item")
  const gated = new Set(input.items.filter((i) => i.gate && !measurable(i.gate)).map((i) => i.id))
  if (lines.some((l) => gated.has(l.itemId))) out.push("not_measurable")
  return out
}

export type WriteBlock = SheetBlock | "over_remaining"

/** Writing adds one rule to `sheetBlocks`: on a lump sum a quantity over the
 * remaining NOW is refused — the extra needs a variation first (CON-05). The
 * cut at approval stays, because sheets waiting for the PM are not in
 * "executed" yet and a later approval can still meet a smaller remaining. */
export function sheetWriteBlocks(input: { archived: boolean; basis: PricingBasis; lines: Pick<SheetLine, "itemId" | "qty">[]; items: Array<Pick<MeasuredItem, "id" | "gate" | "quantity" | "executed">> }): WriteBlock[] {
  const out: WriteBlock[] = sheetBlocks(input)
  const byId = new Map(input.items.map((i) => [i.id, i]))
  if (input.lines.some((l) => { const i = byId.get(l.itemId); return i !== undefined && l.qty > 0 && overRemaining(input.basis, i, l.qty) > 0 })) out.push("over_remaining")
  return out
}

/** The items still to measure (executed below the contract quantity), and how many are complete and hidden. */
export function openItems<T extends Pick<MeasuredItem, "quantity" | "executed">>(items: T[]): { open: T[]; done: number } {
  const open = items.filter((i) => i.executed < i.quantity - 0.001)
  return { open, done: items.length - open.length }
}

export interface MeasureSummary {
  /** Lines with a quantity above zero. */
  count: number
  /** Σ qty × rate as entered (before any cut) — «قيمة القياس المدخل». */
  value: number
  /** Lines on unpriced items: recorded, never billed until priced. */
  unpriced: number
  /** Lump sum: lines over the remaining — they block the sheet. */
  over: number
  /** Lines on items needing a passed inspection they do not have — they block the sheet. */
  noPass: number
}

/** The live footer of the inline measurement (the prototype's act2 box). */
export function measureSummary(basis: PricingBasis, lines: Pick<SheetLine, "itemId" | "qty">[], items: MeasuredItem[]): MeasureSummary {
  const byId = new Map(items.map((i) => [i.id, i]))
  const out: MeasureSummary = { count: 0, value: 0, unpriced: 0, over: 0, noPass: 0 }
  for (const l of lines) {
    const i = byId.get(l.itemId)
    if (!i || !(l.qty > 0)) continue
    out.count += 1
    if (!(i.rate > 0)) out.unpriced += 1
    if (overRemaining(basis, i, l.qty) > 0) out.over += 1
    if (i.gate && !measurable(i.gate)) out.noPass += 1
    out.value += l.qty * (i.rate > 0 ? i.rate : 0)
  }
  out.value = r2(out.value)
  return out
}

/** Above the contract quantity on a re-measurement contract: measured and billed, not a variation. */
export const aboveContract = (basis: PricingBasis, item: Pick<MeasuredItem, "quantity" | "executed">, qty: number) => (basis === "rem" ? r2(Math.max(0, qty - remainingOf(item))) : 0)

/** The value of a sheet as it stands: approved quantities once approved, the measured ones before. */
export function recordedValue(sheet: Pick<PmSheet, "status" | "lines">, rateOf: (itemId: string) => number): number {
  return r2(sheet.lines.reduce((a, l) => a + (sheet.status === "ok" && l.approved != null ? l.approved : l.qty) * Math.max(0, rateOf(l.itemId)), 0))
}

/** The last approved measurement day — a drawing issued after it is not current for work measured before it. */
export const lastApprovedDay = (sheets: Array<Pick<PmSheet, "status" | "day">>): string | null =>
  sheets.reduce<string | null>((m, s) => (s.status === "ok" && (!m || s.day > m) ? s.day : m), null)

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

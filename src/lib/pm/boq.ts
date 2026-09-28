// PM 1.0 — the bill of quantities as the project reads it (the prototype's
// "جدول الكميات"). Every figure is derived from the line: contract = qty × rate,
// earned = executed × rate, unbilled = (executed − billed) × rate, budget of
// what is executed = executed × estimated unit cost. An unpriced line is
// measured and tracked but carries no contract value and no weight in progress
// — an invented rate is worse than none. After start nothing on a line is
// edited here: quantity and rate change by variation, and an unpriced line is
// priced once, by the agreed rate. Pure: no I/O.

import { matchesSearch } from "../search-text"

export interface PmBoqLine {
  id: string
  code: string
  description: string
  unit: string
  /** The BOQ division the line sits in (its section). */
  division: string
  quantity: number
  /** 0 = unpriced. */
  rate: number
  /** Estimated (budget) unit cost; 0 = none recorded. */
  estCost: number
  executed: number
  billed: number
  /** Actual cost booked against the line so far, SAR — null when nothing reports it. */
  actual: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** A stored `boqItems` document as the PM view reads it. */
export function boqLineOf(id: string, d: Record<string, unknown>, locale: string, actual: number | null = null): PmBoqLine {
  const pick = (ar: unknown, en: unknown) => String((locale === "ar" ? ar || en : en || ar) ?? "")
  return {
    id,
    code: String(d.itemNo ?? ""),
    description: pick(d.descriptionAr, d.descriptionEn),
    unit: String(d.unit ?? ""),
    division: pick(d.divisionNameAr, d.divisionNameEn) || String(d.divisionNo ?? "") || String(d.itemNo ?? "").split(/[-.]/)[0] || "",
    quantity: num(d.quantity),
    rate: num(d.unitPrice),
    estCost: num(d.estCost),
    executed: num(d.executedQuantity),
    billed: num(d.billedQuantity),
    actual,
  }
}

export const linePriced = (b: Pick<PmBoqLine, "rate">) => b.rate > 0
export const lineContract = (b: Pick<PmBoqLine, "quantity" | "rate">) => r2(b.quantity * b.rate)
export const lineEarned = (b: Pick<PmBoqLine, "executed" | "rate">) => r2(b.executed * b.rate)
export const lineBilled = (b: Pick<PmBoqLine, "billed" | "rate">) => r2(b.billed * b.rate)
export const lineUnbilled = (b: Pick<PmBoqLine, "executed" | "billed" | "rate">) => r2(Math.max(0, b.executed - b.billed) * b.rate)
export const lineBudget = (b: Pick<PmBoqLine, "quantity" | "estCost">) => r2(b.quantity * b.estCost)
export const lineBudgetEx = (b: Pick<PmBoqLine, "executed" | "estCost">) => r2(b.executed * b.estCost)
export const lineProgress = (b: Pick<PmBoqLine, "executed" | "quantity">) => (b.quantity > 0 ? (b.executed / b.quantity) * 100 : 0)

/** The cost the margin is taken on: what was booked, else the budget of what
 * was executed (then the margin is an estimate, and says so). */
export const lineCost = (b: Pick<PmBoqLine, "actual" | "executed" | "estCost">) => (b.actual ?? lineBudgetEx(b))
export const lineMargin = (b: PmBoqLine) => r2(lineEarned(b) - lineCost(b))

/** Margin %: on what is earned; before any work, the planned margin on the contract. */
export function lineMarginPct(b: PmBoqLine): number {
  const e = lineEarned(b)
  if (e > 0) return (lineMargin(b) / e) * 100
  const c = lineContract(b)
  return c > 0 ? ((c - lineBudget(b)) / c) * 100 : 0
}

/** A "bleeding" line: its actual unit cost is more than 2% over the estimate —
 * the difference comes straight out of the margin. Needs a booked cost. */
export const lineBleeding = (b: PmBoqLine) => b.executed > 0 && b.rate > 0 && b.estCost > 0 && b.actual !== null && b.actual > lineBudgetEx(b) * 1.02

/** Over a line's budget of executed work, in SAR (the drawer's red block over 1,000). */
export const lineOverBudget = (b: PmBoqLine) => (b.actual === null ? 0 : r2(b.actual - lineBudgetEx(b)))

/** The actual unit cost, when a cost is booked. */
export const actualUnitCost = (b: PmBoqLine) => (b.actual !== null && b.executed > 0 ? b.actual / b.executed : null)

export const BOQ_VIEWS = ["all", "leak", "ub", "ns", "done"] as const
export type BoqView = (typeof BOQ_VIEWS)[number]

/** Unbilled below this is rounding, not money to chase (the prototype's 500). */
export const UNBILLED_FLOOR = 500

const IN_VIEW: Record<BoqView, (b: PmBoqLine) => boolean> = {
  all: () => true,
  leak: lineBleeding,
  ub: (b) => lineUnbilled(b) > UNBILLED_FLOOR,
  ns: (b) => b.executed === 0,
  done: (b) => lineProgress(b) >= 99.5,
}

export function viewCounts(lines: PmBoqLine[]): Record<BoqView, number> {
  return Object.fromEntries(BOQ_VIEWS.map((v) => [v, lines.filter(IN_VIEW[v]).length])) as Record<BoqView, number>
}

/** The rows a view and a search show. The search looks across every view's
 * rows first, then the view narrows — as every search box here does. */
export function filterLines(lines: PmBoqLine[], view: BoqView, search: string): PmBoqLine[] {
  return lines.filter((b) => (!search.trim() || matchesSearch(search, [b.code, b.description])) && IN_VIEW[view](b))
}

export interface BoqGroup {
  division: string | null
  lines: PmBoqLine[]
  contract: number
  earned: number
}

/** Grouped by section (sorted), or one group holding everything. */
export function groupLines(lines: PmBoqLine[], bySection: boolean): BoqGroup[] {
  const make = (division: string | null, rows: PmBoqLine[]): BoqGroup => ({
    division,
    lines: rows,
    contract: r2(rows.reduce((a, b) => a + lineContract(b), 0)),
    earned: r2(rows.reduce((a, b) => a + lineEarned(b), 0)),
  })
  if (!bySection) return [make(null, lines)]
  const keys = Array.from(new Set(lines.map((b) => b.division))).sort((a, b) => a.localeCompare(b))
  return keys.map((k) => make(k, lines.filter((b) => b.division === k))).filter((g) => g.lines.length > 0)
}

export interface BoqTotals {
  contract: number
  earned: number
  progress: number
  unbilled: number
  cost: number
  margin: number
  /** Some line's cost is its budget, not a booked cost. */
  estimated: boolean
}

export function boqTotals(lines: PmBoqLine[]): BoqTotals {
  const contract = r2(lines.reduce((a, b) => a + lineContract(b), 0))
  const earned = r2(lines.reduce((a, b) => a + lineEarned(b), 0))
  const cost = r2(lines.reduce((a, b) => a + lineCost(b), 0))
  return {
    contract,
    earned,
    progress: contract > 0 ? (earned / contract) * 100 : 0,
    unbilled: r2(lines.reduce((a, b) => a + lineUnbilled(b), 0)),
    cost,
    margin: r2(earned - cost),
    estimated: lines.some((b) => b.executed > 0 && b.actual === null),
  }
}

export interface UnpricedNote {
  count: number
  /** Unpriced lines already carrying executed work — work nobody is billed for. */
  executed: number
  /** Their share of the BOQ quantities, %: progress is computed on the rest only. */
  unweighted: number
}

export function unpricedNote(lines: PmBoqLine[]): UnpricedNote {
  const up = lines.filter((b) => !linePriced(b))
  const q = lines.reduce((a, b) => a + b.quantity, 0)
  return { count: up.length, executed: up.filter((b) => b.executed > 0).length, unweighted: q > 0 ? (up.reduce((a, b) => a + b.quantity, 0) / q) * 100 : 0 }
}

// ── Pricing an unpriced line ────────────────────────────────────────────────

export type PriceBlock = "archived" | "already_priced" | "bad_rate" | "bad_cost"

/** An unpriced line is priced once, by the agreed rate (from the contract or an
 * approved variation). A priced line's rate is never rewritten here. */
export function priceBlocks(input: { archived: boolean; currentRate: number; rate: number; cost: number }): PriceBlock[] {
  const out: PriceBlock[] = []
  if (input.archived) out.push("archived")
  if (input.currentRate > 0) out.push("already_priced")
  if (!(Number.isFinite(input.rate) && input.rate > 0)) out.push("bad_rate")
  if (!(Number.isFinite(input.cost) && input.cost >= 0)) out.push("bad_cost")
  return out
}

// ── Import: paste from Excel ───────────────────────────────────────────────

export type ImportProblem = "code_format" | "duplicate" | "no_description" | "bad_qty" | "bad_rate" | "bad_cost"

export interface ImportRow {
  line: number
  code: string
  description: string
  unit: string
  quantity: number
  rate: number | null
  cost: number | null
  problems: ImportProblem[]
}

/** Digit groups separated by "-" or "." — 02-01-01, 3.2.1. */
const CODE = /^\d{1,4}(?:[-.]\d{1,4}){0,4}$/
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"
const toNumber = (v: string | undefined) => {
  if (v === undefined || v.trim() === "") return null
  const n = Number(v.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))))
  return Number.isFinite(n) ? n : NaN
}

/** One line per item: code · description · unit · quantity · rate · budget cost,
 * tab-separated (a paste from Excel) or split by | or ;. Rate and cost are
 * optional; every row is judged and a bad row is never imported. */
export function parseBoqPaste(raw: string, existingCodes: Iterable<string> = []): { ok: ImportRow[]; bad: ImportRow[] } {
  const seen = new Set(existingCodes)
  const ok: ImportRow[] = []
  const bad: ImportRow[] = []
  String(raw || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((l, i) => {
      const c = (l.includes("\t") ? l.split("\t") : l.split(/\s*[|;]\s*/)).map((s) => s.trim())
      const qty = toNumber(c[3])
      const row: ImportRow = { line: i + 1, code: c[0] || "", description: c[1] || "", unit: c[2] || "", quantity: qty ?? NaN, rate: toNumber(c[4]), cost: toNumber(c[5]), problems: [] }
      if (!CODE.test(row.code)) row.problems.push("code_format")
      else if (seen.has(row.code)) row.problems.push("duplicate")
      if (!row.description) row.problems.push("no_description")
      if (!(row.quantity > 0)) row.problems.push("bad_qty")
      if (row.rate !== null && !(row.rate >= 0)) row.problems.push("bad_rate")
      if (row.cost !== null && !(row.cost >= 0)) row.problems.push("bad_cost")
      seen.add(row.code)
      ;(row.problems.length ? bad : ok).push(row)
    })
  return { ok, bad }
}

/** A BOQ is written in one transaction; above this it is split in the source. */
export const MAX_IMPORT_ROWS = 450

/** The priced total against the contract value the handover carried from CRM:
 * a gap over 0.5% is flagged — every progress % would sit on a wrong base. */
export function crmMismatch(rows: Array<Pick<ImportRow, "quantity" | "rate">>, contractValue: number): { total: number; value: number; diff: number; under: boolean } | null {
  const total = r2(rows.reduce((a, r) => a + r.quantity * (r.rate || 0), 0))
  if (!rows.length || !(contractValue > 0) || Math.abs(total - contractValue) <= contractValue * 0.005) return null
  return { total, value: contractValue, diff: r2(Math.abs(contractValue - total)), under: total < contractValue }
}

export const divisionOfCode = (code: string) => code.split(/[-.]/)[0] || ""

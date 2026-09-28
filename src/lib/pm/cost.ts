// PM 1.0 — the project's cost and its monthly reconciliation (PRD CST-01…05,
// CVR-01, WF-22). Budget → committed → actual → paid per BOQ line, rolled up by
// section, and the estimate at completion that Finance builds progress revenue
// on (prj:BUD). Every figure comes from a record another screen owns:
//   budget     = quantity × the line's estimated unit cost (`estCost`; 0 = none)
//   committed  = project purchase orders from approval (open quantity × price)
//                + subcontract lines + everything already spent without an order
//   actual     = received on project orders (accepted × price) + stock issued to
//                the project from a company warehouse + approved subcontract
//                certificates + direct purchases
//   paid       = Finance's figure where the project can read it: subcontracts
//                and direct purchases. Finance pays suppliers on their balance,
//                not per order, so order payments are not shown here.
// Stock issued from the project's OWN store is not counted again: it was
// counted when it was received on the project's order. Material received and
// not yet built in is actual cost ahead of progress — it shows as variance
// until the work catches up. Pure: no I/O.

import type { PmEvent } from "./events"

const r2 = (n: number) => Math.round(n * 100) / 100

/** Over budget by more than this share is a bleeding item (CST-01). */
export const LEAK_TOLERANCE = 0.02

/** An approved estimate older than this is stale for Finance (CVR-01). */
export const EAC_STALE_DAYS = 35

export interface CostItem {
  id: string
  code: string
  description: string
  division: string
  quantity: number
  rate: number
  executed: number
  /** Estimated cost per unit, SAR excl. VAT — 0 when nobody estimated it. */
  estCost: number
}

export interface CostPoLine {
  id: string
  name: string
  unit: string
  quantity: number
  unitPrice: number | null
  accepted: number
  cancelled: number
  boqItemId?: string | null
}

export interface CostPo {
  id: string
  docNumber: string
  status: string
  supplierName: string
  rfqId?: string | null
  totalExVat: number
  lines: CostPoLine[]
}

/** A `wasteRecords` row on the project (an issue from a warehouse). */
export interface CostIssue {
  id: string
  type?: string | null
  reversesRecordId?: string | null
  boqItemId?: string | null
  warehouseId?: string | null
  quantityTaken: number
  unitCost?: number | null
}

export interface CostSubcontract {
  value: number
  paid?: number
  lines: Array<{ itemId: string; value: number; certified: number }>
}

/** Site petty-cash purchases, when that ledger exists. */
export interface CostDirect {
  itemId?: string | null
  amount: number
  paid: boolean
}

export interface CostVariation {
  status: string
  value: number
  cost: number
  executedPct: number
}

/** Orders that commit money: approved onwards. Awaiting approval commits nothing yet. */
const COMMITTING = new Set(["approved", "sent", "accepted", "closed", "cancelled"])

/** A line's unit price; a lump-sum order's unpriced lines share what the priced ones leave of its total, by quantity. */
export function poLinePrice(po: Pick<CostPo, "totalExVat" | "lines">, line: Pick<CostPoLine, "unitPrice" | "quantity">): number {
  if (line.unitPrice != null) return line.unitPrice
  const known = po.lines.reduce((a, l) => a + (l.unitPrice != null ? l.unitPrice * l.quantity : 0), 0)
  const openQty = po.lines.filter((l) => l.unitPrice == null).reduce((a, l) => a + l.quantity, 0)
  return openQty > 0 ? Math.max(0, po.totalExVat - known) / openQty : 0
}

/** What an order line commits: the ordered quantity less what was cancelled —
 * only what arrived once the order is closed or cancelled. */
export function poLineCommitted(po: Pick<CostPo, "status" | "totalExVat" | "lines">, line: CostPoLine): number {
  if (!COMMITTING.has(po.status)) return 0
  const qty = po.status === "closed" || po.status === "cancelled" ? line.accepted : Math.max(line.accepted, line.quantity - line.cancelled)
  return r2(qty * poLinePrice(po, line))
}

export const poLineActual = (po: Pick<CostPo, "totalExVat" | "lines">, line: CostPoLine) => r2(line.accepted * poLinePrice(po, line))

/** Issues that still stand: reversals and the rows they cancel drop out, and so
 * does stock moved out of the project's own store (counted at receipt). */
export function liveIssues(issues: CostIssue[], projectWarehouseId: string | null): CostIssue[] {
  const reversed = new Set(issues.filter((i) => i.type === "reversal" && i.reversesRecordId).map((i) => i.reversesRecordId as string))
  return issues.filter((i) => i.type !== "reversal" && !reversed.has(i.id) && !(projectWarehouseId && i.warehouseId === projectWarehouseId))
}

export interface CostFigures {
  budget: number | null
  budgetExecuted: number | null
  committed: number
  actual: number
  paid: number
}

export interface ItemCost extends CostFigures {
  itemId: string
  /** actual − budget of executed; null without an estimate. */
  deviation: number | null
  leak: boolean
  /** Actual cost per executed unit. */
  unitActual: number | null
  /** The line's cost at completion if its efficiency so far holds. */
  forecast: number
}

const blank = (): CostFigures => ({ budget: null, budgetExecuted: null, committed: 0, actual: 0, paid: 0 })

export interface CostInput {
  items: CostItem[]
  pos: CostPo[]
  issues: CostIssue[]
  projectWarehouseId: string | null
  subcontracts: CostSubcontract[]
  direct?: CostDirect[]
}

/** Every line's figures, plus what could not be tied to a line (`unassigned`). */
export function itemCosts(input: CostInput): { items: Map<string, ItemCost>; unassigned: CostFigures } {
  const raw = new Map<string, CostFigures>()
  const unassigned = blank()
  const known = new Set(input.items.map((i) => i.id))
  const slot = (id: string | null | undefined) => {
    if (!id || !known.has(id)) return unassigned
    let f = raw.get(id)
    if (!f) raw.set(id, (f = blank()))
    return f
  }
  for (const po of input.pos) {
    for (const l of po.lines) {
      const f = slot(l.boqItemId)
      f.committed += poLineCommitted(po, l)
      f.actual += poLineActual(po, l)
    }
  }
  for (const i of liveIssues(input.issues, input.projectWarehouseId)) {
    const v = (i.unitCost ?? 0) * i.quantityTaken
    const f = slot(i.boqItemId)
    f.committed += v
    f.actual += v
  }
  for (const c of input.subcontracts) {
    const certified = c.lines.reduce((a, l) => a + l.certified * l.value, 0)
    for (const l of c.lines) {
      const f = slot(l.itemId)
      f.committed += l.value
      f.actual += l.certified * l.value
      f.paid += certified > 0 ? ((c.paid ?? 0) * (l.certified * l.value)) / certified : 0
    }
  }
  for (const d of input.direct ?? []) {
    const f = slot(d.itemId)
    f.committed += d.amount
    f.actual += d.amount
    if (d.paid) f.paid += d.amount
  }

  const items = new Map<string, ItemCost>()
  for (const it of input.items) {
    const f = raw.get(it.id) ?? blank()
    const estimated = it.estCost > 0
    const budget = estimated ? r2(it.quantity * it.estCost) : null
    const budgetExecuted = estimated ? r2(it.executed * it.estCost) : null
    const actual = r2(f.actual)
    const deviation = budgetExecuted === null ? null : r2(actual - budgetExecuted)
    const leak = estimated && it.executed > 0 && it.rate > 0 && budgetExecuted! > 0 && actual > budgetExecuted! * (1 + LEAK_TOLERANCE)
    let forecast: number
    if (budget === null) forecast = actual
    else if (budgetExecuted! > 0 && actual > 0) forecast = r2(budget * (actual / budgetExecuted!))
    else forecast = Math.max(budget, actual)
    items.set(it.id, {
      itemId: it.id,
      budget,
      budgetExecuted,
      committed: r2(Math.max(f.committed, f.actual)),
      actual,
      paid: r2(f.paid),
      deviation,
      leak,
      unitActual: it.executed > 0 ? r2(actual / it.executed) : null,
      forecast,
    })
  }
  return {
    items,
    unassigned: { budget: null, budgetExecuted: null, committed: r2(Math.max(unassigned.committed, unassigned.actual)), actual: r2(unassigned.actual), paid: r2(unassigned.paid) },
  }
}

/** The bleeding items, worst riyal impact first (CST-01). */
export const bleeding = (items: CostItem[], costs: Map<string, ItemCost>, limit = 5) =>
  items
    .map((i) => ({ item: i, cost: costs.get(i.id) }))
    .filter((x): x is { item: CostItem; cost: ItemCost } => Boolean(x.cost?.leak))
    .sort((a, b) => (b.cost.deviation ?? 0) - (a.cost.deviation ?? 0))
    .slice(0, limit)

/** A line's section: its BOQ division, else the first group of its code. */
export const sectionOf = (i: Pick<CostItem, "division" | "code">) => i.division?.trim() || (i.code ?? "").split(/[-.\s]/)[0] || "—"

export interface SectionRow {
  section: string
  n: number
  contract: number
  earned: number
  /** Share of the section's contract value executed (0…1). */
  progress: number
  budget: number
  budgetExecuted: number
  committed: number
  actual: number
  paid: number
  forecast: number
  /** Lines without an estimated cost. */
  unestimated: number
}

export function sectionRows(items: CostItem[], costs: Map<string, ItemCost>): SectionRow[] {
  const by = new Map<string, SectionRow>()
  for (const i of items) {
    const key = sectionOf(i)
    const s = by.get(key) ?? { section: key, n: 0, contract: 0, earned: 0, progress: 0, budget: 0, budgetExecuted: 0, committed: 0, actual: 0, paid: 0, forecast: 0, unestimated: 0 }
    const c = costs.get(i.id)
    s.n++
    s.contract += i.quantity * i.rate
    s.earned += i.executed * i.rate
    s.budget += c?.budget ?? 0
    s.budgetExecuted += c?.budgetExecuted ?? 0
    s.committed += c?.committed ?? 0
    s.actual += c?.actual ?? 0
    s.paid += c?.paid ?? 0
    s.forecast += c?.forecast ?? 0
    if (!(i.estCost > 0)) s.unestimated++
    by.set(key, s)
  }
  const firstCode = new Map<string, string>()
  for (const i of items) {
    const k = sectionOf(i)
    const cur = firstCode.get(k)
    if (cur === undefined || i.code.localeCompare(cur) < 0) firstCode.set(k, i.code)
  }
  return [...by.values()]
    .map((s) => ({
      ...s,
      contract: r2(s.contract),
      earned: r2(s.earned),
      progress: s.contract > 0 ? s.earned / s.contract : 0,
      budget: r2(s.budget),
      budgetExecuted: r2(s.budgetExecuted),
      committed: r2(s.committed),
      actual: r2(s.actual),
      paid: r2(s.paid),
      forecast: r2(s.forecast),
    }))
    .sort((a, b) => (firstCode.get(a.section) ?? "").localeCompare(firstCode.get(b.section) ?? "", undefined, { numeric: true }))
}

export interface ProjectCost {
  contract: number
  earned: number
  budget: number
  budgetExecuted: number
  committed: number
  actual: number
  paid: number
  /** Σ (actual − budget of executed) over estimated lines — lines only. */
  variance: number
  plannedMargin: number
  marginToDate: number
  forecastCost: number
  forecastMargin: number
  penalty: number
  /** Budget of executed ÷ actual on estimated lines: below 1, every budget riyal costs more. */
  cpi: number
  unestimated: number
}

/** The project roll-up (CST-03, CVR-01). Approved variations add their value to
 * the contract and their priced cost to the budget and the forecast; the
 * projected delay penalty comes off the forecast margin. */
export function projectCost(input: {
  items: CostItem[]
  costs: Map<string, ItemCost>
  unassigned: CostFigures
  variations: CostVariation[]
  baseValue: number
  penalty: number
}): ProjectCost {
  const appr = input.variations.filter((v) => v.status === "appr")
  const voValue = appr.reduce((a, v) => a + v.value, 0)
  const voCost = appr.reduce((a, v) => a + v.cost, 0)
  const voEarned = appr.reduce((a, v) => a + v.value * v.executedPct, 0)
  const itemsValue = input.items.reduce((a, i) => a + i.quantity * i.rate, 0)
  const contract = r2((itemsValue > 0 ? itemsValue : input.baseValue) + voValue)
  const earned = r2(input.items.reduce((a, i) => a + i.executed * i.rate, 0) + voEarned)
  const cs = input.items.map((i) => input.costs.get(i.id)).filter((c): c is ItemCost => Boolean(c))
  const sum = (f: (c: ItemCost) => number) => cs.reduce((a, c) => a + f(c), 0)
  const budgetLines = sum((c) => c.budget ?? 0)
  const budgetExecuted = r2(sum((c) => c.budgetExecuted ?? 0))
  const budget = r2(budgetLines + voCost)
  const actual = r2(sum((c) => c.actual) + input.unassigned.actual)
  const estimatedActual = sum((c) => (c.budgetExecuted !== null ? c.actual : 0))
  const forecastCost = r2(sum((c) => c.forecast) + voCost + input.unassigned.actual)
  const penalty = r2(Math.max(0, input.penalty))
  return {
    contract,
    earned,
    budget,
    budgetExecuted,
    committed: r2(sum((c) => c.committed) + input.unassigned.committed),
    actual,
    paid: r2(sum((c) => c.paid) + input.unassigned.paid),
    variance: r2(sum((c) => c.deviation ?? 0)),
    plannedMargin: r2(contract - budget),
    marginToDate: r2(earned - actual),
    forecastCost,
    forecastMargin: r2(contract - forecastCost - penalty),
    penalty,
    cpi: estimatedActual > 0 ? sum((c) => (c.budgetExecuted !== null && c.actual > 0 ? c.budgetExecuted : 0)) / estimatedActual : 1,
    unestimated: input.items.filter((i) => !(i.estCost > 0)).length,
  }
}

// ---------------------------------------------------------------------------
// The approved estimate (CVR-01 → prj:BUD). The key carries the revision so
// the outbox stays append-only; Finance reads the highest revision of a
// project as the one in force — each approval replaces the previous.
// ---------------------------------------------------------------------------

export interface ApprovedEstimate {
  /** Estimate at completion, SAR. */
  v: number
  on: string
  by: string
  byName?: string | null
  rev: number
}

export function estimateAge(e: Pick<ApprovedEstimate, "on"> | null | undefined, today: string): number | null {
  if (!e?.on) return null
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${e.on.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
}

export type EstimateBlock = "archived" | "not_started" | "no_estimate"

export function estimateBlocks(input: { archived: boolean; lifecycle: string; estimate: number }): EstimateBlock[] {
  const out: EstimateBlock[] = []
  if (input.archived) out.push("archived")
  else if (input.lifecycle === "plan") out.push("not_started")
  if (!(input.estimate > 0)) out.push("no_estimate")
  return out
}

/** prj:BUD:<project>:<rev> — the approved estimate at completion Finance divides actual cost by. */
export function budgetEvent(input: {
  organizationId: string
  projectId: string
  projectNo: string
  rev: number
  cost: Pick<ProjectCost, "forecastCost" | "contract" | "actual" | "forecastMargin">
  by: string
  at: string
}): PmEvent {
  return {
    key: `prj:BUD:${input.projectNo}:${input.rev}`,
    kind: "BUD",
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectNo: input.projectNo,
    amount: r2(input.cost.forecastCost),
    params: { rev: input.rev, estimate: r2(input.cost.forecastCost), contract: r2(input.cost.contract), actual: r2(input.cost.actual), margin: r2(input.cost.forecastMargin) },
    by: input.by,
    at: input.at,
  }
}

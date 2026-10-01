// PM 1.0 — indirect costs (the prototype's DIRECT register, «التكاليف غير
// المباشرة»): what the project spends that no BOQ line carries — its site staff,
// support plant, site overheads, insurance and fees. The project manager sets a
// budget per kind for the whole project; the spend is read, never typed:
// payroll and vouchers the books tag to the project, and for plant the cost of
// the days logged on site. They enter the project's budget, what it has spent
// and its forecast at completion — never an item's variance. Pure: no I/O.

export const INDIRECT_KINDS = ["stf", "eq", "ovh", "ins"] as const
export type IndirectKind = (typeof INDIRECT_KINDS)[number]

export type IndirectBudgets = Partial<Record<IndirectKind, number>>

/** Project-cost accounts that items already carry (materials, subcontracts). */
const ITEM_ACCOUNTS = new Set(["510101", "510301"])
/** Source types whose cost the item roll-up already counts (site purchases, losses, transfers). */
const ITEM_SOURCES = new Set(["pm_cash", "pm_loss", "pm_xfer"])

export interface IndirectJournalEntry {
  status?: string | null
  sourceType?: string | null
  sourceId?: string | null
  lines?: Array<{ account: string; debit?: number; credit?: number; project?: string | null }>
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Which indirect kind a booked expense line belongs to, or null when items carry it. */
export function indirectKindOf(account: string): IndirectKind | null {
  if (!account.startsWith("5") || ITEM_ACCOUNTS.has(account)) return null
  if (account.startsWith("5102")) return "stf"
  if (account.startsWith("5104") || account.startsWith("5106")) return "eq"
  if (account.startsWith("5105")) return "ovh"
  if (account.startsWith("5107")) return null
  return "ins"
}

/** Spend per kind from the project's tagged journal lines, plus the plant days logged on site. */
export function indirectActuals(projectId: string, entries: IndirectJournalEntry[], plantLogged: number): { byKind: Record<IndirectKind, number>; plantLogged: number } {
  const byKind: Record<IndirectKind, number> = { stf: 0, eq: 0, ovh: 0, ins: 0 }
  for (const e of entries) {
    if (e.status === "reversed" || e.status === "draft" || (e.sourceType && ITEM_SOURCES.has(e.sourceType))) continue
    for (const l of e.lines ?? []) {
      if (l.project !== projectId) continue
      const kind = indirectKindOf(l.account)
      if (kind) byKind[kind] += (Number(l.debit) || 0) - (Number(l.credit) || 0)
    }
  }
  byKind.eq += plantLogged
  for (const k of INDIRECT_KINDS) byKind[k] = r2(byKind[k])
  return { byKind, plantLogged: r2(plantLogged) }
}

const PAYROLL_PAYABLE = "210202"

/** «مدفوع» per kind: each entry's project spend × the share of its credits that
 * money has left for — cash credited in the entry itself, and for a payroll the
 * salary transfers Finance recorded after it (less returned transfers). Plant
 * days logged on site are a cost, never a payment. */
export function indirectPaid(projectId: string, entries: IndirectJournalEntry[], payrollPayments: IndirectJournalEntry[] = []): Record<IndirectKind, number> {
  const paid: Record<IndirectKind, number> = { stf: 0, eq: 0, ovh: 0, ins: 0 }
  const settled = new Map<string, number>()
  for (const p of payrollPayments) {
    if (p.status === "reversed" || p.status === "draft" || !p.sourceId) continue
    const sign = p.sourceType === "hr_pay_payment" ? 1 : p.sourceType === "hr_pay_return" ? -1 : 0
    if (!sign) continue
    const key = p.sourceId.split(":")[0]
    const amount = (p.lines ?? []).filter((l) => l.account === PAYROLL_PAYABLE).reduce((a, l) => a + (Number(l.debit) || 0) + (Number(l.credit) || 0), 0)
    settled.set(key, (settled.get(key) ?? 0) + sign * amount)
  }
  for (const e of entries) {
    if (e.status === "reversed" || e.status === "draft" || (e.sourceType && ITEM_SOURCES.has(e.sourceType))) continue
    const lines = e.lines ?? []
    const credits = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0)
    if (!(credits > 0)) continue
    const cash = lines.filter((l) => l.account.startsWith("1101")).reduce((a, l) => a + (Number(l.credit) || 0), 0)
    const payroll = e.sourceType === "hr_pay" && e.sourceId ? Math.max(0, settled.get(e.sourceId.replace(/^hr:PAY:/, "")) ?? 0) : 0
    const share = Math.min(1, (cash + payroll) / credits)
    if (!(share > 0)) continue
    for (const l of lines) {
      if (l.project !== projectId) continue
      const kind = indirectKindOf(l.account)
      if (kind) paid[kind] += ((Number(l.debit) || 0) - (Number(l.credit) || 0)) * share
    }
  }
  for (const k of INDIRECT_KINDS) paid[k] = r2(paid[k])
  return paid
}

export interface IndirectRow {
  kind: IndirectKind
  budget: number
  actual: number
}

/** The kinds with a budget or a spend, and their totals. */
export function indirectRows(budgets: IndirectBudgets | null | undefined, actual: Record<IndirectKind, number>): { rows: IndirectRow[]; budget: number; actual: number } {
  const rows = INDIRECT_KINDS.map((kind) => ({ kind, budget: r2(Math.max(0, Number(budgets?.[kind]) || 0)), actual: actual[kind] ?? 0 })).filter((r) => r.budget > 0 || r.actual !== 0)
  return { rows, budget: r2(rows.reduce((a, r) => a + r.budget, 0)), actual: r2(rows.reduce((a, r) => a + r.actual, 0)) }
}

/** A budget the project manager may set: finite, not negative. */
export const indirectBudgetProblems = (b: IndirectBudgets): IndirectKind[] => INDIRECT_KINDS.filter((k) => b[k] !== undefined && !(Number.isFinite(b[k]) && (b[k] as number) >= 0))

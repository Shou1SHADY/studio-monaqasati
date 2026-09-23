// Cash projection (التدفق النقدي المتوقع) — where cash will stand over the next
// 13 weeks (or 6 months), from what the books already know is coming.
//
//   projected balance = today's cash
//                     + expected receipts   (مقبوضات متوقعة)
//                     − expected payments   (مدفوعات متوقعة)
//
// Every amount comes from an open balance in the ledger, placed on the date it
// is expected to turn into cash:
//
//   receipts   client receivables (110201)   each open invoice, booked + the client term
//              unbilled work (110301)        billed next month, then the client term
//   payments   suppliers (210101)            each open bill, booked + the supplier term
//              VAT due (210301 − 110502)     end of the following month
//              withholding tax (210302)      the 10th of the month after withholding
//              employee accruals (210202)    the 1st of next month
//              zakat payable (210303)        120 days after the year it was provided for
//
// Anything already past its date is due NOW and lands in the first bucket
// (and is counted separately as overdue). Balances released by an event rather
// than a date — retention on either side — stay locked beyond the horizon: the
// screen says so rather than inventing a date. Recurring costs that are not yet
// in the books (next month's payroll, rent) are not projected.

import { ACC } from "./accounts"
import { LEDGER_EPOCH, addDays, aggregate, nodeNatural } from "./balances"
import { openItemsByParty } from "./analytics"
import { fiscalYearOf, fiscalYearRange } from "./periods"
import { round2, type JournalEntry } from "./journal"
import { whtRegister } from "./withholding"

export type ProjectionHorizon = "weeks" | "months"

export type ProjectionItemKind = "receivable" | "unbilled" | "payable" | "vat" | "wht" | "payroll" | "zakat"

export interface ProjectionItem {
  kind: ProjectionItemKind
  direction: "in" | "out"
  /** The date the cash is expected to move. */
  date: string
  amount: number
  party?: string
  /** Past its date already — collected/paid "now", in the first bucket. */
  overdue: boolean
}

export interface ProjectionBucket {
  index: number
  from: string
  to: string
  receipts: number
  payments: number
  net: number
  /** Cash at the end of the bucket. */
  balance: number
  items: ProjectionItem[]
}

export interface CashProjection {
  asOf: string
  horizon: ProjectionHorizon
  /** Cash and equivalents (1101) at `asOf`. */
  opening: number
  buckets: ProjectionBucket[]
  /** Receivables, unbilled work and retention — cash earned but not yet in the bank. */
  locked: number
  overdue: { receipts: number; payments: number }
  /** Expected after the horizon, or released by an event with no date. */
  beyond: { receipts: number; payments: number; items: ProjectionItem[] }
  lowest: { balance: number; index: number }
  closing: number
  /** Actual cash at the end of each of the previous buckets, oldest first, then today. */
  history: Array<{ date: string; balance: number }>
}

function lastDayOfMonth(iso: string): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

function firstOfNextMonth(iso: string): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`
}

/** The bucket boundaries after `asOf`. Weeks run 7 days from tomorrow; months
 * are calendar months, the first one being the rest of the current month. */
export function projectionBuckets(asOf: string, horizon: ProjectionHorizon): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = []
  if (horizon === "weeks") {
    for (let i = 0; i < 13; i++) out.push({ from: addDays(asOf, 1 + 7 * i), to: addDays(asOf, 7 * (i + 1)) })
    return out
  }
  let from = addDays(asOf, 1)
  for (let i = 0; i < 6; i++) {
    const to = lastDayOfMonth(from)
    out.push({ from, to })
    from = addDays(to, 1)
  }
  return out
}

/** The same boundaries walked backwards — where the actual-cash line is drawn. */
function historyDates(asOf: string, horizon: ProjectionHorizon, count: number): string[] {
  const out: string[] = []
  if (horizon === "weeks") {
    for (let i = count; i >= 1; i--) out.push(addDays(asOf, -7 * i))
  } else {
    let d = asOf
    const ends: string[] = []
    for (let i = 0; i < count; i++) {
      d = addDays(`${d.slice(0, 7)}-01`, -1)
      ends.push(d)
    }
    out.push(...ends.reverse())
  }
  return out
}

export function cashProjection(
  entries: JournalEntry[],
  opts: {
    asOf: string
    horizon: ProjectionHorizon
    customerTermDays: number
    supplierTermDays: number
    fiscalYearStartMonth: number
    /** How many past buckets of actual cash to show. */
    historyCount?: number
  }
): CashProjection {
  const { asOf, horizon } = opts
  const closing = aggregate(entries, LEDGER_EPOCH, asOf)
  const opening = round2(nodeNatural(closing, "1101"))
  const items: ProjectionItem[] = []
  const beyondItems: ProjectionItem[] = []
  const push = (item: Omit<ProjectionItem, "overdue">) => {
    if (Math.abs(item.amount) < 0.005) return
    items.push({ ...item, amount: round2(item.amount), overdue: item.date <= asOf })
  }

  // Receipts — each client's open invoices.
  for (const party of openItemsByParty(entries, { accounts: [ACC.clientsReceivable], side: "debit", asOf }).values()) {
    for (const it of party.open) push({ kind: "receivable", direction: "in", date: addDays(it.date, opts.customerTermDays), amount: it.amount, party: party.name })
  }
  const unbilled = nodeNatural(closing, ACC.contractAsset)
  if (unbilled > 0) push({ kind: "unbilled", direction: "in", date: addDays(asOf, 30 + opts.customerTermDays), amount: unbilled })

  // Payments — each supplier's open bills.
  for (const party of openItemsByParty(entries, { accounts: [ACC.suppliersPayable], side: "credit", asOf }).values()) {
    for (const it of party.open) push({ kind: "payable", direction: "out", date: addDays(it.date, opts.supplierTermDays), amount: it.amount, party: party.name })
  }
  const vatDue = round2(nodeNatural(closing, ACC.vatOutput) - nodeNatural(closing, ACC.vatInput))
  if (vatDue > 0) push({ kind: "vat", direction: "out", date: lastDayOfMonth(firstOfNextMonth(asOf)), amount: vatDue })
  for (const m of whtRegister(entries, asOf).byMonth) {
    if (m.outstanding > 0) push({ kind: "wht", direction: "out", date: m.dueDate, amount: m.outstanding })
  }
  const accrued = nodeNatural(closing, ACC.employeeAccruals)
  if (accrued > 0) push({ kind: "payroll", direction: "out", date: firstOfNextMonth(asOf), amount: accrued })
  const zakat = nodeNatural(closing, ACC.zakatPayable)
  if (zakat > 0) {
    // Due 120 days after the year it was provided for — the latest provision's year.
    const provided = entries
      .filter((e) => e.status === "posted" && e.date <= asOf && e.lines.some((l) => l.account === ACC.zakatPayable && l.credit > 0))
      .reduce((max, e) => (e.date > max ? e.date : max), asOf)
    const yearEnd = fiscalYearRange(fiscalYearOf(provided, opts.fiscalYearStartMonth), opts.fiscalYearStartMonth).to
    push({ kind: "zakat", direction: "out", date: addDays(yearEnd, 120), amount: zakat })
  }

  const bounds = projectionBuckets(asOf, horizon)
  const last = bounds[bounds.length - 1].to
  let balance = opening
  const buckets: ProjectionBucket[] = bounds.map((b, index) => {
    const mine = items.filter((it) => (index === 0 ? it.date <= b.to : it.date >= b.from && it.date <= b.to))
    const receipts = round2(mine.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0))
    const payments = round2(mine.filter((i) => i.direction === "out").reduce((s, i) => s + i.amount, 0))
    balance = round2(balance + receipts - payments)
    return { index, from: b.from, to: b.to, receipts, payments, net: round2(receipts - payments), balance, items: mine }
  })
  beyondItems.push(...items.filter((it) => it.date > last))
  // Retention is released by handover, not by a date.
  const retentionIn = nodeNatural(closing, ACC.retentionReceivable)
  if (retentionIn > 0) beyondItems.push({ kind: "receivable", direction: "in", date: last, amount: round2(retentionIn), overdue: false, party: "retention" })
  const retentionOut = nodeNatural(closing, ACC.subcontractorRetentionPayable)
  if (retentionOut > 0) beyondItems.push({ kind: "payable", direction: "out", date: last, amount: round2(retentionOut), overdue: false, party: "retention" })

  const lowest = buckets.reduce((low, b) => (b.balance < low.balance ? { balance: b.balance, index: b.index } : low), { balance: buckets[0].balance, index: 0 })
  const history = historyDates(asOf, horizon, opts.historyCount ?? 8).map((date) => ({
    date,
    balance: round2(nodeNatural(aggregate(entries, LEDGER_EPOCH, date), "1101")),
  }))
  history.push({ date: asOf, balance: opening })

  return {
    asOf,
    horizon,
    opening,
    buckets,
    locked: round2(Math.max(0, nodeNatural(closing, ACC.clientsReceivable)) + Math.max(0, unbilled) + Math.max(0, retentionIn)),
    overdue: {
      receipts: round2(items.filter((i) => i.overdue && i.direction === "in").reduce((s, i) => s + i.amount, 0)),
      payments: round2(items.filter((i) => i.overdue && i.direction === "out").reduce((s, i) => s + i.amount, 0)),
    },
    beyond: {
      receipts: round2(beyondItems.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0)),
      payments: round2(beyondItems.filter((i) => i.direction === "out").reduce((s, i) => s + i.amount, 0)),
      items: beyondItems,
    },
    lowest,
    closing: buckets[buckets.length - 1].balance,
    history,
  }
}

// Management reads of the ledger — the figures a finance lead asks about that
// are not themselves statements: how many days cash sits locked, who owes what
// and for how long, how each month went, which projects earn their keep, and
// who wrote what into the books.
//
// Same discipline as balances.ts and statements.ts: pure functions over the
// journal entries already held in memory. No Firestore, no React.

import { ACC, CHART_OF_ACCOUNTS, naturalSign } from "./accounts"
import { aggregate, nodeNatural, LEDGER_EPOCH, type BalanceMap, type LedgerFilter, type PeriodWindows } from "./balances"
import { round2, type AccountingPeriod, type JournalEntry, type JournalLine } from "./journal"
import type { FiscalPeriod } from "./periods"

function lineMatches(line: JournalLine, filter: LedgerFilter): boolean {
  if (filter.branch && line.branch !== filter.branch) return false
  if (filter.project && line.project !== filter.project) return false
  if (filter.costCenter && line.costCenter !== filter.costCenter) return false
  return true
}

const posted = (entries: JournalEntry[]) => entries.filter((e) => e.status === "posted")

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86_400_000)
}

// ---------------------------------------------------------------------------
// Cash conversion cycle (دورة تحويل النقد)
// ---------------------------------------------------------------------------

export interface CashConversionCycle {
  /** Days of revenue sitting in receivables and unbilled work. */
  dso: number | null
  /** Days of cost of revenue sitting in inventory (materials, WIP, finished goods). */
  dio: number | null
  /** Days of cost of revenue the company takes to pay its suppliers. */
  dpo: number | null
  /** dso + dio − dpo: how long a riyal spent waits before it comes back as cash. */
  ccc: number | null
  receivables: number
  inventory: number
  payables: number
  revenue: number
  costOfRevenue: number
  days: number
}

/** The accounts each metric reads. Receivables include unbilled work: in
 * contracting, work done but not yet certified is locked exactly like an
 * unpaid invoice. Retention is left out — it is released by handover, not by
 * a collection cycle, and would distort the days figure for every project. */
export const CCC_ACCOUNTS = {
  receivables: [ACC.clientsReceivable, ACC.contractAsset],
  inventory: ["1104"],
  payables: [ACC.suppliersPayable],
} as const

function averageBalance(windows: PeriodWindows, codes: readonly string[]): number {
  let sum = 0
  for (const code of codes) sum += (nodeNatural(windows.opening, code) + nodeNatural(windows.closing, code)) / 2
  return round2(sum)
}

const ratioDays = (balance: number, flow: number, days: number): number | null =>
  flow > 0.005 ? Math.round((balance / flow) * days * 10) / 10 : null

/**
 * DSO, DIO and DPO on AVERAGE balances over the period (opening and closing),
 * the textbook form — a year-end snapshot alone swings with whatever happened
 * to be invoiced in the last week. `days` is the period length actually
 * elapsed (see elapsedDays), so a year in progress is not diluted by months
 * that have not happened. A metric whose flow is zero is null, not infinity.
 */
export function cashConversionCycle(windows: PeriodWindows, days: number): CashConversionCycle {
  const revenue = round2(Math.abs(nodeNatural(windows.movement, "4")))
  const costOfRevenue = round2(Math.abs(nodeNatural(windows.movement, "51")))
  const receivables = averageBalance(windows, CCC_ACCOUNTS.receivables)
  const inventory = averageBalance(windows, CCC_ACCOUNTS.inventory)
  const payables = averageBalance(windows, CCC_ACCOUNTS.payables)
  const dso = ratioDays(receivables, revenue, days)
  const dio = ratioDays(inventory, costOfRevenue, days)
  const dpo = ratioDays(payables, costOfRevenue, days)
  const ccc = dso === null && dio === null ? null : Math.round(((dso ?? 0) + (dio ?? 0) - (dpo ?? 0)) * 10) / 10
  return { dso, dio, dpo, ccc, receivables, inventory, payables, revenue, costOfRevenue, days }
}

// ---------------------------------------------------------------------------
// Liquidity
// ---------------------------------------------------------------------------

export interface Liquidity {
  currentAssets: number
  currentLiabilities: number
  workingCapital: number
  currentRatio: number | null
  quickRatio: number | null
  cash: number
}

export function liquidity(closing: BalanceMap): Liquidity {
  const currentAssets = nodeNatural(closing, "11")
  const currentLiabilities = nodeNatural(closing, "21")
  const inventory = nodeNatural(closing, "1104")
  return {
    currentAssets,
    currentLiabilities,
    workingCapital: round2(currentAssets - currentLiabilities),
    currentRatio: currentLiabilities > 0.005 ? Math.round((currentAssets / currentLiabilities) * 100) / 100 : null,
    quickRatio: currentLiabilities > 0.005 ? Math.round(((currentAssets - inventory) / currentLiabilities) * 100) / 100 : null,
    cash: nodeNatural(closing, "1101"),
  }
}

// ---------------------------------------------------------------------------
// Monthly trend
// ---------------------------------------------------------------------------

export interface MonthPoint {
  key: string
  labelAr: string
  labelEn: string
  revenue: number
  expenses: number
  profit: number
  /** Cash and equivalents at the month's end. */
  cash: number
}

/** Revenue, expenses, profit and month-end cash for each month given, in one
 * pass over the entries. Months must be contiguous and ordered. */
export function monthlyTrend(entries: JournalEntry[], months: FiscalPeriod[], filter: LedgerFilter = {}): MonthPoint[] {
  if (months.length === 0) return []
  const index = new Map(months.map((m, i) => [m.from.slice(0, 7), i]))
  const rev = months.map(() => 0)
  const exp = months.map(() => 0)
  const cashMove = months.map(() => 0)
  let cashBefore = 0
  const first = months[0].from
  for (const entry of posted(entries)) {
    const i = index.get(entry.date.slice(0, 7))
    const before = entry.date < first
    if (i === undefined && !before) continue
    for (const line of entry.lines) {
      if (!lineMatches(line, filter)) continue
      const signed = line.debit - line.credit
      if (before) {
        if (line.account.startsWith("1101")) cashBefore += signed
        continue
      }
      if (line.account.startsWith("4")) rev[i!] += -signed
      else if (line.account.startsWith("5")) exp[i!] += signed
      if (line.account.startsWith("1101")) cashMove[i!] += signed
    }
  }
  let cash = cashBefore
  return months.map((m, i) => {
    cash += cashMove[i]
    return {
      key: m.key,
      labelAr: m.labelAr,
      labelEn: m.labelEn,
      revenue: round2(rev[i]),
      expenses: round2(exp[i]),
      profit: round2(rev[i] - exp[i]),
      cash: round2(cash),
    }
  })
}

// ---------------------------------------------------------------------------
// Expense mix
// ---------------------------------------------------------------------------

export interface ExpenseSlice {
  code: string
  nameAr: string
  nameEn: string
  value: number
}

/** Expense sub-groups (level 3: materials, labour, G&A…) by period movement,
 * largest first — the "where did the money go" read. */
export function expenseBreakdown(movement: BalanceMap): ExpenseSlice[] {
  return CHART_OF_ACCOUNTS.filter((a) => a.type === "5" && a.level === 3)
    .map((a) => ({ code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, value: nodeNatural(movement, a.code) }))
    .filter((s) => s.value > 0.005)
    .sort((a, b) => b.value - a.value)
}

// ---------------------------------------------------------------------------
// Counterparties — sub-ledgers, statements and aging
// ---------------------------------------------------------------------------

export const NO_PARTY = "__none__"

export function partyKeyOf(line: Pick<JournalLine, "party" | "partyName">): string {
  return line.party || (line.partyName ? `name:${line.partyName.trim()}` : NO_PARTY)
}

export interface LedgerParty {
  key: string
  name: string
  debit: number
  credit: number
  /** debit − credit: positive means the party owes the company. */
  balance: number
  accounts: string[]
}

/** Every counterparty named on a posted line up to `asOf`, with its net
 * position across the accounts given (all accounts when omitted). */
export function ledgerParties(
  entries: JournalEntry[],
  opts: { asOf?: string; accounts?: string[]; filter?: LedgerFilter } = {}
): LedgerParty[] {
  const map = new Map<string, LedgerParty>()
  for (const entry of posted(entries)) {
    if (opts.asOf && entry.date > opts.asOf) continue
    for (const line of entry.lines) {
      if (opts.filter && !lineMatches(line, opts.filter)) continue
      if (opts.accounts && !opts.accounts.some((a) => line.account.startsWith(a))) continue
      const key = partyKeyOf(line)
      if (key === NO_PARTY) continue
      const p = map.get(key) || { key, name: line.partyName || line.party || "", debit: 0, credit: 0, balance: 0, accounts: [] }
      if (!p.name && line.partyName) p.name = line.partyName
      p.debit += line.debit
      p.credit += line.credit
      if (!p.accounts.includes(line.account)) p.accounts.push(line.account)
      map.set(key, p)
    }
  }
  return Array.from(map.values())
    .map((p) => ({ ...p, debit: round2(p.debit), credit: round2(p.credit), balance: round2(p.debit - p.credit) }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
}

export interface StatementLine {
  entryId: string
  entryNumber: number
  date: string
  description: string
  reference: string | null
  sourceType: string
  account: string
  partyName: string | null
  note: string | null
  debit: number
  credit: number
  /** Running debit − credit after this line, opening included. */
  balance: number
}

export interface AccountStatement {
  opening: number
  rows: StatementLine[]
  totalDebit: number
  totalCredit: number
  closing: number
  /** D when the accounts read are debit-natured (assets, expenses) — the side a
   * positive balance should be printed on. */
  nature: "D" | "C"
}

/**
 * كشف حساب: every posted movement on a set of accounts — optionally narrowed to
 * one counterparty — across a period, with a running balance that starts from
 * everything before it. Balances are debit − credit; `nature` tells the page
 * how to print them.
 */
export function accountStatement(
  entries: JournalEntry[],
  opts: { codes: string[]; party?: string | null; from: string; to: string; filter?: LedgerFilter }
): AccountStatement {
  const matchesAccount = (code: string) => opts.codes.length === 0 || opts.codes.some((c) => code.startsWith(c))
  const matches = (line: JournalLine) =>
    matchesAccount(line.account) &&
    (!opts.party || partyKeyOf(line) === opts.party) &&
    (!opts.filter || lineMatches(line, opts.filter))

  let opening = 0
  let totalDebit = 0
  let totalCredit = 0
  const inPeriod: Array<{ entry: JournalEntry; line: JournalLine }> = []
  const sorted = posted(entries)
    .filter((e) => e.date <= opts.to)
    .sort((a, b) => (a.date === b.date ? a.entryNumber - b.entryNumber : a.date < b.date ? -1 : 1))
  for (const entry of sorted) {
    for (const line of entry.lines) {
      if (!matches(line)) continue
      if (entry.date < opts.from) opening += line.debit - line.credit
      else inPeriod.push({ entry, line })
    }
  }
  let running = round2(opening)
  const rows: StatementLine[] = inPeriod.map(({ entry, line }) => {
    running = round2(running + line.debit - line.credit)
    totalDebit += line.debit
    totalCredit += line.credit
    return {
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      date: entry.date,
      description: entry.description,
      reference: entry.reference ?? null,
      sourceType: entry.sourceType,
      account: line.account,
      partyName: line.partyName ?? null,
      note: line.note ?? null,
      debit: line.debit,
      credit: line.credit,
      balance: running,
    }
  })
  const creditNatured = opts.codes.length > 0 && opts.codes.every((c) => c[0] === "2" || c[0] === "3" || c[0] === "4")
  return {
    opening: round2(opening),
    rows,
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    closing: running,
    nature: creditNatured ? "C" : "D",
  }
}

export const AGING_BUCKETS = [30, 60, 90] as const

export interface AgingRow {
  key: string
  name: string
  /** 0–30, 31–60, 61–90, over 90 days. */
  buckets: [number, number, number, number]
  total: number
  oldestDate: string | null
}

export interface AgingReport {
  buckets: [number, number, number, number]
  total: number
  rows: AgingRow[]
}

export interface OpenItem {
  date: string
  /** Positive: still owed. Negative: an overpayment carried forward. */
  amount: number
}

/**
 * Each counterparty's open items on a set of accounts, first-in-first-out:
 * each charge opens an item dated when it was booked, each settlement closes
 * the oldest open items first. `side` is the side that opens an item — debit
 * for receivables, credit for payables. Aging and the cash projection both
 * read this.
 */
export function openItemsByParty(
  entries: JournalEntry[],
  opts: { accounts: string[]; side: "debit" | "credit"; asOf: string; filter?: LedgerFilter }
): Map<string, { name: string; open: OpenItem[] }> {
  const byParty = new Map<string, { name: string; open: OpenItem[] }>()
  const sorted = posted(entries)
    .filter((e) => e.date <= opts.asOf)
    .sort((a, b) => (a.date === b.date ? a.entryNumber - b.entryNumber : a.date < b.date ? -1 : 1))
  for (const entry of sorted) {
    for (const line of entry.lines) {
      if (!opts.accounts.some((a) => line.account.startsWith(a))) continue
      if (opts.filter && !lineMatches(line, opts.filter)) continue
      const key = partyKeyOf(line)
      const party = byParty.get(key) || { name: line.partyName || line.party || "", open: [] }
      if (!party.name && line.partyName) party.name = line.partyName
      const charge = opts.side === "debit" ? line.debit - line.credit : line.credit - line.debit
      if (charge > 0) party.open.push({ date: entry.date, amount: charge })
      else if (charge < 0) {
        let settle = -charge
        while (settle > 0.005 && party.open.length > 0) {
          const item = party.open[0]
          const used = Math.min(item.amount, settle)
          item.amount -= used
          settle -= used
          if (item.amount <= 0.005) party.open.shift()
        }
        // An overpayment has nothing left to settle: carry it as a negative
        // item in the current bucket so the party's total stays true.
        if (settle > 0.005) party.open.push({ date: entry.date, amount: -settle })
      }
      byParty.set(key, party)
    }
  }
  return byParty
}

/**
 * Aging by counterparty over `openItemsByParty`: what is left open is aged from
 * its own date to `asOf`.
 */
export function agingReport(
  entries: JournalEntry[],
  opts: { accounts: string[]; side: "debit" | "credit"; asOf: string; filter?: LedgerFilter }
): AgingReport {
  const byParty = openItemsByParty(entries, opts)
  const totals: [number, number, number, number] = [0, 0, 0, 0]
  const rows: AgingRow[] = []
  for (const [key, party] of byParty) {
    const buckets: [number, number, number, number] = [0, 0, 0, 0]
    let oldest: string | null = null
    for (const item of party.open) {
      if (Math.abs(item.amount) <= 0.005) continue
      const age = daysBetween(item.date, opts.asOf)
      const b = age <= AGING_BUCKETS[0] ? 0 : age <= AGING_BUCKETS[1] ? 1 : age <= AGING_BUCKETS[2] ? 2 : 3
      buckets[b] += item.amount
      if (item.amount > 0 && (!oldest || item.date < oldest)) oldest = item.date
    }
    const total = round2(buckets.reduce((s, v) => s + v, 0))
    if (Math.abs(total) <= 0.005) continue
    const rounded = buckets.map(round2) as [number, number, number, number]
    rounded.forEach((v, i) => (totals[i] += v))
    rows.push({ key, name: party.name, buckets: rounded, total, oldestDate: oldest })
  }
  rows.sort((a, b) => b.total - a.total)
  const roundedTotals = totals.map(round2) as [number, number, number, number]
  return { buckets: roundedTotals, total: round2(roundedTotals.reduce((s, v) => s + v, 0)), rows }
}

// ---------------------------------------------------------------------------
// Project profitability
// ---------------------------------------------------------------------------

export interface ProjectResult {
  project: string
  projectName: string
  revenue: number
  cost: number
  profit: number
  /** Percent of revenue; null without revenue. */
  margin: number | null
}

export function projectProfitability(entries: JournalEntry[], from: string, to: string): ProjectResult[] {
  const map = new Map<string, ProjectResult>()
  for (const entry of posted(entries)) {
    if (entry.date < from || entry.date > to) continue
    for (const line of entry.lines) {
      if (!line.project) continue
      const type = line.account[0]
      if (type !== "4" && type !== "5") continue
      const r = map.get(line.project) || { project: line.project, projectName: line.projectName || "", revenue: 0, cost: 0, profit: 0, margin: null }
      if (!r.projectName && line.projectName) r.projectName = line.projectName
      if (type === "4") r.revenue += line.credit - line.debit
      else r.cost += line.debit - line.credit
      map.set(line.project, r)
    }
  }
  return Array.from(map.values())
    .map((r) => {
      const revenue = round2(r.revenue)
      const cost = round2(r.cost)
      const profit = round2(revenue - cost)
      return { ...r, revenue, cost, profit, margin: revenue > 0.005 ? Math.round((profit / revenue) * 1000) / 10 : null }
    })
    .sort((a, b) => b.revenue - a.revenue || b.cost - a.cost)
}

// ---------------------------------------------------------------------------
// Audit trail (سجل التدقيق)
// ---------------------------------------------------------------------------

export type AuditEventType = "entry_posted" | "entry_draft" | "entry_reversal" | "period_closed" | "settings_updated"

/** Things an auditor looks twice at — raised by the data, not by opinion. */
export type AuditFlag = "manual" | "backdated" | "after_close" | "reversed" | "control_account"

export interface AuditEvent {
  id: string
  type: AuditEventType
  /** When it was captured (ISO timestamp), or null when the record predates capture stamps. */
  at: string | null
  userId: string | null
  userName: string | null
  entryId?: string
  entryNumber?: number
  /** The accounting date the entry belongs to. */
  date?: string
  description: string
  amount?: number
  kind?: string
  sourceType?: string
  period?: string
  flags: AuditFlag[]
}

/** Firestore timestamps arrive as Timestamp objects, plain `{seconds}` or ISO strings. */
export function toIsoTimestamp(value: unknown): string | null {
  if (!value) return null
  if (typeof value === "string") return value
  if (typeof value === "object") {
    const v = value as { toDate?: () => Date; seconds?: number }
    if (typeof v.toDate === "function") return v.toDate().toISOString()
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000).toISOString()
  }
  return null
}

/** Cash, receivables, payables and inventory — balances a hand-written voucher
 * should rarely touch, because a business document normally moves them. */
const CONTROL_PREFIXES = ["1101", ACC.clientsReceivable, ACC.suppliersPayable, "1104"]

/** How far behind the capture date an accounting date may sit before it reads
 * as backdated — one month covers ordinary month-end cut-off. */
const BACKDATE_DAYS = 31

export function auditTrail(
  entries: JournalEntry[],
  periods: AccountingPeriod[] = [],
  settings?: { updatedAt?: unknown; updatedByUserId?: string | null; updatedByUserName?: string | null } | null
): AuditEvent[] {
  const closedAt = new Map(
    periods.filter((p) => p.status === "closed" && p.closedAt).map((p) => [p.period, p.closedAt as string])
  )
  const events: AuditEvent[] = []
  for (const entry of entries) {
    const at = toIsoTimestamp(entry.createdAt)
    const flags: AuditFlag[] = []
    if (entry.kind === "manual") flags.push("manual")
    if (entry.reversedByEntryId) flags.push("reversed")
    if (at && daysBetween(entry.date, at.slice(0, 10)) > BACKDATE_DAYS) flags.push("backdated")
    const lock = closedAt.get(entry.period)
    if (at && lock && at > lock) flags.push("after_close")
    if (entry.kind === "manual" && entry.lines.some((l) => CONTROL_PREFIXES.some((p) => l.account.startsWith(p)))) {
      flags.push("control_account")
    }
    events.push({
      id: `entry:${entry.id}`,
      type: entry.reversesEntryId ? "entry_reversal" : entry.status === "draft" ? "entry_draft" : "entry_posted",
      at,
      userId: entry.createdByUserId || null,
      userName: entry.createdByUserName || null,
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      date: entry.date,
      description: entry.description,
      amount: entry.totalDebit,
      kind: entry.kind,
      sourceType: entry.sourceType,
      period: entry.period,
      flags,
    })
  }
  for (const p of periods) {
    if (p.status !== "closed") continue
    events.push({
      id: `period:${p.id}`,
      type: "period_closed",
      at: p.closedAt ?? null,
      userId: p.closedByUserId ?? null,
      userName: p.closedByUserName ?? null,
      period: p.period,
      description: p.period,
      flags: [],
    })
  }
  const settingsAt = toIsoTimestamp(settings?.updatedAt)
  if (settings && settingsAt) {
    events.push({
      id: "settings",
      type: "settings_updated",
      at: settingsAt,
      userId: settings.updatedByUserId ?? null,
      userName: settings.updatedByUserName ?? null,
      description: "",
      flags: [],
    })
  }
  return events.sort((a, b) => {
    if (a.at && b.at) return a.at < b.at ? 1 : a.at > b.at ? -1 : 0
    if (a.at) return -1
    if (b.at) return 1
    return (b.entryNumber ?? 0) - (a.entryNumber ?? 0)
  })
}

// ---------------------------------------------------------------------------
// Open balances for settlements
// ---------------------------------------------------------------------------

export interface OpenBalance {
  key: string
  name: string
  /** Natural-signed balance per account code. */
  byAccount: Record<string, number>
}

/** Per counterparty, the natural balance on each of the given accounts at
 * `asOf` — what a settlement can clear. */
export function openBalancesByParty(entries: JournalEntry[], accounts: string[], asOf: string): OpenBalance[] {
  const map = new Map<string, OpenBalance>()
  for (const entry of posted(entries)) {
    if (entry.date > asOf) continue
    for (const line of entry.lines) {
      if (!accounts.includes(line.account)) continue
      const key = partyKeyOf(line)
      if (key === NO_PARTY) continue
      const ob = map.get(key) || { key, name: line.partyName || line.party || "", byAccount: {} }
      if (!ob.name && line.partyName) ob.name = line.partyName
      ob.byAccount[line.account] = (ob.byAccount[line.account] || 0) + naturalSign(line.account, line.debit - line.credit)
      map.set(key, ob)
    }
  }
  return Array.from(map.values())
    .map((ob) => ({ ...ob, byAccount: Object.fromEntries(Object.entries(ob.byAccount).map(([k, v]) => [k, round2(v)])) }))
    .filter((ob) => Object.values(ob.byAccount).some((v) => Math.abs(v) > 0.005))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Balances as at a date, independent of the period windows on screen. */
export function balancesAsOf(entries: JournalEntry[], asOf: string, filter: LedgerFilter = {}): BalanceMap {
  return aggregate(entries, LEDGER_EPOCH, asOf, filter)
}


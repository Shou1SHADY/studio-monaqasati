// Balance aggregation — turns journal entries into the numbers every report
// reads. Pure functions over an entry array: no Firestore, no React, so the
// statements are unit-testable against hand-computed figures.
//
// Three windows answer nearly every accounting question, and each statement
// picks the ones it needs:
//   opening  — everything before the period (balance-sheet carry-forward)
//   movement — inside the period (income statement, cash-flow movements)
//   closing  — everything up to the period end (balance sheet, trial balance)

import { naturalSign, ACCOUNT_BY_CODE, type CashFlowClass } from "./accounts"
import { round2, type JournalEntry } from "./journal"

export interface AccountMovement {
  debit: number
  credit: number
  /** debit − credit. Signed, not natural: negate credit-natured codes to display. */
  balance: number
}

/** Account code → movement. */
export type BalanceMap = Record<string, AccountMovement>

export interface LedgerFilter {
  branch?: string | null
  project?: string | null
  costCenter?: string | null
}

function lineMatches(
  line: { branch?: string | null; project?: string | null; costCenter?: string | null },
  filter: LedgerFilter
): boolean {
  if (filter.branch && line.branch !== filter.branch) return false
  if (filter.project && line.project !== filter.project) return false
  if (filter.costCenter && line.costCenter !== filter.costCenter) return false
  return true
}

/**
 * Sum posted lines whose date falls in [from, to].
 *
 * Drafts are excluded everywhere: a draft voucher is a proposal, and letting one
 * touch a statement would mean the books say something the accountant has not
 * yet agreed to.
 */
export function aggregate(
  entries: JournalEntry[],
  from: string,
  to: string,
  filter: LedgerFilter = {}
): BalanceMap {
  const map: BalanceMap = {}
  for (const entry of entries) {
    if (entry.status !== "posted") continue
    if (entry.date < from || entry.date > to) continue
    for (const line of entry.lines) {
      if (!lineMatches(line, filter)) continue
      const acc = map[line.account] || (map[line.account] = { debit: 0, credit: 0, balance: 0 })
      acc.debit += line.debit
      acc.credit += line.credit
    }
  }
  for (const code of Object.keys(map)) {
    map[code].debit = round2(map[code].debit)
    map[code].credit = round2(map[code].credit)
    map[code].balance = round2(map[code].debit - map[code].credit)
  }
  return map
}

/** The earliest date any ledger query needs to reach — before any real entry. */
export const LEDGER_EPOCH = "1900-01-01"

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export interface PeriodWindows {
  opening: BalanceMap
  movement: BalanceMap
  closing: BalanceMap
}

export function periodWindows(
  entries: JournalEntry[],
  from: string,
  to: string,
  filter: LedgerFilter = {}
): PeriodWindows {
  return {
    opening: aggregate(entries, LEDGER_EPOCH, addDays(from, -1), filter),
    movement: aggregate(entries, from, to, filter),
    closing: aggregate(entries, LEDGER_EPOCH, to, filter),
  }
}

/**
 * Rolled-up signed balance of a node — the account itself plus every descendant.
 *
 * Prefix matching is what makes the four-level code scheme load-bearing: "11"
 * sums every current-asset leaf without walking a tree at read time.
 */
export function nodeBalance(map: BalanceMap, code: string): number {
  let sum = 0
  for (const key of Object.keys(map)) if (key.startsWith(code)) sum += map[key].balance
  return round2(sum)
}

export function nodeDebit(map: BalanceMap, code: string): number {
  let sum = 0
  for (const key of Object.keys(map)) if (key.startsWith(code)) sum += map[key].debit
  return round2(sum)
}

export function nodeCredit(map: BalanceMap, code: string): number {
  let sum = 0
  for (const key of Object.keys(map)) if (key.startsWith(code)) sum += map[key].credit
  return round2(sum)
}

/** Rolled-up balance flipped into its natural sign, for display. */
export function nodeNatural(map: BalanceMap, code: string): number {
  return round2(naturalSign(code, nodeBalance(map, code)))
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

export interface TrialBalanceRow {
  code: string
  openingDebit: number
  openingCredit: number
  movementDebit: number
  movementCredit: number
  closingDebit: number
  closingCredit: number
}

export interface TrialBalance {
  rows: TrialBalanceRow[]
  totals: {
    openingDebit: number
    openingCredit: number
    movementDebit: number
    movementCredit: number
    closingDebit: number
    closingCredit: number
  }
  /** Closing debit − closing credit. Anything but 0 means the books are broken. */
  difference: number
}

/** A signed balance split into the debit/credit columns a trial balance shows. */
function split(balance: number): { debit: number; credit: number } {
  return balance >= 0 ? { debit: round2(balance), credit: 0 } : { debit: 0, credit: round2(-balance) }
}

export function trialBalance(windows: PeriodWindows): TrialBalance {
  const codes = new Set<string>([
    ...Object.keys(windows.opening),
    ...Object.keys(windows.movement),
    ...Object.keys(windows.closing),
  ])
  const rows: TrialBalanceRow[] = []
  for (const code of Array.from(codes).sort()) {
    const open = split(windows.opening[code]?.balance || 0)
    const close = split(windows.closing[code]?.balance || 0)
    rows.push({
      code,
      openingDebit: open.debit,
      openingCredit: open.credit,
      movementDebit: windows.movement[code]?.debit || 0,
      movementCredit: windows.movement[code]?.credit || 0,
      closingDebit: close.debit,
      closingCredit: close.credit,
    })
  }
  const totals = rows.reduce(
    (t, r) => ({
      openingDebit: t.openingDebit + r.openingDebit,
      openingCredit: t.openingCredit + r.openingCredit,
      movementDebit: t.movementDebit + r.movementDebit,
      movementCredit: t.movementCredit + r.movementCredit,
      closingDebit: t.closingDebit + r.closingDebit,
      closingCredit: t.closingCredit + r.closingCredit,
    }),
    { openingDebit: 0, openingCredit: 0, movementDebit: 0, movementCredit: 0, closingDebit: 0, closingCredit: 0 }
  )
  for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] = round2(totals[k])
  return { rows, totals, difference: round2(totals.closingDebit - totals.closingCredit) }
}

// ---------------------------------------------------------------------------
// General ledger / account statement
// ---------------------------------------------------------------------------

export interface LedgerRow {
  entryId: string
  entryNumber: number
  date: string
  description: string
  sourceType: string
  sourceId: string
  debit: number
  credit: number
  /** Running balance after this line, opening balance included. */
  balance: number
  project?: string | null
  costCenter?: string | null
  note?: string | null
}

/**
 * Every movement on one account across a period, with a running balance that
 * starts from the account's opening position — the shape an accountant expects
 * from a ledger page, and what a customer or supplier statement is built on.
 */
export function accountLedger(
  entries: JournalEntry[],
  account: string,
  from: string,
  to: string,
  filter: LedgerFilter = {}
): { openingBalance: number; rows: LedgerRow[]; closingBalance: number } {
  const opening = aggregate(entries, LEDGER_EPOCH, addDays(from, -1), filter)
  let running = opening[account]?.balance || 0
  const openingBalance = round2(running)

  const rows: LedgerRow[] = []
  const sorted = entries
    .filter((e) => e.status === "posted" && e.date >= from && e.date <= to)
    .sort((a, b) => (a.date === b.date ? a.entryNumber - b.entryNumber : a.date < b.date ? -1 : 1))

  for (const entry of sorted) {
    for (const line of entry.lines) {
      if (line.account !== account) continue
      if (!lineMatches(line, filter)) continue
      running = round2(running + line.debit - line.credit)
      rows.push({
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        date: entry.date,
        description: entry.description,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        debit: line.debit,
        credit: line.credit,
        balance: running,
        project: line.project,
        costCenter: line.costCenter,
        note: line.note,
      })
    }
  }
  return { openingBalance, rows, closingBalance: round2(running) }
}

// ---------------------------------------------------------------------------
// Integrity checks
//
// These interrogate the ledger itself rather than a report built from it: if
// one fails, no statement above it can be trusted, so the UI blocks on them.
// ---------------------------------------------------------------------------

export interface IntegrityCheck {
  id: string
  labelAr: string
  labelEn: string
  ok: boolean
  detail: string
}

export function integrityChecks(entries: JournalEntry[], windows: PeriodWindows): IntegrityCheck[] {
  const posted = entries.filter((e) => e.status === "posted")
  const unbalanced = posted.filter((e) => Math.abs(round2(e.totalDebit - e.totalCredit)) > 0.02)
  const tb = trialBalance(windows)
  const orphanLines = posted.reduce(
    (n, e) => n + e.lines.filter((l) => !ACCOUNT_BY_CODE[l.account]?.postable).length,
    0
  )
  const uncosted = posted.reduce((n, e) => n + e.lines.filter((l) => !l.costCenter).length, 0)

  return [
    {
      id: "entries_balanced",
      labelAr: "توازن كل قيد على حدة",
      labelEn: "Every entry balances",
      ok: unbalanced.length === 0,
      detail: unbalanced.length
        ? `${unbalanced.length} قيد غير متوازن`
        : `${posted.length} قيد مرحّل — كلها متوازنة`,
    },
    {
      id: "trial_balance",
      labelAr: "توازن ميزان المراجعة",
      labelEn: "Trial balance balances",
      ok: Math.abs(tb.difference) < 0.5,
      detail: `مدين ${tb.totals.closingDebit} مقابل دائن ${tb.totals.closingCredit} — الفرق ${tb.difference}`,
    },
    {
      id: "postable_accounts",
      labelAr: "كل بند قيد مربوط بحساب يقبل القيد",
      labelEn: "Every line hits a postable account",
      ok: orphanLines === 0,
      detail: orphanLines ? `${orphanLines} بند على حساب تجميعي` : "لا قيود على الحسابات التجميعية",
    },
    {
      id: "cost_centers",
      labelAr: "كل بند قيد له مركز تكلفة",
      labelEn: "Every line carries a cost centre",
      ok: uncosted === 0,
      detail: uncosted ? `${uncosted} بند بلا مركز تكلفة` : "كل البنود مصنّفة",
    },
  ]
}

/**
 * Control-account reconciliation: the ledger's total for a control account must
 * equal the sum of its sub-ledger. A gap means a business document moved without
 * its journal entry (or vice versa) — the failure this whole module is designed
 * to make impossible, checked anyway.
 */
export interface ControlReconciliation {
  account: string
  labelAr: string
  ledgerBalance: number
  subLedgerBalance: number
  difference: number
  ok: boolean
}

export function reconcileControl(
  map: BalanceMap,
  account: string,
  labelAr: string,
  subLedgerBalance: number
): ControlReconciliation {
  const ledgerBalance = nodeNatural(map, account)
  const difference = round2(ledgerBalance - round2(subLedgerBalance))
  return {
    account,
    labelAr,
    ledgerBalance,
    subLedgerBalance: round2(subLedgerBalance),
    difference,
    ok: Math.abs(difference) < 0.5,
  }
}

// ---------------------------------------------------------------------------
// Cash-flow helpers
// ---------------------------------------------------------------------------

/** Sum the period movement of every leaf carrying a given cash-flow tag. */
export function cashFlowMovement(map: BalanceMap, tag: CashFlowClass): number {
  let sum = 0
  for (const code of Object.keys(map)) {
    if (ACCOUNT_BY_CODE[code]?.cashFlow === tag) sum += map[code].balance
  }
  return round2(sum)
}

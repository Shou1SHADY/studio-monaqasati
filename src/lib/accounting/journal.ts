// The general journal (دفتر اليومية) — the one place money facts are recorded.
// Everything else in Accounting is a read of these entries.
//
// Three invariants hold the module together:
//
//  1. BALANCED BY CONSTRUCTION. `buildEntry` refuses to return an unbalanced
//     entry, so an unbalanced one can never reach Firestore. Reports may then
//     assume balance instead of defending against it.
//
//  2. APPEND-ONLY. Posted entries are never edited or deleted — a correction is
//     a reversing entry that points back at the original. Same convention as
//     `wasteRecords` and `transfers` elsewhere in this codebase, and the rules
//     enforce it server-side.
//
//  3. IDEMPOTENT. An entry born from a business document takes a DETERMINISTIC
//     id built from (source type, source id). Re-running a posting hook — a
//     retry, a double click, a replayed batch — overwrites the same document
//     instead of double-counting the money.

import type { WriteBatch, Firestore } from "firebase/firestore"
import { doc, collection, serverTimestamp } from "firebase/firestore"
import { isPostable } from "./accounts"

export const ACCOUNTING_ACCOUNTS = "accounting_accounts"
export const JOURNAL_ENTRIES = "accounting_journal"
export const ACCOUNTING_PERIODS = "accounting_periods"
export const ACCOUNTING_SETTINGS = "accounting_settings"

/** Where an entry came from. `auto` is machine-posted from a business event,
 * `manual` is a human journal voucher, `opening` seeds the books. */
export type EntryKind = "auto" | "manual" | "opening"
export type EntryStatus = "draft" | "posted" | "reversed"

/**
 * The business documents that post. Adding a member here means adding a rule in
 * posting-rules.ts — the two are checked against each other by the type system.
 */
export type SourceType =
  | "opening"
  | "ipc_claim"
  | "ipc_collection"
  | "sales_quotation"
  | "sales_payment"
  | "purchase_invoice"
  | "supplier_payment"
  | "goods_receipt"
  | "material_issue"
  | "waste"
  | "work_order_issue"
  | "work_order_delivery"
  | "payroll"
  | "payroll_payment"
  | "expense"
  | "depreciation"
  | "guarantee_margin"
  | "guarantee_release"
  | "retention_release"
  | "vat_settlement"
  | "zakat_provision"
  | "wip_revenue"
  | "manual_voucher"

export interface JournalLine {
  /** A postable leaf code — a rollup here is rejected at build time. */
  account: string
  debit: number
  credit: number
  /** Analytical dimensions. `project` links a line to a project so job costing
   * and per-project P&L are a filter rather than a separate ledger. */
  project?: string | null
  projectName?: string | null
  costCenter?: string | null
  branch?: string | null
  /** Counterparty — a client, supplier or employee id, for sub-ledger views. */
  party?: string | null
  partyName?: string | null
  note?: string | null
}

export interface JournalEntry {
  id: string
  organizationId: string
  entryNumber: number
  /** ISO date (YYYY-MM-DD) the entry belongs to — the accounting date, which
   * is not necessarily the day it was captured. */
  date: string
  /** YYYY-MM, derived from `date`. Indexed so period reports are one query. */
  period: string
  kind: EntryKind
  sourceType: SourceType
  /** Id of the business document. Together with sourceType it makes the entry id. */
  sourceId: string
  description: string
  lines: JournalLine[]
  totalDebit: number
  totalCredit: number
  status: EntryStatus
  /** Set on the entry a reversal cancels, and on the reversal itself. */
  reversesEntryId?: string | null
  reversedByEntryId?: string | null
  createdByUserId: string
  createdByUserName: string
  createdAt?: unknown
  updatedAt?: unknown
}

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

/** Entries within half a halala are treated as balanced — the tolerance absorbs
 * float drift from percentage splits (VAT, retention) without hiding real gaps. */
const BALANCE_TOLERANCE = 0.005

export function periodOf(date: string): string {
  return date.slice(0, 7)
}

/**
 * Stable id for a business-sourced entry. Keeping it deterministic is what
 * makes posting idempotent: the same source document always writes the same
 * Firestore document, so a replayed hook cannot double-post.
 */
export function entryDocId(sourceType: SourceType, sourceId: string): string {
  return `${sourceType}__${sourceId}`
}

export class UnbalancedEntryError extends Error {
  constructor(
    readonly description: string,
    readonly totalDebit: number,
    readonly totalCredit: number
  ) {
    super(`Unbalanced journal entry "${description}": debit ${totalDebit} ≠ credit ${totalCredit}`)
    this.name = "UnbalancedEntryError"
  }
}

export class NonPostableAccountError extends Error {
  constructor(readonly account: string) {
    super(`Account ${account} is a rollup — journal lines may only hit postable leaves`)
    this.name = "NonPostableAccountError"
  }
}

export interface BuildEntryInput {
  organizationId: string
  date: string
  kind: EntryKind
  sourceType: SourceType
  sourceId: string
  description: string
  lines: Array<Partial<JournalLine> & { account: string }>
  entryNumber?: number
  status?: EntryStatus
  userId: string
  userName: string
  /** Applied to any line that does not carry its own. */
  defaultBranch?: string | null
  defaultCostCenter?: string | null
}

/**
 * Normalise, validate and total a set of lines into an entry.
 *
 * Zero-value lines are dropped rather than rejected: rules compute optional
 * components (retention, advance recovery, VAT) generically, and a component
 * that is zero for a given document simply has no line.
 *
 * Throws rather than returning an error union — an unbalanced entry is a
 * programming fault in a posting rule, not a user-facing condition, and it must
 * never be swallowed into a half-written ledger.
 */
export function buildEntry(input: BuildEntryInput): Omit<JournalEntry, "id"> {
  const lines: JournalLine[] = input.lines
    .map((l) => ({
      account: l.account,
      debit: round2(l.debit || 0),
      credit: round2(l.credit || 0),
      project: l.project ?? null,
      projectName: l.projectName ?? null,
      costCenter: l.costCenter ?? input.defaultCostCenter ?? null,
      branch: l.branch ?? input.defaultBranch ?? null,
      party: l.party ?? null,
      partyName: l.partyName ?? null,
      note: l.note ?? null,
    }))
    .filter((l) => l.debit !== 0 || l.credit !== 0)

  for (const line of lines) {
    if (!isPostable(line.account)) throw new NonPostableAccountError(line.account)
  }

  const totalDebit = round2(lines.reduce((sum, l) => sum + l.debit, 0))
  const totalCredit = round2(lines.reduce((sum, l) => sum + l.credit, 0))
  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    throw new UnbalancedEntryError(input.description, totalDebit, totalCredit)
  }

  return {
    organizationId: input.organizationId,
    entryNumber: input.entryNumber ?? 0,
    date: input.date,
    period: periodOf(input.date),
    kind: input.kind,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description,
    lines,
    totalDebit,
    totalCredit,
    status: input.status ?? "posted",
    reversesEntryId: null,
    reversedByEntryId: null,
    createdByUserId: input.userId,
    createdByUserName: input.userName,
  }
}

export function nextEntryNumber(entries: Array<{ entryNumber?: number }>): number {
  return entries.reduce((max, e) => Math.max(max, Number(e.entryNumber) || 0), 0) + 1
}

/**
 * Queue an entry onto a batch that also carries the business write.
 *
 * Taking a batch rather than committing here is deliberate: the ledger entry
 * and the fact it records land together or not at all. A work order that draws
 * stock without its journal entry — or the reverse — is a reconciliation
 * problem that no report can repair afterwards.
 */
export function addEntryToBatch(
  firestore: Firestore,
  batch: WriteBatch,
  entry: Omit<JournalEntry, "id">
): string {
  const id = entryDocId(entry.sourceType, entry.sourceId)
  batch.set(doc(firestore, JOURNAL_ENTRIES, id), {
    ...entry,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return id
}

/** A manual voucher has no business document, so it gets a generated id. */
export function newVoucherId(firestore: Firestore): string {
  return doc(collection(firestore, JOURNAL_ENTRIES)).id
}

/**
 * The mirror image of an entry, dated when the correction is recognised.
 *
 * Reversal — not deletion, not an edit — is how a posted mistake is undone: the
 * original stays legible in the ledger and the audit trail shows both the error
 * and its correction, which is what an auditor expects to find.
 */
export function buildReversal(
  original: JournalEntry,
  opts: { date: string; userId: string; userName: string; reason?: string }
): Omit<JournalEntry, "id"> & { reversesEntryId: string } {
  const lines = original.lines.map((l) => ({
    ...l,
    debit: l.credit,
    credit: l.debit,
  }))
  const built = buildEntry({
    organizationId: original.organizationId,
    date: opts.date,
    kind: "manual",
    sourceType: original.sourceType,
    sourceId: `${original.sourceId}__reversal`,
    description: opts.reason
      ? `عكس القيد ${original.entryNumber} — ${opts.reason}`
      : `عكس القيد ${original.entryNumber} — ${original.description}`,
    lines,
    userId: opts.userId,
    userName: opts.userName,
  })
  return { ...built, reversesEntryId: original.id }
}

// ---------------------------------------------------------------------------
// Periods
//
// A closed period refuses new postings. Without it, last quarter's statements
// change after they were signed — the single most damaging thing a ledger can
// do to the people relying on it.
// ---------------------------------------------------------------------------

export interface AccountingPeriod {
  id: string
  organizationId: string
  /** YYYY-MM */
  period: string
  status: "open" | "closed"
  closedAt?: string | null
  closedByUserId?: string | null
  closedByUserName?: string | null
}

export function isPeriodClosed(periods: AccountingPeriod[], date: string): boolean {
  const p = periodOf(date)
  return periods.some((x) => x.period === p && x.status === "closed")
}

export class ClosedPeriodError extends Error {
  constructor(readonly period: string) {
    super(`Accounting period ${period} is closed — post to an open period or reopen it first`)
    this.name = "ClosedPeriodError"
  }
}

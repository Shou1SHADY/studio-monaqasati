// Human journal vouchers (قيد يومية يدوي) — the accountant's own writes to the
// books: new entries, reversals, and promoting or discarding drafts.
//
// Validation is pure and shared with the form, so the page can say exactly
// which line is wrong before anything is sent; the writes then go through the
// same buildEntry/entryDocId path as every automatic posting, so a manual
// voucher is indistinguishable in shape from a machine one and every report
// picks it up with no special case.

import { deleteDoc, doc, serverTimestamp, writeBatch, type Firestore } from "firebase/firestore"
import { isPostable } from "./accounts"
import {
  JOURNAL_ENTRIES,
  buildEntry,
  buildReversal,
  entryDocId,
  isPeriodClosed,
  newVoucherId,
  periodOf,
  round2,
  ClosedPeriodError,
  type EntryStatus,
  type JournalEntry,
  type JournalLine,
  type SourceType,
  type WhtLineInfo,
} from "./journal"
import { loadPeriods, nextNumber } from "./post"
import { COST_CENTERS } from "./posting-rules"
import { isValidIsoDate } from "./periods"

export interface ManualLineInput {
  account: string
  debit: string | number
  credit: string | number
  note?: string | null
  project?: string | null
  projectName?: string | null
  costCenter?: string | null
  party?: string | null
  partyName?: string | null
  /** The withholding-tax component's line carries what it withheld. */
  wht?: WhtLineInfo | null
}

export type LineIssue = "no_account" | "not_postable" | "both_sides" | "no_amount"
export type EntryIssue = "bad_date" | "no_description" | "min_lines" | "unbalanced"

export interface ManualValidation {
  ok: boolean
  lineIssues: Record<number, LineIssue>
  entryIssues: EntryIssue[]
  totalDebit: number
  totalCredit: number
  /** totalDebit − totalCredit. */
  difference: number
  /** The lines that will be written, blank rows dropped. */
  lines: Array<Partial<JournalLine> & { account: string; debit: number; credit: number }>
}

const amount = (v: string | number): number => {
  const n = typeof v === "number" ? v : Number(String(v).trim() || 0)
  return Number.isFinite(n) ? round2(Math.max(0, n)) : 0
}

function isBlank(line: ManualLineInput): boolean {
  return !line.account && amount(line.debit) === 0 && amount(line.credit) === 0 && !line.note?.trim()
}

/**
 * Every rule a voucher must satisfy, reported per line. Blank rows are ignored
 * rather than rejected — a form always carries a spare empty row.
 */
export function validateManualEntry(input: { date: string; description: string; lines: ManualLineInput[] }): ManualValidation {
  const lineIssues: Record<number, LineIssue> = {}
  const entryIssues: EntryIssue[] = []
  const lines: ManualValidation["lines"] = []
  let totalDebit = 0
  let totalCredit = 0

  input.lines.forEach((line, i) => {
    if (isBlank(line)) return
    const debit = amount(line.debit)
    const credit = amount(line.credit)
    if (!line.account) lineIssues[i] = "no_account"
    else if (!isPostable(line.account)) lineIssues[i] = "not_postable"
    else if (debit > 0 && credit > 0) lineIssues[i] = "both_sides"
    else if (debit === 0 && credit === 0) lineIssues[i] = "no_amount"
    totalDebit += debit
    totalCredit += credit
    if (!lineIssues[i]) {
      lines.push({
        account: line.account,
        debit,
        credit,
        note: line.note?.trim() || null,
        project: line.project || null,
        projectName: line.projectName || null,
        costCenter: line.costCenter || null,
        party: line.party || null,
        partyName: line.partyName?.trim() || null,
        ...(line.wht ? { wht: line.wht } : {}),
      })
    }
  })

  totalDebit = round2(totalDebit)
  totalCredit = round2(totalCredit)
  if (!isValidIsoDate(input.date)) entryIssues.push("bad_date")
  if (!input.description.trim()) entryIssues.push("no_description")
  if (lines.length + Object.keys(lineIssues).length < 2) entryIssues.push("min_lines")
  // Compared in halalas: the rules demand exact equality of the stored totals.
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100) || totalDebit === 0) entryIssues.push("unbalanced")

  return {
    ok: entryIssues.length === 0 && Object.keys(lineIssues).length === 0,
    lineIssues,
    entryIssues,
    totalDebit,
    totalCredit,
    difference: round2(totalDebit - totalCredit),
    lines,
  }
}

export interface ManualEntryWrite {
  organizationId: string
  userId: string
  userName: string
  date: string
  description: string
  reference?: string | null
  lines: ManualLineInput[]
  status: Extract<EntryStatus, "draft" | "posted">
  /** The accountant's own postings: vouchers, settlements, and the tax screens'
   * decisions (zakat provision and payment, WHT remittance). All are `manual` —
   * a person decided them, and the rules require `accounting.post` for that. */
  sourceType?: Extract<SourceType, "manual_voucher" | "settlement" | "zakat_provision" | "zakat_payment" | "wht_remittance">
  /** Lines without their own cost centre fall here. General administration by default. */
  costCenter?: string
}

export class InvalidManualEntryError extends Error {
  constructor(readonly validation: ManualValidation) {
    super("Manual journal entry failed validation")
    this.name = "InvalidManualEntryError"
  }
}

/** Write a voucher. Refuses a closed period and an invalid entry; returns the
 * new entry's id and number. */
export async function saveManualEntry(firestore: Firestore, input: ManualEntryWrite): Promise<{ id: string; entryNumber: number }> {
  const validation = validateManualEntry(input)
  if (!validation.ok) throw new InvalidManualEntryError(validation)

  const periods = await loadPeriods(firestore, input.organizationId)
  if (isPeriodClosed(periods, input.date)) throw new ClosedPeriodError(periodOf(input.date))

  const sourceType = input.sourceType ?? "manual_voucher"
  const voucherId = newVoucherId(firestore)
  const entryNumber = await nextNumber(firestore, input.organizationId)
  const entry = buildEntry({
    organizationId: input.organizationId,
    date: input.date,
    kind: "manual",
    sourceType,
    sourceId: voucherId,
    description: input.description.trim(),
    lines: validation.lines,
    entryNumber,
    status: input.status,
    userId: input.userId,
    userName: input.userName,
    defaultCostCenter: input.costCenter ?? COST_CENTERS.admin,
  })
  const id = entryDocId(input.organizationId, sourceType, voucherId)
  const batch = writeBatch(firestore)
  batch.set(doc(firestore, JOURNAL_ENTRIES, id), {
    ...entry,
    reference: input.reference?.trim() || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return { id, entryNumber }
}

/**
 * Reverse a posted entry: post its mirror image dated `date`, and stamp the
 * original with the reversal's id. Both land in one batch — an original marked
 * reversed with no reversal in the books (or the reverse) would be worse than
 * either state alone.
 *
 * The original stays `posted`: the reversal is what cancels it in every report.
 * Marking it anything else would drop it from the balances AND leave the
 * reversal counting, which is a double correction.
 */
export async function reverseJournalEntry(
  firestore: Firestore,
  input: { original: JournalEntry; date: string; reason?: string; userId: string; userName: string }
): Promise<{ id: string; entryNumber: number }> {
  if (input.original.status !== "posted") throw new Error("only_posted_entries_reverse")
  if (input.original.reversedByEntryId) throw new Error("already_reversed")
  const periods = await loadPeriods(firestore, input.original.organizationId)
  if (isPeriodClosed(periods, input.date)) throw new ClosedPeriodError(periodOf(input.date))

  const built = buildReversal(input.original, {
    date: input.date,
    userId: input.userId,
    userName: input.userName,
    reason: input.reason?.trim() || undefined,
  })
  const entryNumber = await nextNumber(firestore, input.original.organizationId)
  const id = entryDocId(built.organizationId, built.sourceType, built.sourceId)
  const batch = writeBatch(firestore)
  batch.set(doc(firestore, JOURNAL_ENTRIES, id), {
    ...built,
    entryNumber,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  batch.update(doc(firestore, JOURNAL_ENTRIES, input.original.id), {
    reversedByEntryId: id,
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return { id, entryNumber }
}

/** Promote a draft to posted — the moment it starts counting in every report. */
export async function postDraftEntry(firestore: Firestore, entry: JournalEntry): Promise<void> {
  if (entry.status !== "draft") return
  const periods = await loadPeriods(firestore, entry.organizationId)
  if (isPeriodClosed(periods, entry.date)) throw new ClosedPeriodError(periodOf(entry.date))
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, JOURNAL_ENTRIES, entry.id), { status: "posted", updatedAt: serverTimestamp() })
  await batch.commit()
}

/** Only a draft may be discarded; posted history is corrected by reversal. */
export async function deleteDraftEntry(firestore: Firestore, entry: JournalEntry): Promise<void> {
  if (entry.status !== "draft") throw new Error("only_drafts_delete")
  await deleteDoc(doc(firestore, JOURNAL_ENTRIES, entry.id))
}

// The posting service — the one function business modules call.
//
// Callers hand it a PostingResult from posting-rules and either their own batch
// or nothing. It resolves the entry number, refuses closed periods, and writes a
// balanced entry at a deterministic id.
//
// Two guarantees callers depend on:
//   • Passing a batch makes the ledger entry atomic with the business write.
//   • Posting is FAILURE-ISOLATED when the caller cannot batch: a bookkeeping
//     problem must never abort the operation a user actually asked for. The
//     entry is missing, the business fact stands, and the integrity screen
//     surfaces the gap — the opposite trade (losing the user's work to protect
//     the ledger) is not one a user would accept.

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  limit,
  writeBatch,
  type Firestore,
  type WriteBatch,
} from "firebase/firestore"
import {
  ACCOUNTING_PERIODS,
  JOURNAL_ENTRIES,
  addEntryToBatch,
  buildEntry,
  isPeriodClosed,
  periodOf,
  ClosedPeriodError,
  type AccountingPeriod,
  type EntryKind,
} from "./journal"
import type { PostingContext, PostingResult } from "./posting-rules"

/**
 * Highest entry number in the org, +1.
 *
 * Deliberately a plain equality query with the max computed here: adding
 * `orderBy(entryNumber)` would demand a composite index, and a missing index
 * makes the query THROW — which, inside postToLedgerSafe, silently drops the
 * ledger entry. That exact failure happened once; a full read of an org's
 * entries is the cheaper price. (The accounting screens already subscribe to
 * the same set, so this is no new load in practice.)
 */
async function nextNumber(firestore: Firestore, organizationId: string): Promise<number> {
  const snap = await getDocs(
    query(collection(firestore, JOURNAL_ENTRIES), where("organizationId", "==", organizationId))
  )
  let max = 0
  snap.forEach((d) => {
    const n = Number(d.data().entryNumber) || 0
    if (n > max) max = n
  })
  return max + 1
}

async function loadPeriods(firestore: Firestore, organizationId: string): Promise<AccountingPeriod[]> {
  const snap = await getDocs(
    query(collection(firestore, ACCOUNTING_PERIODS), where("organizationId", "==", organizationId))
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AccountingPeriod)
}

export interface PostOptions {
  /** Join the caller's batch instead of committing separately. */
  batch?: WriteBatch
  kind?: EntryKind
  status?: "draft" | "posted"
  /** Skip the closed-period query when the caller already checked. */
  skipPeriodCheck?: boolean
}

/**
 * Write one posting result to the ledger.
 *
 * Returns the entry id, or null when the rule produced nothing to post (a
 * zero-value document is not an error — it simply has no accounting effect).
 */
export async function postToLedger(
  firestore: Firestore,
  ctx: PostingContext,
  result: PostingResult | null,
  options: PostOptions = {}
): Promise<string | null> {
  if (!result || result.empty) return null

  if (!options.skipPeriodCheck) {
    const periods = await loadPeriods(firestore, ctx.organizationId)
    if (isPeriodClosed(periods, result.date)) throw new ClosedPeriodError(periodOf(result.date))
  }

  const entry = buildEntry({
    organizationId: ctx.organizationId,
    date: result.date,
    kind: options.kind ?? "auto",
    sourceType: result.sourceType,
    sourceId: result.sourceId,
    description: result.description,
    lines: result.lines,
    entryNumber: await nextNumber(firestore, ctx.organizationId),
    status: options.status ?? "posted",
    userId: ctx.userId,
    userName: ctx.userName,
    defaultBranch: ctx.branch ?? null,
    defaultCostCenter: result.costCenter,
  })

  if (options.batch) return addEntryToBatch(firestore, options.batch, entry)

  const batch = writeBatch(firestore)
  const id = addEntryToBatch(firestore, batch, entry)
  await batch.commit()
  return id
}

/**
 * Post without letting a bookkeeping failure reach the caller.
 *
 * For hooks bolted onto an existing user action — accepting a quotation,
 * confirming a delivery — where the business write has already succeeded or is
 * committed separately. Failures are logged for the integrity screen to catch,
 * never surfaced as an error on an operation that worked.
 */
export async function postToLedgerSafe(
  firestore: Firestore,
  ctx: PostingContext,
  result: PostingResult | null,
  options: PostOptions = {}
): Promise<string | null> {
  try {
    return await postToLedger(firestore, ctx, result, options)
  } catch (err) {
    console.error("Ledger posting failed:", result?.sourceType, result?.sourceId, err)
    return null
  }
}

/** Whether an org has switched Accounting on. Hooks no-op until it is enabled,
 * so an org that never opens the module never accumulates entries it did not ask
 * for — and none of the modules that post need to know about that decision. */
export async function isAccountingEnabled(firestore: Firestore, organizationId: string): Promise<boolean> {
  const snap = await getDocs(
    query(collection(firestore, "accounting_settings"), where("organizationId", "==", organizationId), limit(1))
  )
  return !snap.empty && snap.docs[0].data().enabled === true
}

/** Has this business document already posted? Used by the backfill so a rerun
 * tops up the gaps instead of rewriting history. */
export async function entryExists(firestore: Firestore, entryId: string): Promise<boolean> {
  const { getDoc } = await import("firebase/firestore")
  const snap = await getDoc(doc(firestore, JOURNAL_ENTRIES, entryId))
  return snap.exists()
}

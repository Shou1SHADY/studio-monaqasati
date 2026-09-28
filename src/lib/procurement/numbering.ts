// Procurement document numbers (PRD 3.0 §15.1) — `PO-2026/014` for a purchase
// order, `GR-2026/031` for a goods receipt. One yearly sequence per org and
// type, drawn INSIDE the transaction that writes the document (the same
// `mfgCounters` documents Sales and Manufacturing draw from, id
// `{orgId}__{type}__{year}`), so an abandoned form consumes no number and two
// buyers can never hold the same one. The stored number stays Latin; the
// Arabic prefix is a display matter (`format.ts`).

import { doc, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { MFG_COUNTERS } from "../manufacturing-engine"
import { drawYearlyDocNumber, formatYearlyDocNumber } from "../sales-numbering"
import type { ProcDocType } from "./format"

export function formatProcDocNumber(type: ProcDocType, year: number, seq: number): string {
  return formatYearlyDocNumber(type, year, seq)
}

/** Read and bump the sequence inside the caller's transaction. All of a
 * transaction's reads must precede its writes — draw the number first. */
export async function drawProcDocNumber(
  firestore: Firestore,
  tx: Transaction,
  organizationId: string,
  type: ProcDocType,
  year = new Date().getUTCFullYear()
): Promise<string> {
  return drawYearlyDocNumber(firestore, tx, organizationId, type, year)
}

/**
 * Several numbers of one type in ONE transaction (a split award prepares an
 * order per supplier at once). A transaction may not read a document after
 * writing it, so the sequence is read once and bumped by the count.
 */
export async function drawProcDocNumbers(
  firestore: Firestore,
  tx: Transaction,
  organizationId: string,
  type: ProcDocType,
  count: number,
  year = new Date().getUTCFullYear()
): Promise<string[]> {
  const ref = doc(firestore, MFG_COUNTERS, `${organizationId}__${type}__${year}`)
  const snap = await tx.get(ref)
  const last = snap.exists() ? Number(snap.data().last) || 0 : 0
  if (count <= 0) return []
  tx.set(ref, { organizationId, type, year, last: last + count, updatedAt: serverTimestamp() })
  return Array.from({ length: count }, (_, k) => formatYearlyDocNumber(type, year, last + k + 1))
}

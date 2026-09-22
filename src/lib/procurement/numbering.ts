// Procurement document numbers (PRD 3.0 §15.1) — `PO-2026/014` for a purchase
// order, `GR-2026/031` for a goods receipt. One yearly sequence per org and
// type, drawn INSIDE the transaction that writes the document (the same
// `mfgCounters` documents Sales and Manufacturing draw from, id
// `{orgId}__{type}__{year}`), so an abandoned form consumes no number and two
// buyers can never hold the same one. The stored number stays Latin; the
// Arabic prefix is a display matter (`format.ts`).

import type { Firestore, Transaction } from "firebase/firestore"
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

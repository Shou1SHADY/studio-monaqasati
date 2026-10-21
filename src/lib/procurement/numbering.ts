// Procurement document numbers (PRD 3.0 §15.1) — `PO-2026/014` for a purchase
// order, `GR-2026/031` for a goods receipt. One yearly sequence per org and
// type, drawn INSIDE the transaction that writes the document (the same
// `mfgCounters` documents Sales and Manufacturing draw from, id
// `{orgId}__{type}__{year}`), so an abandoned form consumes no number and two
// buyers can never hold the same one. The stored number stays Latin; the
// Arabic prefix is a display matter (`format.ts`).

import { doc, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { riyadhDay } from "../hr/format"
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

/** The RFQ's own yearly sequence (`RFQ-2026/031`, Supplier 1.0 NAV-08 / G-10): the counter
 * `{orgId}__RFQ__{year}` beside PO and GR — a number never repeats within its type, and the
 * supplier reads it as a word ("طلب 2026/031"). Three letters, so it never meets another
 * module's two-letter code (`RQ` is Sales' quote request). */
export const RFQ_DOC_TYPE = "RFQ"

/** The ONE sequence of requests that reach «طلبات الشراء الواردة» without a project number (Procurement 2.0 REQ-04): the team's
 * «طلب مواد», an Inventory need line and a workshop ask all draw `MAT-2026/014` from `{orgId}__MAT__{year}` — shown «ط.م-2026/014».
 * A project's request keeps the project's own «MR 03» (it repeats across projects, so its key is a global id, never the number).
 * `MR` is Manufacturing's counter and never meets this one. */
export const MATERIAL_REQUEST_DOC_TYPE = "MAT"

/** The year of the Riyadh calendar day — at 1 AM on 1 January in Riyadh, UTC still says last year. */
export const riyadhYear = (now: Date = new Date()): number => Number(riyadhDay(now).slice(0, 4))

export async function drawRfqNumber(firestore: Firestore, tx: Transaction, organizationId: string, year = riyadhYear()): Promise<string> {
  return drawYearlyDocNumber(firestore, tx, organizationId, RFQ_DOC_TYPE, year)
}

export async function drawMaterialRequestNumber(firestore: Firestore, tx: Transaction, organizationId: string, year = riyadhYear()): Promise<string> {
  return drawYearlyDocNumber(firestore, tx, organizationId, MATERIAL_REQUEST_DOC_TYPE, year)
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

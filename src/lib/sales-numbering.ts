// Sales document numbers (Sales PRD §13, QC-15, INV-03) — one yearly sequence
// per document type, drawn inside the transaction that writes the document, so
// two sellers can never hold the same number and a number is never reused. A
// composer closed without saving draws nothing.
//
// The sequences live beside Manufacturing's (`mfgCounters`, doc id
// `{orgId}__{type}__{year}`) — same collection, same forward-only rule. The
// PRD's "DN" is already Manufacturing's handover note, so a customer delivery
// note is "SD".
//
// A number is stored once, in Latin ("QT-2026/070"), and shown in the reader's
// language ("ع.س-2026/070") — the digits and the slash never change, so a
// number read over the phone finds the same document in either language.

import { doc, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { MFG_COUNTERS } from "./manufacturing-engine"

export type SalesDocType = "QT" | "TN" | "RQ" | "RT" | "SD"

/** `QT-2026/070` — any two-letter code, three-digit padded sequence. */
export function formatYearlyDocNumber(type: string, year: number, seq: number): string {
  return `${type}-${year}/${String(seq).padStart(3, "0")}`
}

export function formatSalesDocNumber(type: SalesDocType, year: number, seq: number): string {
  return formatYearlyDocNumber(type, year, seq)
}

/** Read and bump one `{orgId}__{type}__{year}` sequence inside the caller's
 * transaction — shared by Sales' and Procurement's document types. Reads must
 * precede writes in a transaction: call this before the first `tx.set`. */
export async function drawYearlyDocNumber(
  firestore: Firestore,
  tx: Transaction,
  organizationId: string,
  type: string,
  year = new Date().getUTCFullYear()
): Promise<string> {
  const ref = doc(firestore, MFG_COUNTERS, `${organizationId}__${type}__${year}`)
  const snap = await tx.get(ref)
  const seq = (snap.exists() ? Number(snap.data().last) || 0 : 0) + 1
  tx.set(ref, { organizationId, type, year, last: seq, updatedAt: serverTimestamp() })
  return formatYearlyDocNumber(type, year, seq)
}

/** Read and bump the sequence inside the caller's transaction. */
export async function drawSalesDocNumber(
  firestore: Firestore,
  tx: Transaction,
  organizationId: string,
  type: SalesDocType,
  year = new Date().getUTCFullYear()
): Promise<string> {
  return drawYearlyDocNumber(firestore, tx, organizationId, type, year)
}

// ---------------------------------------------------------------------------
// Revisions — the base number and a suffix (D6)
// ---------------------------------------------------------------------------

const REVISION = /^(.*\/\d+)-(\d+)$/

/** "QT-2026/066-3" → "QT-2026/066". Older random numbers ("Q-AB12CD") have no
 * suffix to strip and are their own base. */
export function baseDocNumber(number: string): string {
  const m = REVISION.exec(number)
  return m ? m[1] : number
}

/** 1 for an original, 2 for "-2", … */
export function revisionOfNumber(number: string): number {
  const m = REVISION.exec(number)
  return m ? Number(m[2]) : 1
}

/** The original keeps the bare number; revisions add -2, -3, … */
export function revisionDocNumber(base: string, revision: number): string {
  return revision <= 1 ? baseDocNumber(base) : `${baseDocNumber(base)}-${revision}`
}

// ---------------------------------------------------------------------------
// Display — the prefix follows the language (UX-01, QC-19, S10)
// ---------------------------------------------------------------------------

const ARABIC_PREFIX: Record<string, string> = {
  QT: "ع.س",
  SO: "أ.ب",
  CO: "ط.س",
  SD: "س.ت",
  RT: "م.ر",
  TN: "إ.ح",
  MR: "طت",
  WO: "أت",
  RQ: "ط.ع",
  // Procurement (PRD 3.0 §15.1): the purchase order, the goods receipt and
  // the price agreement.
  PO: "ط.ش",
  GR: "ا.س",
  AG: "اتف",
  // Project Management (PM 1.0): the project number, as the prototype shows it.
  PJ: "م",
}

/** "QT-2026/070" reads "ع.س-2026/070" in Arabic. Anything that is not one of
 * our sequenced numbers — a legacy "Q-AB12CD", a typed reference — is returned
 * as it is. */
export function displayDocNumber(number: string | null | undefined, locale: string): string {
  if (!number) return ""
  if (locale !== "ar") return number
  const m = /^([A-Z]{2})-(\d{4}\/\d+(?:-\d+)?)$/.exec(number)
  const prefix = m ? ARABIC_PREFIX[m[1]] : undefined
  return m && prefix ? `${prefix}-${m[2]}` : number
}

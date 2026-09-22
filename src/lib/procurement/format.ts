// Procurement document numbers on screen (PRD §15.1). A number is stored once,
// in Latin — `PO-2026/014`, `GR-2026/031` — and shown with the Arabic prefix
// in Arabic (`ط.ش-2026/014`, `ا.س-2026/031`): the digits and the slash never
// change, so a number read over the phone finds the same document in either
// language. The rendering lives with Sales' `displayDocNumber` (one map, one
// regex, one rule); this module only names Procurement's prefixes.

import { displayDocNumber } from "../sales-numbering"

export type ProcDocType = "PO" | "GR"

/** The stored two-letter code and its Arabic prefix. */
export const PROC_DOC_PREFIXES: Record<ProcDocType, { latin: string; arabic: string }> = {
  PO: { latin: "PO", arabic: "ط.ش" },
  GR: { latin: "GR", arabic: "ا.س" },
}

/** `PO-2026/014` → `ط.ش-2026/014` in Arabic, untouched otherwise. Anything that
 * is not one of our sequenced numbers comes back as it is. */
export function displayPoNumber(number: string | null | undefined, locale: string): string {
  return displayDocNumber(number, locale)
}

/** `GR-2026/031` → `ا.س-2026/031` in Arabic. */
export function displayReceiptNumber(number: string | null | undefined, locale: string): string {
  return displayDocNumber(number, locale)
}

export { displayDocNumber }

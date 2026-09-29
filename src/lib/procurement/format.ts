// Procurement document numbers on screen (PRD §15.1). A number is stored once,
// in Latin — `PO-2026/014`, `GR-2026/031` — and shown with the Arabic prefix
// in Arabic (`ط.ش-2026/014`, `ا.س-2026/031`, a notice `إ.ت-…`): the digits and the slash never
// change, so a number read over the phone finds the same document in either
// language. The rendering lives with Sales' `displayDocNumber` (one map, one
// regex, one rule); this module only names Procurement's prefixes.

import { displayDocNumber } from "../sales-numbering"

export type ProcDocType = "PO" | "GR" | "AG"

/** The stored two-letter code and its Arabic prefix. */
export const PROC_DOC_PREFIXES: Record<ProcDocType, { latin: string; arabic: string }> = {
  PO: { latin: "PO", arabic: "ط.ش" },
  GR: { latin: "GR", arabic: "ا.س" },
  AG: { latin: "AG", arabic: "اتف" },
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

/** `AG-2026/003` → `اتف-2026/003` in Arabic. */
export function displayAgreementNumber(number: string | null | undefined, locale: string): string {
  return displayDocNumber(number, locale)
}

/**
 * A supplier's delivery notice (`إ.ت`, prototype `ASN`). The supplier writes
 * the notice and may not draw from our yearly counters, so its number is
 * DERIVED: the order's own number and the notice's place among that order's
 * notices — `PO-2026/126`, its second notice → `ASN-2026/126-2`. Never stored.
 */
export function noticeNumberFor(poNumber: string | null | undefined, ordinal: number | null | undefined): string | null {
  const m = /^[A-Z]{2,3}-(\d{4}\/\d+)$/.exec(poNumber || "")
  return m && ordinal && ordinal > 0 ? `ASN-${m[1]}-${ordinal}` : null
}

/** `ASN-2026/126-2` → `إ.ت-2026/126-2` in Arabic. */
export function displayNoticeNumber(number: string | null | undefined, locale: string): string {
  if (!number) return ""
  return locale === "ar" ? number.replace(/^ASN-/, "إ.ت-") : number
}

export { displayDocNumber }

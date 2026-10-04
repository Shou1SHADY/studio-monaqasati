// What the owner chooses to print on documents the team issues (DEV-60). Empty
// until the owner fills it in, so a team member's documents print nothing the
// owner has not decided to show.

export const COMPANY_PRINT_PROFILE = "companyPrintProfile"

export interface CompanyPrintProfile {
  crNumber?: string
  taxNumber?: string
}

const clean = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "")

/** The company's own number when its profile has one (the owner), else what the owner chose to print (a team member). */
export function printedNumber(own: unknown, chosen: unknown): string | null {
  return clean(own) || clean(chosen) || null
}

export function printProfileFields(input: { crNumber?: unknown; taxNumber?: unknown }): CompanyPrintProfile {
  return { crNumber: clean(input.crNumber), taxNumber: clean(input.taxNumber) }
}

const CR_PATTERN = /^\d{10}$/
const VAT_PATTERN = /^3\d{13}3$/

export type PrintProfileError = "cr_format" | "vat_format"

/** Both numbers are optional; when given they must be shaped like Saudi ones. */
export function printProfileErrors(fields: CompanyPrintProfile): PrintProfileError[] {
  const out: PrintProfileError[] = []
  const cr = clean(fields.crNumber)
  const vat = clean(fields.taxNumber).replace(/\s/g, "")
  if (cr && !CR_PATTERN.test(cr)) out.push("cr_format")
  if (vat && !VAT_PATTERN.test(vat)) out.push("vat_format")
  return out
}

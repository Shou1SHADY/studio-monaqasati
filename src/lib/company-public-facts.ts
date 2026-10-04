// The few facts about a company that its counterparties need in bulk — whether
// a supplier has a tax number and when its registration ends — without any
// number, the certificate files or the bank details (DEV-60). Any signed-in
// user, including the company's own team members, can read
// `companyPublicFacts/{orgId}`, so it holds yes/no flags and a date, never the
// tax number itself (that lives in `companyIdentity`, closed to members).

export const COMPANY_PUBLIC_FACTS = "companyPublicFacts"

export interface CompanyPublicFacts {
  hasVat?: boolean
  crExpiry?: string
  hasCr?: boolean
}

const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "")
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined

/** The public facts a profile write carries — only the ones it names, so a partial write never blanks the rest. */
export function publicFactsPatch(payload: Record<string, unknown> | null | undefined): CompanyPublicFacts {
  const out: CompanyPublicFacts = {}
  if (!payload) return out
  if (has(payload, "taxNumber")) out.hasVat = text(payload.taxNumber) !== ""
  if (has(payload, "crNumber")) out.hasCr = text(payload.crNumber) !== ""
  if (has(payload, "legalDocuments")) {
    const docs = payload.legalDocuments as { cr?: { expiryDate?: unknown } } | null
    out.crExpiry = text(docs?.cr?.expiryDate).slice(0, 10)
  }
  return out
}

/**
 * Whether a supplier has a tax number, its registration expiry, and — only while
 * the old profile field still exists — the number itself. The old profile fields
 * win while they exist (mobile writes only them); the public facts fill what they
 * lack and are the only source once the old fields are removed.
 */
export function factsFromProfile(
  legacy: { taxNumber?: unknown; legalDocuments?: { cr?: { expiryDate?: unknown } | null } | null } | null | undefined,
  facts: CompanyPublicFacts | null | undefined,
): { vat: string; hasVat: boolean; crExpiry: string } {
  const vat = text(legacy?.taxNumber)
  return {
    vat,
    hasVat: vat !== "" || facts?.hasVat === true,
    crExpiry: text(legacy?.legalDocuments?.cr?.expiryDate).slice(0, 10) || text(facts?.crExpiry).slice(0, 10),
  }
}

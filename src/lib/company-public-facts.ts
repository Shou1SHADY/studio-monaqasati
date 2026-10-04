// The few facts about a company that its counterparties need in bulk — whether
// a supplier has a tax number and when its registration ends — without the
// registration number, the certificate files or the bank details (DEV-60). Any
// signed-in user can read `companyPublicFacts/{orgId}`; only the owner writes it.

export const COMPANY_PUBLIC_FACTS = "companyPublicFacts"

export interface CompanyPublicFacts {
  vat?: string
  crExpiry?: string
  hasCr?: boolean
}

const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "")
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined

/** The public facts a profile write carries — only the ones it names, so a partial write never blanks the rest. */
export function publicFactsPatch(payload: Record<string, unknown> | null | undefined): CompanyPublicFacts {
  const out: CompanyPublicFacts = {}
  if (!payload) return out
  if (has(payload, "taxNumber")) out.vat = text(payload.taxNumber).replace(/\s/g, "")
  if (has(payload, "crNumber")) out.hasCr = text(payload.crNumber) !== ""
  if (has(payload, "legalDocuments")) {
    const docs = payload.legalDocuments as { cr?: { expiryDate?: unknown } } | null
    out.crExpiry = text(docs?.cr?.expiryDate).slice(0, 10)
  }
  return out
}

/** A supplier's tax number and registration expiry: the old profile fields win while they exist (mobile writes only them), the public facts fill what they lack. */
export function factsFromProfile(
  legacy: { taxNumber?: unknown; legalDocuments?: { cr?: { expiryDate?: unknown } | null } | null } | null | undefined,
  facts: CompanyPublicFacts | null | undefined,
): { vat: string; crExpiry: string } {
  return {
    vat: text(legacy?.taxNumber) || text(facts?.vat),
    crExpiry: text(legacy?.legalDocuments?.cr?.expiryDate).slice(0, 10) || text(facts?.crExpiry).slice(0, 10),
  }
}

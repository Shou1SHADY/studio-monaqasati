// Zero-dependency so both the client (org-identity.ts) and admin
// (org-identity-admin.ts) resolvers can share the exact same field list.
//
// Fields that represent a COMPANY's identity (name, contact info, legal
// documents, portfolio, verification status) as opposed to account-level
// bookkeeping (role, org membership, login security, email). These must
// come EXCLUSIVELY from the active organization's own doc for a secondary
// company — a naive `{ ...base, ...overlay }` merge still leaks the
// PRIMARY company's value for any field the secondary org hasn't saved
// yet (overlay simply doesn't have that key, so the spread falls through
// to base) — that's the same cross-contamination bug this module exists
// to fix, just for fields instead of whole documents. Strip these keys
// from `base` first so an unset field reads as blank, never as someone
// else's company's data.

export const IDENTITY_FIELD_KEYS = [
  "name", "companyName", "crNumber", "taxNumber", "city", "location",
  "phone", "phoneNumber", "description", "website", "certificates",
  "legalDocuments", "isVerified", "profileCompleted", "specializations",
  "coverageCities", "pendingSpecializations", "pendingCoverageCities",
  "projects", "companyFiles", "verificationRequested",
] as const

export function stripIdentityFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const clone: Record<string, unknown> = { ...obj }
  for (const key of IDENTITY_FIELD_KEYS) delete clone[key]
  return clone as Partial<T>
}

// A team member's own users/{uid} doc is born with isVerified/profileCompleted
// false and never changes — the company is what gets verified and completed.
// These two are the company's STANDING (they gate creating an RFQ and sending an
// offer); a member reads them from his company's doc, while his own name and
// phone stay his. Never the legal documents themselves — they are the owner's
// alone (DEV-60, companyIdentity), and a member's copy is dropped.
export const COMPANY_STANDING_KEYS = ["isVerified", "profileCompleted"] as const
const OWNER_ONLY_KEYS = ["legalDocuments"] as const

export function withCompanyStanding<T extends Record<string, unknown>>(member: T, company: Record<string, unknown> | null | undefined): T {
  const clone: Record<string, unknown> = { ...member }
  for (const key of COMPANY_STANDING_KEYS) {
    if (company && key in company) clone[key] = company[key]
    else delete clone[key]
  }
  for (const key of OWNER_ONLY_KEYS) delete clone[key]
  return clone as T
}

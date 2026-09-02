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

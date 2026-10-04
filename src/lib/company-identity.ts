// A company's sensitive identity — what only its owner, the platform admin and
// outside parties (never its own team members) may read (DEV-60). It lives in
// `companyIdentity/{orgId}`: orgId is the owner's uid for the primary company
// and the `organizations/{id}` id for a secondary one.

export const COMPANY_IDENTITY = "companyIdentity"

export const SENSITIVE_IDENTITY_KEYS = ["crNumber", "taxNumber", "legalDocuments", "iban", "bankName"] as const
export type SensitiveIdentityKey = (typeof SENSITIVE_IDENTITY_KEYS)[number]

export interface CompanyIdentity {
  crNumber?: string
  taxNumber?: string
  legalDocuments?: Record<string, unknown>
  iban?: string
  bankName?: string
}

const present = (v: unknown): boolean => {
  if (v == null) return false
  if (typeof v === "string") return v.trim() !== ""
  if (typeof v === "object") return Object.keys(v as object).length > 0
  return true
}

/** The sensitive fields a profile document carries, empty ones left out. */
export function pickIdentity(source: Record<string, unknown> | null | undefined): CompanyIdentity {
  const out: Record<string, unknown> = {}
  if (!source) return out
  for (const key of SENSITIVE_IDENTITY_KEYS) if (present(source[key])) out[key] = typeof source[key] === "number" ? String(source[key]) : source[key]
  return out as CompanyIdentity
}

/** During the move, a field missing from the identity document is still read from the old profile fields. */
export function resolveIdentity(stored: CompanyIdentity | null | undefined, legacy: Record<string, unknown> | null | undefined): CompanyIdentity {
  return { ...pickIdentity(legacy), ...pickIdentity(stored as Record<string, unknown> | null | undefined) }
}

/** What the old profile document holds that the identity document does not (or holds differently). */
export function identityGaps(stored: CompanyIdentity | null | undefined, legacy: Record<string, unknown> | null | undefined): SensitiveIdentityKey[] {
  const have = pickIdentity(stored as Record<string, unknown> | null | undefined)
  const old = pickIdentity(legacy)
  return SENSITIVE_IDENTITY_KEYS.filter((k) => k in old && JSON.stringify(old[k]) !== JSON.stringify(have[k]))
}

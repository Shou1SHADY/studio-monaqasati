// The company account as the contractors see it (PRD ACC-03/ACC-04, B-11): completion is seven checks
// — basic data, specialties & coverage, and five documents — and "Verified" is the commercial
// register, the national address and the IBAN letter. The VAT number is optional: its certificate is an
// optional document, never a condition (decision 9).

export const DOC_KEYS = ["cr", "vat", "addr", "iban", "conf"] as const
export type DocKey = (typeof DOC_KEYS)[number]

/** The documents that make a company verified. */
export const VERIFY_DOCS: readonly DocKey[] = ["cr", "addr", "iban"]

export interface ProfileDoc {
  url?: string
  name?: string
  expiryDate?: string
}

export interface ProfileFacts {
  name?: string
  companyName?: string
  phone?: string
  crNumber?: string
  nationalAddress?: string
  location?: string
  specializations?: string[]
  coverageCities?: string[]
  legalDocuments?: Partial<Record<DocKey, ProfileDoc>>
  certificates?: { name?: string; url?: string }[]
}

type Rec = Record<string, unknown>
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")

export function profileFacts(raw: Rec): ProfileFacts {
  const docs = (raw.legalDocuments || {}) as Partial<Record<DocKey, ProfileDoc>>
  const list = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [])
  return {
    name: text(raw.name),
    companyName: text(raw.companyName),
    phone: text(raw.phone),
    crNumber: text(raw.crNumber),
    nationalAddress: text(raw.nationalAddress) || text(raw.location),
    specializations: list(raw.specializations),
    coverageCities: list(raw.coverageCities),
    legalDocuments: docs,
    certificates: Array.isArray(raw.certificates) ? (raw.certificates as { name?: string; url?: string }[]) : [],
  }
}

const hasDoc = (f: ProfileFacts, k: DocKey): boolean => {
  if (k === "conf") return (f.certificates || []).some((c) => !!(c && c.url))
  return !!(f.legalDocuments && f.legalDocuments[k] && f.legalDocuments[k]?.url)
}

export function profileChecks(f: ProfileFacts): { k: string; ok: boolean }[] {
  return [
    { k: "basic", ok: !!((f.companyName || f.name) && f.phone && f.crNumber && f.nationalAddress) },
    { k: "specs", ok: !!((f.specializations || []).length && (f.coverageCities || []).length) },
    ...DOC_KEYS.map((k) => ({ k, ok: hasDoc(f, k) })),
  ]
}

export function profilePct(f: ProfileFacts): number {
  const c = profileChecks(f)
  return Math.round((c.filter((x) => x.ok).length / c.length) * 100)
}

/** Verified = the register, the national address and the IBAN letter are uploaded. */
export const isVerified = (f: ProfileFacts) => VERIFY_DOCS.every((k) => hasDoc(f, k))

/** A document's state from its expiry date: valid · due within 60 days · expired. */
export function docState(expiry: string | undefined, today: string): "valid" | "soon" | "expired" | "none" {
  if (!expiry) return "none"
  const n = Math.round((Date.parse(`${expiry.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5)
  return n < 0 ? "expired" : n <= 60 ? "soon" : "valid"
}

/** A Saudi IBAN as stored: spaces removed, upper case. */
export const normalIban = (v: string): string => v.replace(/\s+/g, "").toUpperCase()
/** SA followed by 22 digits. */
export const ibanValid = (v: string): boolean => /^SA\d{22}$/.test(normalIban(v))

// Supplier onboarding (owner, 18 Oct 2026): every supplier company — free or subscribed — uploads its commercial
// registration and its tax registration certificate, asks for approval, and the PLATFORM ADMIN approves it. Until then it
// sends no quotation, from any screen: the server refuses it (`/api/supplier-free/act` quote.new, `/api/supplier/offers`)
// and the `offers` rule no longer lets a supplier write a quote from a browser. A guest quoting through a share link has
// no account and is not asked (owner's decision); once he registers, his company is.
//
// The approval is the company's STANDING `isVerified` (users/{owner} for the primary company, organizations/{id} for a
// secondary one), written only by an admin — the rules refuse it from anyone else. `verificationRequested` is the
// company's own "please review us". Zero-dependency: the website, the server and the mobile app read it alike.

/** The two documents an approval needs, by their `legalDocuments` keys. */
export const APPROVAL_DOCS = ["cr", "vat"] as const
export type ApprovalDoc = (typeof APPROVAL_DOCS)[number]

/** `missing` — a document is not uploaded · `ready` — both are, not yet sent for review · `pending` — with the admin ·
 * `approved`. */
export type ApprovalState = "missing" | "ready" | "pending" | "approved"

type Rec = Record<string, unknown>

/** An uploaded document: a stored file address (or, on older accounts, a bare URL string). */
export function hasApprovalDoc(legalDocuments: unknown, key: ApprovalDoc): boolean {
  const d = (legalDocuments as Rec | null | undefined)?.[key]
  if (typeof d === "string") return d.trim() !== ""
  const url = (d as Rec | null | undefined)?.url
  return typeof url === "string" && url.trim() !== ""
}

export const missingApprovalDocs = (legalDocuments: unknown): ApprovalDoc[] => APPROVAL_DOCS.filter((k) => !hasApprovalDoc(legalDocuments, k))

export function approvalState(company: { isVerified?: unknown; verificationRequested?: unknown; legalDocuments?: unknown } | null | undefined): ApprovalState {
  if (!company) return "missing"
  if (company.isVerified === true) return "approved"
  if (missingApprovalDocs(company.legalDocuments).length) return "missing"
  return company.verificationRequested === true ? "pending" : "ready"
}

// ---------------------------------------------------------------------------
// The free account's monthly quotation allowance (a plan under study: e.g. 30–40 a month free, more on a subscription).
// The admin sets it in Admin → Settings; null = no limit, which is the default. Counted per company per Riyadh month on
// `supplierQuoteCounts/{orgId}__{yyyy-mm}`, incremented in the same transaction that writes the quote.
// ---------------------------------------------------------------------------

export const QUOTA_SETTINGS_DOC = { collection: "platformSettings", id: "supplierQuota" } as const
export const QUOTE_COUNTS = "supplierQuoteCounts"
export const MAX_MONTHLY_QUOTES = 1000

/** The Riyadh month a moment falls in, `yyyy-mm`. */
export const riyadhMonth = (now: Date): string => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 7)

export const quoteCountId = (orgId: string, month: string) => `${orgId}__${month}`

/** A stored limit read safely: a whole number from 1 to MAX_MONTHLY_QUOTES, else no limit. */
export function monthlyLimitOf(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= MAX_MONTHLY_QUOTES ? n : null
}

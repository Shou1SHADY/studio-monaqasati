// The printable quotation document (عرض السعر) — the pure half.
//
// A quotation's stored `amount` is, and stays, the NET total: sales orders,
// payments and the dashboard all read it that way. The document adds what a
// customer-facing offer must show — VAT, the gross total, what each
// installment comes to in money — without writing any of it back. VAT is
// computed the way sales orders compute it (net × vatPercent, rounded to
// halalas), so the figure on the PDF is the figure the order will bill.

import {
  quotationInstallments,
  quotationItemsTotal,
  type CrmContact,
  type CrmQuotation,
  type QuotationBranding,
  type QuotationInstallment,
  type QuotationItem,
} from "./crm"

/** KSA standard rate — the same default a sales order is created with. */
export const DEFAULT_QUOTATION_VAT_PERCENT = 15
/** How long a new quotation holds by default. */
export const DEFAULT_QUOTATION_VALIDITY_DAYS = 30

export const QUOTATION_LOGO_MAX_BYTES = 2 * 1024 * 1024
export const QUOTATION_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const
export const QUOTATION_LOGO_ACCEPT = QUOTATION_LOGO_TYPES.join(",")
/** Storage folder for letterhead logos: `quotation-branding/{orgId}/…`. */
export const QUOTATION_BRANDING_STORAGE_DIR = "quotation-branding"

const round2 = (n: number) => Math.round(n * 100) / 100

export const EMPTY_QUOTATION_BRANDING: QuotationBranding = {
  logoUrl: null,
  companyName: "",
  crNumber: "",
  vatNumber: "",
  address: "",
  phone: "",
  email: "",
  website: "",
}

/** A usable VAT rate: missing means the standard rate, anything outside
 * 0–100 (or not a number) falls back to it too. Zero is a real answer. */
export function normalizeVatPercent(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return DEFAULT_QUOTATION_VAT_PERCENT
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 100) return DEFAULT_QUOTATION_VAT_PERCENT
  return n
}

export interface QuotationDocumentLine extends QuotationItem {
  /** 1-based row number printed in the first column. */
  index: number
  total: number
}

export interface QuotationDocumentInstallment {
  id: string
  label: string
  percent: number
  /** Share of the GROSS total — what the customer actually transfers. */
  amount: number
}

export interface QuotationDocumentTotals {
  lines: QuotationDocumentLine[]
  /** Net — equals the quotation's stored `amount`. */
  subtotal: number
  vatPercent: number
  vat: number
  total: number
  schedule: QuotationDocumentInstallment[]
}

/**
 * Everything the document prints as money. Without item lines the quotation
 * is a lump sum and `amount` is the subtotal. Installment amounts are shares of
 * the VAT-inclusive total (a deposit is invoiced with its VAT); when the
 * schedule covers 100% the last row absorbs the rounding so the rows add up
 * to the total exactly.
 */
export function quotationDocumentTotals(input: {
  items: QuotationItem[] | null | undefined
  amount: number | null | undefined
  vatPercent: number | string | null | undefined
  installments: QuotationInstallment[] | null | undefined
}): QuotationDocumentTotals {
  const items = input.items || []
  const lines = items.map((item, i) => ({ ...item, index: i + 1, total: round2(item.quantity * item.unitPrice) }))
  const subtotal = items.length > 0 ? quotationItemsTotal(items) : round2(Number(input.amount) || 0)
  const vatPercent = normalizeVatPercent(input.vatPercent)
  const vat = round2((subtotal * vatPercent) / 100)
  const total = round2(subtotal + vat)

  const plan = quotationInstallments({ installments: input.installments ?? null })
  const schedule = plan.map((inst) => ({
    id: inst.id,
    label: inst.label,
    percent: inst.percent,
    amount: round2((total * (Number(inst.percent) || 0)) / 100),
  }))
  const percentSum = plan.reduce((sum, i) => sum + (Number(i.percent) || 0), 0)
  if (schedule.length > 1 && Math.abs(percentSum - 100) < 0.01) {
    const others = schedule.slice(0, -1).reduce((sum, s) => sum + s.amount, 0)
    schedule[schedule.length - 1].amount = round2(total - others)
  }

  return { lines, subtotal, vatPercent, vat, total, schedule }
}

/** Document money: two decimals, Western digits, grouped — the way an
 * invoice or bank statement prints it. Wrap in `dir="ltr"`. */
export function formatDocumentMoney(value: number | null | undefined): string {
  const n = Number.isFinite(value as number) ? (value as number) : 0
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** A `YYYY-MM-DD` date (or ISO timestamp) as a Gregorian date with Western
 * digits in the locale's month names. Date-only values are read in UTC so a
 * viewer west of Greenwich never sees the day before. */
export function formatDocumentDate(value: string | null | undefined, locale: string): string {
  if (!value) return "—"
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  })
}

/** `YYYY-MM-DD` plus whole days. Returns "" for an unreadable start. */
export function addDaysToIsoDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(d.getTime())) return ""
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `date` to `validUntil`; null when either is missing or the
 * validity ends before the quotation starts. */
export function validityDaysBetween(date: string | null | undefined, validUntil: string | null | undefined): number | null {
  if (!date || !validUntil) return null
  const from = new Date(`${date}T00:00:00Z`).getTime()
  const to = new Date(`${validUntil}T00:00:00Z`).getTime()
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  const days = Math.round((to - from) / 86_400_000)
  return days >= 0 ? days : null
}

/** Why a picked logo file cannot be used, or null when it can. */
export function validateLogoFile(file: { type: string; size: number }): "type" | "size" | null {
  if (!(QUOTATION_LOGO_TYPES as readonly string[]).includes(file.type)) return "type"
  if (file.size > QUOTATION_LOGO_MAX_BYTES) return "size"
  return null
}

/** A Storage-safe object name that keeps the extension readable. */
export function logoStoragePath(orgId: string, fileName: string, now = Date.now()): string {
  const safe = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return `${QUOTATION_BRANDING_STORAGE_DIR}/${orgId}/${now}-${safe || "logo"}`
}

/** The letterhead a new quotation starts from: the active company's resolved
 * identity plus the org's remembered logo. Every field stays editable. */
export function brandingFromProfile(
  profile: Record<string, unknown> | null | undefined,
  input: { logoUrl?: string | null; email?: string | null; cityLabel?: (city: string) => string }
): QuotationBranding {
  const str = (key: string) => {
    const v = profile?.[key]
    return typeof v === "string" ? v.trim() : ""
  }
  const city = str("city")
  const cityLabel = city && input.cityLabel ? input.cityLabel(city) : city
  const location = str("location")
  const address = [location, cityLabel].filter(Boolean).filter((part, i, all) => all.indexOf(part) === i).join(" - ")
  return {
    logoUrl: input.logoUrl ?? null,
    companyName: str("companyName") || str("name"),
    crNumber: str("crNumber"),
    vatNumber: str("taxNumber"),
    address,
    phone: str("phone") || str("phoneNumber"),
    email: str("email") || (input.email ?? "").trim(),
    website: str("website"),
  }
}

/** The customer block printed on the document. */
export interface QuotationSheetCustomer {
  name: string | null
  company?: string | null
  phone?: string | null
  email?: string | null
  city?: string | null
  crNumber?: string | null
}

/** Everything `QuotationPdfSheet` renders — built live from the builder form,
 * or from a saved quotation for the detail page's download. */
export interface QuotationSheetData {
  quotationNumber: string
  date: string | null
  validUntil: string | null
  customer: QuotationSheetCustomer
  items: QuotationItem[] | null
  /** Net lump sum, used when there are no item lines. */
  amount: number
  vatPercent: number | string | null
  installments: QuotationInstallment[] | null
  terms: string | null
  notes: string | null
  branding: QuotationBranding
}

export function sheetCustomerFromContact(
  contact: Pick<CrmContact, "name" | "company" | "phone" | "email" | "city" | "crNumber"> | null | undefined,
  fallbackName: string | null | undefined
): QuotationSheetCustomer {
  const company = contact?.company?.trim() || null
  const name = contact?.name?.trim() || fallbackName || null
  return {
    name,
    company: company && company !== name ? company : null,
    phone: contact?.phone ?? null,
    email: contact?.email ?? null,
    city: contact?.city ?? null,
    crNumber: contact?.crNumber ?? null,
  }
}

/** A saved quotation as a printable document. Its own branding snapshot wins;
 * quotations from before documents existed print under the company's current
 * letterhead instead. The validity date falls back to date + validityDays. */
export function sheetDataFromQuotation(
  q: CrmQuotation,
  input: { fallbackBranding: QuotationBranding; contact?: CrmContact | null }
): QuotationSheetData {
  const validUntil =
    q.validUntil || (q.date && q.validityDays != null ? addDaysToIsoDate(q.date, q.validityDays) || null : null)
  return {
    quotationNumber: q.quotationNumber,
    date: q.date ?? null,
    validUntil,
    customer: sheetCustomerFromContact(input.contact, q.contactName),
    items: q.items && q.items.length > 0 ? q.items : null,
    amount: Number(q.amount) || 0,
    vatPercent: q.vatPercent ?? null,
    installments: q.installments ?? null,
    terms: q.terms ?? q.paymentTerms ?? null,
    notes: q.notes ?? null,
    branding: q.branding ?? input.fallbackBranding,
  }
}

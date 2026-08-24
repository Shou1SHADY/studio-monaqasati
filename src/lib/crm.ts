// Shared CRM model for BOTH portals. The contractor and supplier CRMs are the
// same three pages over the same collections — every document is scoped by
// `organizationId`, so a contractor org and a supplier org never see each
// other's records even though they share the collection.
//
// Storage layout (all top-level, all org-scoped):
//   crmContacts      — the leads/contacts themselves
//   crmOpportunities — deals, `contactId` back-references a contact
//   crmQuotations    — quotes, `contactId` back-references a contact
//
// Opportunities and quotations used to be SUBcollections of `crmContacts`,
// which made them unqueryable org-wide without a collection-group index (the
// codebase deliberately avoids those). They are top-level now so the
// Opportunities page can list every deal in one query.
// `scripts/migrate-crm-subcollections.ts` moves legacy documents over.

export type ContactType = "client" | "supplier" | "partner" | "other"
export type EntityType = "individual" | "company"
export type LeadStatus = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost"
export type LeadSource = "referral" | "website" | "cold_call" | "event" | "social_media" | "other"

export const CRM_CONTACTS = "crmContacts"
export const CRM_OPPORTUNITIES = "crmOpportunities"
export const CRM_QUOTATIONS = "crmQuotations"

export interface CrmContact {
  id: string
  name: string
  type: ContactType
  entityType?: EntityType
  company?: string | null
  phone?: string | null
  email?: string | null
  status?: LeadStatus
  source?: LeadSource
  ownerId?: string | null
  ownerName?: string | null
  notes?: string | null
  organizationId: string
  createdAt?: unknown
  updatedAt?: unknown
}

export const CONTACT_TYPES: ContactType[] = ["client", "supplier", "partner", "other"]
export const ENTITY_TYPES: EntityType[] = ["individual", "company"]
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "proposal", "won", "lost"]
export const LEAD_SOURCES: LeadSource[] = ["referral", "website", "cold_call", "event", "social_media", "other"]

/** Statuses that are still in play — everything that is neither won nor lost. */
export const OPEN_LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "proposal"]

export const TYPE_BADGE_CLASS: Record<ContactType, string> = {
  client: "bg-cta/10 text-cta border-cta/20",
  supplier: "bg-accent/10 text-accent border-accent/20",
  partner: "bg-success/10 text-success border-success/20",
  other: "bg-muted text-muted-foreground border-border",
}

export const STATUS_BADGE_CLASS: Record<LeadStatus, string> = {
  new: "bg-cta/10 text-cta border-cta/20",
  contacted: "bg-accent/10 text-accent border-accent/20",
  qualified: "bg-warning/10 text-warning border-warning/20",
  proposal: "bg-warning/10 text-warning border-warning/20",
  won: "bg-success/10 text-success border-success/20",
  lost: "bg-destructive/10 text-destructive border-destructive/20",
}

export type OpportunityStage = "new" | "qualified" | "proposal" | "negotiation" | "won" | "lost"
export const OPPORTUNITY_STAGES: OpportunityStage[] = ["new", "qualified", "proposal", "negotiation", "won", "lost"]

/** The stages a deal moves THROUGH — the board renders these as columns, with
 * won/lost shown as a summary rail instead of two ever-growing columns. */
export const OPEN_OPPORTUNITY_STAGES: OpportunityStage[] = ["new", "qualified", "proposal", "negotiation"]

export const OPPORTUNITY_STAGE_BADGE_CLASS: Record<OpportunityStage, string> = {
  new: "bg-cta/10 text-cta border-cta/20",
  qualified: "bg-accent/10 text-accent border-accent/20",
  proposal: "bg-warning/10 text-warning border-warning/20",
  negotiation: "bg-warning/10 text-warning border-warning/20",
  won: "bg-success/10 text-success border-success/20",
  lost: "bg-destructive/10 text-destructive border-destructive/20",
}

/** Column accent for the pipeline board — the top rule of each stage column. */
export const OPPORTUNITY_STAGE_BAR_CLASS: Record<OpportunityStage, string> = {
  new: "bg-cta",
  qualified: "bg-accent",
  proposal: "bg-warning",
  negotiation: "bg-warning",
  won: "bg-success",
  lost: "bg-destructive",
}

export interface CrmOpportunity {
  id: string
  contactId: string
  /** Denormalised so the org-wide list renders without an N+1 contact read.
   * Kept in sync when the contact is renamed (see `renameContactReferences`). */
  contactName?: string | null
  title: string
  stage: OpportunityStage
  value: number
  expectedCloseDate?: string | null
  notes?: string | null
  ownerId?: string | null
  ownerName?: string | null
  /** Set when the deal is tracking a real platform RFQ. */
  rfqId?: string | null
  rfqTitle?: string | null
  organizationId: string
  createdAt?: unknown
  updatedAt?: unknown
}

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected"
export const QUOTATION_STATUSES: QuotationStatus[] = ["draft", "sent", "accepted", "rejected"]
export const QUOTATION_STATUS_BADGE_CLASS: Record<QuotationStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  sent: "bg-cta/10 text-cta border-cta/20",
  accepted: "bg-success/10 text-success border-success/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
}

export interface CrmQuotation {
  id: string
  contactId: string
  contactName?: string | null
  quotationNumber: string
  amount: number
  status: QuotationStatus
  date?: string | null
  notes?: string | null
  organizationId: string
  createdAt?: unknown
  updatedAt?: unknown
}

export function generateQuotationNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let suffix = ""
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
  return `Q-${suffix}`
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Money always renders LTR with grouped digits — Arabic uses Western digits
 * here on purpose, because procurement figures are read against invoices and
 * bank statements that use them. Wrap the output in `dir="ltr"`. */
export function formatSar(value: number | null | undefined, locale: string): string {
  const n = Number.isFinite(value as number) ? (value as number) : 0
  const formatted = n.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return locale === "ar" ? `${formatted} ر.س` : `SAR ${formatted}`
}

/** Compact money for stat tiles, where a 9-digit pipeline total would wrap. */
export function formatSarCompact(value: number | null | undefined, locale: string): string {
  const n = Number.isFinite(value as number) ? (value as number) : 0
  const abs = Math.abs(n)
  const compact =
    abs >= 1_000_000
      ? `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
      : abs >= 10_000
        ? `${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`
        : n.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return locale === "ar" ? `${compact} ر.س` : `SAR ${compact}`
}

/** Firestore Timestamp | ISO string | millis -> Date, or null when unset. */
export function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const d = (value as { toDate: () => Date }).toDate()
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * One date format for the whole CRM. Arabic uses `-u-nu-latn` so digits stay
 * Western, matching `formatSar` — a row that mixed "متبقٍ 7 يوم" with
 * "٣١ أغسطس ٢٠٢٦" made the same line read in two numeral systems at once.
 * Every CRM date goes through here; never render a raw ISO string.
 */
export function formatCrmDate(value: unknown, locale: string): string {
  const d = toDate(value)
  if (!d) return "—"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/** Whole days from today until `value`. Negative once the date has passed. */
export function daysUntil(value: unknown): number | null {
  const d = toDate(value)
  if (!d) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

// ---------------------------------------------------------------------------
// Pipeline aggregation — shared by the leads, opportunities and RFQ pages so
// the same number never gets computed two slightly different ways.
// ---------------------------------------------------------------------------

export interface PipelineSummary {
  total: number
  open: number
  won: number
  lost: number
  /** Value of everything still in play. */
  openValue: number
  wonValue: number
  /** won / (won + lost), 0 when nothing has closed yet. */
  winRate: number
  avgDealValue: number
}

export function summarizeOpportunities(opportunities: CrmOpportunity[]): PipelineSummary {
  let open = 0
  let won = 0
  let lost = 0
  let openValue = 0
  let wonValue = 0

  for (const opp of opportunities) {
    const value = Number.isFinite(opp.value) ? opp.value : 0
    if (opp.stage === "won") {
      won++
      wonValue += value
    } else if (opp.stage === "lost") {
      lost++
    } else {
      open++
      openValue += value
    }
  }

  const closed = won + lost
  return {
    total: opportunities.length,
    open,
    won,
    lost,
    openValue,
    wonValue,
    winRate: closed === 0 ? 0 : Math.round((won / closed) * 100),
    avgDealValue: won === 0 ? 0 : Math.round(wonValue / won),
  }
}

export interface LeadSummary {
  total: number
  open: number
  won: number
  lost: number
  winRate: number
}

export function summarizeLeads(contacts: CrmContact[]): LeadSummary {
  let won = 0
  let lost = 0
  for (const c of contacts) {
    if (c.status === "won") won++
    else if (c.status === "lost") lost++
  }
  const closed = won + lost
  return {
    total: contacts.length,
    open: contacts.length - won - lost,
    won,
    lost,
    winRate: closed === 0 ? 0 : Math.round((won / closed) * 100),
  }
}

/** Free-text match across every field a user would plausibly type. */
export function contactMatchesSearch(contact: CrmContact, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return [contact.name, contact.company, contact.phone, contact.email, contact.ownerName]
    .some((field) => (field || "").toLowerCase().includes(q))
}

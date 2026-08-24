// Shared CRM contact/lead model — used by both the contact list page and the
// contact detail page (opportunities + quotations live there).

export type ContactType = "client" | "supplier" | "partner" | "other"
export type EntityType = "individual" | "company"
export type LeadStatus = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost"
export type LeadSource = "referral" | "website" | "cold_call" | "event" | "social_media" | "other"

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
}

export const CONTACT_TYPES: ContactType[] = ["client", "supplier", "partner", "other"]
export const ENTITY_TYPES: EntityType[] = ["individual", "company"]
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "proposal", "won", "lost"]
export const LEAD_SOURCES: LeadSource[] = ["referral", "website", "cold_call", "event", "social_media", "other"]

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
export const OPPORTUNITY_STAGE_BADGE_CLASS: Record<OpportunityStage, string> = {
  new: "bg-cta/10 text-cta border-cta/20",
  qualified: "bg-accent/10 text-accent border-accent/20",
  proposal: "bg-warning/10 text-warning border-warning/20",
  negotiation: "bg-warning/10 text-warning border-warning/20",
  won: "bg-success/10 text-success border-success/20",
  lost: "bg-destructive/10 text-destructive border-destructive/20",
}

export interface CrmOpportunity {
  id: string
  title: string
  stage: OpportunityStage
  value: number
  expectedCloseDate?: string | null
  notes?: string | null
  organizationId: string
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
  quotationNumber: string
  amount: number
  status: QuotationStatus
  date?: string | null
  notes?: string | null
  organizationId: string
}

export function generateQuotationNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let suffix = ""
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
  return `Q-${suffix}`
}

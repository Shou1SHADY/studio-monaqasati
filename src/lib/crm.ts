// Shared CRM model for BOTH portals. The contractor and supplier CRMs are the
// same pages over the same collections — every document is scoped by
// `organizationId`, so a contractor org and a supplier org never see each
// other's records even though they share the collection.
//
// Storage layout (all top-level, all org-scoped):
//   crmContacts      — the leads/contacts themselves
//   crmOpportunities — deals, `contactId` back-references a contact
//   crmQuotations    — offer versions, `opportunityId` back-references a deal
//   crmActivities    — calls, meetings, site visits, tasks and emails
//
// Opportunities and quotations used to be SUBcollections of `crmContacts`,
// which made them unqueryable org-wide without a collection-group index (the
// codebase deliberately avoids those). They are top-level now so the
// Opportunities page can list every deal in one query.
// `scripts/migrate-crm-subcollections.ts` moves legacy documents over.

export type ContactType = "client" | "supplier" | "partner" | "other"
export type EntityType = "individual" | "company"
/**
 * What kind of body this party is. Distinct from `type` (which says how we
 * relate to them) because a government authority and a private developer are
 * the same "client" but behave nothing alike — they publish differently, pay
 * differently, and demand different classifications.
 */
export type PartyType =
  | "government"
  | "semi_government"
  | "developer"
  | "private"
  | "main_contractor"
  | "endowment"
  | "individual"
/**
 * How we work with a party. Multi-valued on purpose: the same company is
 * routinely a client on one job and the main contractor we subcontract for on
 * another, and forcing a single value makes one of those records a lie.
 */
export type PartyRole = "client" | "main_contractor" | "consultant" | "supplier"
export type LeadStatus = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost"
export type LeadSource = "referral" | "website" | "cold_call" | "event" | "social_media" | "other"
/** Commercial standing of the relationship — drives nothing automatically, but
 * sorts and colours the leads list so the important accounts surface first. */
export type ContactTier = "A" | "B" | "C"

export const CRM_CONTACTS = "crmContacts"
export const CRM_OPPORTUNITIES = "crmOpportunities"
export const CRM_QUOTATIONS = "crmQuotations"
export const CRM_ACTIVITIES = "crmActivities"

/** One human at a party. Parties are organizations; work happens with people. */
export interface ContactPerson {
  name: string
  title?: string | null
  phone?: string | null
  email?: string | null
}

export interface CrmContact {
  id: string
  name: string
  type: ContactType
  entityType?: EntityType
  /** What kind of body this is. Absent on records written before it existed. */
  partyType?: PartyType | null
  /** Every way we work with them. Defaults to `["client"]` when absent. */
  roles?: PartyRole[]
  /** The people we actually deal with. The top-level `phone`/`email` stay as
   * the party's switchboard; these are named individuals. */
  people?: ContactPerson[]
  company?: string | null
  phone?: string | null
  email?: string | null
  status?: LeadStatus
  source?: LeadSource
  ownerId?: string | null
  ownerName?: string | null
  notes?: string | null
  /** Commercial profile — optional, filled in as the relationship matures. */
  city?: string | null
  crNumber?: string | null
  tier?: ContactTier
  /** 0–100, captured from a satisfaction survey after each engagement. */
  satisfaction?: number | null
  /** Average days this party actually takes to pay. 30 or under is on-terms. */
  paymentDays?: number | null
  /** Currently-overdue receivable, in SAR. */
  overdueAmount?: number | null
  organizationId: string
  createdAt?: unknown
  updatedAt?: unknown
}

export const CONTACT_TYPES: ContactType[] = ["client", "supplier", "partner", "other"]
export const ENTITY_TYPES: EntityType[] = ["individual", "company"]
export const PARTY_TYPES: PartyType[] = [
  "government",
  "semi_government",
  "developer",
  "private",
  "main_contractor",
  "endowment",
  "individual",
]
export const PARTY_ROLES: PartyRole[] = ["client", "main_contractor", "consultant", "supplier"]

/** A party with no roles recorded is a client — that is what the CRM was for
 * before roles existed, and it keeps legacy records rendering sensibly. */
export function partyRoles(contact: Pick<CrmContact, "roles">): PartyRole[] {
  return contact.roles && contact.roles.length > 0 ? contact.roles : ["client"]
}

export function contactPeople(contact: Pick<CrmContact, "people">): ContactPerson[] {
  return Array.isArray(contact.people) ? contact.people.filter((p) => p && p.name) : []
}
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "proposal", "won", "lost"]
export const LEAD_SOURCES: LeadSource[] = ["referral", "website", "cold_call", "event", "social_media", "other"]
export const CONTACT_TIERS: ContactTier[] = ["A", "B", "C"]

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

export const TIER_BADGE_CLASS: Record<ContactTier, string> = {
  A: "bg-success/10 text-success border-success/20",
  B: "bg-cta/10 text-cta border-cta/20",
  C: "bg-muted text-muted-foreground border-border",
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

// ---------------------------------------------------------------------------
// Tracks
//
// A public tender, a direct quotation and a contract renewal are three
// different sales cycles wearing the same word "opportunity". They share the
// four open stages above so the board stays one board, but each carries its
// own checklist (gates) and its own meaning for the key date: a tender's date
// is the bid deadline, a quotation's is how long the offer stays valid, and a
// renewal's is when the live contract expires.
// ---------------------------------------------------------------------------

export type OpportunityTrack = "tender" | "quotation" | "renewal"
export const OPPORTUNITY_TRACKS: OpportunityTrack[] = ["tender", "quotation", "renewal"]

// ---------------------------------------------------------------------------
// Deal taxonomy
//
// What the work IS, how it was put to market, and how it will be contracted.
// These are separate axes on purpose: a residential compound can arrive as an
// open tender on a lump-sum basis or as a direct award on unit prices, and
// collapsing them into one "type" field loses the distinction that decides
// whether we can even bid.
// ---------------------------------------------------------------------------

export type ScopeType =
  | "residential"
  | "commercial"
  | "offices"
  | "industrial"
  | "healthcare"
  | "education"
  | "infrastructure"
  | "renovation"
  | "fitout"
  | "mep"
  | "facilities"

export const SCOPE_TYPES: ScopeType[] = [
  "residential",
  "commercial",
  "offices",
  "industrial",
  "healthcare",
  "education",
  "infrastructure",
  "renovation",
  "fitout",
  "mep",
  "facilities",
]

/** The contractor-classification activity a scope of work falls under. This is
 * the axis Saudi classification certificates are issued on, so it — not the
 * project type — decides which grade a bid is judged against. */
export type ClassificationActivity = "buildings" | "roads" | "mep" | "maintenance"
export const CLASSIFICATION_ACTIVITIES: ClassificationActivity[] = ["buildings", "roads", "mep", "maintenance"]

export const SCOPE_ACTIVITY: Record<ScopeType, ClassificationActivity> = {
  residential: "buildings",
  commercial: "buildings",
  offices: "buildings",
  industrial: "buildings",
  healthcare: "buildings",
  education: "buildings",
  infrastructure: "roads",
  renovation: "maintenance",
  fitout: "buildings",
  mep: "mep",
  facilities: "maintenance",
}

/** How the work was put to market. */
export type TenderRoute = "open_tender" | "invitation" | "negotiated" | "direct_award" | "subcontract"
export const TENDER_ROUTES: TenderRoute[] = [
  "open_tender",
  "invitation",
  "negotiated",
  "direct_award",
  "subcontract",
]

/** How it will be priced and contracted. */
export type ContractKind = "lump_sum" | "unit_price" | "cost_plus" | "framework"
export const CONTRACT_KINDS: ContractKind[] = ["lump_sum", "unit_price", "cost_plus", "framework"]

/** Where the deal came from. Deliberately separate from a contact's `source`,
 * which describes how the RELATIONSHIP started — a ten-year client can still
 * bring a deal that arrived through a public tender portal. */
export type OpportunitySource =
  | "open_tender"
  | "invitation"
  | "existing_client"
  | "referral"
  | "main_contractor"
  | "direct_outreach"
  | "whatsapp"
  | "event"

export const OPPORTUNITY_SOURCES: OpportunitySource[] = [
  "open_tender",
  "invitation",
  "existing_client",
  "referral",
  "main_contractor",
  "direct_outreach",
  "whatsapp",
  "event",
]

export const TRACK_BADGE_CLASS: Record<OpportunityTrack, string> = {
  tender: "bg-primary/10 text-primary border-primary/20",
  quotation: "bg-cta/10 text-cta border-cta/20",
  renewal: "bg-accent/10 text-accent border-accent/20",
}

/**
 * A checklist item that must be satisfied before a deal leaves its stage.
 *
 * `auto` gates are not checkboxes — they read the record itself, so a user can
 * never tick "cost recorded" without recording a cost. `module` marks the ones
 * whose real work happens in another part of the platform; the CRM only tracks
 * that it happened.
 */
export interface OpportunityGate {
  id: string
  auto?: "estimate" | "cost" | "submitted_approved" | "fit"
  module?: "finance" | "procurement" | "projects"
}

/** Gate label lives in `messages/*.json` under this key. */
export function gateLabelKey(gate: OpportunityGate): string {
  return `crm_gate_${gate.id}`
}

const TENDER_GATES: Partial<Record<OpportunityStage, OpportunityGate[]>> = {
  new: [
    { id: "bid_docs" },
    { id: "estimate", auto: "estimate" },
    { id: "fit", auto: "fit" },
    { id: "go_no_go" },
  ],
  qualified: [{ id: "boq_priced" }, { id: "cost", auto: "cost" }, { id: "margin_approved" }],
  proposal: [{ id: "bid_bond", module: "finance" }, { id: "submitted", auto: "submitted_approved" }],
  negotiation: [{ id: "clarifications" }, { id: "final_price" }],
}

const QUOTATION_GATES: Partial<Record<OpportunityStage, OpportunityGate[]>> = {
  new: [{ id: "scope_captured" }, { id: "estimate", auto: "estimate" }],
  qualified: [{ id: "cost", auto: "cost" }],
  proposal: [{ id: "submitted", auto: "submitted_approved" }],
  negotiation: [{ id: "discount_answered" }],
}

const RENEWAL_GATES: Partial<Record<OpportunityStage, OpportunityGate[]>> = {
  new: [{ id: "performance_review", module: "projects" }, { id: "satisfaction_captured" }],
  qualified: [{ id: "cost", auto: "cost" }],
  proposal: [{ id: "submitted", auto: "submitted_approved" }],
  negotiation: [{ id: "renewal_feedback" }],
}

export const OPPORTUNITY_GATES: Record<OpportunityTrack, Partial<Record<OpportunityStage, OpportunityGate[]>>> = {
  tender: TENDER_GATES,
  quotation: QUOTATION_GATES,
  renewal: RENEWAL_GATES,
}

/** Translation key for what the key date means on this track. */
export function trackDateLabelKey(track: OpportunityTrack): string {
  return `crm_track_date_${track}`
}

// ---------------------------------------------------------------------------
// Outcome state
//
// `stage` says where a deal sits in the pipeline; `state` says what happened to
// it. They are separate because "awarded but not yet handed over to Projects"
// and "handed over" are both stage `won`, and because a deal parked on hold
// keeps its stage so it can be reactivated exactly where it stopped.
// ---------------------------------------------------------------------------

export type OpportunityState = "open" | "won" | "handed_over" | "lost" | "on_hold"
export const OPPORTUNITY_STATES: OpportunityState[] = ["open", "won", "handed_over", "lost", "on_hold"]

export const OPPORTUNITY_STATE_BADGE_CLASS: Record<OpportunityState, string> = {
  open: "bg-cta/10 text-cta border-cta/20",
  won: "bg-success/10 text-success border-success/20",
  handed_over: "bg-primary/10 text-primary border-primary/20",
  lost: "bg-destructive/10 text-destructive border-destructive/20",
  on_hold: "bg-warning/10 text-warning border-warning/20",
}

export type LostReason =
  | "price"
  | "classification"
  | "track_record"
  | "duration"
  | "withdrew_capacity"
  | "withdrew_terms"
  | "client_cancelled"
  | "no_reason"

export const LOST_REASONS: LostReason[] = [
  "price",
  "classification",
  "track_record",
  "duration",
  "withdrew_capacity",
  "withdrew_terms",
  "client_cancelled",
  "no_reason",
]

export type HoldReason = "client_postponed" | "awaiting_funding" | "awaiting_documents" | "our_capacity"
export const HOLD_REASONS: HoldReason[] = [
  "client_postponed",
  "awaiting_funding",
  "awaiting_documents",
  "our_capacity",
]

/**
 * Why we won. Recorded at award time, next to the awarded value, because a
 * pipeline that only explains its losses teaches half a lesson.
 */
export type WonReason = "price" | "relationship" | "quality" | "speed" | "sole_bidder" | "other"
export const WON_REASONS: WonReason[] = ["price", "relationship", "quality", "speed", "sole_bidder", "other"]

export type ApprovalStatus = "none" | "pending" | "approved"

// ---------------------------------------------------------------------------
// Handover to Projects
//
// A won deal is not a project until a project manager has agreed to run it.
// The handover therefore carries its own status, mirrored on the project
// document (where the PM acts on it) and summarised on the opportunity.
// ---------------------------------------------------------------------------

export type HandoverStatus = "pending" | "accepted" | "rejected"

export const HANDOVER_BADGE_CLASS: Record<HandoverStatus, string> = {
  pending: "bg-warning/10 text-warning border-warning/20",
  accepted: "bg-success/10 text-success border-success/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
}

/** Stored on `projects/{id}.handover`. */
export interface ProjectHandover {
  status: HandoverStatus
  /** The project manager asked to take the project. */
  pmId: string
  pmName?: string | null
  /** Who handed it over, so a rejection has somewhere to go back to. */
  requestedByUserId?: string | null
  requestedByName?: string | null
  /** ISO strings — this object lives inside a map, where server timestamps
   * are fine, but the client also reads it back synchronously. */
  requestedAt: string
  respondedAt?: string | null
  rejectReason?: string | null
  /** The opportunity this project came from. */
  opportunityId?: string | null
}

// ---------------------------------------------------------------------------
// Audit trail and addenda
// ---------------------------------------------------------------------------

/** What a history entry records. Stages plus the terminal moves that are not
 * stages — a deal being handed over, parked, or brought back. */
export type HistoryEvent =
  | OpportunityStage
  | "handed_over"
  | "handover_accepted"
  | "handover_rejected"
  | "on_hold"
  | "reactivated"

export interface StageHistoryEntry {
  event: HistoryEvent
  /** ISO date string. NOT a server timestamp — Firestore rejects
   * `serverTimestamp()` inside an array element, and every history entry is
   * appended to an array. */
  at: string
  byName?: string | null
}

/**
 * A change the client issued after publishing the bid documents. Addenda move
 * the deadline and revise quantities, and a tender where nobody logged them is
 * a tender priced against the wrong drawings.
 */
export interface Addendum {
  number: number
  at: string
  note: string
  /** The deadline as it stands after this addendum. */
  newDate?: string | null
  /** The estimate as it stands after this addendum. */
  newValue?: number | null
}

/** Append-ready history entry for right now. */
export function historyEntry(event: HistoryEvent, byName?: string | null): StageHistoryEntry {
  return { event, at: new Date().toISOString(), byName: byName || null }
}

export function stageHistory(opp: Pick<CrmOpportunity, "stageHistory">): StageHistoryEntry[] {
  return Array.isArray(opp.stageHistory) ? opp.stageHistory : []
}

export function opportunityAddenda(opp: Pick<CrmOpportunity, "addenda">): Addendum[] {
  return Array.isArray(opp.addenda) ? opp.addenda : []
}

export interface CrmOpportunity {
  id: string
  contactId: string
  /** Denormalised so the org-wide list renders without an N+1 contact read.
   * Kept in sync when the contact is renamed (see `renameContactReferences`). */
  contactName?: string | null
  title: string
  stage: OpportunityStage
  /** Which sales cycle this is. Defaults to `tender` for records written
   * before tracks existed — see `opportunityTrack`. */
  track?: OpportunityTrack
  /** Where the deal actually stands. Absent on legacy records; derive it with
   * `opportunityState` rather than reading this field directly. */
  state?: OpportunityState

  // --- what the work is, and how it reached us --------------------------
  /** All scopes that apply. The FIRST is primary and drives which
   * classification activity the bid is judged against. */
  scopeTypes?: ScopeType[]
  /** Free text a user typed under "Other" — surfaced in CRM settings so an
   * admin can fold it into the official list instead of it rotting here. */
  customScopeType?: string | null
  /** Classification activity to use when the custom scope does not map. */
  customScopeActivity?: ClassificationActivity | null
  route?: TenderRoute | null
  contractKind?: ContractKind | null
  source?: OpportunitySource | null
  /** The supervising office, when there is one. Points at another contact. */
  consultantContactId?: string | null
  consultantName?: string | null

  // --- value ladder -------------------------------------------------------
  /** Step 1 — the initial estimate. This is the long-standing `value` field:
   * every pipeline total is built on it, so it keeps its name. */
  value: number
  /** Step 2 — approved cost from the technical office (direct + indirect). */
  approvedCost?: number | null
  /** Step 3 — what was actually sent to the client. */
  submittedPrice?: number | null
  /** Step 4 — what was actually awarded. May be less than submitted. */
  awardedValue?: number | null

  /** 0–100. Drives the weighted pipeline; a deal with no estimate contributes
   * nothing regardless of how confident anyone feels about it. */
  probability?: number | null

  expectedCloseDate?: string | null
  notes?: string | null
  ownerId?: string | null
  ownerName?: string | null

  /** Ids of the manually-ticked gates. Auto gates are never stored here. */
  completedGates?: string[]

  /** Append-only audit trail — every stage move and outcome, with who and when. */
  stageHistory?: StageHistoryEntry[]
  /** Client-issued changes after publication. Tender track only in practice. */
  addenda?: Addendum[]

  // --- price approval -----------------------------------------------------
  approvalStatus?: ApprovalStatus
  approvalAmount?: number | null
  approvedByName?: string | null

  // --- outcome ------------------------------------------------------------
  /** Why we won — required at award time. */
  wonReason?: WonReason | null
  wonNote?: string | null
  lostReason?: LostReason | null
  lostToCompetitor?: string | null
  competitorPrice?: number | null
  lessonLearned?: string | null
  holdReason?: HoldReason | null
  holdUntil?: string | null
  bidderCount?: number | null
  ourRank?: number | null

  // --- handover to Projects ----------------------------------------------
  /** Set once this deal has generated a project. Its presence is what makes
   * the handover irreversible, and what the "open project" link follows. */
  projectId?: string | null
  contractNumber?: string | null
  durationMonths?: number | null
  advancePercent?: number | null
  retentionPercent?: number | null
  projectManagerId?: string | null
  projectManagerName?: string | null
  handedOverAt?: unknown
  /** Mirror of `projects/{projectId}.handover.status`, so the pipeline can
   * show "waiting for the PM" without reading every project. */
  handoverStatus?: HandoverStatus | null
  handoverRejectReason?: string | null

  // --- renewals -----------------------------------------------------------
  /** For a renewal-track deal: the handed-over deal whose contract is expiring.
   * Its presence is what stops that contract being flagged as at risk. */
  renewalOfOpportunityId?: string | null
  /** Value of the contract being renewed, so the uplift is visible. */
  previousContractValue?: number | null

  organizationId: string
  createdAt?: unknown
  updatedAt?: unknown
}

/** Records written before tracks existed are tenders — that was the only
 * cycle the CRM modelled, and it is the safest default for the gate list. */
export function opportunityTrack(opp: Pick<CrmOpportunity, "track">): OpportunityTrack {
  return opp.track && OPPORTUNITY_TRACKS.includes(opp.track) ? opp.track : "tender"
}

/**
 * Where the deal stands. Legacy records carry no `state`, so it is inferred
 * from the stage — which is exactly what the old UI did implicitly.
 */
export function opportunityState(opp: Pick<CrmOpportunity, "state" | "stage" | "projectId">): OpportunityState {
  if (opp.state && OPPORTUNITY_STATES.includes(opp.state)) return opp.state
  if (opp.projectId) return "handed_over"
  if (opp.stage === "won") return "won"
  if (opp.stage === "lost") return "lost"
  return "open"
}

/** Still in play: neither closed nor parked. */
export function isOpportunityOpen(opp: Pick<CrmOpportunity, "state" | "stage" | "projectId">): boolean {
  return opportunityState(opp) === "open"
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export function gatesForStage(track: OpportunityTrack, stage: OpportunityStage): OpportunityGate[] {
  return OPPORTUNITY_GATES[track][stage] || []
}

export function opportunityGates(opp: CrmOpportunity): OpportunityGate[] {
  return gatesForStage(opportunityTrack(opp), opp.stage)
}

/**
 * Extra state an auto gate may need to answer for itself. Only the `fit` gate
 * uses it today; it is optional everywhere so a caller that has not loaded the
 * company profile still gets a sensible (permissive) answer rather than a
 * blocked pipeline.
 */
export interface GateContext {
  profile?: CrmOrgProfile | null
}

export function isGateDone(opp: CrmOpportunity, gate: OpportunityGate, ctx?: GateContext): boolean {
  switch (gate.auto) {
    case "estimate":
      return (opp.value || 0) > 0
    case "cost":
      return (opp.approvedCost || 0) > 0
    case "submitted_approved":
      return (opp.submittedPrice || 0) > 0 && (opp.approvalStatus || "none") === "approved"
    case "fit": {
      // Unconfigured profile means the question was never set up, and an
      // unasked question must not hold a deal hostage.
      if (!ctx?.profile) return true
      return checkEligibility(opp, ctx.profile).eligible && fitsCapacity(opp, ctx.profile)
    }
    default:
      return (opp.completedGates || []).includes(gate.id)
  }
}

export function gatesRemaining(opp: CrmOpportunity, ctx?: GateContext): OpportunityGate[] {
  return opportunityGates(opp).filter((gate) => !isGateDone(opp, gate, ctx))
}

/** The stage after this one on this deal's track, or null at the end. */
export function nextStage(opp: CrmOpportunity): OpportunityStage | null {
  const index = OPEN_OPPORTUNITY_STAGES.indexOf(opp.stage)
  if (index === -1) return null
  return OPEN_OPPORTUNITY_STAGES[index + 1] ?? "won"
}

export function canAdvanceStage(opp: CrmOpportunity, ctx?: GateContext): boolean {
  return isOpportunityOpen(opp) && gatesRemaining(opp, ctx).length === 0 && nextStage(opp) !== null
}

/** Why a generic stage move is refused. `null` means it is allowed. */
export type StageMoveBlock =
  /** The deal is not open (won, lost, parked, handed over). */
  | "closed"
  /** Won and lost are outcomes recorded from inside the record, never a column. */
  | "terminal"
  /** Moving forward while this stage's checklist is incomplete. */
  | "gates"
  /** Jumping more than one stage ahead. */
  | "skip"
  /** Already there. */
  | "same"

/**
 * The ONE rule for moving a deal between pipeline columns, shared by the board,
 * the table and anything else that offers a stage picker.
 *
 * A move is legal when it is one step forward with every gate of the current
 * stage satisfied, or any number of steps backward (a deal can always be
 * demoted — a wrongly ticked gate is not a reason to strand it). Won and lost
 * are never reachable this way: they go through the award and close dialogs,
 * which insist on a value and a reason.
 */
export function stageMoveBlock(
  opp: CrmOpportunity,
  target: OpportunityStage,
  ctx?: GateContext
): StageMoveBlock | null {
  if (target === opp.stage) return "same"
  if (!isOpportunityOpen(opp)) return "closed"
  if (target === "won" || target === "lost") return "terminal"
  const from = OPEN_OPPORTUNITY_STAGES.indexOf(opp.stage)
  const to = OPEN_OPPORTUNITY_STAGES.indexOf(target)
  if (from === -1 || to === -1) return "closed"
  if (to < from) return null
  if (to > from + 1) return "skip"
  return gatesRemaining(opp, ctx).length === 0 ? null : "gates"
}

export function canMoveToStage(opp: CrmOpportunity, target: OpportunityStage, ctx?: GateContext): boolean {
  return stageMoveBlock(opp, target, ctx) === null
}

// ---------------------------------------------------------------------------
// Value ladder
// ---------------------------------------------------------------------------

/** Gross margin on the submitted price, as a percentage to one decimal.
 * Null until both a cost and a submitted price exist — a margin computed
 * against an estimate is a guess wearing a percentage sign. */
export function opportunityMargin(opp: CrmOpportunity): number | null {
  const cost = opp.approvedCost || 0
  const price = opp.submittedPrice || 0
  if (cost <= 0 || price <= 0) return null
  return Math.round(((price - cost) / price) * 1000) / 10
}

/** The most committed figure this deal has — awarded beats submitted beats
 * estimate. Used wherever "what is this deal worth" needs one number. */
export function opportunityBestValue(opp: CrmOpportunity): number {
  return opp.awardedValue || opp.submittedPrice || opp.value || 0
}

/** True when the client awarded less than we offered. */
export function isPartialAward(opp: CrmOpportunity): boolean {
  const awarded = opp.awardedValue || 0
  const submitted = opp.submittedPrice || 0
  return awarded > 0 && submitted > 0 && awarded < submitted
}

// ---------------------------------------------------------------------------
// Eligibility and capacity
//
// Two questions that decide whether a deal is worth pursuing at all, and that
// no amount of sales effort can override: are we classified high enough to be
// allowed to bid, and do we have the capacity left to deliver it.
//
// The company profile behind them is CRM-owned (`crmOrgProfile/{orgId}`) so
// this module answers both without reaching into Projects or Finance.
// ---------------------------------------------------------------------------

export const CRM_ORG_PROFILE = "crmOrgProfile"

/** Saudi contractor classification: grade 1 is the highest, 5 the lowest.
 * `null` means we hold no certificate in that activity at all. */
export type ClassificationGrade = 1 | 2 | 3 | 4 | 5
export const CLASSIFICATION_GRADES: ClassificationGrade[] = [1, 2, 3, 4, 5]

export interface CrmOrgProfile {
  id: string
  organizationId: string
  /** Grade held per activity. Missing key = not classified in that activity. */
  classifications?: Partial<Record<ClassificationActivity, ClassificationGrade>>
  /** Most work, in SAR, the company can carry in a year. */
  annualCeiling?: number | null
  /** Value already committed to work in progress, in SAR. Maintained here
   * rather than read from Projects — a CRM figure the owner controls beats a
   * derived one nobody can reconcile. */
  underExecution?: number | null
  updatedAt?: unknown
}

/**
 * The grade a deal of this size demands. Thresholds mirror the way public
 * tenders in Saudi scale the requirement with contract value; they are a
 * planning heuristic, not a legal test, and the bid documents always win.
 */
export function requiredGrade(value: number): ClassificationGrade {
  if (value >= 30_000_000) return 1
  if (value >= 15_000_000) return 2
  if (value >= 5_000_000) return 3
  return 4
}

/** Primary scope — the first one picked. Drives the classification check. */
export function primaryScope(opp: Pick<CrmOpportunity, "scopeTypes">): ScopeType | null {
  return opp.scopeTypes && opp.scopeTypes.length > 0 ? opp.scopeTypes[0] : null
}

/** Which classification activity this deal is judged under. */
export function opportunityActivity(
  opp: Pick<CrmOpportunity, "scopeTypes" | "customScopeActivity">
): ClassificationActivity | null {
  const scope = primaryScope(opp)
  if (scope) return SCOPE_ACTIVITY[scope]
  return opp.customScopeActivity || null
}

export interface EligibilityCheck {
  activity: ClassificationActivity | null
  /** Grade this deal demands. Null while there is no estimate to size it by. */
  required: ClassificationGrade | null
  /** Grade we hold in that activity. Null when we hold none. */
  held: ClassificationGrade | null
  /** True only when we hold a grade at least as high as the one required. */
  eligible: boolean
  /** Why the answer is not yet knowable, if it isn't. */
  unknown: "no_estimate" | "no_scope" | "no_profile" | null
}

export function checkEligibility(
  opp: Pick<CrmOpportunity, "value" | "scopeTypes" | "customScopeActivity">,
  profile: CrmOrgProfile | null | undefined
): EligibilityCheck {
  const activity = opportunityActivity(opp)
  const held = (activity && profile?.classifications?.[activity]) || null
  const base = { activity, required: null, held, eligible: false }

  if (!activity) return { ...base, unknown: "no_scope" }
  if (!profile) return { ...base, unknown: "no_profile" }
  if (!(opp.value > 0)) return { ...base, unknown: "no_estimate" }

  const required = requiredGrade(opp.value)
  // Lower number is better, so "held <= required" is what passing looks like.
  return { activity, required, held, eligible: held !== null && held <= required, unknown: null }
}

export interface CapacitySnapshot {
  ceiling: number
  underExecution: number
  /** How much of the ceiling is already committed. */
  usedPercent: number
  /** Open pipeline discounted by probability. */
  weighted: number
  /** Where we land if the weighted pipeline converts. */
  projectedPercent: number
  configured: boolean
}

export function capacitySnapshot(
  opportunities: CrmOpportunity[],
  profile: CrmOrgProfile | null | undefined
): CapacitySnapshot {
  const ceiling = profile?.annualCeiling || 0
  const underExecution = profile?.underExecution || 0
  const weighted = summarizeOpportunities(opportunities).weightedValue
  return {
    ceiling,
    underExecution,
    usedPercent: ceiling > 0 ? Math.round((underExecution / ceiling) * 100) : 0,
    weighted,
    projectedPercent: ceiling > 0 ? Math.round(((underExecution + weighted) / ceiling) * 100) : 0,
    configured: ceiling > 0,
  }
}

/** Does taking this deal on still fit under the annual ceiling? Unconfigured
 * ceilings return true — an unanswered question must not block anyone. */
export function fitsCapacity(
  opp: Pick<CrmOpportunity, "value">,
  profile: CrmOrgProfile | null | undefined
): boolean {
  const ceiling = profile?.annualCeiling || 0
  if (ceiling <= 0) return true
  return (profile?.underExecution || 0) + (opp.value || 0) <= ceiling
}

/** How far our offer sat above the winning bid, as a percentage. Null unless
 * both figures were captured on close. */
export function priceGapToWinner(opp: CrmOpportunity): number | null {
  const ours = opp.submittedPrice || 0
  const theirs = opp.competitorPrice || 0
  if (ours <= 0 || theirs <= 0) return null
  return Math.round(((ours - theirs) / theirs) * 1000) / 10
}

// ---------------------------------------------------------------------------
// Price approval
//
// The limit comes from the signed-in member's permissions, not from a role
// table: someone who can accept offers on the platform can approve a CRM
// price, and an org owner (ALL_PERMISSION) has no ceiling at all.
// ---------------------------------------------------------------------------

/** SAR a member may approve without escalating. `Infinity` means no ceiling. */
export const DEFAULT_APPROVAL_LIMIT = 5_000_000

export function needsHigherApproval(amount: number, limit: number): boolean {
  return amount > limit
}

// ---------------------------------------------------------------------------
// Quotations — offer versions
// ---------------------------------------------------------------------------

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected"
export const QUOTATION_STATUSES: QuotationStatus[] = ["draft", "sent", "accepted", "rejected"]

/** Before manufacturing: an estimate whose acceptance sends the missing goods
 * to Manufacturing. After manufacturing: the price of a finished item, so
 * acceptance never spawns a work order. Quotations written before phases
 * existed carry none and read as "before". */
export type QuotationPhase = "pre_manufacturing" | "post_manufacturing"
export const QUOTATION_PHASES: QuotationPhase[] = ["pre_manufacturing", "post_manufacturing"]

export function quotationPhase(q: { phase?: QuotationPhase | null }): QuotationPhase {
  return q.phase === "post_manufacturing" ? "post_manufacturing" : "pre_manufacturing"
}

export const QUOTATION_PHASE_BADGE_CLASS: Record<QuotationPhase, string> = {
  pre_manufacturing: "bg-warning/10 text-warning border-warning/20",
  post_manufacturing: "bg-success/10 text-success border-success/20",
}

/** One line of the payment schedule defined INSIDE the quotation (decision:
 * Finance reads the deposit and installments straight off the quotation, no
 * manual hand-off). `percent` is the share of the quotation amount. */
export interface QuotationInstallment {
  id: string
  label: string
  percent: number
}

/** A customer payment recorded against one installment, keyed by its id in
 * `CrmQuotation.payments`. Kept apart from the schedule so editing the
 * schedule and recording money are different permissions. */
export interface QuotationPayment {
  paidAt: string
  paidAmount: number
  paidByUserId: string | null
  paidByUserName: string | null
  note: string | null
}

export const INSTALLMENT_DEPOSIT_ID = "deposit"
export const INSTALLMENT_BALANCE_ID = "balance"
/** The synthetic single installment of a quotation with no schedule. */
export const INSTALLMENT_FULL_ID = "full"

/** Default schedule for a new quotation — the 30% deposit the client's
 * finance asked for, and the rest on delivery. Labels are filled by the UI. */
export function defaultInstallments(labels: { deposit: string; balance: string }): QuotationInstallment[] {
  return [
    { id: INSTALLMENT_DEPOSIT_ID, label: labels.deposit, percent: 30 },
    { id: INSTALLMENT_BALANCE_ID, label: labels.balance, percent: 70 },
  ]
}

/** A quotation without a schedule is one payment of the whole amount. */
export function quotationInstallments(q: Pick<CrmQuotation, "installments">): QuotationInstallment[] {
  if (q.installments && q.installments.length > 0) return q.installments
  return [{ id: INSTALLMENT_FULL_ID, label: "", percent: 100 }]
}

export function installmentAmount(q: Pick<CrmQuotation, "amount">, inst: Pick<QuotationInstallment, "percent">): number {
  return Math.round(((Number(q.amount) || 0) * inst.percent) / 100 * 100) / 100
}

/** Percents must cover the amount exactly; every line needs a positive share
 * and a name. Returns the problem, or null when the schedule is sound. */
export function validateInstallments(list: QuotationInstallment[]): "empty_label" | "bad_percent" | "not_100" | null {
  if (list.length === 0) return null
  for (const inst of list) {
    if (!inst.label.trim()) return "empty_label"
    if (!Number.isFinite(inst.percent) || inst.percent <= 0 || inst.percent > 100) return "bad_percent"
  }
  const total = list.reduce((sum, i) => sum + i.percent, 0)
  return Math.abs(total - 100) < 0.01 ? null : "not_100"
}

/** A line on the quotation template — picked from inventory or free-typed.
 * On acceptance these become the auto work order's requested items, so the
 * stock check can route only the missing goods to manufacturing. */
export interface QuotationItem {
  name: string
  quantity: number
  unit: string
  unitPrice: number
}

export function quotationItemsTotal(items: QuotationItem[]): number {
  return Math.round(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) * 100) / 100
}
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
  /** Set when the quotation is a priced version of a specific deal. Absent on
   * standalone quotations written against a contact only. */
  opportunityId?: string | null
  /** 1, 2, 3 … — a re-price never overwrites the figure that was sent. */
  version?: number | null
  quotationNumber: string
  amount: number
  /** When present, `amount` is their computed total. */
  items?: QuotationItem[] | null
  status: QuotationStatus
  date?: string | null
  /** How many days the price holds. */
  validityDays?: number | null
  paymentTerms?: string | null
  notes?: string | null
  /** See `QuotationPhase`. Absent on older records — use `quotationPhase()`. */
  phase?: QuotationPhase | null
  /** The linked work order: the one acceptance spawned (before manufacturing)
   * or the finished one being sold (after manufacturing). Either way its
   * presence stops acceptance from creating another. */
  workOrderId?: string | null
  workOrderNumber?: number | null
  /** Payment schedule (deposit, installments). Absent = one full payment. */
  installments?: QuotationInstallment[] | null
  /** Payments recorded against installments, by installment id. */
  payments?: Record<string, QuotationPayment> | null
  /** Set when EVERY installment is paid. ISO date; null until then. Total paid
   * so far lives in `paidAmount` even before that. */
  paidAt?: string | null
  paidAmount?: number | null
  paidByUserId?: string | null
  paidByUserName?: string | null
  paymentNote?: string | null
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
// Activities
//
// The record of contact: what was said, what was promised, what is still owed.
// An activity always names a contact and optionally a deal, so a party's page
// and a deal's page can each show their own slice of the same log.
// ---------------------------------------------------------------------------

export type ActivityType = "call" | "meeting" | "site_visit" | "task" | "email"
export const ACTIVITY_TYPES: ActivityType[] = ["call", "meeting", "site_visit", "task", "email"]

export const ACTIVITY_TYPE_BADGE_CLASS: Record<ActivityType, string> = {
  call: "bg-cta/10 text-cta border-cta/20",
  meeting: "bg-accent/10 text-accent border-accent/20",
  site_visit: "bg-primary/10 text-primary border-primary/20",
  task: "bg-warning/10 text-warning border-warning/20",
  email: "bg-muted text-muted-foreground border-border",
}

export interface CrmActivity {
  id: string
  type: ActivityType
  title: string
  contactId: string
  contactName?: string | null
  opportunityId?: string | null
  opportunityTitle?: string | null
  /** ISO date. Absent means "no commitment made". */
  dueDate?: string | null
  done?: boolean
  notes?: string | null
  ownerId?: string | null
  ownerName?: string | null
  organizationId: string
  createdAt?: unknown
  updatedAt?: unknown
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

/** `YYYY-MM-DD` for `n` days from today — the shape every date input wants. */
export function isoDateIn(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Relationship health
//
// One number a rep can act on, assembled from the three signals the platform
// already holds: how satisfied the client says they are, how they actually pay,
// and how much repeat work they give us. Deliberately conservative — an
// unmeasured party sits mid-band rather than looking healthy by default.
// ---------------------------------------------------------------------------

export type HealthBand = "good" | "fair" | "poor"

export interface ContactHealth {
  score: number
  band: HealthBand
}

export const HEALTH_BAND_CLASS: Record<HealthBand, string> = {
  good: "bg-success/10 text-success border-success/20",
  fair: "bg-warning/10 text-warning border-warning/20",
  poor: "bg-destructive/10 text-destructive border-destructive/20",
}

export function contactHealth(contact: CrmContact, wonDeals = 0): ContactHealth {
  const satisfaction = typeof contact.satisfaction === "number" ? contact.satisfaction : 60
  // Paying inside 30 days scores full marks; every day beyond costs 1.1 points.
  const paymentDays = typeof contact.paymentDays === "number" ? contact.paymentDays : 45
  const payment = Math.max(0, Math.min(100, 100 - Math.max(0, paymentDays - 30) * 1.1))
  // Repeat business, capped: three won deals is as good a signal as thirty.
  const loyalty = Math.min(100, 55 + wonDeals * 10)
  const score = Math.round(satisfaction * 0.4 + payment * 0.35 + loyalty * 0.25)
  return { score, band: score >= 75 ? "good" : score >= 55 ? "fair" : "poor" }
}

// ---------------------------------------------------------------------------
// Pipeline aggregation — shared by the dashboard, leads and opportunities
// pages so the same number never gets computed two slightly different ways.
// ---------------------------------------------------------------------------

export interface PipelineSummary {
  total: number
  open: number
  won: number
  lost: number
  onHold: number
  handedOver: number
  /** Value of everything still in play. */
  openValue: number
  /** Open value discounted by each deal's probability. */
  weightedValue: number
  wonValue: number
  /** won / (won + lost), 0 when nothing has closed yet. Deals parked on hold
   * are excluded on purpose — parking a deal must not flatter the win rate. */
  winRate: number
  avgDealValue: number
}

export function summarizeOpportunities(opportunities: CrmOpportunity[]): PipelineSummary {
  let open = 0
  let won = 0
  let lost = 0
  let onHold = 0
  let handedOver = 0
  let openValue = 0
  let weightedValue = 0
  let wonValue = 0

  for (const opp of opportunities) {
    const value = Number.isFinite(opp.value) ? opp.value : 0
    switch (opportunityState(opp)) {
      case "won":
      case "handed_over": {
        won++
        if (opportunityState(opp) === "handed_over") handedOver++
        wonValue += opportunityBestValue(opp)
        break
      }
      case "lost":
        lost++
        break
      case "on_hold":
        onHold++
        break
      default: {
        open++
        openValue += value
        const probability = typeof opp.probability === "number" ? opp.probability : 50
        weightedValue += (value * Math.max(0, Math.min(100, probability))) / 100
      }
    }
  }

  const closed = won + lost
  return {
    total: opportunities.length,
    open,
    won,
    lost,
    onHold,
    handedOver,
    openValue,
    weightedValue: Math.round(weightedValue),
    wonValue,
    winRate: closed === 0 ? 0 : Math.round((won / closed) * 100),
    avgDealValue: won === 0 ? 0 : Math.round(wonValue / won),
  }
}

// ---------------------------------------------------------------------------
// Renewals at risk
//
// A contract we won and handed over will end. If nobody has opened a renewal
// before it does, that revenue quietly leaves. This is derived entirely from
// CRM-owned data — the handover already recorded a start and a duration — so
// it needs no contracts collection and no read into Projects.
// ---------------------------------------------------------------------------

export interface ContractAtRisk {
  opportunity: CrmOpportunity
  /** ISO date the contract runs out. */
  endDate: string
  daysRemaining: number
}

export function contractEndDate(opp: CrmOpportunity): string | null {
  const start = toDate(opp.handedOverAt)
  const months = opp.durationMonths
  if (!start || !months || months <= 0) return null
  const end = new Date(start)
  end.setMonth(end.getMonth() + months)
  return end.toISOString().slice(0, 10)
}

export function contractsAtRisk(opportunities: CrmOpportunity[], withinDays = 90): ContractAtRisk[] {
  const renewed = new Set(
    opportunities
      .filter((o) => o.renewalOfOpportunityId && opportunityState(o) !== "lost")
      .map((o) => o.renewalOfOpportunityId as string)
  )

  const rows: ContractAtRisk[] = []
  for (const opp of opportunities) {
    if (opportunityState(opp) !== "handed_over") continue
    if (renewed.has(opp.id)) continue
    const endDate = contractEndDate(opp)
    if (!endDate) continue
    const daysRemaining = daysUntil(endDate)
    if (daysRemaining === null || daysRemaining > withinDays) continue
    rows.push({ opportunity: opp, endDate, daysRemaining })
  }
  return rows.sort((a, b) => a.daysRemaining - b.daysRemaining)
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
  const fields = [
    contact.name,
    contact.company,
    contact.phone,
    contact.email,
    contact.ownerName,
    contact.city,
    contact.crNumber,
    // Searching for the person you spoke to is how people actually find a
    // party — they remember "Majed in contracts", not the entity's legal name.
    ...contactPeople(contact).flatMap((p) => [p.name, p.title, p.phone, p.email]),
  ]
  return fields.some((field) => (field || "").toLowerCase().includes(q))
}

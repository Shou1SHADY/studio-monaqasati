import { z } from "zod"
import { leadCompanyTypes, type CompanyType, type LeadTypeFields } from "@/lib/company-types"
import { foldSearchText } from "@/lib/search-text"

export const CLIENT_STAGES = ["onboarding", "active", "at_risk", "churned"] as const
export type ClientStage = (typeof CLIENT_STAGES)[number]

// "note" is the legacy kind (a log line with no date); the dialog offers the other five.
// WhatsApp is recorded only — there is no integration behind it (ADM-08).
export const ACTIVITY_TYPES = ["call", "whatsapp", "meeting", "email", "task", "note"] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]
/** What the history shows: the activities logged by hand, and every stage change with its reason. */
export type HistoryType = ActivityType | "stage"

/** The subscription a client is on — the packages of the pricing page, and a trial before one is chosen. */
export const CLIENT_PLANS = ["trial", "starter", "growth", "enterprise"] as const
export type ClientPlan = (typeof CLIENT_PLANS)[number]
export const isClientPlan = (v: unknown): v is ClientPlan => typeof v === "string" && (CLIENT_PLANS as readonly string[]).includes(v)

/** Where a client came from: the lead his account was created from, or he signed up himself. */
export const CLIENT_SOURCES = ["demo", "onboarding", "manual", "signup", "referral", "event", "other"] as const
export type ClientSource = (typeof CLIENT_SOURCES)[number]
export function clientSourceOf(user: { convertedFromLeadCollection?: string | null }, record?: { source?: string | null } | null): ClientSource {
  if (record?.source && (CLIENT_SOURCES as readonly string[]).includes(record.source)) return record.source as ClientSource
  if (user.convertedFromLeadCollection === "demoRequests") return "demo"
  if (user.convertedFromLeadCollection === "onboardingRequests") return "onboarding"
  return "signup"
}

/** Every stage change states why (agreed with the sales team, 6 Oct 2026) — kept in the record's history. */
export const stageChangeSchema = z.object({ reason: z.string().trim().min(3).max(500) })

/** The record's opportunities and quotes (one collection, `kind`). Amounts in riyals. */
export const DEAL_KINDS = ["opportunity", "quote"] as const
export type DealKind = (typeof DEAL_KINDS)[number]
export const DEAL_STATES: Record<DealKind, readonly string[]> = {
  opportunity: ["open", "won", "lost"],
  quote: ["draft", "sent", "accepted", "rejected"],
}
export const dealSchema = z.object({
  kind: z.enum(DEAL_KINDS),
  title: z.string().trim().min(2).max(200),
  plan: z.enum(CLIENT_PLANS).nullable(),
  amount: z.number().min(0).max(100_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(1000),
})
export type DealInput = z.infer<typeof dealSchema>
export type DealDoc = DealInput & { id: string; clientId: string; state: string; authorName: string; createdAt?: { seconds?: number } | null }
export const NEW_ACTIVITY_TYPES = ["call", "whatsapp", "meeting", "email", "task"] as const
export const ACTIVITY_RESULTS = ["replied", "no_reply", "call_back"] as const
export type ActivityResult = (typeof ACTIVITY_RESULTS)[number]

export const STALE_DAYS = 30

export type ClientUser = {
  id: string
  convertedFromLeadCollection?: string | null
  role?: string
  name?: string
  email?: string
  phone?: string
  city?: string
  isVerified?: boolean
  size?: string
  joinedAt?: { seconds?: number } | null
  createdAt?: { seconds?: number } | null
}

/** Who at the company we talk to (ADM-06). One is the main contact. */
export type CrmContact = { id: string; name: string; title: string; phone: string; email: string; primary: boolean }

export type ClientRecord = {
  stage?: string
  /** The subscription (clients) — CLIENT_PLANS. */
  plan?: string
  /** Set by hand when the derived source is wrong — CLIENT_SOURCES. */
  source?: string
  ownerUid?: string
  ownerName?: string
  /** Legacy: before activities carried the date. Used only when no scheduled activity exists. */
  nextFollowUp?: string
  lastContactAt?: string
  // The opportunity is part of the lead (ADM-07): the plan above, and these — all optional.
  expectedValue?: number
  expectedClose?: string
  contacts?: CrmContact[]
  /** Records the staff said are NOT the same person (ADM-09). */
  notDuplicateOf?: string[]
  mergedInto?: string
  convertedFromLead?: string
  convertedAt?: { seconds?: number } | null
}

export type ClientRow = {
  id: string
  role: "Contractor" | "Supplier"
  name: string
  email: string
  phone: string
  city: string
  isVerified: boolean
  plan: ClientPlan | null
  source: ClientSource
  stage: ClientStage
  ownerUid: string
  ownerName: string
  nextFollowUp: string
  lastContactAt: string
  daysSinceContact: number | null
  followUpDue: boolean
  stale: boolean
  size: string
  /** When the account was created, ms (0 = unknown). */
  sinceMs: number
}

export type ClientSummary = {
  total: number
  byStage: Record<ClientStage, number>
  followUpsDue: number
  stale: number
  unowned: number
}

const DAY_MS = 86_400_000

export function isClientStage(value: unknown): value is ClientStage {
  return typeof value === "string" && (CLIENT_STAGES as readonly string[]).includes(value)
}

/** Calendar days from a moment to now, as people count them: a call on the 6th is «two days ago» on the 8th, whatever
 * the hour (an activity done on a day is stored at noon UTC — counting elapsed hours made it «yesterday» until 3 pm). */
export function calendarDaysSince(ms: number, now: Date): number {
  return Math.max(0, Math.round((Date.parse(toDateKey(now)) - Date.parse(toDateKey(new Date(ms)))) / DAY_MS))
}

export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}


// ── Activities (ADM-08) ──────────────────────────────────────────────────────
// A scheduled activity is the follow-up: its date IS the next follow-up, and the
// last contact is the latest DONE call / WhatsApp / meeting / e-mail. Neither is
// typed into a field any more. A legacy log line (no status) counts as done.

export type CrmActivity = {
  id: string
  clientId: string
  type: HistoryType
  /** A stage change (type "stage"): where it was and where it went. */
  from?: string
  to?: string
  note: string
  authorName?: string
  createdAt?: { seconds?: number } | null
  status?: "scheduled" | "done"
  /** yyyy-mm-dd — when it is due (scheduled) or happened (done). */
  dueDate?: string
  /** HH:mm, optional. */
  dueTime?: string
  title?: string
  withName?: string
  ownerUid?: string
  ownerName?: string
  result?: ActivityResult
  /** Written by the platform, not a person: "converted" = the lead's account was created. */
  system?: "converted"
}

export const CONTACT_TYPES: readonly HistoryType[] = ["call", "whatsapp", "meeting", "email"]

export function contactsClient(type: HistoryType): boolean {
  return (CONTACT_TYPES as readonly string[]).includes(type)
}

const createdDay = (a: CrmActivity) => (a.createdAt?.seconds ? toDateKey(new Date(a.createdAt.seconds * 1000)) : "")

export type ActivityState = "scheduled" | "today" | "overdue" | "done"

export function activityState(a: CrmActivity, today: string): ActivityState {
  if (a.status !== "scheduled") return "done"
  const day = a.dueDate ?? ""
  if (day && day < today) return "overdue"
  if (day === today) return "today"
  return "scheduled"
}

export type ClientDerived = { lastContactAt: string; nextFollowUp: string }

/** Per client: the last contact and the nearest scheduled activity, from the activities alone. */
function joinDerived(a: ClientDerived | undefined, b: ClientDerived | undefined): ClientDerived | undefined {
  if (!a || !b) return a ?? b
  const next = [a.nextFollowUp, b.nextFollowUp].filter(Boolean).sort()[0] ?? ""
  return { lastContactAt: a.lastContactAt > b.lastContactAt ? a.lastContactAt : b.lastContactAt, nextFollowUp: next }
}

export function deriveContacts(activities: CrmActivity[]): Record<string, ClientDerived> {
  const out: Record<string, ClientDerived> = {}
  for (const a of activities) {
    const d = (out[a.clientId] ??= { lastContactAt: "", nextFollowUp: "" })
    if (a.status === "scheduled") {
      if (a.dueDate && (!d.nextFollowUp || a.dueDate < d.nextFollowUp)) d.nextFollowUp = a.dueDate
    } else if (contactsClient(a.type)) {
      const at = a.dueDate || createdDay(a)
      if (at && at > d.lastContactAt.slice(0, 10)) d.lastContactAt = a.createdAt?.seconds && createdDay(a) === at ? new Date(a.createdAt.seconds * 1000).toISOString() : `${at}T12:00:00.000Z`
    }
  }
  return out
}

export type ActivitySummary = { open: number; overdue: number; today: number; within7: number; done: number; doneThisWeek: number; all: number }

export function summarizeActivities(list: CrmActivity[], now: Date): ActivitySummary {
  const today = toDateKey(now)
  const week = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))
  const weekStart = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()))
  const out: ActivitySummary = { open: 0, overdue: 0, today: 0, within7: 0, done: 0, doneThisWeek: 0, all: list.length }
  for (const a of list) {
    const st = activityState(a, today)
    if (st === "done") {
      out.done += 1
      if ((a.dueDate || createdDay(a)) >= weekStart) out.doneThisWeek += 1
      continue
    }
    out.open += 1
    if (st === "overdue") out.overdue += 1
    if (st === "today") out.today += 1
    if (a.dueDate && a.dueDate >= today && a.dueDate <= week) out.within7 += 1
  }
  return out
}

export const ACTIVITY_SEGMENTS = ["open", "overdue", "today", "within7", "done", "all"] as const
export type ActivitySegment = (typeof ACTIVITY_SEGMENTS)[number]

export function inActivitySegment(a: CrmActivity, seg: ActivitySegment, now: Date): boolean {
  const today = toDateKey(now)
  const st = activityState(a, today)
  if (seg === "all") return true
  if (seg === "done") return st === "done"
  if (st === "done") return false
  if (seg === "open") return true
  if (seg === "overdue") return st === "overdue"
  if (seg === "today") return st === "today"
  const week = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))
  return Boolean(a.dueDate) && (a.dueDate as string) >= today && (a.dueDate as string) <= week
}

/** Due soonest first; the ones with no date last; done ones newest first. */
export function sortActivities(list: CrmActivity[]): CrmActivity[] {
  const key = (a: CrmActivity) => `${a.dueDate ?? ""}T${a.dueTime ?? ""}`
  return [...list].sort((a, b) => {
    const ad = a.status === "scheduled"
    const bd = b.status === "scheduled"
    if (ad !== bd) return ad ? -1 : 1
    if (ad) return (a.dueDate ? key(a) : "~").localeCompare(b.dueDate ? key(b) : "~")
    return (b.dueDate ?? createdDay(b)).localeCompare(a.dueDate ?? createdDay(a)) || (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
  })
}

export const activitySchema = z
  .object({
    clientId: z.string().min(1),
    type: z.enum(NEW_ACTIVITY_TYPES),
    status: z.enum(["scheduled", "done"]),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueTime: z.string().regex(/^(\d{2}:\d{2})?$/),
    withName: z.string().trim().max(200),
    ownerUid: z.string(),
    title: z.string().trim().min(1).max(200),
    note: z.string().trim().max(1000),
    result: z.enum(ACTIVITY_RESULTS).optional(),
  })
  .refine((v) => v.status === "scheduled" || v.result === undefined || v.type === "call" || v.type === "whatsapp", { path: ["result"] })

export function buildClientRows(
  users: ClientUser[],
  records: Record<string, ClientRecord>,
  now: Date,
  derived: Record<string, ClientDerived> = {},
): ClientRow[] {
  const today = toDateKey(now)
  const rows: ClientRow[] = []
  for (const u of users) {
    if (u.role !== "Contractor" && u.role !== "Supplier") continue
    const rec = records[u.id] ?? {}
    // A converted client's history includes its time as a lead (ADM-10): the latest contact and the nearest follow-up
    // of either — not the client's alone once it has one activity of its own.
    const d = joinDerived(derived[u.id], derived[rec.convertedFromLead ?? ""])
    const stage = isClientStage(rec.stage) ? rec.stage : "onboarding"
    const lastContactAt = d?.lastContactAt || rec.lastContactAt || ""
    const lastMs = lastContactAt ? Date.parse(lastContactAt) : NaN
    const daysSinceContact = Number.isNaN(lastMs) ? null : calendarDaysSince(lastMs, now)
    const nextFollowUp = d?.nextFollowUp || rec.nextFollowUp || ""
    const since = u.joinedAt?.seconds ?? u.createdAt?.seconds ?? 0
    rows.push({
      id: u.id,
      role: u.role,
      name: u.name?.trim() || u.email || u.id,
      email: u.email ?? "",
      phone: u.phone ?? "",
      city: u.city ?? "",
      isVerified: u.isVerified === true,
      plan: isClientPlan(rec.plan) ? rec.plan : null,
      source: clientSourceOf(u, rec),
      stage,
      ownerUid: rec.ownerUid ?? "",
      ownerName: rec.ownerName ?? "",
      nextFollowUp,
      lastContactAt,
      daysSinceContact,
      followUpDue: nextFollowUp !== "" && nextFollowUp <= today && stage !== "churned",
      stale: stage !== "churned" && (daysSinceContact === null || daysSinceContact > STALE_DAYS),
      size: u.size ?? "",
      sinceMs: since * 1000,
    })
  }
  return rows
}

export function summarizeClients(rows: ClientRow[]): ClientSummary {
  const byStage: Record<ClientStage, number> = { onboarding: 0, active: 0, at_risk: 0, churned: 0 }
  let followUpsDue = 0
  let stale = 0
  let unowned = 0
  for (const r of rows) {
    byStage[r.stage] += 1
    if (r.followUpDue) followUpsDue += 1
    if (r.stale) stale += 1
    if (r.stage !== "churned" && !r.ownerUid) unowned += 1
  }
  return { total: rows.length, byStage, followUpsDue, stale, unowned }
}

export const LEAD_STAGES = ["new", "contacted", "demo", "negotiation", "lost"] as const
export type LeadStage = (typeof LEAD_STAGES)[number]
export type LeadViewStage = LeadStage | "converted"

// `LeadSource` is which request collection the lead lives in (it keys the CRM record
// and never changes); `LeadChannel` is where it CAME FROM, as the team reads it.
export const LEAD_SOURCES = ["demo", "onboarding", "manual"] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]
export const LEAD_CHANNELS = ["demo", "onboarding", "ad", "outreach", "other"] as const
export type LeadChannel = (typeof LEAD_CHANNELS)[number]
/** What a person can pick when adding a lead by hand (ADM-04). */
export const MANUAL_CHANNELS = ["ad", "outreach", "other"] as const
export type LeadKind = "contractor" | "supplier" | "unspecified"

/** Silent this many days or more = needs a call (ADM-01). */
export const LEAD_STALE_DAYS = 7

export type LeadDoc = LeadTypeFields & {
  id: string
  source: LeadSource
  name?: string
  company?: string
  phone?: string
  email?: string
  status?: string
  city?: string
  size?: string
  preferredDate?: string
  /** Manual leads: where it came from (ad / we contacted / other). */
  manualSource?: string
  /** Removed from the list by platform staff (junk, a duplicate) — kept, and restorable. */
  archived?: boolean
  archivedReason?: string
  convertedAt?: { seconds?: number } | null
  createdAt?: { seconds?: number } | null
}

export type LeadRow = {
  id: string
  crmId: string
  source: LeadSource
  channel: LeadChannel
  kind: LeadKind
  name: string
  company: string
  phone: string
  email: string
  types: CompanyType[]
  typeOther: string
  city: string
  size: string
  preferredDate: string
  converted: boolean
  convertedMs: number
  archived: boolean
  stage: LeadViewStage
  ownerUid: string
  ownerName: string
  plan: ClientPlan | ""
  expectedValue: number
  expectedClose: string
  nextFollowUp: string
  lastContactAt: string
  createdMs: number
  daysSinceContact: number | null
  /** Days since the last contact, or since it arrived when never contacted. */
  silentDays: number
  followUpDue: boolean
  stale: boolean
}

export type LeadSummary = {
  total: number
  open: number
  byStage: Record<LeadViewStage, number>
  followUpsDue: number
  stale: number
  unowned: number
}

export function leadCrmId(source: LeadSource, id: string): string {
  return `lead_${source}_${id}`
}

export function isLeadStage(value: unknown): value is LeadStage {
  return typeof value === "string" && (LEAD_STAGES as readonly string[]).includes(value)
}

export function leadChannel(l: Pick<LeadDoc, "source" | "manualSource">): LeadChannel {
  if (l.source === "demo") return "demo"
  if (l.source === "onboarding") return "onboarding"
  return l.manualSource === "ad" || l.manualSource === "outreach" ? l.manualSource : "other"
}

const CONTRACTOR_SIDE: readonly CompanyType[] = ["contractor", "developer"]
const SUPPLIER_SIDE: readonly CompanyType[] = ["supplier", "manufacturer"]

/** Contractor or supplier, from the company types a lead ticked; a lead that ticked both sides reads as unspecified. */
export function leadKind(types: readonly CompanyType[]): LeadKind {
  const c = types.some((t) => CONTRACTOR_SIDE.includes(t))
  const sp = types.some((t) => SUPPLIER_SIDE.includes(t))
  return c && !sp ? "contractor" : sp && !c ? "supplier" : "unspecified"
}

export function buildLeadRows(
  leads: LeadDoc[],
  records: Record<string, ClientRecord>,
  now: Date,
  derived: Record<string, ClientDerived> = {},
): LeadRow[] {
  const today = toDateKey(now)
  return leads.map((l) => {
    const crmId = leadCrmId(l.source, l.id)
    const rec = records[crmId] ?? {}
    const d = derived[crmId]
    const converted = l.status === "converted"
    const stage: LeadViewStage = converted ? "converted" : isLeadStage(rec.stage) ? rec.stage : "new"
    const createdMs = l.createdAt?.seconds ? l.createdAt.seconds * 1000 : 0
    const lastContactAt = d?.lastContactAt || rec.lastContactAt || ""
    const lastMs = lastContactAt ? Date.parse(lastContactAt) : NaN
    const daysSinceContact = Number.isNaN(lastMs) ? null : calendarDaysSince(lastMs, now)
    const nextFollowUp = d?.nextFollowUp || rec.nextFollowUp || ""
    const closed = converted || stage === "lost"
    const silentDays = daysSinceContact ?? (createdMs ? calendarDaysSince(createdMs, now) : 0)
    const { types, other } = leadCompanyTypes(l)
    return {
      id: l.id,
      crmId,
      source: l.source,
      channel: leadChannel(l),
      kind: leadKind(types),
      name: l.name?.trim() || l.company?.trim() || l.email || l.id,
      company: l.company?.trim() ?? "",
      phone: l.phone ?? "",
      email: l.email ?? "",
      types,
      typeOther: other,
      city: l.city ?? "",
      size: l.size ?? "",
      preferredDate: l.preferredDate ?? "",
      converted,
      convertedMs: l.convertedAt?.seconds ? l.convertedAt.seconds * 1000 : 0,
      archived: l.archived === true,
      stage,
      ownerUid: rec.ownerUid ?? "",
      ownerName: rec.ownerName ?? "",
      plan: isClientPlan(rec.plan) ? rec.plan : "",
      expectedValue: typeof rec.expectedValue === "number" && rec.expectedValue > 0 ? rec.expectedValue : 0,
      expectedClose: rec.expectedClose ?? "",
      nextFollowUp,
      lastContactAt,
      createdMs,
      daysSinceContact,
      silentDays,
      followUpDue: !closed && nextFollowUp !== "" && nextFollowUp <= today,
      stale: !closed && silentDays >= LEAD_STALE_DAYS,
    }
  })
}

export function summarizeLeads(rows: LeadRow[]): LeadSummary {
  const byStage: Record<LeadViewStage, number> = { new: 0, contacted: 0, demo: 0, negotiation: 0, lost: 0, converted: 0 }
  let followUpsDue = 0
  let stale = 0
  let unowned = 0
  let open = 0
  for (const r of rows) {
    if (r.archived) continue
    byStage[r.stage] += 1
    const closed = r.stage === "lost" || r.stage === "converted"
    if (!closed) open += 1
    if (r.followUpDue) followUpsDue += 1
    if (r.stale) stale += 1
    if (!closed && !r.ownerUid) unowned += 1
  }
  return { total: rows.filter((r) => !r.archived).length, open, byStage, followUpsDue, stale, unowned }
}

// ── The list: segments, filters, and the four cards (ADM-01, ADM-02) ─────────

/** The strip over the list: where is this lead in its life — and nothing else. */
export const LEAD_SEGMENTS = ["open", "converted", "lost", "removed", "all"] as const
export type LeadSegment = (typeof LEAD_SEGMENTS)[number]
/** The four columns of the board: only the stages a lead moves through while open. */
export const OPEN_STAGES = ["new", "contacted", "demo", "negotiation"] as const
export type OpenStage = (typeof OPEN_STAGES)[number]

export const isOpenLead = (r: Pick<LeadRow, "stage" | "archived">) => !r.archived && r.stage !== "lost" && r.stage !== "converted"

export function inLeadSegment(r: LeadRow, seg: LeadSegment): boolean {
  if (seg === "removed") return r.archived
  if (r.archived) return false
  if (seg === "open") return isOpenLead(r)
  if (seg === "converted") return r.stage === "converted"
  if (seg === "lost") return r.stage === "lost"
  return true
}

export function leadSegmentCounts(rows: LeadRow[]): Record<LeadSegment, number> {
  const out = { open: 0, converted: 0, lost: 0, all: 0, removed: 0 }
  for (const seg of LEAD_SEGMENTS) out[seg] = rows.filter((r) => inLeadSegment(r, seg)).length
  return out
}

/** Which «last contact» filter buckets a lead falls in (ADM-02): never reached · silent 7 days or more · reached this
 * week. A lead that was never reached and arrived 7+ days ago is both «never» and «over7». */
export function leadContactBuckets(r: Pick<LeadRow, "daysSinceContact" | "silentDays">): Array<"never" | "over7" | "within7"> {
  const out: Array<"never" | "over7" | "within7"> = []
  if (r.daysSinceContact === null) out.push("never")
  if (r.silentDays >= LEAD_STALE_DAYS) out.push("over7")
  if (r.daysSinceContact !== null && r.daysSinceContact < LEAD_STALE_DAYS) out.push("within7")
  return out
}

/** The same for a client, on the clients' 30-day line (ADM-10). */
export function clientContactBuckets(r: { daysSinceContact: number | null }): Array<"never" | "over30" | "within30"> {
  if (r.daysSinceContact === null) return ["never"]
  return [r.daysSinceContact >= STALE_DAYS ? "over30" : "within30"]
}

/** How long ago a lead arrived, for a card with no follow-up yet (ADM-03): hours on its first day, then days. */
export function arrivedAgo(createdMs: number, now: Date): { unit: "hours" | "days"; n: number } | null {
  if (!createdMs) return null
  const ms = Math.max(0, now.getTime() - createdMs)
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 24) return { unit: "hours", n: hours }
  const today = toDateKey(now)
  const days = Math.round((Date.parse(today) - Date.parse(toDateKey(new Date(createdMs)))) / DAY_MS)
  return { unit: "days", n: Math.max(1, days) }
}

export type LeadFilters = {
  channels: LeadChannel[]
  /** "" any · "none" nobody · "me" · a staff uid */
  owner: string
  kind: "" | "contractor" | "supplier"
  /** "never" never reached · "over7" 7 days or more · "within7" reached this week */
  contact: "" | "never" | "over7" | "within7"
  dupesOnly: boolean
}

export const NO_LEAD_FILTERS: LeadFilters = { channels: [], owner: "", kind: "", contact: "", dupesOnly: false }

export function countLeadFilters(f: LeadFilters): number {
  return (f.channels.length ? 1 : 0) + (f.owner ? 1 : 0) + (f.kind ? 1 : 0) + (f.contact ? 1 : 0) + (f.dupesOnly ? 1 : 0)
}

export function matchesLeadFilters(r: LeadRow, f: LeadFilters, ctx: { meUid: string; hasDuplicates: boolean }): boolean {
  if (f.channels.length && !f.channels.includes(r.channel)) return false
  if (f.owner === "none" && r.ownerUid) return false
  if (f.owner === "me" && r.ownerUid !== ctx.meUid) return false
  if (f.owner && f.owner !== "none" && f.owner !== "me" && r.ownerUid !== f.owner) return false
  if (f.kind && r.kind !== f.kind) return false
  if (f.contact === "never" && r.daysSinceContact !== null) return false
  if (f.contact === "over7" && !(r.silentDays >= LEAD_STALE_DAYS)) return false
  if (f.contact === "within7" && !(r.daysSinceContact !== null && r.daysSinceContact < LEAD_STALE_DAYS)) return false
  if (f.dupesOnly && !ctx.hasDuplicates) return false
  return true
}

export type LeadCards = { leads: number; noContact: number; unowned: number; expectedValue: number; valued: number; unvalued: number }

/** The four cards over the leads tab: all counted over OPEN leads except the first, which is every live lead. */
export function leadCards(rows: LeadRow[]): LeadCards {
  const live = rows.filter((r) => !r.archived)
  const open = live.filter(isOpenLead)
  const valued = open.filter((r) => r.expectedValue > 0)
  return {
    leads: live.length,
    noContact: open.filter((r) => r.silentDays >= LEAD_STALE_DAYS).length,
    unowned: open.filter((r) => !r.ownerUid).length,
    expectedValue: valued.reduce((n, r) => n + r.expectedValue, 0),
    valued: valued.length,
    unvalued: open.length - valued.length,
  }
}

/** Column header of the board: how many and the money in it. */
export function stageTotals(rows: LeadRow[]): Record<OpenStage, { count: number; value: number }> {
  const out = Object.fromEntries(OPEN_STAGES.map((s) => [s, { count: 0, value: 0 }])) as Record<OpenStage, { count: number; value: number }>
  for (const r of rows) {
    if (r.archived || !(OPEN_STAGES as readonly string[]).includes(r.stage)) continue
    out[r.stage as OpenStage].count += 1
    out[r.stage as OpenStage].value += r.expectedValue
  }
  return out
}

// ── Dashboard tab (ADM-01, ADM-03) ───────────────────────────────────────────

export type LeadDashboard = {
  thisWeek: number
  lastWeek: number
  thisMonth: number
  lastMonth: number
  bySource: Record<LeadChannel, number>
  openByStage: Record<OpenStage, number>
  convertedThisMonth: number
  convertedLastMonth: number
  /** Percent of the leads that arrived in the last 90 days that became accounts; null when none arrived. */
  conversionRate: number | null
}

export function leadDashboard(rows: LeadRow[], now: Date): LeadDashboard {
  const intake = leadIntake(rows, now)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
  const since = now.getTime() - 90 * DAY_MS
  const openByStage = { new: 0, contacted: 0, demo: 0, negotiation: 0 } as Record<OpenStage, number>
  let convertedThisMonth = 0
  let convertedLastMonth = 0
  let arrived = 0
  let arrivedConverted = 0
  for (const r of rows) {
    if (!r.archived && (OPEN_STAGES as readonly string[]).includes(r.stage)) openByStage[r.stage as OpenStage] += 1
    if (r.converted && r.convertedMs) {
      if (r.convertedMs >= monthStart) convertedThisMonth += 1
      else if (r.convertedMs >= lastMonthStart) convertedLastMonth += 1
    }
    if (r.createdMs >= since) {
      arrived += 1
      if (r.converted) arrivedConverted += 1
    }
  }
  return {
    thisWeek: intake.thisWeek,
    lastWeek: intake.lastWeek,
    thisMonth: intake.thisMonth,
    lastMonth: intake.lastMonth,
    bySource: intake.bySource,
    openByStage,
    convertedThisMonth,
    convertedLastMonth,
    conversionRate: arrived ? Math.round((arrivedConverted / arrived) * 100) : null,
  }
}

// ── Clients tab (ADM-10) ─────────────────────────────────────────────────────

export const CLIENT_SEGMENTS = ["all", "onboarding", "active", "at_risk", "churned"] as const
export type ClientSegment = (typeof CLIENT_SEGMENTS)[number]

export function clientCards(rows: ClientRow[]) {
  const live = rows.filter((r) => r.stage !== "churned")
  return {
    total: rows.length,
    noContact: live.filter((r) => r.daysSinceContact === null || r.daysSinceContact >= STALE_DAYS).length,
    unowned: live.filter((r) => !r.ownerUid).length,
    atRisk: rows.filter((r) => r.stage === "at_risk").length,
  }
}

// ── Duplicates and leads who are already clients ────────────────────────────
// The same person arrives twice (a demo request, then "start free", or under a
// second e-mail), and some leads already hold an account. A match on the phone
// (last nine digits: 05x, 9665x and +9665x are one number), the e-mail, or the
// full name (Arabic-folded, two words or more) is shown, never merged.

export function phoneKey(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "")
  return digits.length >= 7 ? digits.slice(-9) : ""
}

const emailKey = (email: string | null | undefined) => (email ?? "").trim().toLowerCase()
const nameKey = (name: string | null | undefined) => {
  const folded = foldSearchText(name ?? "")
  return folded.split(/\s+/).filter(Boolean).length >= 2 ? folded : ""
}
const keysOf = (p: { name?: string; email?: string; phone?: string }) =>
  [phoneKey(p.phone) && `p:${phoneKey(p.phone)}`, emailKey(p.email) && `e:${emailKey(p.email)}`, nameKey(p.name) && `n:${nameKey(p.name)}`].filter(Boolean) as string[]

/** While typing a new lead: an existing live lead that has this phone, e-mail or full name (the first by phone, then e-mail, then name). */
export function findSimilarLead(rows: LeadRow[], p: { name?: string; email?: string; phone?: string }): { row: LeadRow; reason: "phone" | "email" | "name" } | null {
  const live = rows.filter((r) => !r.archived)
  const ph = phoneKey(p.phone)
  const em = emailKey(p.email)
  const nm = nameKey(p.name)
  const byPhone = ph ? live.find((r) => phoneKey(r.phone) === ph) : undefined
  if (byPhone) return { row: byPhone, reason: "phone" }
  const byEmail = em ? live.find((r) => emailKey(r.email) === em) : undefined
  if (byEmail) return { row: byEmail, reason: "email" }
  const byName = nm ? live.find((r) => nameKey(r.name) === nm) : undefined
  return byName ? { row: byName, reason: "name" } : null
}

export type MatchReason = "phone" | "email" | "name"
export type LeadMatch = { duplicates: string[]; client: string | null; reasons: Record<string, MatchReason> }

const REASON_ORDER: MatchReason[] = ["phone", "email", "name"]
const reasonOfKey = (k: string): MatchReason => (k.startsWith("p:") ? "phone" : k.startsWith("e:") ? "email" : "name")

/** For each live lead: the other live leads that look like the same person (and why), and
 * the registered client it already is (by name), if any. Removed and merged leads are left
 * out; a pair the staff marked "not a duplicate" (`dismissed`: crmId → crmIds) is not offered again. */
export function leadMatches(
  rows: LeadRow[],
  clients: Array<{ name: string; email: string; phone: string }>,
  dismissed: Record<string, string[]> = {},
): Map<string, LeadMatch> {
  const live = rows.filter((r) => !r.archived)
  const byKey = new Map<string, string[]>()
  for (const r of live) for (const k of keysOf(r)) byKey.set(k, [...(byKey.get(k) ?? []), r.crmId])
  const clientByKey = new Map<string, string>()
  for (const c of clients) for (const k of keysOf(c)) if (!clientByKey.has(k)) clientByKey.set(k, c.name)
  const out = new Map<string, LeadMatch>()
  for (const r of live) {
    const keys = keysOf(r)
    const reasons: Record<string, MatchReason> = {}
    for (const k of keys) {
      for (const id of byKey.get(k) ?? []) {
        if (id === r.crmId || dismissed[r.crmId]?.includes(id) || dismissed[id]?.includes(r.crmId)) continue
        const prev = reasons[id]
        const next = reasonOfKey(k)
        if (!prev || REASON_ORDER.indexOf(next) < REASON_ORDER.indexOf(prev)) reasons[id] = next
      }
    }
    const duplicates = Object.keys(reasons)
    const client = keys.map((k) => clientByKey.get(k)).find(Boolean) ?? null
    if (duplicates.length || client) out.set(r.crmId, { duplicates, client, reasons })
  }
  return out
}

/** Two records the staff confirmed are one person: the older stays, the newer moves in. */
export function mergeDirection(a: Pick<LeadRow, "crmId" | "createdMs">, b: Pick<LeadRow, "crmId" | "createdMs">) {
  const [keep, drop] = (a.createdMs || Infinity) <= (b.createdMs || Infinity) ? [a, b] : [b, a]
  return { keep: keep.crmId, drop: drop.crmId }
}

const contactKey = (c: Pick<CrmContact, "name" | "phone" | "email">) => phoneKey(c.phone) || emailKey(c.email) || nameKey(c.name) || c.name.trim().toLowerCase()

/** The kept record after a merge: contacts without twins, the kept record's own
 * owner / plan / value — and the other's where the kept one has none. */
export function mergeRecords(keep: ClientRecord, drop: ClientRecord): ClientRecord {
  const seen = new Set<string>()
  const contacts: CrmContact[] = []
  for (const c of [...(keep.contacts ?? []), ...(drop.contacts ?? [])]) {
    const k = contactKey(c)
    if (seen.has(k)) continue
    seen.add(k)
    contacts.push(c)
  }
  if (contacts.length && !contacts.some((c) => c.primary)) contacts[0] = { ...contacts[0], primary: true }
  return {
    ...keep,
    ownerUid: keep.ownerUid || drop.ownerUid || "",
    ownerName: keep.ownerUid ? keep.ownerName ?? "" : drop.ownerUid ? drop.ownerName ?? "" : "",
    plan: keep.plan || drop.plan,
    expectedValue: keep.expectedValue || drop.expectedValue,
    expectedClose: keep.expectedClose || drop.expectedClose,
    contacts,
    lastContactAt: [keep.lastContactAt ?? "", drop.lastContactAt ?? ""].sort().pop() || "",
  }
}

type MergeSide = { crmId: string; name: string; phone: string; email: string }

/** ADM-09: what a merge writes onto the kept record, and how many people it brings over. Both sides count with their
 * requester when no contact was entered yet — the person who asked IS a contact — so the other's requester is not lost;
 * it gets an id of its own so it can never collide with the kept record's. */
export function planMerge(keep: MergeSide, drop: MergeSide, records: Record<string, ClientRecord>): { record: ClientRecord; contactsMoved: number } {
  const strip = (r: ClientRecord & { id?: string }) => {
    const { id: _id, ...rest } = r
    return rest as ClientRecord
  }
  const keepRec = strip(records[keep.crmId] ?? {})
  const dropRec = strip(records[drop.crmId] ?? {})
  const keepContacts = effectiveContacts(keepRec.contacts, keep)
  const dropContacts = effectiveContacts(dropRec.contacts, drop).map((c) => (c.id === "origin" ? { ...c, id: `c_from_${drop.crmId}`, primary: false } : c))
  const record = mergeRecords({ ...keepRec, contacts: keepContacts }, { ...dropRec, contacts: dropContacts })
  return { record, contactsMoved: (record.contacts?.length ?? 0) - keepContacts.length }
}

// ── Intake: how many leads came in, by week and by month ─────────────────────
// What the ad campaigns are measured on. The week runs Sunday to Saturday (the
// Saudi working week starts on Sunday); months are calendar months, local time.
// Removed leads still count — they arrived.

export type LeadIntake = {
  thisWeek: number
  lastWeek: number
  thisMonth: number
  lastMonth: number
  /** This month, by where the lead came from. */
  bySource: Record<LeadChannel, number>
}

export function leadIntake(rows: Array<Pick<LeadRow, "createdMs" | "channel">>, now: Date): LeadIntake {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() - day.getDay()).getTime()
  const lastWeekStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() - day.getDay() - 7).getTime()
  const monthStart = new Date(day.getFullYear(), day.getMonth(), 1).getTime()
  const lastMonthStart = new Date(day.getFullYear(), day.getMonth() - 1, 1).getTime()
  const out: LeadIntake = { thisWeek: 0, lastWeek: 0, thisMonth: 0, lastMonth: 0, bySource: { demo: 0, onboarding: 0, ad: 0, outreach: 0, other: 0 } }
  for (const r of rows) {
    const t = r.createdMs
    if (!t) continue
    if (t >= weekStart) out.thisWeek += 1
    else if (t >= lastWeekStart) out.lastWeek += 1
    if (t >= monthStart) {
      out.thisMonth += 1
      out.bySource[r.channel] += 1
    } else if (t >= lastMonthStart) out.lastMonth += 1
  }
  return out
}

export const manualLeadSchema = z
  .object({
    source: z.enum(MANUAL_CHANNELS),
    kind: z.enum(["contractor", "supplier", "unspecified"]),
    name: z.string().trim().min(2).max(200),
    company: z.string().trim().max(200),
    phone: z.string().trim().max(30).regex(/^[+\d\s().\-]*$/),
    email: z.string().trim().toLowerCase().max(200),
    city: z.string().trim().max(100),
    ownerUid: z.string(),
    note: z.string().trim().max(1000),
  })
  .refine((v) => v.phone.length >= 7 || v.email.length > 0, { path: ["phone"] })
  .refine((v) => v.email === "" || z.string().email().safeParse(v.email).success, { path: ["email"] })

/** A lead's own details, edited from the header of its page (ADM-05): name, and a phone or an e-mail to reach it by. */
export const leadDetailsSchema = z
  .object({
    kind: z.enum(["contractor", "supplier", "unspecified"]),
    name: z.string().trim().min(2).max(200),
    company: z.string().trim().max(200),
    phone: z.string().trim().max(30).regex(/^[+\d\s().\-]*$/),
    email: z.string().trim().toLowerCase().max(200),
    city: z.string().trim().max(100),
  })
  .refine((v) => v.phone.length >= 7 || v.email.length > 0, { path: ["phone"] })
  .refine((v) => v.email === "" || z.string().email().safeParse(v.email).success, { path: ["email"] })
export type LeadDetails = z.infer<typeof leadDetailsSchema>

export const contactSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    title: z.string().trim().max(100),
    phone: z.string().trim().max(30).regex(/^[+\d\s().\-]*$/),
    email: z.string().trim().toLowerCase().max(200),
    primary: z.boolean(),
  })
  .refine((v) => v.phone.length >= 7 || v.email.length > 0, { path: ["phone"] })
  .refine((v) => v.email === "" || z.string().email().safeParse(v.email).success, { path: ["email"] })

/** The people of a lead or client: those entered, or — before any is — the one who asked, as the main contact. */
export function effectiveContacts(stored: CrmContact[] | undefined, fallback: { name: string; phone: string; email: string }): CrmContact[] {
  if (stored?.length) return stored
  if (!fallback.name && !fallback.phone && !fallback.email) return []
  return [{ id: "origin", name: fallback.name, title: "", phone: fallback.phone, email: fallback.email, primary: true }]
}

/** Exactly one main contact: a new main demotes the others; none left promotes the first. */
export function withPrimary(list: CrmContact[], primaryId?: string): CrmContact[] {
  const id = primaryId ?? list.find((c) => c.primary)?.id ?? list[0]?.id
  return list.map((c) => ({ ...c, primary: c.id === id }))
}

// ── Display (ADM-11) ─────────────────────────────────────────────────────────

/** One date format everywhere: «21 أكتوبر 2026» / «21 Oct 2026». Accepts ms, a Date, or yyyy-mm-dd. */
export function formatCrmDate(value: number | string | Date | null | undefined, locale: string): string {
  if (value === null || value === undefined || value === "" || value === 0) return "—"
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", { day: "numeric", month: locale === "ar" ? "long" : "short", year: "numeric" })
}

/** «50 – 10 employees», «10-50», «201+» → «10–50» / «201+», in numbers only — the caller adds the unit in the UI language. */
export function companySizeRange(size: string | null | undefined): string {
  const nums = (size ?? "").match(/\d+/g)?.map(Number) ?? []
  if (nums.length === 0) return ""
  if (nums.length === 1) return /\+|plus|more|أكثر/i.test(size ?? "") ? `${nums[0]}+` : String(nums[0])
  const [a, b] = [nums[0], nums[1]].sort((x, y) => x - y)
  return `${a}–${b}`
}

/** The money figure, grouped, Latin digits, no currency sign (the screen adds the riyal glyph). */
export function formatAmount(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}

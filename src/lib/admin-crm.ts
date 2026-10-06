import { z } from "zod"
import { leadCompanyTypes, type CompanyType, type LeadTypeFields } from "@/lib/company-types"
import { foldSearchText } from "@/lib/search-text"

export const CLIENT_STAGES = ["onboarding", "active", "at_risk", "churned"] as const
export type ClientStage = (typeof CLIENT_STAGES)[number]

export const ACTIVITY_TYPES = ["call", "meeting", "email", "note"] as const
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
}

export type ClientRecord = {
  stage?: string
  /** The subscription (clients) — CLIENT_PLANS. */
  plan?: string
  /** The contact's national ID / iqama / passport number. */
  idNo?: string
  /** Set by hand when the derived source is wrong — CLIENT_SOURCES. */
  source?: string
  ownerUid?: string
  ownerName?: string
  nextFollowUp?: string
  lastContactAt?: string
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
  idNo: string
  stage: ClientStage
  ownerUid: string
  ownerName: string
  nextFollowUp: string
  lastContactAt: string
  daysSinceContact: number | null
  followUpDue: boolean
  stale: boolean
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

export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

export function buildClientRows(
  users: ClientUser[],
  records: Record<string, ClientRecord>,
  now: Date,
): ClientRow[] {
  const today = toDateKey(now)
  const rows: ClientRow[] = []
  for (const u of users) {
    if (u.role !== "Contractor" && u.role !== "Supplier") continue
    const rec = records[u.id] ?? {}
    const stage = isClientStage(rec.stage) ? rec.stage : "onboarding"
    const lastContactAt = rec.lastContactAt ?? ""
    const lastMs = lastContactAt ? Date.parse(lastContactAt) : NaN
    const daysSinceContact = Number.isNaN(lastMs) ? null : Math.max(0, Math.floor((now.getTime() - lastMs) / DAY_MS))
    const nextFollowUp = rec.nextFollowUp ?? ""
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
      idNo: rec.idNo ?? "",
      stage,
      ownerUid: rec.ownerUid ?? "",
      ownerName: rec.ownerName ?? "",
      nextFollowUp,
      lastContactAt,
      daysSinceContact,
      followUpDue: nextFollowUp !== "" && nextFollowUp <= today && stage !== "churned",
      stale: stage !== "churned" && (daysSinceContact === null || daysSinceContact > STALE_DAYS),
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

export function contactsClient(type: ActivityType): boolean {
  return type !== "note"
}

export const LEAD_STAGES = ["new", "contacted", "demo", "negotiation", "lost"] as const
export type LeadStage = (typeof LEAD_STAGES)[number]
export type LeadViewStage = LeadStage | "converted"

export const LEAD_SOURCES = ["demo", "onboarding", "manual"] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

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
  /** Removed from the list by platform staff (junk, a duplicate) — kept, and restorable. */
  archived?: boolean
  createdAt?: { seconds?: number } | null
}

export type LeadRow = {
  id: string
  crmId: string
  source: LeadSource
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
  archived: boolean
  idNo: string
  stage: LeadViewStage
  ownerUid: string
  ownerName: string
  nextFollowUp: string
  lastContactAt: string
  createdMs: number
  daysSinceContact: number | null
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

export function buildLeadRows(leads: LeadDoc[], records: Record<string, ClientRecord>, now: Date): LeadRow[] {
  const today = toDateKey(now)
  return leads.map((l) => {
    const crmId = leadCrmId(l.source, l.id)
    const rec = records[crmId] ?? {}
    const converted = l.status === "converted"
    const stage: LeadViewStage = converted ? "converted" : isLeadStage(rec.stage) ? rec.stage : "new"
    const createdMs = l.createdAt?.seconds ? l.createdAt.seconds * 1000 : 0
    const lastContactAt = rec.lastContactAt ?? ""
    const lastMs = lastContactAt ? Date.parse(lastContactAt) : NaN
    const daysSinceContact = Number.isNaN(lastMs) ? null : Math.max(0, Math.floor((now.getTime() - lastMs) / DAY_MS))
    const nextFollowUp = rec.nextFollowUp ?? ""
    const closed = converted || stage === "lost"
    const silentDays = daysSinceContact ?? (createdMs ? Math.max(0, Math.floor((now.getTime() - createdMs) / DAY_MS)) : 0)
    const { types, other } = leadCompanyTypes(l)
    return {
      id: l.id,
      crmId,
      source: l.source,
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
      archived: l.archived === true,
      idNo: rec.idNo ?? "",
      stage,
      ownerUid: rec.ownerUid ?? "",
      ownerName: rec.ownerName ?? "",
      nextFollowUp,
      lastContactAt,
      createdMs,
      daysSinceContact,
      followUpDue: !closed && nextFollowUp !== "" && nextFollowUp <= today,
      stale: !closed && silentDays > LEAD_STALE_DAYS,
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

export type LeadMatch = { duplicates: string[]; client: string | null }

/** For each live lead: the other live leads that look like the same person, and
 * the registered client it already is (by name), if any. Removed leads are left out. */
export function leadMatches(rows: LeadRow[], clients: Array<{ name: string; email: string; phone: string }>): Map<string, LeadMatch> {
  const live = rows.filter((r) => !r.archived)
  const byKey = new Map<string, string[]>()
  for (const r of live) for (const k of keysOf(r)) byKey.set(k, [...(byKey.get(k) ?? []), r.crmId])
  const clientByKey = new Map<string, string>()
  for (const c of clients) for (const k of keysOf(c)) if (!clientByKey.has(k)) clientByKey.set(k, c.name)
  const out = new Map<string, LeadMatch>()
  for (const r of live) {
    const keys = keysOf(r)
    const duplicates = Array.from(new Set(keys.flatMap((k) => byKey.get(k) ?? []))).filter((id) => id !== r.crmId)
    const client = keys.map((k) => clientByKey.get(k)).find(Boolean) ?? null
    if (duplicates.length || client) out.set(r.crmId, { duplicates, client })
  }
  return out
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
  bySource: Record<LeadSource, number>
}

export function leadIntake(rows: Array<Pick<LeadRow, "createdMs" | "source">>, now: Date): LeadIntake {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() - day.getDay()).getTime()
  const lastWeekStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() - day.getDay() - 7).getTime()
  const monthStart = new Date(day.getFullYear(), day.getMonth(), 1).getTime()
  const lastMonthStart = new Date(day.getFullYear(), day.getMonth() - 1, 1).getTime()
  const out: LeadIntake = { thisWeek: 0, lastWeek: 0, thisMonth: 0, lastMonth: 0, bySource: { demo: 0, onboarding: 0, manual: 0 } }
  for (const r of rows) {
    const t = r.createdMs
    if (!t) continue
    if (t >= weekStart) out.thisWeek += 1
    else if (t >= lastWeekStart) out.lastWeek += 1
    if (t >= monthStart) {
      out.thisMonth += 1
      out.bySource[r.source] += 1
    } else if (t >= lastMonthStart) out.lastMonth += 1
  }
  return out
}

export const manualLeadSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    company: z.string().trim().max(200),
    phone: z.string().trim().max(30).regex(/^[+\d\s().\-]*$/),
    email: z.string().trim().toLowerCase().max(200),
    note: z.string().trim().max(1000),
  })
  .refine((v) => v.phone.length >= 7 || v.email.length > 0, { path: ["phone"] })
  .refine((v) => v.email === "" || z.string().email().safeParse(v.email).success, { path: ["email"] })

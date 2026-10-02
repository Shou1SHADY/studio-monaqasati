import { z } from "zod"

export const CLIENT_STAGES = ["onboarding", "active", "at_risk", "churned"] as const
export type ClientStage = (typeof CLIENT_STAGES)[number]

export const ACTIVITY_TYPES = ["call", "meeting", "email", "note"] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const STALE_DAYS = 30

export type ClientUser = {
  id: string
  role?: string
  name?: string
  email?: string
  phone?: string
  city?: string
  isVerified?: boolean
}

export type ClientRecord = {
  stage?: string
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

export type LeadDoc = {
  id: string
  source: LeadSource
  name?: string
  company?: string
  phone?: string
  email?: string
  status?: string
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
  converted: boolean
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
    return {
      id: l.id,
      crmId,
      source: l.source,
      name: l.name?.trim() || l.company?.trim() || l.email || l.id,
      company: l.company?.trim() ?? "",
      phone: l.phone ?? "",
      email: l.email ?? "",
      converted,
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
    byStage[r.stage] += 1
    const closed = r.stage === "lost" || r.stage === "converted"
    if (!closed) open += 1
    if (r.followUpDue) followUpsDue += 1
    if (r.stale) stale += 1
    if (!closed && !r.ownerUid) unowned += 1
  }
  return { total: rows.length, open, byStage, followUpsDue, stale, unowned }
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

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

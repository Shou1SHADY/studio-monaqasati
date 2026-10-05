// Activities — the scheduled follow-ups of the platform (DEV-69, the Odoo
// reference): a to-do, a call, a meeting, an e-mail or a document to upload,
// planned for a day, given to a person, optionally attached to the document it
// is about. "My to-dos" is one list across modules, grouped overdue · today ·
// planned. Pure: no I/O.

export const ACTIVITIES = "activities"

export const ACTIVITY_TYPES = ["todo", "call", "meeting", "email", "document"] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const ACTIVITY_STATUSES = ["open", "done", "cancelled"] as const
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number]

/** The kinds of document an activity can hang on. */
export const ACTIVITY_TARGET_KINDS = ["rfq", "offer", "po", "receipt", "invoice", "project", "supplier", "quotation", "other"] as const
export type ActivityTargetKind = (typeof ACTIVITY_TARGET_KINDS)[number]

export interface ActivityTarget {
  kind: ActivityTargetKind
  id: string
  /** What the person reads: "PO-2026/012". */
  label: string
  /** Portal-relative path that opens the document: "/contractor/rfqs/orders?po=…". */
  href: string
}

export interface Activity {
  id: string
  organizationId: string
  type: ActivityType
  summary: string
  note: string | null
  /** `YYYY-MM-DD`. */
  dueOn: string
  assigneeId: string
  assigneeName: string
  createdById: string
  createdByName: string
  status: ActivityStatus
  target: ActivityTarget | null
  /** `kind:id` — what a document's own list of activities is queried by. */
  targetKey: string | null
  doneOn?: string | null
  doneById?: string | null
  doneByName?: string | null
  feedback?: string | null
}

export const SUMMARY_MAX = 120
export const NOTE_MAX = 1000

export const targetKeyOf = (t: Pick<ActivityTarget, "kind" | "id"> | null | undefined): string | null => (t ? `${t.kind}:${t.id}` : null)

export const isOpen = (a: Pick<Activity, "status">): boolean => a.status === "open"

const DAY_MS = 86_400_000
const dayMs = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`)

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number => Math.round((dayMs(to) - dayMs(from)) / DAY_MS)

export type ActivityBucket = "overdue" | "today" | "planned"

export function bucketOf(a: Pick<Activity, "dueOn">, today: string): ActivityBucket {
  return a.dueOn < today ? "overdue" : a.dueOn === today ? "today" : "planned"
}

/** How far the due date is: `kind` picks the sentence, `days` fills it. */
export function dueLabel(a: Pick<Activity, "dueOn">, today: string): { kind: "overdue" | "today" | "tomorrow" | "in"; days: number } {
  const d = daysBetween(today, a.dueOn)
  if (d < 0) return { kind: "overdue", days: -d }
  if (d === 0) return { kind: "today", days: 0 }
  if (d === 1) return { kind: "tomorrow", days: 1 }
  return { kind: "in", days: d }
}

const byDue = (a: Activity, b: Activity) => a.dueOn.localeCompare(b.dueOn) || a.summary.localeCompare(b.summary) || a.id.localeCompare(b.id)

export interface ActivityGroups {
  overdue: Activity[]
  today: Activity[]
  planned: Activity[]
}

/** The open activities of one person, grouped; the oldest overdue first. */
export function groupMine(all: Activity[], uid: string, today: string): ActivityGroups {
  const mine = all.filter((a) => isOpen(a) && a.assigneeId === uid).sort(byDue)
  return {
    overdue: mine.filter((a) => bucketOf(a, today) === "overdue"),
    today: mine.filter((a) => bucketOf(a, today) === "today"),
    planned: mine.filter((a) => bucketOf(a, today) === "planned"),
  }
}

export interface ActivityCounts {
  overdue: number
  today: number
  planned: number
  /** What needs attention now: overdue plus today. */
  due: number
}

export function countsOf(groups: ActivityGroups): ActivityCounts {
  return { overdue: groups.overdue.length, today: groups.today.length, planned: groups.planned.length, due: groups.overdue.length + groups.today.length }
}

/** What was done lately, newest first. */
export function recentlyDone(all: Activity[], limit = 10): Activity[] {
  return all
    .filter((a) => a.status === "done")
    .sort((a, b) => (b.doneOn ?? "").localeCompare(a.doneOn ?? "") || b.id.localeCompare(a.id))
    .slice(0, limit)
}

/** A document's own activities: open ones by due date, then the closed ones, newest first. */
export function forRecord(all: Activity[], key: string): Activity[] {
  const here = all.filter((a) => a.targetKey === key)
  return [...here.filter(isOpen).sort(byDue), ...here.filter((a) => !isOpen(a)).sort((a, b) => (b.doneOn ?? b.dueOn).localeCompare(a.doneOn ?? a.dueOn))]
}

export type ActivityBlock = "no_summary" | "summary_long" | "note_long" | "bad_type" | "bad_due" | "past_due" | "no_assignee"

export function activityBlocks(input: { type: string; summary: string; note?: string | null; dueOn: string; assigneeId: string; today: string }): ActivityBlock[] {
  const out: ActivityBlock[] = []
  const summary = input.summary.trim()
  if (!summary) out.push("no_summary")
  else if (summary.length > SUMMARY_MAX) out.push("summary_long")
  if ((input.note ?? "").trim().length > NOTE_MAX) out.push("note_long")
  if (!(ACTIVITY_TYPES as readonly string[]).includes(input.type)) out.push("bad_type")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) || Number.isNaN(dayMs(input.dueOn))) out.push("bad_due")
  else if (input.dueOn < input.today) out.push("past_due")
  if (!input.assigneeId.trim()) out.push("no_assignee")
  return out
}

/** The assignee, the one who planned it and the company owner may change an activity; nobody else. */
export function mayManage(a: Pick<Activity, "assigneeId" | "createdById" | "status">, uid: string, isOwner: boolean): boolean {
  return isOpen(a) && (a.assigneeId === uid || a.createdById === uid || isOwner)
}

/** A rescheduled date must be today or later. */
export const rescheduleBlock = (dueOn: string, today: string): ActivityBlock | null =>
  !/^\d{4}-\d{2}-\d{2}$/.test(dueOn) || Number.isNaN(dayMs(dueOn)) ? "bad_due" : dueOn < today ? "past_due" : null

export function activityFromDoc(id: string, data: Record<string, unknown>): Activity {
  const text = (v: unknown) => (typeof v === "string" ? v : "")
  const target = (data.target ?? null) as ActivityTarget | null
  return {
    id,
    organizationId: text(data.organizationId),
    type: ((ACTIVITY_TYPES as readonly string[]).includes(text(data.type)) ? data.type : "todo") as ActivityType,
    summary: text(data.summary),
    note: typeof data.note === "string" && data.note ? data.note : null,
    dueOn: text(data.dueOn),
    assigneeId: text(data.assigneeId),
    assigneeName: text(data.assigneeName),
    createdById: text(data.createdById),
    createdByName: text(data.createdByName),
    status: ((ACTIVITY_STATUSES as readonly string[]).includes(text(data.status)) ? data.status : "open") as ActivityStatus,
    target: target && typeof target === "object" && target.id ? target : null,
    targetKey: typeof data.targetKey === "string" ? data.targetKey : null,
    doneOn: typeof data.doneOn === "string" ? data.doneOn : null,
    doneById: typeof data.doneById === "string" ? data.doneById : null,
    doneByName: typeof data.doneByName === "string" ? data.doneByName : null,
    feedback: typeof data.feedback === "string" && data.feedback ? data.feedback : null,
  }
}

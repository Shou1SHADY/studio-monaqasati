// HR 1.0 — attendance (PRD AT-01…04, WF-04, WF-05). One document per
// workplace and month: each recorded day holds WHO was listed there and the
// exceptions only (AT-01: all present, then exceptions); days nobody recorded
// are filled only by a named declaration kept on record (AT-04); the month
// closes after it ends and never reopens (AT-03). Payroll reads closed months
// only. An office (HQ, department) and "unassigned" assume presence (AT-02):
// their unrecorded days do not block closing. Pure: no I/O.

import { isOffice, UNASSIGNED_SITE, type SiteType } from "./sites"
import { isHoliday, OFFICIAL_HOLIDAYS, type Holiday } from "./holidays"
import { addDays, monthRange } from "./statutory"
import type { ViolationCode } from "./penalties"

/** `hrAttendance/{orgId}__{siteId}__{yyyy-mm}`. */
export const attendanceId = (orgId: string, siteId: string, month: string) => `${orgId}__${siteId}__${month}`

export const DAY_EXCEPTIONS = ["absent", "sick", "permission"] as const
export type DayException = (typeof DAY_EXCEPTIONS)[number]

/** One person's exception on a day. Present with no overtime is not written. */
export interface AttendanceException {
  status?: DayException | null
  /** Overtime hours worked that day (art. 107). */
  ot?: number | null
  /** A violation seen that day — the penalty is decided by the HR manager. */
  violation?: ViolationCode | null
  note?: string | null
}

export interface DaySheet {
  by: string
  byName: string | null
  at: string
  /** Everyone on the sheet that day — present unless an exception says otherwise. */
  listed: string[]
  ex: Record<string, AttendanceException>
  /** "A worker here but not listed" — for HR to correct the assignment. */
  unlisted?: Array<{ name: string; note?: string | null }>
}

export interface Declaration {
  days: string[]
  /** The people on the workplace when declared — recorded present on those days. */
  employees: string[]
  /** AT-04 — each person is credited only the declared days he was on this workplace: from the day he
   * joined or moved in (`since`) to his last day (`until`). Older declarations carry neither. */
  since?: Record<string, string> | null
  until?: Record<string, string> | null
  /** "I state that these people were at work on these days" — ticked by whoever declared. */
  ack?: boolean
  by: string
  byName: string | null
  at: string
  note: string
}

export interface WorkplaceMonth {
  id: string
  organizationId: string
  siteId: string
  month: string
  days: Record<string, DaySheet>
  declarations: Declaration[]
  /** Set once; the rules refuse every change after it. `asIs` = closed with unrecorded days under the warn policy. */
  closed: { by: string; byName: string | null; at: string; asIs: boolean; missing: string[] } | null
}

/** Presence assumed (AT-02): offices and the unassigned bench. */
export const assumesPresence = (siteId: string, type: SiteType | null | undefined) => siteId === UNASSIGNED_SITE || (type ? isOffice(type) : false)

/** Friday is the weekly rest day (art. 104). */
export const isRestDay = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() === 5

export { isHoliday } from "./holidays"

export const monthOf = (day: string) => day.slice(0, 7)
export const monthOver = (month: string, today: string) => today > monthRange(month).end

/** Working days of the month that should have a record by now — through yesterday.
 * Fridays and the official holidays are not working days (WF-05 step 1). */
export function dueDays(month: string, today: string, holidays: readonly Holiday[] = OFFICIAL_HOLIDAYS): string[] {
  const { start, end } = monthRange(month)
  const last = today > end ? end : addDays(today, -1)
  const out: string[] = []
  for (let d = start; d <= last; d = addDays(d, 1)) if (!isRestDay(d) && !isHoliday(d, holidays)) out.push(d)
  return out
}

/** Days nobody recorded and nobody declared (WF-05 step 1). None where presence is assumed. A day before
 * anyone was on the workplace is not missing (AT-04): `from` is the first day someone was there
 * (`firstOnSite`) — null when nobody was there this month, so nothing is missing; left out, the month's 1st. */
export function missingDays(
  wm: Pick<WorkplaceMonth, "days" | "declarations"> | null,
  month: string,
  today: string,
  opts: { assumed: boolean; holidays?: readonly Holiday[]; from?: string | null }
): string[] {
  if (opts.assumed || opts.from === null) return []
  const declared = new Set((wm?.declarations ?? []).flatMap((d) => d.days))
  return dueDays(month, today, opts.holidays).filter((d) => (!opts.from || d >= opts.from) && !wm?.days?.[d] && !declared.has(d))
}

/** The first day a person was on his present workplace: the day he joined, or the day he moved in. */
export const arrivedOn = (e: { join?: string | null; siteSince?: string | null }): string | null => {
  const j = e.join ?? null
  const s = e.siteSince ?? null
  return j && s ? (s > j ? s : j) : (s ?? j)
}

/** The first day anyone was on a workplace in a month — the people placed there (from the day each arrived)
 * and anyone a sheet of the month lists. Null: nobody this month, so no day is missing (AT-04). */
export function firstOnSite(people: Array<{ join?: string | null; siteSince?: string | null; lastDay?: string | null }>, wm: Pick<WorkplaceMonth, "days"> | null, month: string): string | null {
  const { start, end } = monthRange(month)
  let first: string | null = null
  const take = (d: string | null) => {
    if (!d || d > end) return
    const x = d < start ? start : d
    if (!first || x < first) first = x
  }
  for (const p of people) if (!p.lastDay || p.lastDay >= start) take(arrivedOn(p))
  for (const [d, s] of Object.entries(wm?.days ?? {})) if (s.listed?.length) take(d)
  return first
}

/** Where a workplace's month stands (§5 Sites, AT-03): closed · up to date (every due day recorded) ·
 * behind since the first missing day. `through` is the last day with a record or a declaration. */
export type MonthStatus = { state: "closed" } | { state: "current"; through: string | null } | { state: "behind"; since: string; through: string | null; missing: number }

export function monthStatus(wm: Pick<WorkplaceMonth, "days" | "declarations" | "closed"> | null, missing: readonly string[]): MonthStatus {
  if (wm?.closed) return { state: "closed" }
  const recorded = [...Object.keys(wm?.days ?? {}), ...(wm?.declarations ?? []).flatMap((d) => d.days)].sort()
  const through = recorded.length ? recorded[recorded.length - 1] : null
  if (!missing.length) return { state: "current", through }
  return { state: "behind", since: missing[0], through, missing: missing.length }
}

// ---------------------------------------------------------------------------
// The day sheet (AT-01)
// ---------------------------------------------------------------------------

/**
 * Who is on a workplace's sheet on a day: assigned there, joined by that day
 * (no attendance before joining — a day back-filled later included), and not
 * past his last day. Someone serving his notice is still at work: he stays on
 * the sheet to his last day, and a settled leaver stays on the days he worked.
 */
export function onSheet(e: { siteId?: string | null; status: string; join?: string | null; lastDay?: string | null }, siteId: string, day: string): boolean {
  const here = siteId === UNASSIGNED_SITE ? !e.siteId : e.siteId === siteId
  if (!here) return false
  if (!e.join || e.join > day) return false
  if (e.status === "left") return Boolean(e.lastDay) && day <= (e.lastDay as string)
  if (e.status === "leaving") return !e.lastDay || day <= e.lastDay
  return true
}

/** Everyone inside an approved leave on a day — paid leave too: on leave is never absent (WF-07). */
export function onLeaveOn(requests: Array<{ employeeId: string; kind: string; state: string; leave?: { from: string; to: string } | null }>, day: string): Set<string> {
  const out = new Set<string>()
  for (const r of requests) if (r.kind === "leave" && r.state === "approved" && r.leave && day >= r.leave.from && day <= r.leave.to) out.add(r.employeeId)
  return out
}

/** One person's day as the site page shows it (§5 Sites "Today"): on leave · an exception · present on the
 * sheet (or assumed in an office) · not recorded yet — or the rest day. Same reading as `dutyToday`. */
export type DayState = "present" | "absent" | "sick" | "permission" | "leave" | "unrecorded" | "rest"

export function dayState(employeeId: string, sheet: Pick<DaySheet, "listed" | "ex"> | null | undefined, ctx: { onLeave: ReadonlySet<string>; assumed: boolean; day: string }): DayState {
  if (ctx.onLeave.has(employeeId)) return "leave"
  const ex = sheet?.ex?.[employeeId]?.status
  if (ex) return ex
  if (ctx.assumed || sheet?.listed?.includes(employeeId)) return "present"
  return isRestDay(ctx.day) ? "rest" : "unrecorded"
}

export type SheetBlock ="future" | "past" | "recorded" | "closed" | "not_listed" | "bad_ot" | "no_violation_role"

/** Hours of overtime one day may carry — a day has 24, a sheet row never more than 12. */
export const MAX_DAILY_OT = 12

/** WF-04 — "the day closes when it is recorded": the sheet is today's, saved once. A day already recorded
 * is locked; a past day with no sheet is filled only by the named declaration (AT-04). */
export function sheetBlocks(input: {
  day: string
  today: string
  closed: boolean
  /** A sheet is already on record for this day. */
  recorded?: boolean
  listed: string[]
  ex: Record<string, AttendanceException>
  mayRecordViolation: boolean
}): SheetBlock[] {
  const out: SheetBlock[] = []
  if (input.day > input.today) out.push("future")
  else if (input.day < input.today) out.push("past")
  if (input.recorded) out.push("recorded")
  if (input.closed) out.push("closed")
  const listed = new Set(input.listed)
  const ex = Object.entries(input.ex)
  if (ex.some(([id]) => !listed.has(id))) out.push("not_listed")
  if (ex.some(([, e]) => e.ot != null && !(e.ot >= 0 && e.ot <= MAX_DAILY_OT))) out.push("bad_ot")
  if (!input.mayRecordViolation && ex.some(([, e]) => e.violation)) out.push("no_violation_role")
  return out
}

/** Someone absent or sick that day worked no overtime — hours typed before the status changed are not kept. */
const worked = (status: DayException | null | undefined) => status !== "absent" && status !== "sick"

/** Keep only what is an exception — present with no overtime, violation or note is not written. */
export function compactExceptions(ex: Record<string, AttendanceException>): Record<string, AttendanceException> {
  const out: Record<string, AttendanceException> = {}
  for (const [id, e] of Object.entries(ex)) {
    const clean: AttendanceException = {}
    if (e.status) clean.status = e.status
    if (e.ot && e.ot > 0 && worked(e.status)) clean.ot = Math.round(e.ot * 4) / 4
    if (e.violation) clean.violation = e.violation
    if (e.note?.trim()) clean.note = e.note.trim()
    if (Object.keys(clean).length) out[id] = clean
  }
  return out
}

// ---------------------------------------------------------------------------
// Declaration and closing (AT-03, AT-04)
// ---------------------------------------------------------------------------

export type DeclareBlock = "no_days" | "no_note" | "no_ack" | "not_missing" | "closed"

/** AT-04 — a named declaration: the days, why they have no sheet, and the declarer's own statement that
 * these people were at work on them (`ack`). Left out, `ack` is not asked (an older caller). */
export function declareBlocks(input: { days: string[]; note: string; missing: string[]; closed: boolean; ack?: boolean }): DeclareBlock[] {
  const out: DeclareBlock[] = []
  if (input.closed) out.push("closed")
  if (!input.days.length) out.push("no_days")
  if (!input.note.trim()) out.push("no_note")
  if (input.ack === false) out.push("no_ack")
  const miss = new Set(input.missing)
  if (input.days.some((d) => !miss.has(d))) out.push("not_missing")
  return out
}

export type CloseBlock = "not_over" | "closed" | "missing"

/** Closing: after the month only; unrecorded days block (default) or warn (company policy). */
export function closeBlocks(input: { month: string; today: string; closed: boolean; missing: string[]; policy: "block" | "warn" }): { blocks: CloseBlock[]; warnings: "missing"[] } {
  const blocks: CloseBlock[] = []
  const warnings: "missing"[] = []
  if (input.closed) blocks.push("closed")
  if (!monthOver(input.month, input.today)) blocks.push("not_over")
  if (input.missing.length) (input.policy === "block" ? blocks : warnings).push("missing")
  return { blocks, warnings }
}

/** The days of a declaration one person is credited: from the day he was on the workplace to his last day. */
export function creditedDays(d: Pick<Declaration, "days" | "since" | "until">, employeeId: string): string[] {
  const from = d.since?.[employeeId]
  const to = d.until?.[employeeId]
  return d.days.filter((day) => (!from || day >= from) && (!to || day <= to))
}

/** Who a declaration credits, and from/to which day — the people on the workplace, each from the day he
 * joined or moved in, to his last day (AT-04). Someone who arrived after every declared day is left out. */
export function declarationRoster(
  people: Array<{ id: string; join?: string | null; siteSince?: string | null; lastDay?: string | null; status?: string | null }>,
  days: readonly string[]
): { employees: string[]; since: Record<string, string>; until: Record<string, string>; manDays: Record<string, number> } {
  const employees: string[] = []
  const since: Record<string, string> = {}
  const until: Record<string, string> = {}
  const manDays: Record<string, number> = {}
  const sorted = [...days].sort()
  for (const p of people) {
    const from = arrivedOn(p)
    const to = p.status === "leaving" || p.status === "left" ? (p.lastDay ?? null) : null
    const n = days.filter((d) => (!from || d >= from) && (!to || d <= to)).length
    if (!n) continue
    employees.push(p.id)
    // Only a bound that cuts the declared days is kept — everyone else is credited them all.
    if (from && from > sorted[0]) since[p.id] = from
    if (to && to < sorted[sorted.length - 1]) until[p.id] = to
    manDays[p.id] = n
  }
  return { employees, since, until, manDays }
}

// ---------------------------------------------------------------------------
// One person's month at one workplace — what payroll reads
// ---------------------------------------------------------------------------

export interface EmployeeMonth {
  present: number
  absent: number
  sick: number
  permission: number
  /** Days filled by a declaration, counted present — shown apart, never hidden. */
  declared: number
  overtimeHours: number
  violations: Array<{ day: string; code: ViolationCode }>
}

export const EMPTY_MONTH: EmployeeMonth = { present: 0, absent: 0, sick: 0, permission: 0, declared: 0, overtimeHours: 0, violations: [] }

export function employeeMonth(wm: Pick<WorkplaceMonth, "days" | "declarations"> | null, employeeId: string): EmployeeMonth {
  const out: EmployeeMonth = { ...EMPTY_MONTH, violations: [] }
  if (!wm) return out
  for (const [day, sheet] of Object.entries(wm.days ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!sheet.listed?.includes(employeeId)) continue
    const e = sheet.ex?.[employeeId]
    if (e?.status === "absent") out.absent++
    else if (e?.status === "sick") out.sick++
    else if (e?.status === "permission") out.permission++
    else out.present++
    if (e?.ot && worked(e.status)) out.overtimeHours += e.ot
    if (e?.violation) out.violations.push({ day, code: e.violation })
  }
  for (const d of wm.declarations ?? []) if (d.employees.includes(employeeId)) out.declared += creditedDays(d, employeeId).length
  return out
}

/** Add one workplace's month to another's — a person moved mid-month is paid from both. */
export function addMonths(a: EmployeeMonth, b: EmployeeMonth): EmployeeMonth {
  return {
    present: a.present + b.present,
    absent: a.absent + b.absent,
    sick: a.sick + b.sick,
    permission: a.permission + b.permission,
    declared: a.declared + b.declared,
    overtimeHours: a.overtimeHours + b.overtimeHours,
    violations: [...a.violations, ...b.violations],
  }
}

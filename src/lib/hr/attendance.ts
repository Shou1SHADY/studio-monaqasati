// HR 1.0 — attendance (PRD AT-01…04, WF-04, WF-05). One document per
// workplace and month: each recorded day holds WHO was listed there and the
// exceptions only (AT-01: all present, then exceptions); days nobody recorded
// are filled only by a named declaration kept on record (AT-04); the month
// closes after it ends and never reopens (AT-03). Payroll reads closed months
// only. An office (HQ, department) and "unassigned" assume presence (AT-02):
// their unrecorded days do not block closing. Pure: no I/O.

import { isOffice, UNASSIGNED_SITE, type SiteType } from "./sites"
import { addDays, monthRange } from "./statutory"
import type { Holiday } from "./leave"
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

export function isHoliday(day: string, holidays: Holiday[] = []): boolean {
  return holidays.some((h) => day >= h.from && day <= addDays(h.from, h.days - 1))
}

export const monthOf = (day: string) => day.slice(0, 7)
export const monthOver = (month: string, today: string) => today > monthRange(month).end

/** Working days of the month that should have a record by now — through yesterday. */
export function dueDays(month: string, today: string, holidays: Holiday[] = []): string[] {
  const { start, end } = monthRange(month)
  const last = today > end ? end : addDays(today, -1)
  const out: string[] = []
  for (let d = start; d <= last; d = addDays(d, 1)) if (!isRestDay(d) && !isHoliday(d, holidays)) out.push(d)
  return out
}

/** Days nobody recorded and nobody declared (WF-05 step 1). None where presence is assumed. */
export function missingDays(wm: Pick<WorkplaceMonth, "days" | "declarations"> | null, month: string, today: string, opts: { assumed: boolean; holidays?: Holiday[] }): string[] {
  if (opts.assumed) return []
  const declared = new Set((wm?.declarations ?? []).flatMap((d) => d.days))
  return dueDays(month, today, opts.holidays).filter((d) => !wm?.days?.[d] && !declared.has(d))
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

export type SheetBlock = "future" | "closed" | "not_listed" | "bad_ot" | "no_violation_role"

/** Hours of overtime one day may carry — a day has 24, a sheet row never more than 12. */
export const MAX_DAILY_OT = 12

export function sheetBlocks(input: { day: string; today: string; closed: boolean; listed: string[]; ex: Record<string, AttendanceException>; mayRecordViolation: boolean }): SheetBlock[] {
  const out: SheetBlock[] = []
  if (input.day > input.today) out.push("future")
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

export type DeclareBlock = "no_days" | "no_note" | "not_missing" | "closed"

export function declareBlocks(input: { days: string[]; note: string; missing: string[]; closed: boolean }): DeclareBlock[] {
  const out: DeclareBlock[] = []
  if (input.closed) out.push("closed")
  if (!input.days.length) out.push("no_days")
  if (!input.note.trim()) out.push("no_note")
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
  for (const d of wm.declarations ?? []) if (d.employees.includes(employeeId)) out.declared += d.days.length
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

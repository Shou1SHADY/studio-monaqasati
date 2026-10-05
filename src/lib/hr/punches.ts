// HR 1.0 — punches, devices, geofence (PRD PT-01…08, SH-05, forms 20/21/22;
// optional: punch). Whatever the source, payroll reads the same daily status:
// the workplace month's sheet (`hrAttendance.days`) stays the record. A punch
// is EVIDENCE — the system proposes and a person decides, nothing is deducted
// or marked absent automatically (PT-04): a late arrival is excused or made a
// violation, no punch becomes permission or absence, a missing out-punch is set
// to the shift's end (no overtime on an incomplete day), punch overtime is
// approved or refused with its reason (PT-05 — unapproved overtime never
// reaches payroll), a punch outside the fence is accepted or not. When a day's
// exceptions are decided its sheet is recorded from the punches, once, like
// any sheet (WF-04).
//
// Where the evidence lives:
//  - device files (CSV — employee no · date · time) and every decision ride the
//    workplace month (`hrAttendance/{org}__{site}__{yyyy-mm}`): `pd[day][emp]`
//    the punches, `pdx[day][emp]` the decisions, `xs[day][emp]` someone who
//    punched here but is assigned elsewhere, `imports[]` each file read — so
//    the month's lock and readers apply to them unchanged;
//  - the employee's own punch from My file sits on his record (`pn` today,
//    `py` the day before), the time stamped by the server, his location read at
//    that moment only, inside or outside the workplace's radius (+30 m margin).
// Pure: no I/O.

import type { HrContext } from "./access"
import { hrAllowed } from "./access"
import type { AttendanceException, WorkplaceMonth } from "./attendance"
import { isRestDay, onLeaveOn, onSheet } from "./attendance"
import { isHoliday, isRamadan } from "./holidays"
import type { ViolationCode } from "./penalties"
import type { HrRequest } from "./requests"
import { hm, mh, shiftOf, siteShifts, type EmployeeShift, type SiteShifts } from "./shifts"
import { UNASSIGNED_SITE, type SiteType } from "./sites"
import { addDays, daysBetween, STATUTORY } from "./statutory"
import type { TodayItem } from "./today"

// ---------------------------------------------------------------------------
// The workplace's attendance source (form `am`, PT-01)
// ---------------------------------------------------------------------------

export const ATT_SOURCES = ["sheet", "device", "app"] as const
export type AttSource = (typeof ATT_SOURCES)[number]

/** `hrSites/{id}.att` — written by the HR manager; applies from the day it is saved. */
export interface SiteAttendance {
  source: AttSource
  /** One daily schedule ("HH:MM"), when the workplace runs no shifts. */
  schedule?: { in: string; out: string } | null
  /** Lateness grace in minutes (PT-08, 0–60). */
  grace?: number | null
  /** The geofence of an app workplace: its centre and radius in metres (PT-06). */
  geo?: { lat: number | null; lng: number | null; r: number } | null
  by?: string | null
  byName?: string | null
  at?: string | null
}

/** A workplace as the punch screens read it — `hrSites` plus the two optional blocks. */
export interface PunchSite {
  id: string
  name?: string
  nameEn?: string | null
  type: SiteType | null
  active?: boolean
  supervisorUserId?: string | null
  att?: SiteAttendance | null
  shifts?: SiteShifts | null
}

/** The prototype's amOf: with punch off — or the unassigned — the supervisor's sheet; otherwise the HR
 * manager's choice, or by type: workshop and warehouse a device, a project site the sheet, the rest the app. */
export function sourceOf(site: Pick<PunchSite, "id" | "type" | "att"> | null | undefined, punch: boolean): AttSource {
  if (!punch || !site || site.id === UNASSIGNED_SITE) return "sheet"
  const chosen = site.att?.source
  if (chosen && ATT_SOURCES.includes(chosen)) return chosen
  if (site.type === "workshop" || site.type === "warehouse") return "device"
  if (site.type === "project") return "sheet"
  return "app"
}

/** The prototype's SCHD — a project 06:30–15:30, workshop and warehouse 07:00–16:00, fleet 06:00–15:00, else 08:00–17:00. */
export const SCHEDULE_DEFAULTS: Partial<Record<SiteType, { in: string; out: string }>> = {
  project: { in: "06:30", out: "15:30" },
  workshop: { in: "07:00", out: "16:00" },
  warehouse: { in: "07:00", out: "16:00" },
  fleet: { in: "06:00", out: "15:00" },
}
export const OFFICE_SCHEDULE = { in: "08:00", out: "17:00" }

/** The company's default lateness grace (the prototype's POL.grace). */
export const DEFAULT_GRACE_MIN = 15
export const MAX_GRACE_MIN = 60
/** PT-06 — the geofence: a radius of at least 30 m (default 150) plus a 30 m accuracy margin, so nobody standing at
 * the gate is refused. */
export const GEO_MARGIN_M = 30
export const MIN_RADIUS_M = 30
export const DEFAULT_RADIUS_M = 150

export const siteSchedule = (site: Pick<PunchSite, "type" | "att"> | null | undefined) => site?.att?.schedule ?? (site?.type ? SCHEDULE_DEFAULTS[site.type] : null) ?? OFFICE_SCHEDULE
export const graceOf = (site: Pick<PunchSite, "att"> | null | undefined) => (typeof site?.att?.grace === "number" ? site.att.grace : DEFAULT_GRACE_MIN)

/** A day's working window in minutes after the day's midnight — `out` past 1440 runs into the next morning. */
export interface Schedule {
  in: number
  out: number
  night: boolean
}

/** The prototype's schOf: the worker's shift (or the workplace's one schedule); in Ramadan six hours (AT-06). */
export function scheduleOf(site: Pick<PunchSite, "type" | "att" | "shifts"> | null | undefined, emp: { shift?: EmployeeShift | null } | null, day: string): Schedule {
  const sh = siteShifts(site) ? shiftOf(emp ?? {}, site, day) : null
  const base = sh ?? siteSchedule(site)
  const i = hm(base.in) ?? 480
  let o = hm(base.out) ?? 1020
  const night = o <= i
  if (night) o += 1440
  if (isRamadan(day)) o = i + STATUTORY.ramadanHours * 60
  return { in: i, out: o, night }
}

export type SourceBlock = "bad_time" | "bad_grace" | "bad_radius" | "bad_point"

/** Form `am` — readable times that differ, a grace of 0–60 minutes, and for the app a radius of 30 m or more and
 * either both coordinates or none (a fence with no centre checks nothing). */
export function sourceBlocks(input: SiteAttendance): SourceBlock[] {
  const out: SourceBlock[] = []
  const s = input.schedule
  if (s && (hm(s.in) == null || hm(s.out) == null || s.in === s.out)) out.push("bad_time")
  if (input.grace != null && !(Number.isInteger(input.grace) && input.grace >= 0 && input.grace <= MAX_GRACE_MIN)) out.push("bad_grace")
  if (input.source === "app" && input.geo) {
    if (!(input.geo.r >= MIN_RADIUS_M)) out.push("bad_radius")
    const { lat, lng } = input.geo
    const has = (v: number | null) => typeof v === "number" && Number.isFinite(v)
    if (has(lat) !== has(lng) || (has(lat) && (Math.abs(lat as number) > 90 || Math.abs(lng as number) > 180))) out.push("bad_point")
  }
  return out
}

// ---------------------------------------------------------------------------
// The geofence (PT-06)
// ---------------------------------------------------------------------------

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))))
}

/** Inside the workplace's fence (radius + 30 m)? Null when the workplace has no centre set or no position was read. */
export function fenceCheck(site: Pick<PunchSite, "att"> | null | undefined, pos: { lat: number; lng: number } | null): { inside: boolean | null; d: number | null; r: number } {
  const g = site?.att?.geo
  const r = g?.r ?? DEFAULT_RADIUS_M
  if (!pos || typeof g?.lat !== "number" || typeof g?.lng !== "number") return { inside: null, d: null, r }
  const d = distanceM(pos, { lat: g.lat, lng: g.lng })
  return { inside: d <= r + GEO_MARGIN_M, d, r }
}

// ---------------------------------------------------------------------------
// The evidence and the decisions (stored on the workplace month)
// ---------------------------------------------------------------------------

export type PunchSrc = "dev" | "app" | "fix"

/** One person's punches on a shift day: first in, last out ("HH:MM", Riyadh). `geo` false = outside the fence. */
export interface PunchRec {
  in: string | null
  out: string | null
  src: PunchSrc
  geo?: boolean | null
}

export interface PunchStamp {
  by: string
  byName: string | null
  at: string
}

export const OT_REFUSALS = ["nowork", "wait", "err"] as const
export type OtRefusal = (typeof OT_REFUSALS)[number]

/** A person's decided exceptions on a day — each in its decider's name. */
export interface PunchDecision {
  late?: PunchStamp & { v: "excused" | "violation" }
  nop?: PunchStamp & { v: "permission" | "absent" }
  /** The out time set for a missing out-punch — the shift's end, never later (no overtime on an incomplete day). */
  out?: PunchStamp & { v: string }
  ot?: PunchStamp & { v: "ok" | OtRefusal; h: number }
  fence?: PunchStamp & { v: "ok" | "absent" }
}
export type PunchDecisionKind = keyof PunchDecision

/** One device file read (form `impdev`). */
export interface DeviceImport extends PunchStamp {
  rows: number
  saved: number
  dup: number
  dawn: number
  unknown: string[]
  /** The shift days the file covered — a device place has no "no punch" for a day no file covered. */
  days: string[]
}

/** The punch fields of `hrAttendance` — beside the sheet's `days`, never inside it. */
export interface PunchMonth {
  pd?: Record<string, Record<string, PunchRec>> | null
  pdx?: Record<string, Record<string, PunchDecision>> | null
  /** Punched here while assigned to the named workplace — cost follows the assignment (PT-04). */
  xs?: Record<string, Record<string, string | null>> | null
  imports?: DeviceImport[] | null
}

export type PunchWm = Pick<WorkplaceMonth, "siteId" | "month" | "days" | "closed"> & PunchMonth

/** `employees/{id}.pn` / `.py` — his own punch, server-stamped. */
export interface AppPunch {
  day: string
  siteId: string | null
  in: TimeLike
  out?: TimeLike | null
  at?: TimeLike | null
  inside?: boolean | null
  outInside?: boolean | null
  d?: number | null
}
export type TimeLike = { toDate: () => Date } | { seconds: number } | string | null | undefined

const RIYADH_MS = 3 * 3_600_000

/** A stored time as a Date (a Timestamp, its plain form, or an ISO string). */
export function timeOf(t: TimeLike): Date | null {
  if (!t) return null
  if (typeof t === "string") {
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if ("toDate" in t && typeof t.toDate === "function") return t.toDate()
  if ("seconds" in t && typeof t.seconds === "number") return new Date(t.seconds * 1000)
  return null
}

/** Minutes after midnight in Riyadh (UTC+3, no daylight saving). */
export const riyadhMinutes = (now: Date = new Date()) => {
  const d = new Date(now.getTime() + RIYADH_MS)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
export const riyadhHm = (t: TimeLike) => {
  const d = timeOf(t)
  return d ? mh(riyadhMinutes(d)) : null
}

/** His app punch for a day, as a punch record — from `pn` or `py`. */
export function appPunchOn(emp: { pn?: AppPunch | null; py?: AppPunch | null }, day: string): PunchRec | null {
  const p = emp.pn?.day === day ? emp.pn : emp.py?.day === day ? emp.py : null
  if (!p) return null
  const inside = p.inside === false || p.outInside === false ? false : p.inside === true ? true : null
  return { in: riyadhHm(p.in), out: riyadhHm(p.out ?? null), src: "app", geo: inside }
}

/** A day's punches on a workplace: what devices and corrections put on the month, and each person's own app punch. */
export function dayPunches(wm: PunchMonth | null | undefined, day: string, people: ReadonlyArray<{ id: string; pn?: AppPunch | null; py?: AppPunch | null }>): Record<string, PunchRec> {
  const out: Record<string, PunchRec> = { ...(wm?.pd?.[day] ?? {}) }
  for (const p of people) {
    const app = appPunchOn(p, day)
    if (!app) continue
    const have = out[p.id]
    out[p.id] = have ? { ...have, in: have.in ?? app.in, out: have.out ?? app.out, geo: have.geo ?? app.geo } : app
  }
  return out
}

/** A punch time as minutes inside the shift day: past midnight of a night shift (or an early hour long before it
 * starts) counts as the next morning. */
export function shiftMinutes(t: string | null | undefined, sc: Schedule): number | null {
  const m = hm(t)
  if (m == null) return null
  return (sc.night || sc.out > 1440) && m < sc.in - 360 ? m + 1440 : m
}

/** The violation a late arrival is, by minutes late (the penalties table: up to 15 · 30 · 60 · more). */
export const lateCode = (min: number): ViolationCode => (min <= 15 ? "late15" : min <= 30 ? "late30" : min <= 60 ? "late60" : "lateOver")

/** Overtime a punch shows: half an hour past the shift's end at least, in quarter hours. */
export const MIN_OT_MIN = 30
export const punchOtHours = (outMin: number, sc: Schedule) => (outMin - sc.out >= MIN_OT_MIN ? Math.floor((outMin - sc.out) / 15) / 4 : 0)

// ---------------------------------------------------------------------------
// Exceptions (PT-04, PT-05, `punchEx`)
// ---------------------------------------------------------------------------

export const PUNCH_EX_KINDS = ["nop", "late", "noout", "ot", "fence", "xsite"] as const
export type PunchExKind = (typeof PUNCH_EX_KINDS)[number]

export interface PunchEx {
  kind: PunchExKind
  employeeId: string
  siteId: string
  day: string
  /** Minutes late, hours of overtime, the punch times and the schedule, for the row's line. */
  min?: number
  h?: number
  in?: string | null
  out?: string | null
  sched: { in: string; out: string }
  /** xsite: the workplace he is assigned to. */
  assigned?: string | null
}

type Person = { id: string; shift?: EmployeeShift | null }

export interface SiteDay {
  site: PunchSite
  source: AttSource
  day: string
  today: string
  /** Minutes after midnight now, in Riyadh. */
  nowMin: number
  /** Everyone on the workplace's sheet that day (`onSheet`). */
  people: Person[]
  onLeave: ReadonlySet<string>
  punches: Record<string, PunchRec>
  decisions: Record<string, PunchDecision>
  recorded: boolean
  closed: boolean
  /** A device place: a file covered this day (no "no punch" before one did). */
  fileCovers: boolean
}

const restOrHoliday = (day: string) => isRestDay(day) || isHoliday(day)

/** The prototype's punchEx for one workplace and day — what waits for a person's decision. Nothing on a sheet
 * workplace, on a recorded day or in a closed month. */
export function siteDayExceptions(i: SiteDay): PunchEx[] {
  if (i.source === "sheet" || i.recorded || i.closed || i.day > i.today) return []
  const out: PunchEx[] = []
  const grace = graceOf(i.site)
  const rest = restOrHoliday(i.day)
  const yesterday = addDays(i.today, -1)
  // A day nobody punched on an app workplace is a day the app was not used — the sheet or the declaration fills it.
  const used = i.source === "device" ? i.fileCovers : i.people.some((p) => i.punches[p.id]?.in)
  for (const p of i.people) {
    if (i.onLeave.has(p.id)) continue
    const pr = i.punches[p.id]
    const d = i.decisions[p.id] ?? {}
    const sc = scheduleOf(i.site, p, i.day)
    const sched = { in: mh(sc.in), out: mh(sc.out) }
    const base = { employeeId: p.id, siteId: i.site.id, day: i.day, sched, in: pr?.in ?? null, out: pr?.out ?? null }
    if (d.fence?.v === "absent") continue
    const inMin = shiftMinutes(pr?.in, sc)
    if (inMin != null) {
      if (pr?.geo === false && pr.src !== "fix" && !d.fence) out.push({ ...base, kind: "fence" })
      if (inMin - sc.in > grace && !d.late) out.push({ ...base, kind: "late", min: inMin - sc.in })
      const outMin = d.out ? shiftMinutes(d.out.v, sc) : shiftMinutes(pr?.out, sc)
      if (outMin == null) {
        // The out-punch is missing once the shift is over (+2 h): yesterday's day shift, or a night shift's next morning.
        const over = i.day < yesterday || (i.day === yesterday && (!sc.night || i.nowMin > sc.out - 1440 + 120))
        if (over) out.push({ ...base, kind: "noout" })
      } else if (!d.out && !d.ot) {
        const h = punchOtHours(outMin, sc)
        if (h > 0) out.push({ ...base, kind: "ot", h })
      }
    } else if (!rest && !d.nop && used && (i.day < i.today || i.nowMin > sc.in + 120)) {
      out.push({ ...base, kind: "nop" })
    }
  }
  return out
}

/** Someone who punched here while assigned elsewhere (`xs`) — "cost follows the assignment" (PT-04). Shown until
 * his record places him here, for the last week. */
export function xsiteExceptions(wm: PunchWm, employees: ReadonlyArray<{ id: string; siteId: string | null }>, today: string): PunchEx[] {
  const out: PunchEx[] = []
  if (wm.closed) return out
  for (const [day, m] of Object.entries(wm.xs ?? {})) {
    if (daysBetween(day, today) > 7) continue
    for (const id of Object.keys(m ?? {})) {
      const e = employees.find((x) => x.id === id)
      if (!e || e.siteId === wm.siteId) continue
      out.push({ kind: "xsite", employeeId: id, siteId: wm.siteId, day, assigned: e.siteId ?? null, in: wm.pd?.[day]?.[id]?.in ?? null, sched: { in: "", out: "" } })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The day recorded from punches
// ---------------------------------------------------------------------------

export type PunchDayBlock = "today" | "recorded" | "closed" | "sheet" | "open" | "no_file" | "no_punches" | "nobody"

/** The sheet a day's punches and decisions make (AT-01): everyone on the workplace listed, present unless decided
 * absent or on permission, approved punch overtime as overtime. On a rest day or a holiday only those who punched
 * are listed. Recorded only once nothing waits for a decision (late arrivals never block — excusing or recording
 * the violation is its own act). */
export function punchDay(i: SiteDay): { listed: string[]; ex: Record<string, AttendanceException>; blocks: PunchDayBlock[]; present: number; absent: number } {
  const blocks: PunchDayBlock[] = []
  if (i.day >= i.today) blocks.push("today")
  if (i.recorded) blocks.push("recorded")
  if (i.closed) blocks.push("closed")
  if (i.source === "sheet") blocks.push("sheet")
  const rest = restOrHoliday(i.day)
  const anyPunch = i.people.some((p) => i.punches[p.id]?.in)
  if (i.source === "device" && !i.fileCovers && !anyPunch) blocks.push("no_file")
  if (i.source === "app" && !anyPunch && !rest) blocks.push("no_punches")
  const open = siteDayExceptions({ ...i, recorded: false, closed: false }).filter((x) => x.kind !== "late")
  if (open.length) blocks.push("open")
  const listed: string[] = []
  const ex: Record<string, AttendanceException> = {}
  let present = 0
  let absent = 0
  for (const p of i.people) {
    const pr = i.punches[p.id]
    const d = i.decisions[p.id] ?? {}
    if (rest && !pr?.in) continue
    listed.push(p.id)
    if (i.onLeave.has(p.id)) continue
    const status = d.fence?.v === "absent" ? "absent" : !pr?.in ? (d.nop?.v ?? null) : null
    const e: AttendanceException = {}
    if (status) e.status = status
    if (d.ot?.v === "ok" && d.ot.h > 0 && status !== "absent") e.ot = d.ot.h
    if (Object.keys(e).length) ex[p.id] = e
    if (status === "absent") absent++
    else present++
  }
  if (!listed.length) blocks.push("nobody")
  return { listed, ex, blocks, present, absent }
}

// ---------------------------------------------------------------------------
// The device file (form `impdev`, PT-02, SH-05)
// ---------------------------------------------------------------------------

export interface DeviceRow {
  line: number
  no: string
  day: string | null
  time: string | null
}

const isoDay = (y: number, m: number, d: number) => {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y < 2100)) return null
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : null
}

/** A device date: 2026-10-05 · 2026/10/05 · 05/10/2026 · 05-10-2026 (day first, as the devices sold here print it). */
export function deviceDay(v: string): string | null {
  const s = v.trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) return isoDay(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return isoDay(Number(m[3]), Number(m[2]), Number(m[1]))
  return null
}

/** The file's rows: employee no · date · time (a "date time" in the second column also reads). A first row whose
 * number is not a number is the header. */
export function deviceRows(table: string[][]): DeviceRow[] {
  const out: DeviceRow[] = []
  table.forEach((r, idx) => {
    const no = (r[0] ?? "").trim()
    if (idx === 0 && !/^\d+$/.test(no)) return
    let day = (r[1] ?? "").trim()
    let time = (r[2] ?? "").trim()
    if (!time && /\s/.test(day)) [day, time] = day.split(/\s+/, 2)
    const t = hm(time)
    out.push({ line: idx + 1, no, day: deviceDay(day), time: t == null ? null : mh(t) })
  })
  return out
}

/** Two reads of the same finger within five minutes are one punch. */
export const DUP_WINDOW_MIN = 5

export interface DeviceReview {
  rows: number
  /** Per person and shift day: first in, last out — what will be saved. */
  saved: Array<{ employeeId: string; day: string; in: string; out: string | null }>
  /** Matched rows kept. */
  punches: number
  dup: number
  /** A night worker's dawn punch — counted as the out of the shift that started the day before (SH-05). */
  dawn: number
  /** Numbers on no record (never create employees — temporary labour is Procurement's supply contract). */
  unknown: string[]
  /** Unreadable rows, and rows dated after today. */
  bad: number
  future: number
  /** On an approved leave that day — not saved (record his return first). */
  leave: Array<{ employeeId: string; day: string }>
  /** Assigned elsewhere — saved apart as an exception for the assignment (cost follows the assignment). */
  other: Array<{ employeeId: string; day: string; siteId: string | null; in: string }>
  late: number
  days: string[]
}

type DevEmp = { id: string; no: number; siteId: string | null; status?: string | null; shift?: EmployeeShift | null }

/** The prototype's readPunches, keyed by the file's own dates (the prototype ignored them). */
export function reviewDeviceFile(rows: DeviceRow[], ctx: { site: PunchSite; employees: readonly DevEmp[]; requests: ReadonlyArray<Pick<HrRequest, "employeeId" | "kind" | "state" | "leave">>; today: string }): DeviceReview {
  const r: DeviceReview = { rows: rows.length, saved: [], punches: 0, dup: 0, dawn: 0, unknown: [], bad: 0, future: 0, leave: [], other: [], late: 0, days: [] }
  const byNo = new Map(ctx.employees.filter((e) => e.status !== "left" && e.status !== "expected").map((e) => [String(e.no), e]))
  const groups = new Map<string, { emp: DevEmp; day: string; mins: number[] }>()
  const leaveSeen = new Set<string>()
  const otherSeen = new Map<string, { employeeId: string; day: string; siteId: string | null; in: string; min: number }>()
  for (const row of rows) {
    if (!row.day || !row.time || !row.no) {
      r.bad++
      continue
    }
    if (row.day > ctx.today) {
      r.future++
      continue
    }
    const emp = byNo.get(String(Number(row.no)))
    if (!emp) {
      if (!r.unknown.includes(row.no)) r.unknown.push(row.no)
      continue
    }
    const t = hm(row.time) as number
    const today = scheduleOf(ctx.site, emp, row.day)
    let day = row.day
    let min = t
    // SH-05 — a night worker's punch long before his shift starts closes yesterday's shift.
    if (today.night && t < today.in - 360) {
      day = addDays(row.day, -1)
      min = t + 1440
      r.dawn++
    }
    const key = `${emp.id}|${day}`
    if (onLeaveOn(ctx.requests as Parameters<typeof onLeaveOn>[0], day).has(emp.id)) {
      if (!leaveSeen.has(key)) r.leave.push({ employeeId: emp.id, day })
      leaveSeen.add(key)
      continue
    }
    if (emp.siteId !== ctx.site.id) {
      const o = otherSeen.get(key)
      if (!o || min < o.min) otherSeen.set(key, { employeeId: emp.id, day, siteId: emp.siteId, in: mh(min), min })
      continue
    }
    const g = groups.get(key) ?? { emp, day, mins: [] }
    g.mins.push(min)
    groups.set(key, g)
  }
  r.other = [...otherSeen.values()].map(({ min: _m, ...o }) => o)
  const days = new Set<string>()
  for (const g of groups.values()) {
    const sorted = [...g.mins].sort((a, b) => a - b)
    const kept: number[] = []
    for (const m of sorted) {
      if (kept.length && m - kept[kept.length - 1] < DUP_WINDOW_MIN) r.dup++
      else kept.push(m)
    }
    r.punches += kept.length
    const sc = scheduleOf(ctx.site, g.emp, g.day)
    if (kept[0] - sc.in > graceOf(ctx.site)) r.late++
    r.saved.push({ employeeId: g.emp.id, day: g.day, in: mh(kept[0]), out: kept.length > 1 ? mh(kept[kept.length - 1]) : null })
    days.add(g.day)
  }
  for (const o of r.other) days.add(o.day)
  r.saved.sort((a, b) => a.day.localeCompare(b.day) || a.employeeId.localeCompare(b.employeeId))
  r.days = [...days].sort()
  return r
}

/** A file's punch merged into what the day already holds: the earliest in, the latest out. A correction's punch
 * (`fix`) stays a correction. */
export function mergePunch(old: PunchRec | null | undefined, next: { in: string; out: string | null }, sc: Schedule): PunchRec {
  const times = [old?.in, old?.out, next.in, next.out].map((t) => ({ t, m: shiftMinutes(t, sc) })).filter((x): x is { t: string; m: number } => x.m != null)
  times.sort((a, b) => a.m - b.m)
  const first = times[0]
  const last = times[times.length - 1]
  return { in: first?.t ?? next.in, out: last && first && last.m - first.m >= DUP_WINDOW_MIN ? last.t : null, src: old?.src === "fix" ? "fix" : "dev", geo: old?.geo ?? null }
}

/** The latest device file read on a workplace across the months given. */
export function lastImport(months: ReadonlyArray<PunchMonth>): DeviceImport | null {
  let best: DeviceImport | null = null
  for (const m of months) for (const x of m.imports ?? []) if (!best || x.at > best.at) best = x
  return best
}

/** PT-03 — a silent device: the last file read more than a day ago ("no file means no attendance, overtime or
 * closing"). Null when none was ever read, or the last is recent. */
export function importLateDays(last: Pick<DeviceImport, "at"> | null, today: string): number | null {
  if (!last) return null
  const n = daysBetween(last.at.slice(0, 10), today)
  return n > 1 ? n : null
}

export const fileCovers = (months: ReadonlyArray<PunchMonth>, day: string) => months.some((m) => (m.imports ?? []).some((x) => x.days?.includes(day)))

// ---------------------------------------------------------------------------
// The whole picture — the Attendance tab, Today
// ---------------------------------------------------------------------------

type WorldEmp = Person & { siteId: string | null; status: string; join?: string | null; lastDay?: string | null; pn?: AppPunch | null; py?: AppPunch | null }

export interface PunchWorld {
  today: string
  nowMin: number
  punch: boolean
  employees: readonly WorldEmp[]
  sites: readonly PunchSite[]
  /** The workplace months read (this and last month). */
  months: readonly PunchWm[]
  requests: ReadonlyArray<Pick<HrRequest, "employeeId" | "kind" | "state" | "leave">>
  /** The workplaces the viewer may see — null: all. */
  scope?: readonly string[] | null
}

/** How far back undecided exceptions are shown — the correction window. */
export const PUNCH_WINDOW_DAYS = 7

const monthOfDay = (day: string) => day.slice(0, 7)

/** One workplace's day, ready for `siteDayExceptions` / `punchDay`. */
export function siteDay(w: PunchWorld, site: PunchSite, day: string): SiteDay {
  const wm = w.months.find((m) => m.siteId === site.id && m.month === monthOfDay(day)) ?? null
  const people = w.employees.filter((e) => onSheet(e, site.id, day))
  const siteMonths = w.months.filter((m) => m.siteId === site.id)
  // The source applies from the day it was chosen (form `am`: "applies from today"); before it, the sheet.
  const from = site.att?.at?.slice(0, 10) ?? null
  return {
    site,
    source: from && day < from ? "sheet" : sourceOf(site, w.punch),
    day,
    today: w.today,
    nowMin: w.nowMin,
    people,
    onLeave: onLeaveOn(w.requests as Parameters<typeof onLeaveOn>[0], day),
    punches: dayPunches(wm, day, people),
    decisions: wm?.pdx?.[day] ?? {},
    recorded: Boolean(wm?.days?.[day]),
    closed: Boolean(wm?.closed),
    fileCovers: fileCovers(siteMonths, day),
  }
}

const punchSites = (w: PunchWorld) => w.sites.filter((s) => s.active !== false && sourceOf(s, w.punch) !== "sheet" && (!w.scope || w.scope.includes(s.id)))

/** Every undecided exception the viewer may see, newest day first — the last week, today included. */
export function punchExceptions(w: PunchWorld): PunchEx[] {
  if (!w.punch) return []
  const out: PunchEx[] = []
  for (const site of punchSites(w))
    for (let n = 0; n <= PUNCH_WINDOW_DAYS; n++) {
      const day = addDays(w.today, -n)
      out.push(...siteDayExceptions(siteDay(w, site, day)))
    }
  for (const wm of w.months) if (!w.scope || w.scope.includes(wm.siteId)) out.push(...xsiteExceptions(wm, w.employees, w.today))
  return out.sort((a, b) => b.day.localeCompare(a.day) || PUNCH_EX_KINDS.indexOf(a.kind) - PUNCH_EX_KINDS.indexOf(b.kind))
}

/** Days of the open months a workplace may now record from its punches (nothing waits for a decision). */
export function readyDays(w: PunchWorld, site: PunchSite): Array<{ day: string; listed: string[]; ex: Record<string, AttendanceException>; present: number; absent: number }> {
  if (!w.punch || sourceOf(site, w.punch) === "sheet") return []
  const out: Array<{ day: string; listed: string[]; ex: Record<string, AttendanceException>; present: number; absent: number }> = []
  const months = [...new Set(w.months.filter((m) => m.siteId === site.id && !m.closed).map((m) => m.month))].sort()
  for (const month of months) {
    for (let d = `${month}-01`; d < w.today && monthOfDay(d) === month; d = addDays(d, 1)) {
      const sd = siteDay(w, site, d)
      if (sd.recorded) continue
      const r = punchDay(sd)
      if (!r.blocks.length) out.push({ day: d, ...r })
    }
  }
  return out
}

/** Present today by source (the Attendance tab's first number): those who punched in on a punch workplace. */
export function punchedToday(w: PunchWorld): { device: number; app: number; ids: Set<string> } {
  const ids = new Set<string>()
  let device = 0
  let app = 0
  for (const site of punchSites(w)) {
    const sd = siteDay(w, site, w.today)
    for (const p of sd.people) {
      if (!sd.punches[p.id]?.in || sd.onLeave.has(p.id)) continue
      ids.add(p.id)
      if (sd.source === "device") device++
      else app++
    }
  }
  return { device, app, ids }
}

/** PT-03 — device workplaces whose file has not been read for more than a day. */
export function silentDevices(w: PunchWorld): Array<{ site: PunchSite; days: number }> {
  if (!w.punch) return []
  return punchSites(w)
    .filter((s) => sourceOf(s, w.punch) === "device")
    .map((site) => ({ site, days: importLateDays(lastImport(w.months.filter((m) => m.siteId === site.id)), w.today) }))
    .filter((x): x is { site: PunchSite; days: number } => x.days !== null)
}

/** Today's rows for the punch feature (the prototype's x5Decisions): the HR manager — exceptions to decide; the HR
 * manager and payroll — a device file not read for more than a day; payroll — punch overtime and missing outs
 * before the month closes ("unapproved overtime never reaches payroll"); whoever records — days ready to record. */
export function punchTodayItems(ctx: HrContext, w: PunchWorld): TodayItem[] {
  if (!w.punch) return []
  const out: TodayItem[] = []
  const ex = punchExceptions(w)
  const count = (k: PunchExKind) => ex.filter((x) => x.kind === k).length
  const counts = { late: count("late"), nop: count("nop"), ot: count("ot"), noout: count("noout") }
  if (ctx.roles.has("manager") && ex.length)
    out.push({ key: "punch:ex", group: "due", severity: "blue", kind: "punch_exceptions", params: { n: ex.length }, facts: [{ k: "punch_counts", p: counts }], href: "attendance", action: "open" })
  if (ctx.roles.has("manager") || ctx.roles.has("payroll"))
    for (const s of silentDevices(w))
      out.push({ key: `punch:dev:${s.site.id}`, group: "blocking", severity: "amber", kind: "device_silent", params: { site: s.site.name ?? "", n: s.days }, facts: [{ k: "no_file_no_att" }], href: `attendance?import=${s.site.id}`, action: "import" })
  if (ctx.roles.has("payroll") && !ctx.roles.has("manager")) {
    const n = counts.ot + counts.noout
    if (n) out.push({ key: "punch:ot", group: "due", severity: "blue", kind: "punch_ot", params: { n }, facts: [{ k: "ot_unapproved" }], href: "attendance", action: "open" })
  }
  if (hrAllowed(ctx, "attendance.record")) {
    let days = 0
    for (const site of punchSites(w)) if (hrAllowed(ctx, "attendance.record", { site: site.id })) days += readyDays(w, site).length
    if (days) out.push({ key: "punch:ready", group: "due", severity: "blue", kind: "punch_ready", params: { n: days }, facts: [{ k: "punch_ready" }], href: "attendance", action: "record" })
  }
  return out
}

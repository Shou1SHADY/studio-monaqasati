// HR 1.0 — shifts (PRD SH-01…06, PRD form 23; optional: punch). A workplace
// either keeps one daily schedule or runs shifts — morning, evening, night —
// each with its own times. A shift belongs to the day it STARTS: the night
// shift ends the next morning and stays that day's (SH-02), so payroll counts
// days exactly as before. A worker's shift changes from a date (SH-03): the
// day the new one is first read in attendance and punches; the change before
// it stays readable for the days it covered. A second shift on the same day is
// overtime at the hourly wage + 50 % (art. 107), within the 60-hour monthly cap
// (SH-04). Shift swaps between two workers are not in this version.
// Pure: no I/O.

import { STATUTORY } from "./statutory"
import type { SiteType } from "./sites"

export const SHIFT_IDS = ["m", "e", "n"] as const
export type ShiftId = (typeof SHIFT_IDS)[number]

/** One shift of a workplace: "HH:MM" start and end — an end at or before the start runs past midnight. */
export interface ShiftDef {
  id: ShiftId
  in: string
  out: string
}

/** `hrSites/{id}.shifts` — off: one daily schedule (the workplace's attendance schedule). */
export interface SiteShifts {
  on: boolean
  list: ShiftDef[]
}

/** The prototype's SHDEF: morning 07–15, evening 15–23, night 23–07. */
export const SHIFT_DEFAULTS: Record<ShiftId, { in: string; out: string }> = {
  m: { in: "07:00", out: "15:00" },
  e: { in: "15:00", out: "23:00" },
  n: { in: "23:00", out: "07:00" },
}

/** Workplaces offered "runs shifts" when created (the prototype's site form): warehouse, workshop, fleet. */
export const SHIFT_SITE_TYPES: readonly SiteType[] = ["workshop", "warehouse", "fleet"]

/** A workshop runs three shifts by default, any other place two. */
export const defaultShiftIds = (type: SiteType | null | undefined): ShiftId[] => (type === "workshop" ? ["m", "e", "n"] : ["m", "e"])

export const defaultShifts = (type: SiteType | null | undefined): SiteShifts => ({ on: true, list: defaultShiftIds(type).map((id) => ({ id, ...SHIFT_DEFAULTS[id] })) })

/** "HH:MM" → minutes after midnight; null when unreadable. */
export function hm(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((s ?? "").trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

/** Minutes → "HH:MM" on the clock (a minute past midnight of the next day reads as the clock shows it). */
export function mh(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

/** A shift that ends at or before it starts runs past midnight (SH-02). */
export const isNight = (d: Pick<ShiftDef, "in" | "out">) => (hm(d.out) ?? 0) <= (hm(d.in) ?? 0)

/** A shift's length in hours — the overtime a second shift adds (SH-04). */
export function shiftHours(d: Pick<ShiftDef, "in" | "out">): number {
  const a = hm(d.in) ?? 0
  let b = hm(d.out) ?? 0
  if (b <= a) b += 1440
  return (b - a) / 60
}

/** The shifts a workplace runs today — null when it keeps one schedule. */
export function siteShifts(site: { shifts?: SiteShifts | null } | null | undefined): ShiftDef[] | null {
  const s = site?.shifts
  return s?.on && Array.isArray(s.list) && s.list.length ? s.list.filter((x) => SHIFT_IDS.includes(x.id)) : null
}

/** `employees/{id}.shift` — the shift from `from`; before it, `prev` (null = the workplace's first). */
export interface EmployeeShift {
  id: ShiftId
  from: string
  prev?: ShiftId | null
}

/** The shift id a worker is on a day: the new one from its date, the one before it until then. */
export function shiftIdOn(emp: { shift?: EmployeeShift | null }, day: string): ShiftId | null {
  const s = emp.shift
  if (!s) return null
  return day >= s.from ? s.id : (s.prev ?? null)
}

/** The worker's shift on a day — the workplace's first when none is set or his is no longer run. */
export function shiftOf(emp: { shift?: EmployeeShift | null }, site: { shifts?: SiteShifts | null } | null | undefined, day: string): ShiftDef | null {
  const list = siteShifts(site)
  if (!list) return null
  const id = shiftIdOn(emp, day)
  return list.find((x) => x.id === id) ?? list[0]
}

// ---------------------------------------------------------------------------
// The workplace's shifts (form `shifts`) and a worker's shift (form `shiftset`)
// ---------------------------------------------------------------------------

export type ShiftsBlock = "none_chosen" | "bad_time" | "same_time"

/** On with no shift ticked is refused; each ticked shift needs a readable start and end that differ. */
export function shiftsBlocks(input: SiteShifts): ShiftsBlock[] {
  const out: ShiftsBlock[] = []
  if (!input.on) return out
  if (!input.list.length) out.push("none_chosen")
  if (input.list.some((x) => hm(x.in) == null || hm(x.out) == null)) out.push("bad_time")
  else if (input.list.some((x) => x.in === x.out)) out.push("same_time")
  return out
}

/** Keep only the ticked shifts, in the order morning · evening · night. */
export function normalizeShifts(input: SiteShifts): SiteShifts {
  const list = SHIFT_IDS.map((id) => input.list.find((x) => x.id === id)).filter((x): x is ShiftDef => Boolean(x)).map((x) => ({ id: x.id, in: x.in, out: x.out }))
  return { on: Boolean(input.on), list: input.on ? list : [] }
}

/** Saving the workplace's shifts: a worker on a shift no longer run moves to the first one from today;
 * switching shifts off clears every worker's shift (the prototype's submit). */
export function shiftMoves(people: ReadonlyArray<{ id: string; shift?: EmployeeShift | null }>, next: SiteShifts, today: string): Array<{ id: string; shift: EmployeeShift | null }> {
  const out: Array<{ id: string; shift: EmployeeShift | null }> = []
  const list = next.on ? next.list : []
  for (const p of people) {
    if (!p.shift) continue
    if (!list.length) out.push({ id: p.id, shift: null })
    else if (!list.some((x) => x.id === p.shift!.id)) out.push({ id: p.id, shift: { id: list[0].id, from: today, prev: shiftIdOn(p, today) } })
  }
  return out
}

export type ShiftSetBlock = "no_shifts" | "no_shift" | "not_run" | "bad_date" | "past" | "same"

/** SH-03 — a worker's shift from a date: one the workplace runs, from today or later (a past day was already
 * read in attendance), and not the one he is already on from that day. */
export function shiftSetBlocks(input: { list: ShiftDef[] | null; shiftId: ShiftId | null; from: string | null; today: string; current: ShiftId | null }): ShiftSetBlock[] {
  const out: ShiftSetBlock[] = []
  if (!input.list) return ["no_shifts"]
  if (!input.shiftId) out.push("no_shift")
  else if (!input.list.some((x) => x.id === input.shiftId)) out.push("not_run")
  if (!input.from || !/^\d{4}-\d{2}-\d{2}$/.test(input.from)) out.push("bad_date")
  else if (input.from < input.today) out.push("past")
  if (input.shiftId && input.shiftId === input.current) out.push("same")
  return out
}

/** The record a shift change leaves: the new shift from its date, the one in force the day before kept as `prev`. */
export function nextShift(emp: { shift?: EmployeeShift | null }, list: ShiftDef[], shiftId: ShiftId, from: string): EmployeeShift {
  const before = shiftIdOn(emp, from) ?? list[0]?.id ?? null
  return { id: shiftId, from, prev: before }
}

// ---------------------------------------------------------------------------
// The sheet by shift (SH-06) and the second shift (SH-04)
// ---------------------------------------------------------------------------

/** OT cap a month (art. 107) — above it a second shift needs the worker's written consent. */
export const OT_MONTH_CAP = STATUTORY.overtimeMonthlyCapHours

/** The prototype's shiftHdr: per shift, present / on it — and how many work a second shift today. */
export function shiftHeader<T extends { id: string; shift?: EmployeeShift | null }>(
  people: readonly T[],
  site: { shifts?: SiteShifts | null } | null | undefined,
  day: string,
  present: (id: string) => boolean,
  second: (id: string) => boolean
): { rows: Array<{ shift: ShiftDef; present: number; total: number }>; second: number } | null {
  const list = siteShifts(site)
  if (!list) return null
  const rows = list.map((s) => {
    const on = people.filter((p) => shiftOf(p, site, day)?.id === s.id)
    return { shift: s, present: on.filter((p) => present(p.id)).length, total: on.length }
  })
  return { rows, second: people.filter((p) => second(p.id)).length }
}

/** Sort a sheet by shift, morning first — the prototype's attSheet order. */
export const shiftRank = (emp: { shift?: EmployeeShift | null }, site: { shifts?: SiteShifts | null } | null | undefined, day: string) => {
  const s = shiftOf(emp, site, day)
  return s ? SHIFT_IDS.indexOf(s.id) : 0
}

/** SH-04 — a second shift adds its length as overtime; above the monthly cap it warns (written consent). */
export function secondShiftHours(site: { shifts?: SiteShifts | null } | null | undefined, emp: { shift?: EmployeeShift | null }, day: string): number | null {
  const s = shiftOf(emp, site, day)
  return s ? shiftHours(s) : null
}

/** The roster report (RP-02, feature punch): each worker on a shift workplace, his shift and its times. */
export function rosterRows<E extends { id: string; no: number; trade: string; siteId: string | null; status?: string | null; shift?: EmployeeShift | null }>(
  employees: readonly E[],
  sites: ReadonlyArray<{ id: string; shifts?: SiteShifts | null }>,
  day: string
): Array<{ emp: E; siteId: string; shift: ShiftDef; night: boolean }> {
  const out: Array<{ emp: E; siteId: string; shift: ShiftDef; night: boolean }> = []
  for (const e of [...employees].sort((a, b) => a.no - b.no)) {
    if (e.status && e.status !== "active") continue
    const site = sites.find((s) => s.id === e.siteId)
    const s = shiftOf(e, site, day)
    if (site && s) out.push({ emp: e, siteId: site.id, shift: s, night: isNight(s) })
  }
  return out
}

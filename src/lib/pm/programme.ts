// The programme (PM 1.0 §8, PRG-01/02, the Contract tab's "Programme"): the
// duration in force and its revisions, planned against actual, the projected
// damages, and the activities laid over it. Nothing here is edited by hand: a
// new revision comes only from a claim granted with days, an activity's % from
// the measurement of its items, and the critical path from its links. Pure.

import { grantedDays, type PmClaim } from "./claim"

export const PM_ACTIVITIES = "pmActivities"

const DAY = 86_400_000
const dayNum = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const r1 = (n: number) => Math.round(n * 10) / 10

// ── Revisions ────────────────────────────────────────────────────────────────

export interface ProgrammeRevision {
  rev: number
  /** Effective duration under this revision, days. */
  days: number
  endOn: string | null
  /** The day it was issued: the start for R0, the client's answer for the rest. */
  on: string | null
  claimSeq: number | null
  granted: number
}

/** R0 is the contract as signed; each claim granted with days issues the next. */
export function programmeRevisions(input: { durationDays: number; startOn: string | null; claims: Array<Pick<PmClaim, "seq" | "status" | "revision" | "response">> }): ProgrammeRevision[] {
  const end = (days: number) => (input.startOn ? addDays(input.startOn, days) : null)
  const out: ProgrammeRevision[] = [{ rev: 0, days: input.durationDays, endOn: end(input.durationDays), on: input.startOn ? input.startOn.slice(0, 10) : null, claimSeq: null, granted: 0 }]
  const granted = input.claims
    .filter((c) => (c.status === "appr" || c.status === "part") && (c.response?.days ?? 0) > 0 && (c.revision ?? 0) > 0)
    .sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0))
  let days = input.durationDays
  for (const c of granted) {
    days += c.response?.days ?? 0
    out.push({ rev: c.revision ?? out.length, days, endOn: end(days), on: c.response?.on ?? null, claimSeq: c.seq, granted: c.response?.days ?? 0 })
  }
  return out
}

export const effectiveDuration = (durationDays: number, claims: Array<Pick<PmClaim, "status"> & { response?: { days: number } | null }>) => durationDays + grantedDays(claims)

// ── Planned against actual ──────────────────────────────────────────────────

export interface CurvePoint {
  day: string
  planned: number
  actual: number | null
}

/** Planned is linear over the effective duration (§8, as the delay formula
 * reads it); actual is the approved measurement by value, cumulated by the day
 * each sheet was measured. One point per sheet day, plus the start and today. */
export function progressCurve(input: {
  startOn: string | null
  effectiveDays: number
  contractValue: number
  sheets: Array<{ status: string; day: string; lines: Array<{ itemId: string; qty: number; approved?: number | null }> }>
  rateOf: (itemId: string) => number
  today: string
  /** The curve's shape (`programmeK`); 1 = linear. */
  k?: number
}): CurvePoint[] {
  if (!input.startOn || input.effectiveDays <= 0 || input.contractValue <= 0) return []
  const start = input.startOn.slice(0, 10)
  const planned = (day: string) => r1(planF((dayNum(day) - dayNum(start)) / input.effectiveDays, input.k ?? 1))
  const byDay = new Map<string, number>()
  for (const s of input.sheets) {
    if (s.status !== "ok") continue
    const v = s.lines.reduce((a, l) => a + (l.approved ?? l.qty) * input.rateOf(l.itemId), 0)
    byDay.set(s.day, (byDay.get(s.day) || 0) + v)
  }
  const points: CurvePoint[] = [{ day: start, planned: 0, actual: 0 }]
  let cum = 0
  for (const day of Array.from(byDay.keys()).sort()) {
    if (day < start || day > input.today) continue
    cum += byDay.get(day) || 0
    points.push({ day, planned: planned(day), actual: r1(Math.min(100, (cum / input.contractValue) * 100)) })
  }
  if (input.today > start && points[points.length - 1].day !== input.today) points.push({ day: input.today, planned: planned(input.today), actual: points[points.length - 1].actual })
  const endOn = addDays(start, input.effectiveDays)
  if (endOn > input.today) points.push({ day: endOn, planned: 100, actual: null })
  return points
}

// ── Activities ──────────────────────────────────────────────────────────────

export interface PmActivity {
  id: string
  seq: number
  name: string
  from: string
  to: string
  itemIds: string[]
  /** The activity that must finish first, when there is one. */
  pred: string | null
  by: string
  byName?: string | null
  at: string
}

export type ActivityState = "done" | "run" | "late" | "soon" | "idle"

export const activityNo = (seq: number) => String(seq).padStart(2, "0")

/** % from the measurement of its items, weighted by value — never typed. */
export function activityProgress(a: Pick<PmActivity, "itemIds">, items: Array<{ id: string; quantity: number; rate: number; executed: number }>): number | null {
  const mine = items.filter((i) => a.itemIds.includes(i.id) && i.rate > 0 && i.quantity > 0)
  const total = mine.reduce((s, i) => s + i.quantity * i.rate, 0)
  if (!(total > 0)) return null
  return r1((mine.reduce((s, i) => s + Math.min(i.executed, i.quantity) * i.rate, 0) / total) * 100)
}

/** Planned today: linear between its start and its end. */
export function activityPlanned(a: Pick<PmActivity, "from" | "to">, today: string): number {
  const f = dayNum(a.from)
  const t = dayNum(a.to)
  if (t <= f) return today >= a.to ? 100 : 0
  return r1(Math.min(100, Math.max(0, ((dayNum(today) - f) / (t - f)) * 100)))
}

/** 12 points behind its own plan is "behind"; started date passed with nothing done is "idle". */
export function activityState(a: Pick<PmActivity, "from" | "to">, progress: number | null, today: string): ActivityState {
  const pc = progress ?? 0
  if (pc >= 99.5) return "done"
  if (today < a.from) return "soon"
  if (activityPlanned(a, today) - pc > 12) return "late"
  return pc <= 0 ? "idle" : "run"
}

/** The chain that finishes last, followed back through its links — a day late
 * anywhere on it is a day late on handover. Derived, never ticked by hand. */
export function criticalPath(acts: Array<Pick<PmActivity, "id" | "to" | "pred">>): Set<string> {
  const out = new Set<string>()
  if (!acts.length) return out
  const byId = new Map(acts.map((a) => [a.id, a]))
  let cur: Pick<PmActivity, "id" | "to" | "pred"> | undefined = [...acts].sort((a, b) => b.to.localeCompare(a.to) || a.id.localeCompare(b.id))[0]
  while (cur && !out.has(cur.id)) {
    out.add(cur.id)
    cur = cur.pred ? byId.get(cur.pred) : undefined
  }
  return out
}

/** What a late activity holds up: the ones that wait on it. */
export const activityNext = (acts: Array<Pick<PmActivity, "id" | "pred" | "name">>, id: string) => acts.filter((a) => a.pred === id)

export type ActivityBlock = "no_name" | "dates" | "pred_self" | "pred_cycle"

export function activityBlocks(input: { name: string; from: string; to: string; pred: string | null; id?: string | null }, acts: Array<Pick<PmActivity, "id" | "pred">>): ActivityBlock[] {
  const out: ActivityBlock[] = []
  if (!input.name.trim()) out.push("no_name")
  if (!input.from || !input.to || input.to <= input.from) out.push("dates")
  if (input.pred && input.id && input.pred === input.id) out.push("pred_self")
  else if (input.pred && input.id) {
    // Walking back from the chosen predecessor must never reach this activity.
    const byId = new Map(acts.map((a) => [a.id, a]))
    let cur = byId.get(input.pred)
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      if (cur.id === input.id) {
        out.push("pred_cycle")
        break
      }
      seen.add(cur.id)
      cur = cur.pred ? byId.get(cur.pred) : undefined
    }
  }
  return out
}

// ── The planned curve's shape ───────────────────────────────────────────────
// F(x) = 1 − (1 − x)^k over the duration in force. k is calibrated on the
// original programme (R01) so that F matches what the activities plan for
// today, then stretched over the effective duration — an extension moves the
// whole curve, not just its end. With no activities to calibrate on, k = 1:
// the straight line PRD §8 reads the delay on.

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** Planned %, 0…100, at a share x of the duration. */
export const planF = (x: number, k: number) => 100 * (1 - Math.pow(1 - clamp01(x), k))

/** The shape that makes F(elapsed share) equal the planned % today. */
export function curveK(plannedToday: number, elapsedShare: number): number {
  const x0 = Math.min(0.999, elapsedShare)
  const p0 = plannedToday / 100
  if (!(x0 > 0) || !(p0 > 0) || p0 >= 1) return 1
  return Math.max(0.4, Math.min(6, Math.log(1 - p0) / Math.log(1 - x0)))
}

/** What the activities plan for today, by the value of their items; null when none carries a priced item. */
export function activitiesPlanned(acts: Array<Pick<PmActivity, "from" | "to" | "itemIds">>, items: Array<{ id: string; quantity: number; rate: number }>, today: string): number | null {
  let total = 0
  let planned = 0
  for (const a of acts) {
    const v = items.filter((i) => a.itemIds.includes(i.id) && i.rate > 0).reduce((s, i) => s + i.quantity * i.rate, 0)
    total += v
    planned += v * (activityPlanned(a, today) / 100)
  }
  return total > 0 ? r1((planned / total) * 100) : null
}

/** k for a project: calibrated on R01 from its activities, else linear. */
export function programmeK(input: { acts: Array<Pick<PmActivity, "from" | "to" | "itemIds">>; items: Array<{ id: string; quantity: number; rate: number }>; startOn: string | null; durationDays: number; today: string }): number {
  if (!input.startOn || input.durationDays <= 0) return 1
  const p0 = activitiesPlanned(input.acts, input.items, input.today)
  if (p0 === null) return 1
  return curveK(p0, (dayNum(input.today) - dayNum(input.startOn)) / input.durationDays)
}

/** A planned line as points (day index → %), for drawing. */
export function plannedLine(durationDays: number, k: number): Array<[number, number]> {
  if (durationDays <= 0) return []
  const step = Math.max(3, Math.round(durationDays / 70))
  const out: Array<[number, number]> = []
  for (let t = 0; t < durationDays; t += step) out.push([t, r1(planF(t / durationDays, k))])
  out.push([durationDays, 100])
  return out
}

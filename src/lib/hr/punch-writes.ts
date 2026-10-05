// HR 1.0 — the punch feature's writes (PRD PT-01…07, SH-01…04; optional:
// punch). Each runs the guard first and, where a month is touched, re-reads it
// inside one transaction: a month closed a second ago refuses, and a day
// already recorded keeps its sheet (WF-04). The punches and decisions ride the
// workplace month beside its `days`, so the rules that already guard
// `hrAttendance` guard them; the employee's own punch is on his record, its
// time stamped by the server — the rules check it is now.

import { collection, doc, runTransaction, serverTimestamp, updateDoc, writeBatch, type Firestore, type Transaction } from "firebase/firestore"
import type { HrContext } from "./access"
import { attendanceId, monthOf, type WorkplaceMonth } from "./attendance"
import { recordDay } from "./attendance-writes"
import { HR_ATTENDANCE, HR_EMPLOYEES, HR_SITES } from "./collections"
import type { HrEmployee } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import { todayDay } from "./format"
import { emitHrNotice, hrLinks } from "./notify"
import {
  lateCode,
  mergePunch,
  OT_REFUSALS,
  punchDay,
  scheduleOf,
  shiftMinutes,
  sourceBlocks,
  type AppPunch,
  type DeviceImport,
  type DeviceReview,
  type OtRefusal,
  type PunchDecision,
  type PunchMonth,
  type PunchRec,
  type PunchSite,
  type SiteAttendance,
  type SiteDay,
} from "./punches"
import { hm, mh, nextShift, normalizeShifts, shiftIdOn, shiftMoves, shiftsBlocks, shiftSetBlocks, siteShifts, type EmployeeShift, type ShiftId, type SiteShifts } from "./shifts"
import { recordViolation } from "./violation-writes"
import { assertHr, HrWriteError } from "./write-guard"

type Month = WorkplaceMonth & PunchMonth

const stampOf = (actor: HrActor) => ({ by: actor.uid, byName: actor.name, at: new Date().toISOString() })

function logTx(tx: Transaction, firestore: Firestore, employeeId: string, orgId: string, actor: HrActor, kind: string, params: Record<string, string | number | null>) {
  tx.set(doc(collection(firestore, HR_EMPLOYEES, employeeId, HR_LOG)), { organizationId: orgId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind, params, source: "hr" })
}

const base = (orgId: string, siteId: string, month: string) => ({ organizationId: orgId, siteId, month, days: {}, declarations: [], closed: null })

// ---------------------------------------------------------------------------
// The workplace: its attendance source (form `am`) and its shifts (form `shifts`)
// ---------------------------------------------------------------------------

/** PT-01/02/06/08 — the HR manager sets how a workplace's attendance comes in; it applies from today. */
export async function saveAttendanceSource(firestore: Firestore, ctx: HrContext, siteId: string, actor: HrActor, input: SiteAttendance): Promise<void> {
  assertHr(ctx, "settings.manage")
  const blocks = sourceBlocks(input)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const att: SiteAttendance = {
    source: input.source,
    schedule: input.schedule ? { in: mh(hm(input.schedule.in) as number), out: mh(hm(input.schedule.out) as number) } : null,
    grace: input.grace ?? null,
    geo: input.source === "app" && input.geo ? { lat: input.geo.lat ?? null, lng: input.geo.lng ?? null, r: Math.round(input.geo.r) } : null,
    ...stampOf(actor),
  }
  await updateDoc(doc(firestore, HR_SITES, siteId), { att, updatedAt: serverTimestamp(), updatedBy: actor.uid })
}

/** SH-01/02 — the workplace's shifts. Workers on a shift no longer run move to the first one from today; switching
 * shifts off clears every worker's shift. Each move is in the worker's log. */
export async function saveSiteShifts(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  siteId: string,
  actor: HrActor,
  input: SiteShifts,
  people: ReadonlyArray<{ id: string; shift?: EmployeeShift | null }>,
  opts: { today?: string } = {}
): Promise<{ moved: number }> {
  assertHr(ctx, "settings.manage")
  const next = normalizeShifts(input)
  const blocks = shiftsBlocks(next)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const today = opts.today ?? todayDay()
  const moves = shiftMoves(people, next, today)
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, HR_SITES, siteId), { shifts: next, updatedAt: serverTimestamp(), updatedBy: actor.uid })
  for (const m of moves) {
    batch.update(doc(firestore, HR_EMPLOYEES, m.id), { shift: m.shift, updatedAt: serverTimestamp() })
    const from = people.find((p) => p.id === m.id)?.shift?.id ?? null
    batch.set(doc(collection(firestore, HR_EMPLOYEES, m.id, HR_LOG)), { organizationId: orgId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind: "shift_changed", params: { was: from, now: m.shift?.id ?? null, on: today }, source: "hr" })
  }
  await batch.commit()
  return { moved: moves.length }
}

/** SH-03 — a worker's shift from a date (form `shiftset`): the HR manager, or the supervisor of the worker's own
 * workplace. The day before keeps the shift it had. */
export async function setEmployeeShift(
  firestore: Firestore,
  ctx: HrContext,
  employeeId: string,
  actor: HrActor,
  input: { shiftId: ShiftId | null; from: string | null },
  opts: { today?: string } = {}
): Promise<void> {
  const today = opts.today ?? todayDay()
  await runTransaction(firestore, async (tx) => {
    const es = await tx.get(doc(firestore, HR_EMPLOYEES, employeeId))
    if (!es.exists()) throw new HrWriteError("missing")
    const emp = { id: es.id, ...(es.data() as Omit<HrEmployee, "id">) } as HrEmployee & { shift?: EmployeeShift | null }
    assertHr(ctx, "shift.set", { site: emp.siteId })
    const ss = emp.siteId ? await tx.get(doc(firestore, HR_SITES, emp.siteId)) : null
    const site = ss?.exists() ? (ss.data() as PunchSite) : null
    const list = siteShifts(site)
    const blocks = shiftSetBlocks({ list, shiftId: input.shiftId, from: input.from, today, current: input.from ? shiftIdOn(emp, input.from) : null })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const shift = nextShift(emp, list!, input.shiftId as ShiftId, input.from as string)
    tx.update(es.ref, { shift, updatedAt: serverTimestamp() })
    logTx(tx, firestore, emp.id, emp.organizationId, actor, "shift_changed", { was: shift.prev ?? null, now: shift.id, on: shift.from })
  })
}

// ---------------------------------------------------------------------------
// The device file (form `impdev`)
// ---------------------------------------------------------------------------

/** PT-02 — save a reviewed device file: each person's first in / last out merged into the day's punches, people
 * assigned elsewhere kept apart as exceptions, the read itself logged. Days of a closed month are skipped (a
 * closed month never reopens). The workplace's supervisor, payroll or the HR manager — before the closing. */
export async function importDeviceFile(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  site: PunchSite,
  actor: HrActor,
  review: DeviceReview,
  employees: ReadonlyArray<{ id: string; shift?: EmployeeShift | null }>
): Promise<{ saved: number; skipped: number }> {
  assertHr(ctx, "attendance.record", { site: site.id })
  if (!review.saved.length && !review.other.length) throw new HrWriteError("blocked", ["nothing"])
  const months = [...new Set([...review.saved.map((s) => monthOf(s.day)), ...review.other.map((o) => monthOf(o.day))])].sort()
  let saved = 0
  let skipped = 0
  await runTransaction(firestore, async (tx) => {
    saved = 0
    skipped = 0
    const refs = months.map((m) => doc(firestore, HR_ATTENDANCE, attendanceId(orgId, site.id, m)))
    const snaps = await Promise.all(refs.map((r) => tx.get(r)))
    months.forEach((month, i) => {
      const wm = snaps[i].exists() ? (snaps[i].data() as Month) : null
      const mine = review.saved.filter((s) => monthOf(s.day) === month)
      const others = review.other.filter((o) => monthOf(o.day) === month)
      if (wm?.closed) {
        skipped += mine.length + others.length
        return
      }
      const patch: Record<string, unknown> = {}
      for (const s of mine) {
        const emp = employees.find((e) => e.id === s.employeeId) ?? null
        patch[`pd.${s.day}.${s.employeeId}`] = mergePunch(wm?.pd?.[s.day]?.[s.employeeId], { in: s.in, out: s.out }, scheduleOf(site, emp, s.day))
        saved++
      }
      for (const o of others) patch[`xs.${o.day}.${o.employeeId}`] = o.siteId ?? null
      const entry: DeviceImport = { ...stampOf(actor), rows: review.rows, saved: mine.length, dup: review.dup, dawn: review.dawn, unknown: review.unknown.slice(0, 50), days: [...new Set([...mine, ...others].map((x) => x.day))].sort() }
      const imports = [...(wm?.imports ?? []), entry].slice(-30)
      if (!wm) {
        // A new month: the nested punches are built as maps (a set takes no dotted paths).
        const pd: Record<string, Record<string, PunchRec>> = {}
        for (const s of mine) (pd[s.day] ??= {})[s.employeeId] = patch[`pd.${s.day}.${s.employeeId}`] as PunchRec
        const xs: Record<string, Record<string, string | null>> = {}
        for (const o of others) (xs[o.day] ??= {})[o.employeeId] = o.siteId ?? null
        tx.set(refs[i], { ...base(orgId, site.id, month), pd, xs, imports, updatedAt: serverTimestamp() })
      } else tx.update(refs[i], { ...patch, imports, updatedAt: serverTimestamp() })
    })
  })
  return { saved, skipped }
}

// ---------------------------------------------------------------------------
// Deciding an exception (PT-04, PT-05, form `otno`)
// ---------------------------------------------------------------------------

export type PunchDecisionInput =
  | { kind: "late"; v: "excused" | "violation"; min: number }
  | { kind: "nop"; v: "permission" | "absent" }
  | { kind: "out" }
  | { kind: "ot"; v: "ok" | OtRefusal; h: number }
  | { kind: "fence"; v: "ok" | "absent" }

/** A person decides an exception — in his name, on the day it is about, before the day is recorded. A late
 * arrival made a violation opens its record for the HR manager (WF-09); refused overtime is told to the employee,
 * who may object by a correction request (PT-05). */
export async function decidePunch(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  site: PunchSite,
  actor: HrActor,
  input: { day: string; employeeId: string } & PunchDecisionInput,
  opts: { today?: string } = {}
): Promise<void> {
  assertHr(ctx, "attendance.record", { site: site.id })
  if (input.kind === "late" && input.v === "violation") assertHr(ctx, "violation.record", { site: site.id })
  if (input.kind === "ot" && input.v !== "ok" && !OT_REFUSALS.includes(input.v)) throw new HrWriteError("blocked", ["no_reason"])
  const ref = doc(firestore, HR_ATTENDANCE, attendanceId(orgId, site.id, monthOf(input.day)))
  let emp: HrEmployee | null = null
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const es = await tx.get(doc(firestore, HR_EMPLOYEES, input.employeeId))
    if (!es.exists()) throw new HrWriteError("missing")
    emp = { id: es.id, ...(es.data() as Omit<HrEmployee, "id">) }
    const wm = snap.exists() ? (snap.data() as Month) : null
    if (wm?.closed) throw new HrWriteError("blocked", ["closed"])
    if (wm?.days?.[input.day]) throw new HrWriteError("blocked", ["recorded"])
    const sc = scheduleOf(site, emp as HrEmployee & { shift?: EmployeeShift | null }, input.day)
    const stamp = stampOf(actor)
    let value: PunchDecision[keyof PunchDecision]
    if (input.kind === "out") value = { ...stamp, v: mh(sc.out) }
    else if (input.kind === "ot") value = { ...stamp, v: input.v, h: input.h }
    else value = { ...stamp, v: input.v } as PunchDecision[keyof PunchDecision]
    const path = `pdx.${input.day}.${input.employeeId}.${input.kind}`
    if (!wm) tx.set(ref, { ...base(orgId, site.id, monthOf(input.day)), pdx: { [input.day]: { [input.employeeId]: { [input.kind]: value } } }, updatedAt: serverTimestamp() })
    else tx.update(ref, { [path]: value, updatedAt: serverTimestamp() })
    const on = input.day
    if (input.kind === "late" && input.v === "excused") logTx(tx, firestore, emp.id, orgId, actor, "punch_late_excused", { on, min: input.min })
    if (input.kind === "out") logTx(tx, firestore, emp.id, orgId, actor, "punch_out_fixed", { on, at: mh(sc.out) })
    if (input.kind === "ot") logTx(tx, firestore, emp.id, orgId, actor, input.v === "ok" ? "punch_ot_approved" : "punch_ot_refused", { on, h: input.h, why: input.v === "ok" ? null : input.v })
  })
  const e = emp as HrEmployee | null
  if (!e) return
  if (input.kind === "late" && input.v === "violation") {
    try {
      await recordViolation(firestore, ctx, orgId, actor, { employeeId: e.id, code: lateCode(input.min), on: input.day }, { today: opts.today })
    } catch (err) {
      // Already on record for that day and code — the decision stands.
      if (!(err instanceof HrWriteError && err.blocks.includes("exists"))) throw err
    }
  }
  if (input.kind === "ot" && input.v !== "ok" && e.userId)
    await emitHrNotice(firestore, actor, {
      kind: "hr_ot_refused",
      organizationId: orgId,
      to: [{ users: [e.userId] }],
      params: { on: input.day, h: input.h, why: `@hr_ot_why.${input.v}` },
      link: hrLinks.me(),
      once: `${e.id}__${input.day}`,
      employeeId: e.id,
    })
}

/** The day recorded from its punches (AT-01 via PT-04): the sheet the punches and decisions make, saved once like
 * any sheet — refused while an exception waits for a decision. */
export async function recordPunchDay(firestore: Firestore, ctx: HrContext, orgId: string, sd: SiteDay, actor: HrActor, opts: { today?: string } = {}): Promise<{ present: number; absent: number }> {
  const r = punchDay(sd)
  if (r.blocks.length) throw new HrWriteError("blocked", r.blocks)
  await recordDay(firestore, ctx, orgId, { id: sd.site.id, type: sd.site.type }, sd.day, actor, { listed: r.listed, ex: r.ex }, { today: opts.today ?? sd.today, fromPunches: true })
  return { present: r.present, absent: r.absent }
}

// ---------------------------------------------------------------------------
// His own punch from My file (PT-06)
// ---------------------------------------------------------------------------

export type AppPunchBlock = "not_app" | "inactive" | "done" | "no_in"

/** In: once a day (a new day moves the last one to `py`); out: after his in, once. */
export function appPunchBlocks(emp: { status: string; pn?: AppPunch | null }, source: string, kind: "in" | "out", today: string): AppPunchBlock[] {
  const out: AppPunchBlock[] = []
  if (source !== "app") out.push("not_app")
  if (emp.status !== "active") out.push("inactive")
  const pn = emp.pn?.day === today ? emp.pn : null
  if (kind === "in" && pn) out.push("done")
  if (kind === "out" && !pn) out.push("no_in")
  if (kind === "out" && pn?.out) out.push("done")
  return out
}

/** The employee punches in or out. His location was read at this moment only (with his consent); the inside /
 * outside flag and the distance are kept — never a track. The server stamps the time. */
export async function punchFromApp(
  firestore: Firestore,
  emp: Pick<HrEmployee, "id" | "status" | "siteId"> & { pn?: AppPunch | null; py?: AppPunch | null },
  source: string,
  kind: "in" | "out",
  fence: { inside: boolean | null; d: number | null },
  opts: { today?: string } = {}
): Promise<void> {
  const today = opts.today ?? todayDay()
  const blocks = appPunchBlocks(emp, source, kind, today)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const ref = doc(firestore, HR_EMPLOYEES, emp.id)
  if (kind === "in") {
    const pn = { day: today, siteId: emp.siteId ?? null, in: serverTimestamp(), out: null, at: serverTimestamp(), inside: fence.inside, d: fence.d }
    // The day before is kept as `py` — a missing out-punch and overtime are read from it the next morning.
    await updateDoc(ref, { pn, ...(emp.pn && emp.pn.day !== today ? { py: emp.pn } : {}), updatedAt: serverTimestamp() })
  } else await updateDoc(ref, { pn: { ...emp.pn, out: serverTimestamp(), at: serverTimestamp(), outInside: fence.inside }, updatedAt: serverTimestamp() })
}

// ---------------------------------------------------------------------------
// An approved correction of a forgotten punch (PT-07 `miss`/`out`)
// ---------------------------------------------------------------------------

/** The punch an approved "I forgot to punch" / "I was outside the fence on duty" puts on the day: in at the shift's
 * start (or his earlier punch) and out at its end (no overtime), marked a correction. Null when the day is already
 * recorded or the month closed (the sheet is the record then). */
export function fixPunch(wm: (PunchMonth & Pick<WorkplaceMonth, "closed" | "days">) | null, site: PunchSite | null, emp: { id: string; shift?: EmployeeShift | null }, day: string, type: "miss" | "out"): PunchRec | null {
  if (wm?.closed || wm?.days?.[day]) return null
  const sc = scheduleOf(site, emp, day)
  const have = wm?.pd?.[day]?.[emp.id]
  const early = have?.in != null && (shiftMinutes(have.in, sc) ?? sc.in) < sc.in
  return { in: early ? (have!.in as string) : mh(sc.in), out: have?.out ?? mh(sc.out), src: "fix", geo: type === "out" ? false : true }
}

/** Writes an approved correction's punch inside the approving transaction (its reads already done). */
export function writeFixPunch(tx: Transaction, firestore: Firestore, wm: PunchMonth | null, orgId: string, siteId: string, day: string, employeeId: string, rec: PunchRec) {
  const ref = doc(firestore, HR_ATTENDANCE, attendanceId(orgId, siteId, monthOf(day)))
  if (wm) tx.update(ref, { [`pd.${day}.${employeeId}`]: rec, updatedAt: serverTimestamp() })
  else tx.set(ref, { ...base(orgId, siteId, monthOf(day)), pd: { [day]: { [employeeId]: rec } }, updatedAt: serverTimestamp() })
}

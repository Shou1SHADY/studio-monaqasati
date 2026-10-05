// HR — government platforms (PRD GV-01…05, PY-08; optional features `gov` and `mudad`). We connect to no
// platform (GV-01): what must be done on Qiwa, GOSI, Muqeem, health insurance, Traffic, HRDF and Mudad is
// COMPUTED from the record's events (GV-02) — a joiner, a pay change, an absence past day 15, a leaver, an
// iqama to issue or renew, an injury, a trip abroad, a paid payroll — done THERE by government relations and
// recorded HERE with its reference, so it is neither forgotten nor done twice. Each platform can be switched
// off (GV-03). A platform's exported report is compared with the record (GV-04): differences only — missing
// and extra become tasks, an unknown number never creates an employee, taking the platform's value is a
// choice; wages are compared only for a viewer who sees pay (RL-03), government relations sees the counts
// and who differs, never an amount. The pre-Mudad check (PY-08) lists what Mudad will flag on a payroll,
// each justified once; the month's Mudad status is recorded after the upload (GV-05). Nitaqat's what-if
// shows a hire's or an exit's effect on the Saudi ratio (ST-04). Pure: no I/O.

import type { HrContext } from "./access"
import { driveDocOf, iqamaDueBy, type DocType } from "./documents"
import type { EmployeePay, HrEmployee } from "./employee"
import type { ExitTask } from "./eos"
import type { HrExit } from "./exit-writes"
import type { HrInjury } from "./injuries"
import { payOn } from "./pay"
import { lineWarnings, payDayOf, type Payroll, type PayrollLine } from "./payroll"
import { leaveReturn, type HrRequest, type Stamp } from "./requests"
import type { FactPart, TodayItem } from "./today"
import { HR_PLATFORMS } from "./settings"
import { addDays, daysBetween } from "./statutory"

/** `hrGovTasks/{orgId}__{key}` — a recorded platform act (`done`), a task a reconciliation or a pay change
 * made (`task`), and each platform's last reconciliation (`recon`). No amount is ever written here. */
export const HR_GOV = "hrGovTasks"
export const govDocId = (orgId: string, key: string) => `${orgId}__${key}`

export const PLATFORMS = HR_PLATFORMS
export type Platform = (typeof PLATFORMS)[number]
/** HRDF is off until the company asks for it (the prototype's `POL.pf`). */
const DEFAULT_OFF: ReadonlySet<Platform> = new Set(["hrdf"])
export type PlatformSwitches = Partial<Record<Platform, boolean>>
export const platformOn = (sw: PlatformSwitches | null | undefined, pf: Platform) => sw?.[pf] ?? !DEFAULT_OFF.has(pf)

/** What each platform's report brings back: the three compared by file; Mudad's month status is typed. */
export const RECON_PLATFORMS = ["muqeem", "gosi", "qiwa"] as const
export type ReconPlatform = (typeof RECON_PLATFORMS)[number]
export const IMPORTS: ReadonlySet<Platform> = new Set(["qiwa", "mudad", "gosi", "muqeem"])
/** The reconciliations that compare a WAGE — their values reach pay roles only (RL-03). */
export const WAGE_RECON: ReadonlySet<ReconPlatform> = new Set(["gosi", "qiwa"])

export type TaskCode = "ct" | "reg" | "xfer" | "dl" | "abs" | "sup" | "pay" | "excl" | "rem" | "fexit" | "iq" | "ren" | "ins" | "inj" | "erv" | "up" | "miss" | "gone" | "wage"

/** How a task is closed: recorded here (`done`, the «سجّل أنه تمّ» form), or by the record it belongs to. */
export type TaskAction =
  | { kind: "done" }
  | { kind: "doc"; doc: DocType }
  | { kind: "injury" }
  | { kind: "exit"; exitId: string; task: ExitTask }
  | { kind: "exit_visa"; requestId: string }
  | { kind: "mudad"; payrollKey: string }

export interface PlatformTask {
  key: string
  pf: Platform
  code: TaskCode
  employeeId: string | null
  /** The person's name, or the payroll's month for Mudad. */
  name: string
  due: string
  late: boolean
  action: TaskAction
  params: Record<string, string | number>
}

export interface ReconRow {
  k: DiffKind
  employeeId: string | null
  no: string
}

export interface GovDoc {
  id: string
  organizationId: string
  kind: "done" | "task" | "recon"
  key: string
  pf: Platform
  code?: TaskCode | null
  employeeId?: string | null
  /** A pay change's effective day (code `pay`). */
  on?: string | null
  due?: string | null
  ref?: string | null
  by: string
  byName: string | null
  at: string
  /** A reconciliation: rows in their report, matched, differences, and who differs (never a value). */
  n?: number
  matched?: number
  diff?: number
  rows?: ReconRow[]
}

export const taskKey = (pf: Platform, code: TaskCode, employeeId: string | null, suffix?: string | null) => `${pf}:${code}:${employeeId ?? ""}${suffix ? `:${suffix}` : ""}`

/** A joiner's first 30 days: his contract, GOSI registration, a transfer of services, HRDF support. */
const NEW_DAYS = 30
/** A pay change older than this asks nothing more of Qiwa (the prototype's 60 days). */
const PAY_WINDOW = 60
/** An approved leave abroad within this many days asks for the exit re-entry visa. */
const TRIP_DAYS = 21

export interface PlatformWorld {
  today: string
  employees: HrEmployee[]
  requests: HrRequest[]
  exits: HrExit[]
  injuries: HrInjury[]
  /** Only for a viewer who reads payrolls (pay roles): the Mudad upload task. */
  payrolls?: Payroll[] | null
  docs: GovDoc[]
  switches?: PlatformSwitches | null
  renewWindowDays: number
  /** The viewer's own record — nobody records his own exit re-entry. */
  selfId?: string | null
}

type PayrollWithMudad = Payroll & { mudad?: MudadStatus | null }

/** GV-02 — every task the record asks of the platforms, open ones only, the earliest due first. */
export function platformTasks(w: PlatformWorld): PlatformTask[] {
  const { today } = w
  const out: PlatformTask[] = []
  const done = new Set(w.docs.filter((d) => d.kind === "done").map((d) => d.key))
  const on = (pf: Platform) => platformOn(w.switches, pf)
  const name = (e: Pick<HrEmployee, "names">) => e.names?.ar ?? ""
  const add = (pf: Platform, code: TaskCode, e: HrEmployee | null, due: string, action: TaskAction = { kind: "done" }, opts: { suffix?: string | null; params?: Record<string, string | number>; key?: string; label?: string } = {}) => {
    if (!on(pf)) return
    const key = opts.key ?? taskKey(pf, code, e?.id ?? null, opts.suffix)
    if (action.kind === "done" && done.has(key)) return
    out.push({ key, pf, code, employeeId: e?.id ?? null, name: opts.label ?? (e ? name(e) : ""), due, late: due < today, action, params: opts.params ?? {} })
  }
  const byId = new Map(w.employees.map((e) => [e.id, e]))

  for (const e of w.employees) {
    const st = e.status ?? "active"
    if (st === "expected") continue
    const sa = e.nationality === "sa"
    const gone = st === "left" || st === "leaving"
    const isNew = !gone && Boolean(e.join) && e.join <= today && daysBetween(e.join, today) < NEW_DAYS
    if (isNew) {
      add("qiwa", "ct", e, addDays(e.join, 7))
      add("gosi", "reg", e, addDays(e.join, 7))
      if (e.source === "transfer") add("qiwa", "xfer", e, addDays(e.join, 3))
      if (sa) add("hrdf", "sup", e, addDays(e.join, 30))
    }
    const lic = e.docs?.licence
    if (!gone && driveDocOf(e.trade) === "licence" && lic && daysBetween(today, lic) <= 60) add("traffic", "dl", e, lic, { kind: "doc", doc: "licence" })
    if (!sa && !gone) {
      if (!e.docs?.iqama && e.source === "visa" && e.join) add("muqeem", "iq", e, iqamaDueBy(e.join), { kind: "doc", doc: "iqama" })
      else if (e.docs?.iqama && daysBetween(today, e.docs.iqama) <= w.renewWindowDays) add("muqeem", "ren", e, e.docs.iqama, { kind: "doc", doc: "iqama" })
      const ins = e.docs?.insurance
      if (!ins || daysBetween(today, ins) <= 30) add("chi", "ins", e, ins || addDays(e.join, 7), { kind: "doc", doc: "insurance" }, { params: { missing: ins ? 0 : 1 } })
    }
  }

  // Art. 80 — a leave ended 15 days ago with no return: the absence report on Qiwa.
  for (const r of w.requests) {
    const late = leaveReturn(r, today)
    const e = byId.get(r.employeeId)
    if (late && late.daysLate >= 15 && e) add("qiwa", "abs", e, addDays(r.leave!.to, 15), { kind: "done" }, { suffix: r.id, params: { days: late.daysLate } })
    // LV-08 — an approved trip abroad within three weeks: the exit re-entry visa, two days before it.
    const rv = r as HrRequest & { exitVisa?: Stamp | null }
    if (e && r.kind === "leave" && r.state === "approved" && r.leave?.travel && !rv.exitVisa && !r.returned && r.leave.from > today && daysBetween(today, r.leave.from) <= TRIP_DAYS && r.employeeId !== w.selfId)
      add("muqeem", "erv", e, addDays(r.leave.from, -2), { kind: "exit_visa", requestId: r.id }, { suffix: r.id, params: { from: r.leave.from } })
  }

  // A pay change: the basic in the Qiwa contract (written beside the change — no amount here).
  for (const d of w.docs)
    if (d.kind === "task" && d.code === "pay" && d.on && daysBetween(d.on, today) <= PAY_WINDOW) {
      const e = d.employeeId ? byId.get(d.employeeId) : undefined
      if (e && e.status !== "left") add("qiwa", "pay", e, addDays(d.on, 7), { kind: "done" }, { key: d.key, params: { on: d.on } })
    }

  // The leaver (EX-06): GOSI exclusion and the insurance removal from his last day; the final exit once settled.
  for (const x of w.exits) {
    if (!x.lastDay || x.lastDay > today) continue
    const e = byId.get(x.employeeId) ?? null
    const label = x.employeeName
    const sa = e?.nationality === "sa"
    if (!x.tasks?.gosi) add("gosi", "excl", e, addDays(x.lastDay, 7), { kind: "exit", exitId: x.id, task: "gosi" }, { key: taskKey("gosi", "excl", x.employeeId), label })
    if (!sa && !x.tasks?.insurance) add("chi", "rem", e, addDays(x.lastDay, 7), { kind: "exit", exitId: x.id, task: "insurance" }, { key: taskKey("chi", "rem", x.employeeId), label })
    if (!sa && x.state !== "leaving" && !x.tasks?.finalExit) add("muqeem", "fexit", e, addDays(x.lastDay, 14), { kind: "exit", exitId: x.id, task: "finalExit" }, { key: taskKey("muqeem", "fexit", x.employeeId), label })
  }

  // DC-07 — an injury not yet reported to GOSI.
  for (const i of w.injuries) if (!i.report) add("gosi", "inj", byId.get(i.employeeId) ?? null, i.due, { kind: "injury" }, { key: taskKey("gosi", "inj", i.employeeId, i.id), label: i.employeeName })

  // GV-05 — a paid month's wage file is uploaded to Mudad and its status recorded (pay roles read payrolls).
  for (const p of (w.payrolls ?? []) as PayrollWithMudad[])
    if (p.kind === "main" && p.state === "paid" && !p.mudad) {
      const paidOn = p.paid?.date ?? p.paid?.at?.slice(0, 10) ?? today
      add("mudad", "up", null, addDays(paidOn, 3), { kind: "mudad", payrollKey: p.key }, { key: taskKey("mudad", "up", null, p.key), label: "", params: { month: p.month } })
    }

  // What a reconciliation made: missing there, still there, a registered wage to fix.
  for (const d of w.docs)
    if (d.kind === "task" && d.code !== "pay" && d.code && d.due) {
      const e = d.employeeId ? byId.get(d.employeeId) : undefined
      add(d.pf, d.code, e ?? null, d.due, { kind: "done" }, { key: d.key, label: e ? name(e) : "" })
    }

  return out.sort((a, b) => a.due.localeCompare(b.due) || a.key.localeCompare(b.key))
}

/** The tasks a viewer may close (`platform.tasks`), and how many are past their day, per platform. */
export function taskSummary(tasks: PlatformTask[]): { total: number; late: number; byPf: Partial<Record<Platform, number>> } {
  const byPf: Partial<Record<Platform, number>> = {}
  for (const x of tasks) byPf[x.pf] = (byPf[x.pf] ?? 0) + 1
  return { total: tasks.length, late: tasks.filter((x) => x.late).length, byPf }
}

// ---------------------------------------------------------------------------
// Reconciliation by import (GV-04)
// ---------------------------------------------------------------------------

export type DiffKind = "diff" | "miss" | "gone" | "unk"
export interface ReconDiff {
  k: DiffKind
  employeeId: string | null
  /** The number as their report gave it. */
  no: string
  /** Ours and theirs — only when the viewer may see the value (a wage only for pay roles). */
  ours?: string | number | null
  theirs?: string | number | null
}
export interface ReconInputRow {
  no: string
  value: string | number | null
}

const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/
/** A day as their report writes it — ISO or day/month/year — as ISO; anything else is no value. */
export function reconDay(v: string): string | null {
  const s = v.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = DMY.exec(s)
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null
}

/** Their report, two columns: the employee number (or the ID / iqama number) and the value. A header row
 * and blank lines are skipped; a row with no number counts as unreadable. */
export function parseReconCsv(text: string, pf: ReconPlatform): { rows: ReconInputRow[]; bad: number } {
  const rows: ReconInputRow[] = []
  let bad = 0
  const lines = text.replace(/^﻿/, "").split(/\r?\n/)
  lines.forEach((line, i) => {
    if (!line.trim()) return
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""))
    const no = cells[0] ?? ""
    if (!/^\d+$/.test(no)) {
      if (i > 0) bad++
      return
    }
    const raw = cells[1] ?? ""
    const value = pf === "muqeem" ? reconDay(raw) : raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw)
    rows.push({ no, value })
  })
  return { rows, bad }
}

/** Who each platform's report should list: Muqeem — non-Saudis past the visa stage; GOSI and Qiwa — everyone
 * who has joined. A leaver is no longer ours. */
export function reconPopulation(pf: ReconPlatform, employees: HrEmployee[], today: string): HrEmployee[] {
  return employees.filter((e) => {
    const st = e.status ?? "active"
    if (st === "expected" || st === "left" || !e.join || e.join > today) return false
    return pf === "muqeem" ? e.nationality !== "sa" : true
  })
}

const sameValue = (a: string | number, b: string | number) => (typeof a === "number" && typeof b === "number" ? Math.round(a * 100) === Math.round(b * 100) : String(a) === String(b))

/** GV-04 — their report against the record, differences only. A row is matched by the employee number or the
 * ID / iqama number. `valueOf` is null when the viewer may not see the value (a wage, RL-03): only who is
 * missing, extra or unknown is compared then. */
export function reconcile(pf: ReconPlatform, rows: ReconInputRow[], employees: HrEmployee[], valueOf: ((e: HrEmployee) => string | number | null) | null, today: string): { diffs: ReconDiff[]; n: number; matched: number } {
  const byNo = new Map<string, HrEmployee>()
  for (const e of employees) {
    byNo.set(String(e.no), e)
    if (e.idNo) byNo.set(e.idNo.trim(), e)
  }
  const seen = new Set<string>()
  const diffs: ReconDiff[] = []
  for (const r of rows) {
    const e = byNo.get(r.no) ?? byNo.get(String(Number(r.no)))
    if (!e) {
      diffs.push({ k: "unk", employeeId: null, no: r.no })
      continue
    }
    seen.add(e.id)
    if (e.status === "left") {
      diffs.push({ k: "gone", employeeId: e.id, no: r.no })
      continue
    }
    if (!valueOf) continue
    const ours = valueOf(e)
    if (ours != null && r.value != null && !sameValue(ours, r.value)) diffs.push({ k: "diff", employeeId: e.id, no: r.no, ours, theirs: r.value })
    else if (ours == null && r.value != null && pf === "muqeem") diffs.push({ k: "diff", employeeId: e.id, no: r.no, ours: null, theirs: r.value })
  }
  for (const e of reconPopulation(pf, employees, today)) if (!seen.has(e.id)) diffs.push({ k: "miss", employeeId: e.id, no: String(e.no) })
  return { diffs, n: rows.length, matched: rows.length - diffs.filter((d) => d.k !== "miss").length }
}

/** The value of the record each report is compared with: Muqeem — the iqama's expiry; GOSI — the registered
 * wage (basic + housing in force today); Qiwa — the documented basic. */
export function reconValue(pf: ReconPlatform, e: HrEmployee, pay: EmployeePay | undefined, docs: GovDoc[], today: string): string | number | null {
  if (pf === "muqeem") return e.docs?.iqama ?? null
  if (!pay) return null
  const now = payOn(pay, today)
  if (pf === "gosi") return now.basic + now.housing
  return documentedBasic(e.id, pay, docs) ?? now.basic
}

/** The tasks a saved reconciliation makes: missing there / still there after leaving (due in 3 days; GOSI's
 * missing skips joiners of under 30 days, still in their registration window), and on GOSI a "fix the
 * registered wage" task per difference when asked (due in 7). Keyed by the day, so a later reconciliation that
 * finds the same person again makes a new task. */
export function reconTasks(pf: ReconPlatform, diffs: ReconDiff[], employees: HrEmployee[], today: string, opts: { wageTasks: boolean; open: ReadonlySet<string> }): Array<{ key: string; code: TaskCode; employeeId: string; due: string }> {
  const out: Array<{ key: string; code: TaskCode; employeeId: string; due: string }> = []
  const byId = new Map(employees.map((e) => [e.id, e]))
  const openFor = (code: TaskCode, id: string) => [...opts.open].some((k) => k.startsWith(`${pf}:${code}:${id}:`))
  for (const d of diffs) {
    if (!d.employeeId) continue
    const code: TaskCode | null = d.k === "miss" ? "miss" : d.k === "gone" ? "gone" : d.k === "diff" && pf === "gosi" && opts.wageTasks ? "wage" : null
    if (!code) continue
    const e = byId.get(d.employeeId)
    if (code === "miss" && pf === "gosi" && e?.join && daysBetween(e.join, today) < NEW_DAYS) continue
    if (openFor(code, d.employeeId)) continue
    out.push({ key: taskKey(pf, code, d.employeeId, today), code, employeeId: d.employeeId, due: addDays(today, code === "wage" ? 7 : 3) })
  }
  return out
}

// ---------------------------------------------------------------------------
// The documented basic (Qiwa) and the pre-Mudad check (PY-08)
// ---------------------------------------------------------------------------

/** The basic the Qiwa contract carries: while a pay change's Qiwa update is not recorded, the basic before it;
 * otherwise the value taken from Qiwa's report (when taken after the last recorded update); else null — the
 * record is taken as documented. */
export function documentedBasic(employeeId: string, pay: (Pick<EmployeePay, "basic" | "housing" | "transport" | "steps"> & { qiwaBasic?: number | null; qiwaAt?: string | null }) | undefined, docs: GovDoc[]): number | null {
  if (!pay) return null
  const done = new Map(docs.filter((d) => d.kind === "done").map((d) => [d.key, d]))
  const changes = docs.filter((d) => d.kind === "task" && d.code === "pay" && d.employeeId === employeeId && d.on)
  const open = changes.filter((d) => !done.has(d.key)).sort((a, b) => (a.on as string).localeCompare(b.on as string))
  if (open.length) return payOn(pay, addDays(open[0].on as string, -1)).basic
  if (pay.qiwaBasic == null) return null
  const lastDone = changes.map((d) => done.get(d.key)?.at ?? "").sort().pop() ?? ""
  return !lastDone || (pay.qiwaAt ?? "") >= lastDone ? pay.qiwaBasic : null
}

export type MudadFindingKind = "late" | "held" | "basic" | "half" | "zero" | "low"
export interface MudadFinding {
  /** The justification's key on the payroll (`just.<key>`). */
  key: string
  kind: MudadFindingKind
  employeeId: string | null
  name: string
  params: Record<string, string | number>
}

export interface MudadStatus {
  pct: number | null
  note: string | null
  by: string
  byName: string | null
  at: string
}
export interface MudadJustification {
  why: string
  by: string
  byName: string | null
  at: string
}

/** The three reasons the prototype offers (or the preparer's own words). */
export const MUDAD_REASONS = ["raise_not_on_qiwa", "written_consent", "returned_paid_after_fix"] as const

/** PY-08 — what Mudad will flag on a main payroll, before it is sent: paid after the pay day (the whole month),
 * a held transfer (unpaid this month), the basic against the Qiwa contract, deductions above half the wage
 * (art. 93: GOSI + advance + penalties + sick), a net of zero or less, and — with no absence, unpaid or sick
 * day — a net below 90% of the wage less GOSI. A warning, never a block. */
export function mudadFindings(p: Pick<Payroll, "kind" | "state" | "month" | "lines" | "paid">, ctx: { payDay: number; documentedBasic?: (employeeId: string) => number | null }): MudadFinding[] {
  const out: MudadFinding[] = []
  if (p.kind !== "main") return out
  const paidOn = p.paid?.date ?? null
  if (p.state === "paid" && paidOn) {
    const due = payDayOf(p.month, ctx.payDay)
    if (paidOn > due) out.push({ key: "month_late", kind: "late", employeeId: null, name: "", params: { date: paidOn, due } })
  }
  for (const l of p.lines ?? []) {
    const f = (kind: MudadFindingKind, params: Record<string, string | number> = {}) => out.push({ key: `${l.employeeId}_${kind}`, kind, employeeId: l.employeeId, name: l.name, params })
    if (l.held) {
      f("held", { reason: l.heldReason ?? "iban_returned" })
      continue
    }
    const doc = ctx.documentedBasic?.(l.employeeId) ?? null
    if (doc != null && l.basic != null && Math.round(doc) !== Math.round(l.basic)) f("basic", { ours: l.basic, theirs: doc })
    const ded = deductionsOf(l)
    if (l.gross > 0 && ded > l.gross * 0.5) f("half", { amount: Math.round(ded) })
    const w = lineWarnings(l)
    if (l.net <= 0) f("zero")
    else if (w.includes("net_below_90")) f("low", { net: l.net })
  }
  return out
}

const deductionsOf = (l: Pick<PayrollLine, "gosiEmployee" | "advance" | "penalties" | "sickDeduction">) => l.gosiEmployee + l.advance + l.penalties + l.sickDeduction

/** The findings not yet justified on the payroll. */
export const unjustified = (findings: MudadFinding[], just: Record<string, unknown> | null | undefined) => findings.filter((f) => !just?.[f.key])

// ---------------------------------------------------------------------------
// Nitaqat what-if (ST-04)
// ---------------------------------------------------------------------------

/** The Saudi ratio and the safety margin after hiring or losing people: `saudis` / `others` are the change
 * (+ a hire, − an exit). Same arithmetic as `nitaqatOf`. */
export function nitaqatAfter(base: { total: number; saudis: number }, minPct: number | null, change: { saudis: number; others: number }) {
  const saudis = Math.max(0, base.saudis + change.saudis)
  const total = Math.max(saudis, base.total + change.saudis + change.others)
  const pct = total ? Math.round((saudis / total) * 100) : 0
  if (minPct == null || !total) return { total, saudis, pct, short: null as number | null, spare: null as number | null }
  const need = (total * minPct) / 100
  const short = Math.max(0, Math.ceil(need) - saudis)
  return { total, saudis, pct, short, spare: short ? 0 : Math.max(0, Math.floor(saudis - need)) }
}

// ---------------------------------------------------------------------------
// Today (slice 1 — the `gov` and `mudad` feature rows)
// ---------------------------------------------------------------------------

/** Government relations' desk — or the HR manager's when no member holds that role (the prototype's TABS). */
export const govDesk = (ctx: Pick<HrContext, "roles">, govHeld: boolean | undefined) => ctx.roles.has("gov") || (ctx.roles.has("manager") && govHeld === false)

/** The feature rows on Today: «أعمال على المنصات: N — M تجاوزت موعدها» for government relations and the HR
 * manager (who, while the role is held, is sent to the documents instead); for pay roles with `mudad`, a
 * payroll whose pre-Mudad findings are not justified and a paid month whose Mudad status is not recorded. */
export function platformTodayItems(i: {
  ctx: HrContext
  today: string
  features: ReadonlySet<string>
  govHeld: boolean | undefined
  tasks: PlatformTask[]
  payrolls: Payroll[]
  payDay: number
  documentedBasic?: (employeeId: string) => number | null
}): TodayItem[] {
  const out: TodayItem[] = []
  const { ctx } = i
  if (i.features.has("gov") && (ctx.roles.has("gov") || ctx.roles.has("manager")) && i.tasks.length) {
    const s = taskSummary(i.tasks)
    const desk = govDesk(ctx, i.govHeld)
    const facts: FactPart[] = PLATFORMS.filter((pf) => s.byPf[pf]).map((pf) => ({ k: `pf_${pf}`, p: { n: s.byPf[pf] as number } }))
    out.push({ key: "platforms", group: "due", severity: s.late ? "amber" : "blue", kind: s.late ? "platform_tasks_late" : "platform_tasks", params: { count: s.total, late: s.late }, facts, href: desk ? "platforms" : "people?filter=docs", action: desk ? "platforms" : "documents" })
  }
  const pays = ctx.roles.has("manager") || ctx.roles.has("payroll")
  if (i.features.has("mudad") && pays)
    for (const p of i.payrolls as Array<PayrollWithMudad & { just?: Record<string, unknown> | null }>) {
      if (p.kind !== "main") continue
      const open = unjustified(mudadFindings(p, { payDay: i.payDay, documentedBasic: i.documentedBasic }), p.just)
      if (open.length && p.state !== "paid") out.push({ key: `mudadcheck:${p.key}`, group: "due", severity: "amber", kind: "mudad_check", params: { month: p.month, n: open.length }, facts: [{ k: "mudad_warning" }], href: "payroll", action: "justify" })
      if (p.state === "paid" && !p.mudad) {
        const paidOn = p.paid?.date ?? p.paid?.at?.slice(0, 10) ?? i.today
        const due = addDays(paidOn, 3)
        out.push({ key: `mudadstatus:${p.key}`, group: "due", severity: due < i.today ? "amber" : "blue", kind: "mudad_status", params: { month: p.month }, facts: [{ k: "by_day", p: { due } }, ...(open.length ? [{ k: "unjustified", p: { n: open.length } }] : [])], href: "payroll", action: "record" })
      }
    }
  return out
}

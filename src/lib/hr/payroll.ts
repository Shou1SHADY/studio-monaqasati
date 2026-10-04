// HR 1.0 — payroll (PRD PY-01…05, PY-07, PY-10; §7.3, §8). Computed from the
// CLOSED months of every workplace and the contract, never typed: prepared by
// payroll, approved by the HR manager — never by whoever prepared it (RL-02).
// A bounced or unapproved IBAN holds its LINE, not the payroll (PY-03); a late
// item goes to the supplementary "-D" payroll, the closed month never reopens
// (PY-04). What reaches Finance is two events with fixed keys — hr:PAY and
// hr:EOS — that balance on their own. Pure: no I/O.

import { addMonths, assumesPresence, EMPTY_MONTH, employeeMonth, type EmployeeMonth, type WorkplaceMonth } from "./attendance"
import type { EmployeePay, HrEmployee } from "./employee"
import { monthlyEosAccrual } from "./eos"
import { isHoliday } from "./holidays"
import { leaveDays, sickSplit, type Holiday } from "./leave"
import { gosiBase, overtimeOverCap, payLine, wageOf, type PayLine } from "./pay"
import type { HrRequest } from "./requests"
import { monthPenalties, type HrViolation } from "./violations"
import { costKindOf, UNASSIGNED_SITE, type CostKind, type HrSite } from "./sites"
import { addDays, monthRange, r2, serviceYears, STATUTORY } from "./statutory"

/** `hrPayrolls/{orgId}__{yyyy-mm}` and its supplementary `{orgId}__{yyyy-mm}-D`. */
export const payrollId = (orgId: string, key: string) => `${orgId}__${key}`
export const supplementaryKey = (month: string) => `${month}-D`

export const PAYROLL_STATES = ["prepared", "approved", "posted", "paid"] as const
export type PayrollState = (typeof PAYROLL_STATES)[number]

export interface PayrollLine extends PayLine {
  employeeId: string
  /** The employee's platform user — his payslip is his to read (ES-04). */
  userId?: string | null
  no: number
  name: string
  idNo: string | null
  nationality: string
  siteId: string | null
  costKind: CostKind
  projectId: string | null
  iban: string | null
  /** PY-03 — the line waits; the rest of the payroll goes. */
  held: boolean
  heldReason: "iban_returned" | "iban_unapproved" | "no_iban" | null
  attendance: Pick<EmployeeMonth, "present" | "absent" | "sick" | "permission" | "declared" | "overtimeHours">
  /** Every deduction with its reason (ES-04): unpaid leave days, sick days by band, each penalty. */
  reasons?: { unpaidDays: number; sickThreeQuarters: number; sickUnpaid: number; penalties: Array<{ code: string; on: string; deducted: number }> }
  /** Sick days used in the service year after this month (art. 117 bands carry across months). */
  sickUsed: number
  sickYear: number
  /** Accruals for hr:EOS: end-of-service (art. 84) and leave. */
  eosAccrual: number
  leaveAccrual: number
  /** The line's cost to the company: what it earned (gross less sick and unpaid days) + employer GOSI. */
  cost: number
  /** The basic and housing the line was computed with — the Mudad file and the GOSI statement read these, never a later raise. */
  basic?: number
  housing?: number
}

export interface SupplementaryLine {
  employeeId: string
  userId?: string | null
  no: number
  name: string
  idNo: string | null
  siteId: string | null
  costKind: CostKind
  projectId: string | null
  iban: string | null
  held: boolean
  heldReason: PayrollLine["heldReason"]
  /** Retro pay differences of the closed month (EM-04). */
  retro: number
  net: number
}

export interface Stamp {
  by: string
  byName: string | null
  at: string
}

export interface Payroll {
  id: string
  organizationId: string
  month: string
  key: string
  kind: "main" | "supplementary"
  state: PayrollState
  lines: PayrollLine[]
  supplementary?: SupplementaryLine[]
  prepared: Stamp
  approved?: Stamp | null
  posted?: (Stamp & { entry?: string | null }) | null
  paid?: (Stamp & { date?: string | null }) | null
}

// ---------------------------------------------------------------------------
// Blocking facts (PY-02)
// ---------------------------------------------------------------------------

export type PayrollBlock = "not_over" | "unclosed" | "no_pay" | "approved"

/** Every workplace that must be closed: not an office, with someone on it who is on THIS month's payroll, or a record this month.
 * A workplace whose people all joined after the month has nothing to close for it. */
export function sitesToClose(month: string, sites: HrSite[], employees: Pick<HrEmployee, "siteId" | "status" | "join" | "since" | "lastDay">[], attendance: WorkplaceMonth[]): string[] {
  const ids = new Set<string>()
  for (const e of employees) if (e.siteId && onPayroll(e, month)) ids.add(e.siteId)
  for (const a of attendance) if (a.month === month) ids.add(a.siteId)
  return [...ids].filter((id) => !assumesPresence(id, sites.find((s) => s.id === id)?.type ?? null))
}

export function payrollBlocks(input: { month: string; today: string; sites: HrSite[]; employees: HrEmployee[]; attendance: WorkplaceMonth[]; missingPay: string[]; state?: PayrollState | null }): { blocks: PayrollBlock[]; unclosed: string[] } {
  const blocks: PayrollBlock[] = []
  if (input.state && input.state !== "prepared") blocks.push("approved")
  if (input.today <= monthRange(input.month).end) blocks.push("not_over")
  const closed = new Set(input.attendance.filter((a) => a.month === input.month && a.closed).map((a) => a.siteId))
  const unclosed = sitesToClose(input.month, input.sites, input.employees, input.attendance).filter((id) => !closed.has(id))
  if (unclosed.length) blocks.push("unclosed")
  if (input.missingPay.length) blocks.push("no_pay")
  return { blocks, unclosed }
}

// ---------------------------------------------------------------------------
// Who is on it (PY-10) and each line (PY-01)
// ---------------------------------------------------------------------------

/** On the month's payroll: joined by its end, not left, and — if imported — from the import month on.
 * The month of the last day is the settlement's, not the payroll's (EX-05). */
export function onPayroll(e: Pick<HrEmployee, "join" | "status" | "since" | "lastDay">, month: string): boolean {
  // A settled leaver is still owed every month BEFORE the month of his last
  // day; only a record marked left with no last day (an old one) is off them all.
  if (e.status === "left" && !e.lastDay) return false
  if (!e.join || e.join > monthRange(month).end) return false
  if (e.lastDay && e.lastDay.slice(0, 7) <= month) return false
  if (e.since && e.since.slice(0, 7) > month) return false
  return true
}

function datesOf(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** The month's unpaid and sick-leave days from approved leaves (the excess of an annual leave is its LAST days);
 * `all` is every day of the month inside ANY approved leave — paid ones too: a day on leave is never an absence;
 * `sickFromMonth` counts the approved sick-leave days from this month's first day on. */
export function leaveDaysInMonth(requests: HrRequest[], employeeId: string, month: string, holidays?: readonly Holiday[]): { unpaid: string[]; sick: string[]; all: string[]; sickFromMonth: number } {
  const { start, end } = monthRange(month)
  const unpaid: string[] = []
  const sick: string[] = []
  const all: string[] = []
  let sickFromMonth = 0
  for (const r of requests) {
    if (r.employeeId !== employeeId || r.kind !== "leave" || r.state !== "approved" || !r.leave) continue
    const l = r.leave
    const dates = datesOf(l.from, l.to)
    const counted = dates.filter((d) => leaveDays(d, d, holidays) === 1)
    const inMonth = (d: string) => d >= start && d <= end
    all.push(...dates.filter(inMonth))
    if (l.type === "sick") {
      sick.push(...counted.filter(inMonth))
      sickFromMonth += counted.filter((d) => d >= start).length
    } else if (l.unpaidDays > 0) unpaid.push(...counted.slice(Math.max(0, counted.length - l.unpaidDays)).filter(inMonth))
  }
  return { unpaid, sick, all, sickFromMonth }
}

export interface ComputeInput {
  month: string
  employees: HrEmployee[]
  pays: Map<string, EmployeePay>
  sites: HrSite[]
  /** Every workplace-month of this month (closed ones are what count). */
  attendance: WorkplaceMonth[]
  requests: HrRequest[]
  /** Last month's lines — the sick days used in the service year carry over. */
  previous?: PayrollLine[] | null
  holidays?: Holiday[]
  /** Penalties applied or upheld for this month — capped here at five days' wage (PN-03); an objected one waits. */
  violations?: HrViolation[]
}

function heldOf(pay: EmployeePay): PayrollLine["heldReason"] {
  if (!pay.iban) return "no_iban"
  if (pay.ibanState === "returned") return "iban_returned"
  if (pay.ibanState === "fixed") return "iban_unapproved"
  return null
}

export function computePayroll(input: ComputeInput): { lines: PayrollLine[]; missingPay: string[] } {
  const { month } = input
  // What counts: a CLOSED month — and an office's or the unassigned bench's
  // records as they stand: presence is assumed there, nothing asks for a
  // closing (AT-02), and an exception written on its sheet is still a fact.
  const closed = input.attendance.filter((a) => a.month === month && (a.closed || assumesPresence(a.siteId, input.sites.find((s) => s.id === a.siteId)?.type ?? null)))
  const lines: PayrollLine[] = []
  const missingPay: string[] = []
  const { start, end } = monthRange(month)
  for (const e of input.employees) {
    if (!onPayroll(e, month)) continue
    const pay = input.pays.get(e.id)
    if (!pay || !(pay.basic > 0)) {
      missingPay.push(e.id)
      continue
    }
    const att = closed.reduce<EmployeeMonth>((acc, wm) => addMonths(acc, employeeMonth(wm, e.id)), { ...EMPTY_MONTH, violations: [] })
    // Sick: the sheet's sick days and approved sick leave, each day once; banded by the service year.
    const leave = leaveDaysInMonth(input.requests, e.id, month, input.holidays)
    const sickDates = new Set(leave.sick)
    for (const wm of closed) for (const [d, s] of Object.entries(wm.days ?? {})) if (s.listed.includes(e.id) && s.ex?.[e.id]?.status === "sick") sickDates.add(d)
    const sickYear = Math.floor(serviceYears(e.join, end))
    const prev = input.previous?.find((l) => l.employeeId === e.id)
    // With no earlier line (a first payroll, a joiner, the import month) the
    // record's count is the start — less the approved sick leave from this
    // month on, which approval already wrote there and this month counts itself.
    const usedBefore = prev && prev.sickYear === sickYear ? prev.sickUsed : e.sick && e.sick.year === sickYear && !prev ? Math.max(0, e.sick.days - leave.sickFromMonth) : 0
    const split = sickSplit(usedBefore, sickDates.size)
    // A day inside ANY approved leave — paid or not — is not absence; and one
    // date is one day whatever the number of sheets that list him: absent only
    // if no workplace recorded him otherwise that day.
    const onLeave = new Set(leave.all)
    const absentOn = new Set<string>()
    const seenOn = new Set<string>()
    for (const wm of closed)
      for (const [d, s] of Object.entries(wm.days ?? {})) {
        if (!s.listed.includes(e.id)) continue
        if (s.ex?.[e.id]?.status === "absent") absentOn.add(d)
        else seenOn.add(d)
      }
    const absent = [...absentOn].filter((d) => !onLeave.has(d) && !seenOn.has(d)).length
    // A whole calendar month without pay is the whole 30-day wage (February's 28 days too) —
    // a public holiday inside it is not a leave day (LV-02), so it does not break "whole".
    const from = e.join > start ? e.join : start
    const unpaidDays = leave.unpaid.length > 0 && datesOf(from, end).every((d) => leave.unpaid.includes(d) || isHoliday(d, input.holidays)) ? STATUTORY.monthDays : leave.unpaid.length
    const pen = monthPenalties(input.violations ?? [], e.id, month, wageOf(pay))
    const line = payLine({
      pay,
      nationality: e.nationality,
      join: e.join,
      month,
      attendance: { absent, overtimeHours: att.overtimeHours, sickThreeQuarters: split.threeQuarters, sickUnpaid: split.unpaid + split.beyond, unpaid: unpaidDays },
      advance: pay.advance ?? null,
      penalties: pen.total,
    })
    const site = input.sites.find((s) => s.id === e.siteId)
    const costKind: CostKind = e.siteId && site ? costKindOf(site.type) : "admin"
    const years = serviceYears(e.join, end)
    const entitlement = years >= STATUTORY.leave.fiveYears ? STATUTORY.leave.afterFive : STATUTORY.leave.base
    const share = line.days / STATUTORY.monthDays
    const heldReason = heldOf(pay)
    lines.push({
      ...line,
      employeeId: e.id,
      userId: e.userId ?? null,
      no: e.no,
      name: e.names?.ar ?? "",
      idNo: e.idNo ?? null,
      nationality: e.nationality,
      siteId: e.siteId ?? null,
      costKind,
      projectId: site?.type === "project" ? (site.projectId ?? null) : null,
      iban: pay.iban ?? null,
      held: heldReason !== null,
      heldReason,
      attendance: { present: att.present, absent, sick: sickDates.size, permission: att.permission, declared: att.declared, overtimeHours: att.overtimeHours },
      reasons: {
        unpaidDays: leave.unpaid.length,
        sickThreeQuarters: split.threeQuarters,
        sickUnpaid: split.unpaid + split.beyond,
        penalties: pen.items
          .filter((x) => x.deducted > 0)
          .map((x) => {
            const v = (input.violations ?? []).find((y) => y.id === x.id)
            return { code: v?.code ?? "", on: v?.on ?? "", deducted: x.deducted }
          }),
      },
      sickUsed: usedBefore + sickDates.size,
      sickYear,
      eosAccrual: r2(monthlyEosAccrual(line.wage, years) * share),
      leaveAccrual: r2((line.wage / STATUTORY.monthDays) * (entitlement / 12) * share),
      cost: r2(line.gross - line.sickDeduction - line.unpaidDeduction + line.gosiEmployer),
      basic: pay.basic,
      housing: pay.housing,
    })
  }
  lines.sort((a, b) => a.no - b.no)
  return { lines, missingPay }
}

/** PY-04 — the supplementary: retro differences recorded against the closed month, nothing else. */
export function computeSupplementary(month: string, employees: HrEmployee[], pays: Map<string, EmployeePay>, sites: HrSite[]): SupplementaryLine[] {
  const out: SupplementaryLine[] = []
  for (const e of employees) {
    const pay = pays.get(e.id)
    const retro = r2((pay?.retro ?? []).filter((x) => x.month === month).reduce((s, x) => s + x.amount, 0))
    if (!pay || retro === 0) continue
    const site = sites.find((s) => s.id === e.siteId)
    const heldReason = heldOf(pay)
    out.push({
      employeeId: e.id,
      userId: e.userId ?? null,
      no: e.no,
      name: e.names?.ar ?? "",
      idNo: e.idNo ?? null,
      siteId: e.siteId ?? null,
      costKind: e.siteId && site ? costKindOf(site.type) : "admin",
      projectId: site?.type === "project" ? (site.projectId ?? null) : null,
      iban: pay.iban ?? null,
      held: heldReason !== null,
      heldReason,
      retro,
      net: retro,
    })
  }
  return out.sort((a, b) => a.no - b.no)
}

// ---------------------------------------------------------------------------
// Totals, warnings (PY-08) and what reaches Finance (§7.3)
// ---------------------------------------------------------------------------

export interface PayrollTotals {
  people: number
  gross: number
  deductions: number
  gosiEmployee: number
  gosiEmployer: number
  advances: number
  penalties: number
  net: number
  /** Net of held lines — inside 2106, outside the transfer and the Mudad file. */
  heldNet: number
  heldCount: number
  eos: number
  leave: number
}

export function payrollTotals(lines: PayrollLine[]): PayrollTotals {
  const t: PayrollTotals = { people: lines.length, gross: 0, deductions: 0, gosiEmployee: 0, gosiEmployer: 0, advances: 0, penalties: 0, net: 0, heldNet: 0, heldCount: 0, eos: 0, leave: 0 }
  for (const l of lines) {
    t.gross += l.gross
    t.deductions += l.gross - l.net
    t.gosiEmployee += l.gosiEmployee
    t.gosiEmployer += l.gosiEmployer
    t.advances += l.advance
    t.penalties += l.penalties
    t.net += l.net
    if (l.held) {
      t.heldNet += l.net
      t.heldCount++
    }
    t.eos += l.eosAccrual
    t.leave += l.leaveAccrual
  }
  for (const k of Object.keys(t) as (keyof PayrollTotals)[]) if (k !== "people" && k !== "heldCount") t[k] = r2(t[k])
  return t
}

export type LineWarning = "net_negative" | "over_half" | "net_below_90" | "ot_over_cap" | "held" | "declared"

/** PY-08 — the pre-Mudad check, as warnings on the line. */
export function lineWarnings(l: PayrollLine): LineWarning[] {
  const w: LineWarning[] = []
  if (l.net < 0) w.push("net_negative")
  else if (l.gross > 0 && l.gross - l.net > l.gross / 2) w.push("over_half")
  else if (l.monthWage > 0 && l.net < l.monthWage * 0.9) w.push("net_below_90")
  if (overtimeOverCap(l.attendance.overtimeHours)) w.push("ot_over_cap")
  if (l.held) w.push("held")
  if (l.attendance.declared > 0) w.push("declared")
  return w
}

export interface CostCentreRow {
  costKind: CostKind
  siteId: string | null
  projectId: string | null
  amount: number
}

/** One debit row per workplace (the cost centre follows the assignment, not the job title). */
export function byCostCentre(rows: Array<{ costKind: CostKind; siteId: string | null; projectId: string | null; amount: number }>): CostCentreRow[] {
  const m = new Map<string, CostCentreRow>()
  for (const r of rows) {
    const k = `${r.costKind}|${r.siteId ?? UNASSIGNED_SITE}`
    const cur = m.get(k) ?? { costKind: r.costKind, siteId: r.siteId, projectId: r.projectId, amount: 0 }
    cur.amount = r2(cur.amount + r.amount)
    m.set(k, cur)
  }
  return [...m.values()]
}

/** `hr:PAY:<key>` — Dr cost per centre; Cr salaries payable (net incl. held), GOSI, advances, fines. Balances by construction. */
export function payEvent(p: Pick<Payroll, "key" | "month" | "kind" | "lines" | "supplementary">) {
  if (p.kind === "supplementary") {
    const sup = p.supplementary ?? []
    const net = r2(sup.reduce((s, l) => s + l.net, 0))
    return {
      key: `hr:PAY:${p.key}`,
      debit: byCostCentre(sup.map((l) => ({ costKind: l.costKind, siteId: l.siteId, projectId: l.projectId, amount: l.retro }))),
      credit: { salariesPayable: net, gosi: 0, advances: 0, fines: 0 },
      held: r2(sup.filter((l) => l.held).reduce((s, l) => s + l.net, 0)),
      lines: sup.map((l) => ({ no: l.no, siteId: l.siteId, gross: l.retro, net: l.net, held: l.held })),
    }
  }
  const t = payrollTotals(p.lines)
  return {
    key: `hr:PAY:${p.key}`,
    debit: byCostCentre(p.lines.map((l) => ({ costKind: l.costKind, siteId: l.siteId, projectId: l.projectId, amount: l.cost }))),
    credit: { salariesPayable: t.net, gosi: r2(t.gosiEmployee + t.gosiEmployer), advances: t.advances, fines: t.penalties },
    held: t.heldNet,
    lines: p.lines.map((l) => ({ no: l.no, siteId: l.siteId, gross: l.gross, gosiEmployee: l.gosiEmployee, gosiEmployer: l.gosiEmployer, advance: l.advance, penalties: l.penalties, net: l.net, held: l.held })),
  }
}

/** `hr:EOS:<month>` — the month's accruals: Dr cost per centre; Cr EOS provision and leave provision. */
export function eosEvent(p: Pick<Payroll, "month" | "lines">) {
  const t = payrollTotals(p.lines)
  return {
    key: `hr:EOS:${p.month}`,
    debit: byCostCentre(p.lines.map((l) => ({ costKind: l.costKind, siteId: l.siteId, projectId: l.projectId, amount: r2(l.eosAccrual + l.leaveAccrual) }))),
    credit: { eosProvision: t.eos, leaveProvision: t.leave },
  }
}

export const eventBalances = (e: { debit: CostCentreRow[]; credit: Record<string, number> }) =>
  r2(e.debit.reduce((s, d) => s + d.amount, 0)) === r2(Object.values(e.credit).reduce((s, c) => s + c, 0))

// ---------------------------------------------------------------------------
// Files for the authorities (PY-07) — produced here, uploaded by a person
// ---------------------------------------------------------------------------

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (rows: Array<Array<string | number | null>>) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"

/** The pay a line was computed with: frozen on the line; a line prepared before that reads the pay document. */
const frozenPay = (l: PayrollLine, pays: Map<string, EmployeePay>) => {
  const p = pays.get(l.employeeId)
  return { basic: l.basic ?? p?.basic ?? 0, housing: l.housing ?? p?.housing ?? 0, transport: 0 }
}

/** The Mudad wage file: one row per paid line, keyed by the ID number; the row adds up to the net. Held lines stay out.
 * Basic and housing stand whole for the days paid; what else was earned (transport, overtime, commission) is "other";
 * an absence is a DEDUCTION like every other — earnings are never negative (the prototype's wpsRows). */
export function mudadCsv(lines: PayrollLine[], pays: Map<string, EmployeePay>): string {
  const rows: Array<Array<string | number | null>> = [["id_no", "name", "iban", "basic", "housing", "other_earnings", "deductions", "net"]]
  for (const l of lines) {
    if (l.held) continue
    const p = frozenPay(l, pays)
    const share = l.days / STATUTORY.monthDays
    const basic = r2(p.basic * share)
    const housing = r2(p.housing * share)
    const other = r2(l.monthWage - basic - housing + l.overtime + l.commission)
    const deductions = r2(basic + housing + other - l.net)
    rows.push([l.idNo, l.name, l.iban, basic.toFixed(2), housing.toFixed(2), other.toFixed(2), deductions.toFixed(2), l.net.toFixed(2)])
  }
  return csv(rows)
}

/** The GOSI statement: base and both shares per line — its total is the GOSI credit. A held transfer still owes
 * its contributions, so held lines are IN it (they are in the credit). */
export function gosiCsv(lines: PayrollLine[], pays: Map<string, EmployeePay>): string {
  const rows: Array<Array<string | number | null>> = [["id_no", "name", "nationality", "scheme", "base", "employee", "employer", "total"]]
  for (const l of lines) {
    const base = gosiBase(frozenPay(l, pays), l.days)
    rows.push([l.idNo, l.name, l.nationality, l.gosiScheme, base.toFixed(2), l.gosiEmployee.toFixed(2), l.gosiEmployer.toFixed(2), r2(l.gosiEmployee + l.gosiEmployer).toFixed(2)])
  }
  return csv(rows)
}

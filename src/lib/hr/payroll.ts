// HR 1.0 — payroll (PRD PY-01…05, PY-07, PY-10; §7.3, §8). Computed from the
// CLOSED months of every workplace and the contract, never typed: prepared by
// payroll, approved by the HR manager — never by whoever prepared it (RL-02).
// A bounced or unapproved IBAN holds its LINE, not the payroll (PY-03); a late
// item — a retro pay difference, a commission, a penalty refunded after the
// objection — goes to a supplementary "-D" payroll of that month, the closed
// month never reopens (PY-04). What reaches Finance is two events with fixed
// keys — hr:PAY and hr:EOS — that balance on their own. Pure: no I/O.

import { addMonths, assumesPresence, EMPTY_MONTH, employeeMonth, type EmployeeMonth, type WorkplaceMonth } from "./attendance"
import type { EmployeePay, HrEmployee } from "./employee"
import { gratuity, monthlyEosAccrual } from "./eos"
import { isHoliday } from "./holidays"
import { leaveDays, sickSplit, type Holiday } from "./leave"
import { gosiBase, overtimeOverCap, payLine, payOn, paySegments, wageOf, type PayFacts, type PayLine } from "./pay"
import type { HrRequest } from "./requests"
import { monthPenalties, type HrViolation } from "./violations"
import { costKindOf, UNASSIGNED_SITE, type CostKind, type HrSite } from "./sites"
import { addDays, daysBetween, monthRange, r2, serviceYears, STATUTORY } from "./statutory"

/** `hrPayrolls/{orgId}__{yyyy-mm}` and its supplementaries `{orgId}__{yyyy-mm}-D`, `-D2`, `-D3`… — each a new
 * event key (hr:PAY:yyyy-mm-D2): what arrives after one supplementary was approved goes to the next, never
 * into one already sent (HR-Pipeline §2: a change arrives as a new event with its own key). */
export const payrollId = (orgId: string, key: string) => `${orgId}__${key}`
export const supplementaryKey = (month: string, n = 1) => `${month}-D${n > 1 ? n : ""}`
/** The most supplementaries one month may have — a bound for the write that looks for the next free key. */
export const MAX_SUPPLEMENTARIES = 20

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
  /** Every deduction with its reason (ES-04): unpaid leave days, sick days by band, each penalty (by its violation id). */
  reasons?: { unpaidDays: number; sickThreeQuarters: number; sickUnpaid: number; penalties: Array<{ id?: string; code: string; on: string; deducted: number }> }
  /** The commission items this line paid (PY-01) — one approved later goes to a supplementary. */
  commissionIds?: string[]
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
  /** Commission approved after the month's payroll (PY-01). */
  commission?: number
  /** Penalties deducted in the month and cancelled on objection since — paid back (PN-04). */
  refunds?: number
  /** What the line is made of — the ids its approval clears and the next supplementary leaves out. */
  items?: SupplementaryItem[]
  net: number
}

export interface SupplementaryItem {
  kind: "retro" | "commission" | "refund"
  /** The retro or commission item's id on the pay document; the violation's id for a refund. */
  id: string
  amount: number
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
  /** fin:RETURNED — transfers the bank sent back after the payment, by employee (Finance's). */
  returned?: Record<string, Stamp & { reason?: string | null; date?: string | null }> | null
  /** Held or returned lines paid since, by employee (Finance's) — they go in the "-R" release file. */
  paidHeld?: Record<string, Stamp & { date?: string | null }> | null
  /** fin:GOSIPAID — Finance paid the month's contributions (PY-09). */
  gosiPaid?: (Stamp & { date: string; amount: number; entry?: string | null }) | null
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

type AdvanceRequest = HrRequest & { payout?: { date?: string | null } | null }

/** AD-01, WF-08 step 4 — the first month an advance is taken back: the month after Finance paid it out
 * (fin:PRPAID). An approved advance not yet paid out takes nothing (null); one with no request behind it —
 * brought in by the import — runs from the import month, as it always did (undefined). */
export function advanceStartMonth(requests: HrRequest[], employeeId: string): string | null | undefined {
  const latest = (requests as AdvanceRequest[])
    .filter((r) => r.employeeId === employeeId && r.kind === "advance" && r.state === "approved")
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0]
  if (!latest) return undefined
  const paidOn = latest.payout?.date
  if (!paidOn) return null
  return addDays(monthRange(paidOn.slice(0, 7)).end, 1).slice(0, 7)
}

/** The facts one employee's month is computed from (the payroll's, or the settlement's last month). */
export interface LineFacts {
  month: string
  sites: HrSite[]
  /** The month's workplace records that count (closed, or an office's). */
  counted: WorkplaceMonth[]
  requests: HrRequest[]
  previous?: PayrollLine[] | null
  holidays?: Holiday[]
  violations?: HrViolation[]
  /** EX-04 — the settlement pays the month of the last day up to it, with no advance instalment (the
   * settlement takes the whole balance); a commission for that month is paid there, the payroll has no line for him. */
  lastDay?: string | null
  noAdvance?: boolean
}

/** One employee's line for the month — the payroll's, and the settlement's last month (EX-04). */
export function employeeLine(e: HrEmployee, raw: EmployeePay, f: LineFacts): PayrollLine {
  const { month, counted } = f
  const { start, end } = monthRange(month)
  const to = f.lastDay && f.lastDay < end ? f.lastDay : end
  // EM-04 — the pay in force on each day: the period's rates are those at its end; the month's wage and
  // the GOSI base follow every change inside it.
  const pay = payOn(raw, to)
  const segments = paySegments(raw, e.join, month, f.lastDay)
  const att = counted.reduce<EmployeeMonth>((acc, wm) => addMonths(acc, employeeMonth(wm, e.id)), { ...EMPTY_MONTH, violations: [] })
  // Sick: the sheet's sick days and approved sick leave, each day once; banded by the service year.
  const leave = leaveDaysInMonth(f.requests, e.id, month, f.holidays)
  const inPeriod = (d: string) => d <= to
  const sickDates = new Set(leave.sick.filter(inPeriod))
  for (const wm of counted) for (const [d, s] of Object.entries(wm.days ?? {})) if (inPeriod(d) && s.listed.includes(e.id) && s.ex?.[e.id]?.status === "sick") sickDates.add(d)
  const sickYear = Math.floor(serviceYears(e.join, end))
  const prev = f.previous?.find((l) => l.employeeId === e.id)
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
  for (const wm of counted)
    for (const [d, s] of Object.entries(wm.days ?? {})) {
      if (!inPeriod(d) || !s.listed.includes(e.id)) continue
      if (s.ex?.[e.id]?.status === "absent") absentOn.add(d)
      else seenOn.add(d)
    }
  const absent = [...absentOn].filter((d) => !onLeave.has(d) && !seenOn.has(d)).length
  // A whole calendar month without pay is the whole 30-day wage (February's 28 days too) —
  // a public holiday inside it is not a leave day (LV-02), so it does not break "whole".
  const from = e.join > start ? e.join : start
  const unpaid = leave.unpaid.filter(inPeriod)
  const unpaidDays = unpaid.length > 0 && datesOf(from, to).every((d) => unpaid.includes(d) || isHoliday(d, f.holidays)) ? STATUTORY.monthDays : unpaid.length
  // Overtime of the period only: the sheets' days after the last day are not his.
  const overtimeHours = f.lastDay
    ? counted.reduce((s, wm) => s + Object.entries(wm.days ?? {}).reduce((t, [d, x]) => t + (inPeriod(d) && x.listed.includes(e.id) ? (x.ex?.[e.id]?.ot ?? 0) : 0), 0), 0)
    : att.overtimeHours
  const pen = monthPenalties(f.violations ?? [], e.id, month, wageOf(pay))
  // PY-01 — Sales' approved commission for the month.
  const commissions = (raw.commissions ?? []).filter((c) => c.month === month && c.amount > 0)
  // AD-01 — the instalment from the month after the payout.
  const startsIn = advanceStartMonth(f.requests, e.id)
  const advanceDue = !f.noAdvance && startsIn !== null && (startsIn === undefined || startsIn <= month)
  const line = payLine({
    pay,
    segments,
    nationality: e.nationality,
    join: e.join,
    month,
    lastDay: f.lastDay,
    attendance: { absent, overtimeHours, sickThreeQuarters: split.threeQuarters, sickUnpaid: split.unpaid + split.beyond, unpaid: unpaidDays },
    advance: advanceDue ? (raw.advance ?? null) : null,
    penalties: pen.total,
    commission: r2(commissions.reduce((s, c) => s + c.amount, 0)),
  })
  const site = f.sites.find((s) => s.id === e.siteId)
  const costKind: CostKind = e.siteId && site ? costKindOf(site.type) : "admin"
  const years = serviceYears(e.join, end)
  const entitlement = years >= STATUTORY.leave.fiveYears ? STATUTORY.leave.afterFive : STATUTORY.leave.base
  const share = line.days / STATUTORY.monthDays
  const heldReason = heldOf(raw)
  // The basic and housing the month paid — every piece weighed by its days — for the Mudad file.
  const weighed = (k: keyof PayFacts) => (line.days > 0 ? r2(segments.reduce((s, x) => s + x.pay[k] * x.days, 0) / line.days) : pay[k])
  return {
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
    iban: raw.iban ?? null,
    held: heldReason !== null,
    heldReason,
    attendance: { present: att.present, absent, sick: sickDates.size, permission: att.permission, declared: att.declared, overtimeHours },
    reasons: {
      unpaidDays: unpaid.length,
      sickThreeQuarters: split.threeQuarters,
      sickUnpaid: split.unpaid + split.beyond,
      penalties: pen.items
        .filter((x) => x.deducted > 0)
        .map((x) => {
          const v = (f.violations ?? []).find((y) => y.id === x.id)
          return { id: x.id, code: v?.code ?? "", on: v?.on ?? "", deducted: x.deducted }
        }),
    },
    commissionIds: commissions.map((c) => c.id),
    sickUsed: usedBefore + sickDates.size,
    sickYear,
    eosAccrual: r2(monthlyEosAccrual(line.wage, years) * share),
    leaveAccrual: r2((line.wage / STATUTORY.monthDays) * (entitlement / 12) * share),
    cost: r2(line.gross - line.sickDeduction - line.unpaidDeduction + line.gosiEmployer),
    basic: weighed("basic"),
    housing: weighed("housing"),
  }
}

/** What counts of a month's workplace records: a CLOSED month — and an office's or the unassigned bench's
 * records as they stand: presence is assumed there, nothing asks for a closing (AT-02), and an exception
 * written on its sheet is still a fact. */
export function countedAttendance(month: string, attendance: WorkplaceMonth[], sites: HrSite[]): WorkplaceMonth[] {
  return attendance.filter((a) => a.month === month && (a.closed || assumesPresence(a.siteId, sites.find((s) => s.id === a.siteId)?.type ?? null)))
}

export function computePayroll(input: ComputeInput): { lines: PayrollLine[]; missingPay: string[] } {
  const { month } = input
  const counted = countedAttendance(month, input.attendance, input.sites)
  const lines: PayrollLine[] = []
  const missingPay: string[] = []
  for (const e of input.employees) {
    if (!onPayroll(e, month)) continue
    const pay = input.pays.get(e.id)
    if (!pay || !(payOn(pay, monthRange(month).end).basic > 0)) {
      missingPay.push(e.id)
      continue
    }
    lines.push(employeeLine(e, pay, { month, sites: input.sites, counted, requests: input.requests, previous: input.previous, holidays: input.holidays, violations: input.violations }))
  }
  lines.sort((a, b) => a.no - b.no)
  return { lines, missingPay }
}

export interface SupplementaryInput {
  month: string
  employees: HrEmployee[]
  pays: Map<string, EmployeePay>
  sites: HrSite[]
  /** The month's main payroll — what its approved lines already paid (commissions) and deducted (penalties). */
  main?: Pick<Payroll, "state" | "lines"> | null
  /** The month's supplementaries already approved — their items are never paid again. */
  done?: Array<Pick<Payroll, "state" | "supplementary">>
  /** The month's penalties — one cancelled on objection after the main deducted it is paid back (PN-04). */
  violations?: HrViolation[]
}

/** The penalty a line deducted, by violation (lines written before ids were kept match by code and day). */
export function deductedOn(line: Pick<PayrollLine, "reasons"> | null | undefined, v: Pick<HrViolation, "id" | "code" | "on">): number {
  const hit = (line?.reasons?.penalties ?? []).find((p) => (p.id ? p.id === v.id : p.code === v.code && p.on === v.on))
  return hit?.deducted ?? 0
}

/** PY-04 — the supplementary: what reached the closed month after its payroll was approved — retro pay
 * differences (EM-04), commission approved late (PY-01), penalties cancelled after they were deducted
 * (PN-04) — and nothing an earlier supplementary of the month already paid. */
export function computeSupplementary(input: SupplementaryInput): SupplementaryLine[] {
  const { month } = input
  const sent = (p: { state: PayrollState }) => p.state !== "prepared"
  const paid = new Set((input.done ?? []).filter(sent).flatMap((p) => (p.supplementary ?? []).flatMap((l) => (l.items ?? []).map((i) => `${i.kind}:${i.id}`))))
  const mainLines = input.main && sent(input.main) ? input.main.lines : []
  const out: SupplementaryLine[] = []
  for (const e of input.employees) {
    const pay = input.pays.get(e.id)
    if (!pay) continue
    const mainLine = mainLines.find((l) => l.employeeId === e.id) ?? null
    const items: SupplementaryItem[] = []
    for (const [i, x] of (pay.retro ?? []).entries()) if (x.month === month && x.amount !== 0) items.push({ kind: "retro", id: x.id ?? `${month}#${i}`, amount: x.amount })
    // A commission the main line did not pay — approved after it, or for a month already closed.
    // Only for someone the main payroll paid: a leaver's last month — and its commission — is the settlement's.
    if (input.main && sent(input.main) && mainLine)
      for (const c of pay.commissions ?? []) if (c.month === month && c.amount > 0 && !(mainLine?.commissionIds ?? []).includes(c.id)) items.push({ kind: "commission", id: c.id, amount: c.amount })
    for (const v of input.violations ?? []) {
      if (v.employeeId !== e.id || v.state !== "cancelled" || v.deductMonth !== month) continue
      const back = deductedOn(mainLine, v)
      if (back > 0) items.push({ kind: "refund", id: v.id, amount: back })
    }
    const due = items.filter((i) => !paid.has(`${i.kind}:${i.id}`))
    if (!due.length) continue
    const sum = (k: SupplementaryItem["kind"]) => r2(due.filter((i) => i.kind === k).reduce((s, i) => s + i.amount, 0))
    const retro = sum("retro")
    const commission = sum("commission")
    const refunds = sum("refund")
    const net = r2(retro + commission + refunds)
    if (net === 0) continue
    const site = input.sites.find((s) => s.id === e.siteId)
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
      commission,
      refunds,
      items: due,
      net,
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

/** A day the line was not paid in full for a reason Mudad already knows: a recorded absence, an unpaid or a sick
 * day (the prototype's "no absence and no leave"). */
const explainedShortfall = (l: Pick<PayrollLine, "attendance" | "unpaidDeduction" | "sickDeduction" | "reasons">) =>
  l.attendance.absent > 0 || l.attendance.sick > 0 || l.unpaidDeduction > 0 || l.sickDeduction > 0 || (l.reasons?.unpaidDays ?? 0) > 0

/** PY-08 — the pre-Mudad check, as warnings on the line: a net of zero or less; deductions above half the pay
 * (art. 93); or — with no recorded absence, unpaid or sick day — a net below 90% of the month's wage less the
 * employee's GOSI share, which Mudad asks a reason for (the prototype's `mudadFindings`). The GOSI share is a
 * deduction every Saudi has, never a shortfall: comparing the net with the bare wage flagged every Saudi. */
export function lineWarnings(l: PayrollLine): LineWarning[] {
  const w: LineWarning[] = []
  if (l.net <= 0) w.push("net_negative")
  else if (l.gross > 0 && l.gross - l.net > l.gross / 2) w.push("over_half")
  else if (l.monthWage > 0 && !explainedShortfall(l) && l.net < (l.monthWage - l.gosiEmployee) * 0.9) w.push("net_below_90")
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

/** `hr:PAY:<key>` — Dr cost per centre; Cr salaries payable (net incl. held), GOSI, advances, fines. Balances by construction.
 * A supplementary's variable items only: retro and late commission are cost; a refunded penalty comes back out of the
 * workers' fines fund it was credited to (a negative fines credit — a debit). */
export function payEvent(p: Pick<Payroll, "key" | "month" | "kind" | "lines" | "supplementary">) {
  if (p.kind === "supplementary") {
    const sup = p.supplementary ?? []
    const net = r2(sup.reduce((s, l) => s + l.net, 0))
    const refunds = r2(sup.reduce((s, l) => s + (l.refunds ?? 0), 0))
    const earned = (l: SupplementaryLine) => r2(l.retro + (l.commission ?? 0))
    return {
      key: `hr:PAY:${p.key}`,
      debit: byCostCentre(sup.map((l) => ({ costKind: l.costKind, siteId: l.siteId, projectId: l.projectId, amount: earned(l) }))),
      credit: { salariesPayable: net, gosi: 0, advances: 0, fines: r2(-refunds) },
      held: r2(sup.filter((l) => l.held).reduce((s, l) => s + l.net, 0)),
      lines: sup.map((l) => ({ no: l.no, siteId: l.siteId, gross: earned(l), refunds: l.refunds ?? 0, net: l.net, held: l.held })),
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
// Review (PY-06): exceptions by cost centre — what the payroll officer reads
// ---------------------------------------------------------------------------

export const LINE_EXCEPTIONS = ["absence", "overtime", "sick", "unpaid", "penalty", "advance", "commission", "held", "negative"] as const
export type LineException = (typeof LINE_EXCEPTIONS)[number]

/** PY-06 — what makes a line worth a look (the prototype's `isExc`): absence, overtime, sick days, unpaid days,
 * a penalty, an advance instalment, commission, a held transfer, a net of zero or less. A line with none of these
 * is the contract wage paid as agreed. */
export function lineExceptions(l: PayrollLine): LineException[] {
  const out: LineException[] = []
  if (l.attendance.absent > 0 || l.absenceDeduction > 0) out.push("absence")
  if (l.attendance.overtimeHours > 0 || l.overtime > 0) out.push("overtime")
  if (l.attendance.sick > 0 || l.sickDeduction > 0) out.push("sick")
  if (l.unpaidDeduction > 0) out.push("unpaid")
  if (l.penalties > 0) out.push("penalty")
  if (l.advance > 0) out.push("advance")
  if (l.commission > 0) out.push("commission")
  if (l.held) out.push("held")
  if (l.net <= 0) out.push("negative")
  return out
}

/** An exception or a pre-Mudad warning (declared days, over half deducted, net under 90%). */
export const isException = (l: PayrollLine) => lineExceptions(l).length > 0 || lineWarnings(l).length > 0

export interface LineGroup<L> {
  /** The workplace — null for the unassigned. */
  siteId: string | null
  lines: L[]
  count: number
  /** Net of the lines that go now — held lines wait. */
  net: number
  gross: number
}

const unassigned = (siteId: string | null) => !siteId || siteId === UNASSIGNED_SITE

/** PY-06 — lines grouped by cost centre (the workplace): the largest gross first, the unassigned last; inside, the
 * lines that go now before the held ones, the largest net first. */
export function groupByCostCentre<L extends { siteId: string | null; held: boolean; net: number; gross?: number }>(lines: L[]): LineGroup<L>[] {
  const by = new Map<string, L[]>()
  for (const l of lines) {
    const k = unassigned(l.siteId) ? UNASSIGNED_SITE : (l.siteId as string)
    by.set(k, [...(by.get(k) ?? []), l])
  }
  const groups = [...by.entries()].map(([k, ls]) => ({
    siteId: k === UNASSIGNED_SITE ? null : k,
    lines: ls.slice().sort((a, b) => Number(a.held) - Number(b.held) || b.net - a.net),
    count: ls.length,
    net: r2(ls.filter((l) => !l.held).reduce((s, l) => s + l.net, 0)),
    gross: r2(ls.reduce((s, l) => s + (l.gross ?? l.net), 0)),
  }))
  return groups.sort((a, b) => Number(a.siteId === null) - Number(b.siteId === null) || b.gross - a.gross)
}

/** PY-06 — the cost of the month by cost centre (workplace), as Finance books it: each line's `cost` (what it
 * earned + employer GOSI) — held lines included, their cost is the month's — largest first, with each one's share. */
export function costByCentre(lines: Array<Pick<PayrollLine, "siteId" | "cost">>): Array<{ siteId: string | null; amount: number; share: number }> {
  const by = new Map<string, number>()
  for (const l of lines) {
    const k = unassigned(l.siteId) ? UNASSIGNED_SITE : (l.siteId as string)
    by.set(k, r2((by.get(k) ?? 0) + l.cost))
  }
  const total = [...by.values()].reduce((s, v) => s + v, 0)
  return [...by.entries()]
    .map(([k, amount]) => ({ siteId: k === UNASSIGNED_SITE ? null : k, amount, share: total > 0 ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount)
}

// ---------------------------------------------------------------------------
// The month before its payroll (PY-02) — no lines, the contract estimate
// ---------------------------------------------------------------------------

/** The contract estimate for a month still running: the wage in force at its end of everyone on it. It enters no
 * entry and is never a line (the prototype's «تقدير من العقود»). */
export function contractEstimate(employees: HrEmployee[], pays: Map<string, EmployeePay>, month: string): number {
  const end = monthRange(month).end
  let sum = 0
  for (const e of employees) {
    const p = pays.get(e.id)
    if (p && onPayroll(e, month)) sum += wageOf(payOn(p, end))
  }
  return r2(sum)
}

/** The last day every listed workplace has a sheet for — the day attendance is recorded through (null: nothing yet). */
export function recordedThrough(attendance: WorkplaceMonth[], siteIds: string[]): string | null {
  if (!siteIds.length) return null
  let through: string | null = null
  for (const id of siteIds) {
    const days = Object.keys(attendance.find((a) => a.siteId === id)?.days ?? {}).sort()
    const last = days[days.length - 1]
    if (!last) return null
    if (through === null || last < through) through = last
  }
  return through
}

/** The day the payroll may open: the day after the month ends. */
export const payrollOpensOn = (month: string) => addDays(monthRange(month).end, 1)

/** Salaries are due on the policy's pay day of the following month; a payment after it is late (PY-08). */
export const payDayOf = (month: string, payDay: number) => addDays(monthRange(month).end, payDay)

export function daysAfterPayDay(month: string, payDay: number, paidOn: string | null | undefined): number {
  if (!paidOn) return 0
  return Math.max(0, daysBetween(payDayOf(month, payDay), paidOn))
}

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

/** The Saudi banks by the two digits after the IBAN's check digits — the code Mudad's file carries (SWIFT prefix).
 * Two merged banks keep their old codes (SAMBA → SNB, Alawwal → SAB). */
export const SA_BANK_CODES: Readonly<Record<string, string>> = {
  "05": "INMA",
  "10": "NCBK",
  "15": "ALBI",
  "20": "RIBL",
  "30": "ARNB",
  "40": "NCBK",
  "45": "SABB",
  "50": "SABB",
  "55": "BSFR",
  "60": "BJAZ",
  "65": "SIBC",
  "80": "RJHI",
  "90": "GULF",
  "95": "EBIL",
}

/** The bank of a Saudi IBAN (SA + 2 check digits + 2-digit bank code + 18): its code, the bare digits when the bank
 * is not in the table, null when the IBAN is not a full Saudi one. */
export function bankOfIban(iban: string | null | undefined): string | null {
  const m = /^SA\d{2}(\d{2})[0-9A-Z]{18}$/.exec((iban ?? "").replace(/\s+/g, "").toUpperCase())
  return m ? (SA_BANK_CODES[m[1]] ?? m[1]) : null
}

export interface MudadRow {
  employeeId: string
  idNo: string | null
  name: string
  bank: string | null
  iban: string | null
  basic: number
  housing: number
  /** Transport, overtime, commission — and on a supplementary every late item. */
  other: number
  deductions: number
  net: number
  /** The bank sent this transfer back after the file was uploaded — the row is marked, not removed. */
  returned: boolean
}

type PayrollFiles = Pick<Payroll, "key" | "month" | "kind" | "lines" | "supplementary" | "returned" | "paidHeld">

/** One row per paid line, keyed by the ID number; the row adds up to the net. Held lines stay out. Basic and housing
 * stand whole for the days paid; what else was earned (transport, overtime, commission) is "other"; an absence is a
 * DEDUCTION like every other — earnings are never negative (the prototype's wpsRows). */
export function mudadRows(lines: PayrollLine[], pays: Map<string, EmployeePay>, returned?: Payroll["returned"]): MudadRow[] {
  return lines
    .filter((l) => !l.held)
    .map((l) => {
      const p = frozenPay(l, pays)
      const share = l.days / STATUTORY.monthDays
      const basic = r2(p.basic * share)
      const housing = r2(p.housing * share)
      const other = r2(l.monthWage - basic - housing + l.overtime + l.commission)
      const deductions = r2(basic + housing + other - l.net)
      return { employeeId: l.employeeId, idNo: l.idNo, name: l.name, bank: bankOfIban(l.iban), iban: l.iban, basic, housing, other, deductions, net: l.net, returned: Boolean(returned?.[l.employeeId]) }
    })
}

/** A supplementary's file (PY-04/07): variable items only — no basic, no housing; retro, late commission and a
 * penalty paid back are "other"; nothing is deducted. */
export function mudadSupplementaryRows(lines: SupplementaryLine[], returned?: Payroll["returned"]): MudadRow[] {
  return lines
    .filter((l) => !l.held)
    .map((l) => ({ employeeId: l.employeeId, idNo: l.idNo, name: l.name, bank: bankOfIban(l.iban), iban: l.iban, basic: 0, housing: 0, other: l.net, deductions: 0, net: l.net, returned: Boolean(returned?.[l.employeeId]) }))
}

export const MUDAD_COLUMNS = ["id_no", "name", "bank", "iban", "basic", "housing", "other_earnings", "deductions", "net", "establishment", "period"] as const

/** The Mudad / WPS CSV: the prototype's columns, with the establishment's Mudad number and the period on every row. */
export function mudadRowsCsv(rows: MudadRow[], opts: { establishment?: string | null; period: string }): string {
  const out: Array<Array<string | number | null>> = [[...MUDAD_COLUMNS]]
  for (const r of rows) out.push([r.idNo, r.name, r.bank, r.iban, r.basic.toFixed(2), r.housing.toFixed(2), r.other.toFixed(2), r.deductions.toFixed(2), r.net.toFixed(2), opts.establishment ?? "", opts.period])
  return csv(out)
}

/** The Mudad wage file of a main payroll's lines (for callers that hold only the lines). */
export function mudadCsv(lines: PayrollLine[], pays: Map<string, EmployeePay>, opts: { establishment?: string | null; period?: string } = {}): string {
  return mudadRowsCsv(mudadRows(lines, pays), { establishment: opts.establishment, period: opts.period ?? "" })
}

export interface MudadFile {
  /** `mudad-2026-08.csv`, `mudad-2026-08-D.csv`, the release `mudad-2026-08-R.csv`. */
  name: string
  kind: "main" | "supplementary" | "release"
  period: string
  rows: MudadRow[]
  total: number
  /** Lines left out — held until their IBAN is fixed, then sent in the "-R" release file. */
  heldCount: number
  heldNet: number
  csv: string
}

const fileOf = (name: string, kind: MudadFile["kind"], period: string, rows: MudadRow[], held: Array<{ net: number }>, establishment?: string | null): MudadFile => ({
  name,
  kind,
  period,
  rows,
  total: r2(rows.reduce((s, x) => s + x.net, 0)),
  heldCount: held.length,
  heldNet: r2(held.reduce((s, x) => s + x.net, 0)),
  csv: mudadRowsCsv(rows, { establishment, period }),
})

/** PY-07 — the payroll's Mudad file (a supplementary's too), for the preview and the download. */
export function mudadFile(p: PayrollFiles, pays: Map<string, EmployeePay>, establishment?: string | null): MudadFile {
  if (p.kind === "supplementary") {
    const sup = p.supplementary ?? []
    return fileOf(`mudad-${p.key}.csv`, "supplementary", p.month, mudadSupplementaryRows(sup, p.returned), sup.filter((l) => l.held), establishment)
  }
  return fileOf(`mudad-${p.key}.csv`, "main", p.month, mudadRows(p.lines, pays, p.returned), p.lines.filter((l) => l.held), establishment)
}

/** PY-03/07 — the "-R" release file: the lines paid AFTER the month — held at approval or returned by the bank, then
 * paid once the IBAN was approved (`paidHeld`). Null while none was. */
export function releaseFile(p: PayrollFiles, pays: Map<string, EmployeePay>, establishment?: string | null): MudadFile | null {
  const paid = p.paidHeld ?? {}
  if (!Object.keys(paid).length) return null
  const rows =
    p.kind === "supplementary"
      ? mudadSupplementaryRows((p.supplementary ?? []).filter((l) => paid[l.employeeId]).map((l) => ({ ...l, held: false })))
      : mudadRows(
          p.lines.filter((l) => paid[l.employeeId]).map((l) => ({ ...l, held: false })),
          pays
        )
  return rows.length ? fileOf(`mudad-${p.key}-R.csv`, "release", p.month, rows, [], establishment) : null
}

export interface GosiRow {
  employeeId: string
  idNo: string | null
  name: string
  nationality: string
  scheme: PayrollLine["gosiScheme"]
  base: number
  employee: number
  employer: number
}

export interface GosiStatement {
  /** Saudis, one row each (the prototype's table). */
  saudi: GosiRow[]
  /** Non-Saudis, aggregated: occupational hazards, employer only. */
  nonSaudi: { count: number; base: number; employer: number }
  rows: GosiRow[]
  employee: number
  employer: number
  /** = the GOSI credit of hr:PAY (210204). */
  total: number
}

/** The GOSI statement: base and both shares per line — its total is the GOSI credit. A held transfer still owes
 * its contributions, so held lines are IN it (they are in the credit). */
export function gosiStatement(lines: PayrollLine[], pays: Map<string, EmployeePay>): GosiStatement {
  const rows: GosiRow[] = lines.map((l) => ({ employeeId: l.employeeId, idNo: l.idNo, name: l.name, nationality: l.nationality, scheme: l.gosiScheme, base: gosiBase(frozenPay(l, pays), l.days), employee: l.gosiEmployee, employer: l.gosiEmployer }))
  const others = rows.filter((x) => x.scheme === "nonSaudi")
  const employee = r2(rows.reduce((s, x) => s + x.employee, 0))
  const employer = r2(rows.reduce((s, x) => s + x.employer, 0))
  return {
    saudi: rows.filter((x) => x.scheme !== "nonSaudi"),
    nonSaudi: { count: others.length, base: r2(others.reduce((s, x) => s + x.base, 0)), employer: r2(others.reduce((s, x) => s + x.employer, 0)) },
    rows,
    employee,
    employer,
    total: r2(employee + employer),
  }
}

export function gosiCsv(lines: PayrollLine[], pays: Map<string, EmployeePay>): string {
  const rows: Array<Array<string | number | null>> = [["id_no", "name", "nationality", "scheme", "base", "employee", "employer", "total"]]
  for (const x of gosiStatement(lines, pays).rows) rows.push([x.idNo, x.name, x.nationality, x.scheme, x.base.toFixed(2), x.employee.toFixed(2), x.employer.toFixed(2), r2(x.employee + x.employer).toFixed(2)])
  return csv(rows)
}

// ---------------------------------------------------------------------------
// Reconciliation with Finance (PY-09) — HR reads, Finance pays
// ---------------------------------------------------------------------------

type AnyPayLine = PayrollLine | SupplementaryLine
const payLinesOf = (p: Pick<Payroll, "kind" | "lines" | "supplementary">): AnyPayLine[] => (p.kind === "supplementary" ? (p.supplementary ?? []) : p.lines)

/** GOSI contributions of a month are due by the 15th of the next. */
export const gosiDueOn = (month: string) => addDays(monthRange(month).end, 15)

export interface Reconciliation {
  /** Salaries payable (210202): the net of every line, held ones included. */
  payable: number
  /** Paid so far: transferred and not returned, plus held / returned lines paid since. Null before fin:PAID. */
  paid: number | null
  /** Still owed: held lines and returned transfers not paid again. */
  owed: number
  owedCount: number
  gosi: number
  gosiPaid: { date: string; amount: number } | null
  gosiDue: string
  gosiOverdue: boolean
  eos: number
  leave: number
}

export function financeReconciliation(p: Pick<Payroll, "month" | "kind" | "state" | "lines" | "supplementary" | "returned" | "paidHeld" | "gosiPaid">, today: string): Reconciliation {
  const lines = payLinesOf(p)
  const paidState = p.state === "paid"
  const owedLine = (l: AnyPayLine) => (l.held || Boolean(p.returned?.[l.employeeId])) && !p.paidHeld?.[l.employeeId]
  const owedLs = paidState ? lines.filter(owedLine) : lines.filter((l) => l.held)
  const payable = r2(lines.reduce((s, l) => s + l.net, 0))
  const owed = r2(owedLs.reduce((s, l) => s + l.net, 0))
  const t = p.kind === "main" ? payrollTotals(p.lines) : null
  const gosiDue = gosiDueOn(p.month)
  const gosiPaid = p.gosiPaid ? { date: p.gosiPaid.date, amount: p.gosiPaid.amount } : null
  return {
    payable,
    paid: paidState ? r2(payable - owed) : null,
    owed,
    owedCount: owedLs.length,
    gosi: t ? r2(t.gosiEmployee + t.gosiEmployer) : 0,
    gosiPaid,
    gosiDue,
    gosiOverdue: p.kind === "main" && !gosiPaid && today > gosiDue,
    eos: t?.eos ?? 0,
    leave: t?.leave ?? 0,
  }
}

/** The balance of a credit-side account (a provision) from journal entries: credits less debits. */
export function creditBalance(entries: Array<{ lines?: Array<{ account: string; debit?: number | null; credit?: number | null }> | null }>, account: string): number {
  let b = 0
  for (const e of entries) for (const l of e.lines ?? []) if (l.account === account) b += (l.credit ?? 0) - (l.debit ?? 0)
  return r2(b)
}

/** hr:RECON — the end-of-service provision against the ledger: what everyone in service would be owed if his
 * service ended today (termination, art. 84) against the balance of the provision account; the difference is the
 * adjustment Finance posts. `ledger` null = Accounting off (nothing to compare). */
export function eosReconciliation(employees: HrEmployee[], pays: Map<string, EmployeePay>, today: string, ledger: number | null): { accrued: number; people: number; ledger: number | null; difference: number | null } {
  let accrued = 0
  let people = 0
  for (const e of employees) {
    if (e.status === "left" || !e.join || e.join > today) continue
    const p = pays.get(e.id)
    if (!p) continue
    accrued += gratuity(wageOf(payOn(p, today)), e.join, today, "termination_notice")
    people++
  }
  accrued = r2(accrued)
  return { accrued, people, ledger, difference: ledger === null ? null : r2(accrued - ledger) }
}

// ---------------------------------------------------------------------------
// The payslip's state, as My file reads it (ES-04)
// ---------------------------------------------------------------------------

export type PayslipState = "none" | "preparing" | "with_finance" | "paid" | "held" | "returned" | "repaid"

/** Where one employee's line of a payroll stands: not on it · being prepared · approved and with Finance · paid
 * (on the payroll's payment day) · held (no / unapproved / bounced IBAN — paid once fixed) · returned by the bank
 * (with Finance's reason) · paid again after the fix. Pure — the payroll document as the pay roles read it. */
export function payslipState(
  p: Pick<Payroll, "kind" | "state" | "lines" | "supplementary" | "paid" | "returned" | "paidHeld"> | null | undefined,
  employeeId: string
): { state: PayslipState; date: string | null; reason: string | null; net: number | null } {
  if (!p) return { state: "none", date: null, reason: null, net: null }
  const line = payLinesOf(p).find((l) => l.employeeId === employeeId)
  if (!line) return { state: "none", date: null, reason: null, net: null }
  const net = line.net
  if (p.state === "prepared") return { state: "preparing", date: null, reason: null, net }
  const again = p.paidHeld?.[employeeId]
  if (again) return { state: "repaid", date: again.date ?? again.at?.slice(0, 10) ?? null, reason: null, net }
  const back = p.returned?.[employeeId]
  if (p.state === "paid" && back) return { state: "returned", date: back.date ?? null, reason: back.reason ?? null, net }
  if (line.held) return { state: "held", date: null, reason: line.heldReason, net }
  if (p.state === "paid") return { state: "paid", date: p.paid?.date ?? p.paid?.at?.slice(0, 10) ?? null, reason: null, net }
  return { state: "with_finance", date: null, reason: null, net }
}

// ---------------------------------------------------------------------------
// Advances on the Payroll page (AD-01…03)
// ---------------------------------------------------------------------------

export interface OutstandingAdvance {
  employeeId: string
  no: number
  name: string
  amount: number
  balance: number
  instalment: number
  /** Instalments still to take — the last one may be smaller. */
  monthsLeft: number
}

/** Every advance with a balance: taken from payroll in instalments, no second one before it is repaid (AD-02). */
export function outstandingAdvances(employees: Pick<HrEmployee, "id" | "no" | "names">[], pays: Map<string, EmployeePay>): OutstandingAdvance[] {
  const out: OutstandingAdvance[] = []
  for (const e of employees) {
    const a = pays.get(e.id)?.advance
    if (!a || !(a.balance > 0)) continue
    const instalment = a.instalment > 0 ? a.instalment : a.balance
    out.push({ employeeId: e.id, no: e.no, name: e.names?.ar ?? "", amount: a.amount, balance: a.balance, instalment, monthsLeft: Math.ceil(a.balance / instalment) })
  }
  return out.sort((a, b) => b.balance - a.balance)
}

/** The advance requests the Payroll page lists: waiting for a decision, with Finance, approved and not yet paid
 * out, and those declined in the last 60 days — newest first. */
export function advanceRequestsInView(requests: HrRequest[], today: string): HrRequest[] {
  const since = addDays(today, -60)
  return requests
    .filter((r) => {
      if (r.kind !== "advance") return false
      if (r.state === "pending" || r.state === "endorsed" || r.state === "finance") return true
      if (r.state === "approved") return !(r as AdvanceRequest).payout
      if (r.state === "declined") return (r.decision?.at ?? r.createdAt ?? "").slice(0, 10) >= since
      return false
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
}

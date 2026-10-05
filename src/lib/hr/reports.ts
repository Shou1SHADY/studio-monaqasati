// HR 1.0 — Reports (PRD RP-01/02, "Reports and their columns"). Every report
// is computed from the live record the moment it is opened — no stored copy
// that could differ from the screens — previewed on screen and downloaded as
// CSV (UTF-8). A report in riyals exists only for the roles that see pay
// (RL-03); a report of a feature that is off is not offered. The optional
// features' reports (openings, reviews, certificates, training, lateness,
// shift roster) join when those features are built. Pure: no I/O.

import { ACC } from "../accounting/accounts"
import { hrAllowed, lineManagerOf, type HrContext, type HrRole } from "./access"
import { addMonths, assumesPresence, EMPTY_MONTH, employeeMonth, isRestDay, type EmployeeMonth, type WorkplaceMonth } from "./attendance"
import { DOC_TYPES, type DocType } from "./documents"
import type { EmployeePay, HrEmployee } from "./employee"
import { gratuity, monthlyEosAccrual, leaveEncashment, type ExitReason } from "./eos"
import type { HrExit } from "./exit-writes"
import { accruedDays, leaveBalance } from "./leave"
import { wageOf } from "./pay"
import { leaveDaysInMonth, type Payroll } from "./payroll"
import type { HrRequest } from "./requests"
import { costKindOf, UNASSIGNED_SITE, type CostKind, type HrSite } from "./sites"
import { addDays, daysBetween, monthRange, r2, serviceYears } from "./statutory"
import { tradeOf } from "./trades"
import type { HrViolation } from "./violations"
import { VIOLATIONS, type ViolationCode } from "./penalties"
import type { HrFeature } from "./settings"
import { graceOf, scheduleOf, shiftMinutes, siteDay, sourceOf, type PunchSite, type PunchWm } from "./punches"
import { rosterRows, type EmployeeShift } from "./shifts"

export const REPORT_IDS = ["register", "attendance", "cost", "documents", "leave", "eos", "advances", "penalties", "saudization", "movement", "turnover", "structure", "late", "roster"] as const
export type ReportId = (typeof REPORT_IDS)[number]

/**
 * How a cell is read: `enum` cells hold a key rendered through `enumOf`
 * (`trade` → `trade.<key>`); `site` holds a workplace name, null = unassigned;
 * `money` is riyals (shown with the riyal sign on screen, plain in the CSV);
 * `penalty` is a ladder step as `penaltyCell` writes it ("warning",
 * "fraction:0.1", "days:2", "termination") — rendered as the penalty's words.
 */
export type CellKind = "no" | "text" | "num" | "money" | "date" | "pct" | "enum" | "site" | "penalty"

/** A penalty step as a report cell — the regulation's words, not a step number (the prototype's `penTx`). */
export function penaltyCell(code: string, step: number | null | undefined): string | null {
  const ladder = VIOLATIONS[code as ViolationCode]
  if (!ladder || step == null) return null
  const s = ladder[Math.min(step, ladder.length - 1)]
  return s.kind === "fraction" ? `fraction:${s.of}` : s.kind === "days" ? `days:${s.days}` : s.kind
}

/** The parts of a penalty cell, for its words: `rep.penalty.<kind>` with {pct} or {days}. */
export function penaltyCellParts(v: string): { kind: "warning" | "fraction" | "days" | "termination"; pct?: number; days?: number } {
  const [kind, n] = v.split(":")
  if (kind === "fraction") return { kind, pct: Math.round(Number(n) * 100) }
  if (kind === "days") return { kind, days: Number(n) }
  return { kind: kind === "termination" ? "termination" : "warning" }
}
export interface ReportColumn {
  key: string
  kind: CellKind
  enumOf?: string
}
export type Cell = string | number | null

export interface ReportDef {
  id: ReportId
  /** In riyals — only for the roles that see pay (RL-03). */
  money: boolean
  /** Narrower than "whoever reads reports" (the prototype's `roles`). */
  roles?: readonly HrRole[]
  /** Offered only while this optional feature is on (the prototype's `feat`). */
  feature?: HrFeature
  columns: ReportColumn[]
}

const c = (key: string, kind: CellKind, enumOf?: string): ReportColumn => ({ key, kind, enumOf })
const NO = c("no", "no")
const NAME = c("name", "text")
const SITE = c("site", "site")
const TRADE = c("trade", "enum", "trade")

export const REPORTS: Record<ReportId, ReportDef> = {
  register: { id: "register", money: false, columns: [NO, NAME, TRADE, c("nationality", "enum", "nat"), SITE, c("join", "date"), c("status", "enum", "status")] },
  attendance: { id: "attendance", money: false, columns: [NO, NAME, SITE, c("present", "num"), c("absent", "num"), c("sick", "num"), c("leave", "num"), c("overtime", "num")] },
  cost: { id: "cost", money: true, columns: [SITE, c("account", "text"), c("headcount", "num"), c("gross", "money"), c("gosi", "money"), c("eos_accrual", "money"), c("cost", "money"), c("per_head", "money")] },
  documents: { id: "documents", money: false, columns: [NO, NAME, c("doc", "enum", "doc"), c("expiry", "date"), c("days_left", "num"), c("state", "enum", "rep.doc_state"), SITE] },
  leave: { id: "leave", money: true, columns: [NO, NAME, c("years", "num"), c("accrued", "num"), c("taken", "num"), c("balance", "num"), c("liability", "money")] },
  eos: { id: "eos", money: true, columns: [NO, NAME, c("years", "num"), c("wage", "money"), c("termination", "money"), c("resignation", "money"), c("monthly", "money")] },
  advances: { id: "advances", money: true, columns: [NO, NAME, c("principal", "money"), c("balance_left", "money"), c("instalment", "money"), c("months_left", "num")] },
  penalties: { id: "penalties", money: true, columns: [NO, NAME, c("violation", "enum", "violation"), c("on", "date"), c("hearing", "date"), c("penalty", "penalty"), c("amount", "money"), c("vstate", "enum", "vio.state")] },
  saudization: { id: "saudization", money: false, columns: [TRADE, c("headcount", "num"), c("saudis", "num"), c("others", "num"), c("ratio", "pct"), c("localized", "enum", "rep.yes")] },
  movement: { id: "movement", money: false, columns: [NO, NAME, c("event", "enum", "rep.event"), c("date", "date"), c("reason", "enum", "exit.reasons"), TRADE, SITE] },
  turnover: { id: "turnover", money: false, roles: ["manager", "management"], columns: [SITE, c("headcount", "num"), c("joined90", "num"), c("leaving", "num"), c("turnover", "pct")] },
  structure: { id: "structure", money: false, columns: [NO, NAME, TRADE, SITE, c("manager", "text"), c("source", "enum", "rep.mgr")] },
  // Optional: punch — lateness and punch exceptions; the shift roster (RP-02).
  late: { id: "late", money: false, feature: "punch", columns: [NO, NAME, SITE, c("att_source", "enum", "punch.src"), c("in_today", "text"), c("late_today", "num"), c("late_month", "num")] },
  roster: { id: "roster", money: false, feature: "punch", columns: [NO, NAME, TRADE, SITE, c("shift", "enum", "punch.shift"), c("shift_from", "text"), c("shift_to", "text"), c("second_today", "enum", "rep.yes")] },
}

/** RP-01 — the reports this viewer is offered: money ones only with pay (RL-03). */
export function visibleReports(ctx: HrContext, features: ReadonlySet<HrFeature> = new Set()): ReportDef[] {
  if (!hrAllowed(ctx, "reports.view")) return []
  const money = hrAllowed(ctx, "pay.view")
  return REPORT_IDS.map((id) => REPORTS[id]).filter((r) => (!r.money || money) && (!r.roles || r.roles.some((x) => ctx.roles.has(x))) && (!r.feature || features.has(r.feature)))
}

export interface ReportWorld {
  today: string
  locale: string
  employees: HrEmployee[]
  sites: HrSite[]
  /** Pay roles only — an empty map for everyone else. */
  pays: Map<string, EmployeePay>
  payrolls: Payroll[]
  /** The month the attendance report reads (the last month) and its workplace months. */
  month: string
  attendance: WorkplaceMonth[]
  requests: HrRequest[]
  violations: HrViolation[]
  exits: HrExit[]
  /** Optional: punch — this month's workplace months (punches, today's sheet) and the time in Riyadh. */
  punch?: { months: PunchWm[]; nowMin: number } | null
}

const WINDOW_DAYS = 90
const DOC_WINDOW_DAYS = 90
const one = (n: number) => Math.round(n * 10) / 10

/** The labour-cost account a workplace's people post to (the Finance contract). */
export const COST_ACCOUNT: Record<CostKind, string> = { direct: ACC.costLabour, workshop: ACC.costWorkshopLabour, distribution: ACC.distributionSalaries, admin: ACC.adminSalaries }

/** The latest main payroll — the one the cost report reads. */
export const latestMain = (payrolls: Payroll[]) => payrolls.filter((p) => p.kind === "main").sort((a, b) => b.month.localeCompare(a.month))[0] ?? null

export interface CostCentreRow {
  /** The workplace — `UNASSIGNED_SITE` for the unassigned ("no output"). */
  siteId: string
  kind: CostKind
  account: string
  n: number
  gross: number
  gosi: number
  /** The end-of-service accrual of the month (hr:EOS) — shown beside the cost, not in it (the Finance contract). */
  eos: number
  /** Gross + employer GOSI, as posted to the account. */
  cost: number
  perHead: number
  /** Share of the payroll's cost, in whole percent. */
  share: number
}

/** AS-04, RP-02 — a payroll's labour cost by cost centre: the cost follows the assignment (one workplace = one
 * account), never spread by percentages. ONE computation for the cost report and management's Today table. */
export function costCentres(p: Pick<Payroll, "lines">): { rows: CostCentreRow[]; total: number } {
  const by = new Map<string, { kind: CostKind; n: number; gross: number; gosi: number; eos: number }>()
  for (const l of p.lines) {
    const k = l.siteId ?? UNASSIGNED_SITE
    const cur = by.get(k) ?? { kind: l.costKind ?? costKindOf(UNASSIGNED_SITE), n: 0, gross: 0, gosi: 0, eos: 0 }
    cur.n++
    cur.gross += l.gross
    cur.gosi += l.gosiEmployer
    cur.eos += l.eosAccrual ?? 0
    by.set(k, cur)
  }
  const total = r2([...by.values()].reduce((a, v) => a + v.gross + v.gosi, 0))
  const rows = [...by.entries()]
    .map(([siteId, v]) => {
      const cost = r2(v.gross + v.gosi)
      return { siteId, kind: v.kind, account: COST_ACCOUNT[v.kind], n: v.n, gross: r2(v.gross), gosi: r2(v.gosi), eos: r2(v.eos), cost, perHead: r2(cost / v.n), share: total ? Math.round((cost / total) * 100) : 0 }
    })
    .sort((a, b) => b.cost - a.cost)
  return { rows, total }
}

/** A CSV the module builds (the Mudad wage file, the GOSI statement) read back for its preview: the header,
 * the first `n` rows, how many there are, and each numeric column's total — whatever columns the builder writes. */
export function csvPreview(text: string, n = 8): { header: string[]; rows: string[][]; count: number; totals: Array<number | null> } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0)
  const split = (l: string) => {
    const out: string[] = []
    let cur = ""
    let q = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (q) {
        if (ch === '"' && l[i + 1] === '"') {
          cur += '"'
          i++
        } else if (ch === '"') q = false
        else cur += ch
      } else if (ch === '"') q = true
      else if (ch === ",") {
        out.push(cur)
        cur = ""
      } else cur += ch
    }
    out.push(cur)
    return out
  }
  const [header = [], ...body] = lines.map(split)
  const numeric = header.map((_, c) => body.length > 0 && body.every((r) => r[c] === "" || /^-?\d+(\.\d+)?$/.test(r[c] ?? "")) && body.some((r) => /\./.test(r[c] ?? "")))
  const totals = header.map((_, c) => (numeric[c] ? r2(body.reduce((a, r) => a + (Number(r[c]) || 0), 0)) : null))
  return { header, rows: body.slice(0, n), count: body.length, totals }
}

/** Working days of a month for someone at a place that assumes presence: not Friday, inside his service. */
function assumedWorkdays(e: Pick<HrEmployee, "join" | "lastDay">, month: string, today: string): number {
  const { start, end } = monthRange(month)
  const from = e.join && e.join > start ? e.join : start
  let to = end < today ? end : addDays(today, -1)
  if (e.lastDay && e.lastDay < to) to = e.lastDay
  let n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isRestDay(d)) n++
  return n
}

export function reportRows(id: ReportId, w: ReportWorld): Cell[][] {
  const live = w.employees.filter((e) => e.status !== "left").sort((a, b) => (a.no ?? 0) - (b.no ?? 0))
  const name = (e: Pick<HrEmployee, "names">) => (w.locale === "ar" ? e.names?.ar : e.names?.en || e.names?.ar) ?? ""
  const siteOf = (id: string | null | undefined) => (id && id !== UNASSIGNED_SITE ? (w.sites.find((s) => s.id === id)?.name ?? null) : null)
  const wage = (e: HrEmployee) => {
    const p = w.pays.get(e.id)
    return p ? wageOf(p) : 0
  }
  const byId = new Map(w.employees.map((e) => [e.id, e]))

  switch (id) {
    case "register":
      return live.map((e) => [e.no, name(e), e.trade, e.nationality, siteOf(e.siteId), e.join, e.status ?? "active"])

    case "attendance": {
      const { end } = monthRange(w.month)
      return live
        .filter((e) => e.join && e.join <= end)
        .map((e) => {
          const m = w.attendance.filter((a) => a.month === w.month).reduce<EmployeeMonth>((acc, wm) => addMonths(acc, employeeMonth(wm, e.id)), { ...EMPTY_MONTH, violations: [] })
          const leave = leaveDaysInMonth(w.requests, e.id, w.month).all.filter((d) => !isRestDay(d)).length
          const site = w.sites.find((s) => s.id === e.siteId)
          // An office (and the unassigned) assumes presence and records exceptions only (AT-02).
          const present = assumesPresence(e.siteId ?? UNASSIGNED_SITE, site?.type ?? null) ? Math.max(0, assumedWorkdays(e, w.month, w.today) - m.absent - m.sick - m.permission - leave) : m.present + m.declared
          return [e.no, name(e), siteOf(e.siteId), present, m.absent, m.sick, leave, m.overtimeHours]
        })
    }

    case "cost": {
      const p = latestMain(w.payrolls)
      if (!p) return []
      return costCentres(p)
        .rows.sort((a, b) => b.gross - a.gross)
        .map((r) => [siteOf(r.siteId), r.account, r.n, r.gross, r.gosi, r.eos, r.cost, r.perHead])
    }

    case "documents": {
      const rows: Array<{ e: HrEmployee; d: DocType; exp: string; left: number }> = []
      for (const e of live)
        for (const d of DOC_TYPES) {
          if (d === "iqama" && e.nationality === "sa") continue
          const exp = e.docs?.[d]
          if (!exp) continue
          const left = daysBetween(w.today, exp)
          if (left <= DOC_WINDOW_DAYS) rows.push({ e, d, exp, left })
        }
      return rows.sort((a, b) => a.left - b.left).map((x) => [x.e.no, name(x.e), x.d, x.exp, x.left, x.left < 0 ? "expired" : x.left <= 30 ? "d30" : "d90", siteOf(x.e.siteId)])
    }

    case "leave":
      return live
        .filter((e) => e.join)
        .map((e) => {
          const bal = leaveBalance(e.join, w.today, e.leaveTaken ?? 0, e.openingLeave ?? 0)
          return [e.no, name(e), one(serviceYears(e.join, w.today)), Math.floor(accruedDays(e.join, w.today) + (e.openingLeave ?? 0)), e.leaveTaken ?? 0, bal, leaveEncashment(wage(e), bal)] as Cell[]
        })
        .sort((a, b) => (b[5] as number) - (a[5] as number))

    case "eos":
      return live
        .filter((e) => e.join)
        .map((e) => {
          const wg = wage(e)
          const years = serviceYears(e.join, w.today)
          return [e.no, name(e), one(years), wg, gratuity(wg, e.join, w.today, "termination_notice"), gratuity(wg, e.join, w.today, "resignation"), monthlyEosAccrual(wg, years)] as Cell[]
        })
        .sort((a, b) => (b[4] as number) - (a[4] as number))

    case "advances":
      return live.flatMap((e) => {
        const a = w.pays.get(e.id)?.advance
        if (!a || !(a.balance > 0)) return []
        return [[e.no, name(e), a.amount || a.balance, a.balance, a.instalment, a.instalment > 0 ? Math.ceil(a.balance / a.instalment) : null]]
      })

    case "penalties":
      return w.violations
        .filter((v) => v.state === "applied" || v.state === "objected" || v.state === "upheld" || v.state === "cancelled")
        .sort((a, b) => b.on.localeCompare(a.on))
        .map((v) => {
          const e = byId.get(v.employeeId)
          return [e?.no ?? null, e ? name(e) : v.employeeName, v.code, v.on, v.hearing?.on ?? null, penaltyCell(v.code, v.step), v.amount ?? 0, v.state]
        })

    case "saudization": {
      const by = new Map<string, { sa: number; other: number }>()
      for (const e of live) {
        const cur = by.get(e.trade) ?? { sa: 0, other: 0 }
        if (e.nationality === "sa") cur.sa++
        else cur.other++
        by.set(e.trade, cur)
      }
      return [...by.entries()]
        .sort((a, b) => b[1].sa + b[1].other - (a[1].sa + a[1].other))
        .map(([trade, v]) => [trade, v.sa + v.other, v.sa, v.other, Math.round((v.sa / (v.sa + v.other)) * 100), tradeOf(trade)?.saudiOnly ? "yes" : null])
    }

    case "movement": {
      const since = addDays(w.today, -WINDOW_DAYS)
      const joined: Cell[][] = live.filter((e) => e.join && e.join > since && e.join <= w.today).map((e) => [e.no, name(e), "joined", e.join, null, e.trade, siteOf(e.siteId)])
      const left: Cell[][] = w.exits
        .filter((x) => x.lastDay && x.lastDay > since)
        .map((x) => {
          const e = byId.get(x.employeeId)
          return [x.no ?? e?.no ?? null, e ? name(e) : x.employeeName, "left", x.lastDay, x.reason as ExitReason, e?.trade ?? null, siteOf(x.siteId ?? e?.siteId)]
        })
      return [...joined, ...left].sort((a, b) => String(b[3]).localeCompare(String(a[3])))
    }

    case "turnover": {
      const since = addDays(w.today, -WINDOW_DAYS)
      const places = [...w.sites.filter((s) => s.active !== false).map((s) => s.id), UNASSIGNED_SITE]
      return places
        .map((sid) => {
          const here = live.filter((e) => (e.siteId || UNASSIGNED_SITE) === sid)
          const leaving = here.filter((e) => e.status === "leaving").length
          return [siteOf(sid), here.length, here.filter((e) => e.join && e.join > since).length, leaving, here.length ? Math.round(((leaving * 12) / here.length) * 100) : 0] as Cell[]
        })
        .filter((r) => (r[1] as number) > 0)
    }

    case "structure": {
      const supervisorOf = (siteId: string) => w.sites.find((s) => s.id === siteId)?.supervisorEmployeeId ?? null
      return live.map((e) => {
        const m = lineManagerOf(e, supervisorOf)
        const me = m ? byId.get(m) : null
        return [e.no, name(e), e.trade, siteOf(e.siteId), me ? name(me) : null, !m ? "management" : e.managerId && e.managerId !== e.id ? "set" : "derived"]
      })
    }

    case "late": {
      // Each person on a punch workplace: today's in-punch, minutes late today, and late days this month.
      const months = w.punch?.months ?? []
      const pw = { today: w.today, nowMin: w.punch?.nowMin ?? 0, punch: true, employees: w.employees, sites: w.sites as PunchSite[], months, requests: w.requests }
      return live.flatMap((e) => {
        const site = w.sites.find((s) => s.id === e.siteId) as PunchSite | undefined
        const source = sourceOf(site ?? null, true)
        if (!site || source === "sheet" || e.status !== "active") return []
        const ps = e as HrEmployee & { shift?: EmployeeShift | null }
        const today = siteDay(pw, site, w.today).punches[e.id]
        const sc = scheduleOf(site, ps, w.today)
        const lateMin = (inT: string | null | undefined, s: typeof sc) => {
          const m = shiftMinutes(inT, s)
          return m != null && m - s.in > graceOf(site) ? m - s.in : 0
        }
        const wm = months.find((m) => m.siteId === site.id)
        const days = Object.keys(wm?.pd ?? {}).filter((d) => lateMin(siteDay(pw, site, d).punches[e.id]?.in, scheduleOf(site, ps, d)) > 0)
        return [[e.no, name(e), siteOf(e.siteId), source, today?.in ?? null, lateMin(today?.in, sc), days.length]]
      })
    }

    case "roster": {
      const wmToday = (siteId: string) => w.punch?.months.find((m) => m.siteId === siteId)?.days?.[w.today] ?? null
      return rosterRows(live as Array<HrEmployee & { shift?: EmployeeShift | null }>, w.sites as PunchSite[], w.today).map((r) => [
        r.emp.no,
        name(r.emp),
        r.emp.trade,
        siteOf(r.siteId),
        r.shift.id,
        r.shift.in,
        r.night ? `${r.shift.out} +1` : r.shift.out,
        wmToday(r.siteId)?.ex?.[r.emp.id]?.second ? "yes" : null,
      ])
    }
  }
}

/** CSV (UTF-8 with a BOM so Excel reads Arabic): a header of column titles, each cell as `render` writes it. */
export function reportCsv(header: string[], rows: string[][]): string {
  const cell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
}

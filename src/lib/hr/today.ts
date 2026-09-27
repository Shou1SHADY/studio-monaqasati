// HR 1.0 — Today (PRD TD-01…03): "needs your decision" in four fixed groups —
// blocking now · from another module · people's requests · due dates — each
// row with its first action, and only what THIS viewer may act on. What
// another module holds is shown with its source and no button (TD-03): the
// count of such rows carrying an action must be zero. Computed from the
// record; nothing is ticked by hand. Pure: no I/O.

import { hrAllowed, type HrContext } from "./access"
import { assumesPresence, type WorkplaceMonth } from "./attendance"
import { docState, DOC_TYPES, iqamaDueBy, legalOnSite, type DocType } from "./documents"
import type { EmployeePay, HrEmployee } from "./employee"
import type { HrExit } from "./exit-writes"
import { injuryState, type HrInjury } from "./injuries"
import { sitesToClose, type Payroll } from "./payroll"
import type { HrRequest } from "./requests"
import type { HrSite } from "./sites"
import { addDays, daysBetween, monthRange } from "./statutory"

export type TodayGroup = "blocking" | "other" | "requests" | "due"
export const TODAY_GROUPS: TodayGroup[] = ["blocking", "other", "requests", "due"]

export type TodaySource = "payments" | "warehouses"

export interface TodayItem {
  key: string
  group: Exclude<TodayGroup, "requests">
  severity: "red" | "amber" | "blue"
  kind: string
  params: Record<string, string | number>
  /** Where the first action is done, relative to the portal's HR root ("people/ID", "sites/ID", "payroll"). */
  href?: string
  /** The first action's label key; never set on a row another module holds. */
  action?: string
  source?: TodaySource
}

export interface TodayInput {
  ctx: HrContext
  today: string
  renewWindowDays: number
  employees: HrEmployee[]
  sites: HrSite[]
  /** Last month's workplace months (for closing) and this month's (today's sheet). */
  lastMonth: WorkplaceMonth[]
  thisMonth: WorkplaceMonth[]
  injuries: HrInjury[]
  exits: HrExit[]
  requests: HrRequest[]
  payrolls: Payroll[]
  pays: Map<string, EmployeePay>
}

const DUE_SOON_DAYS = 14
const CONTRACT_NOTICE_DAYS = 60

export function todayItems(i: TodayInput): TodayItem[] {
  const { ctx, today } = i
  const out: TodayItem[] = []
  const may = (a: Parameters<typeof hrAllowed>[1], site?: string | null) => hrAllowed(ctx, a, site === undefined ? {} : { site })
  const live = i.employees.filter((e) => e.status !== "left")
  const name = (e: Pick<HrEmployee, "names">) => e.names?.ar ?? ""
  const siteName = (id: string | null) => i.sites.find((s) => s.id === id)?.name ?? ""
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)

  // --- Blocking now -----------------------------------------------------------
  if (may("employee.assign"))
    for (const e of live)
      if (e.siteId && !legalOnSite({ nationality: e.nationality, docs: e.docs ?? {} }, today))
        out.push({ key: `iqama:${e.id}`, group: "blocking", severity: "red", kind: "iqama_on_site", params: { name: name(e), site: siteName(e.siteId) }, href: `people/${e.id}`, action: "move" })

  const mainLast = i.payrolls.find((p) => p.kind === "main" && p.month === lastMonth)
  if (!mainLast || mainLast.state === "prepared") {
    const closed = new Set(i.lastMonth.filter((w) => w.closed).map((w) => w.siteId))
    for (const siteId of sitesToClose(lastMonth, i.sites, live, i.lastMonth))
      if (!closed.has(siteId) && may("attendance.close", siteId))
        out.push({ key: `close:${siteId}`, group: "blocking", severity: "red", kind: "close_month", params: { site: siteName(siteId), month: lastMonth }, href: `sites/${siteId}`, action: "close" })
  }

  for (const inj of i.injuries)
    if (injuryState(inj, today) === "overdue" && may("injury.report"))
      out.push({ key: `inj:${inj.id}`, group: "blocking", severity: "red", kind: "injury_overdue", params: { name: inj.employeeName, due: inj.due }, href: `people/${inj.employeeId}`, action: "report" })

  for (const [id, p] of i.pays) {
    const e = i.employees.find((x) => x.id === id)
    if (!e) continue
    if (p.ibanState === "returned" && may("iban.fix")) out.push({ key: `ibanfix:${id}`, group: "blocking", severity: "red", kind: "iban_fix", params: { name: name(e) }, href: `people/${id}`, action: "fix_iban" })
    if (p.ibanState === "fixed" && may("iban.approve")) out.push({ key: `ibanok:${id}`, group: "blocking", severity: "amber", kind: "iban_approve", params: { name: name(e) }, href: `people/${id}`, action: "approve_iban" })
  }

  if (may("payroll.prepare") && today > monthRange(lastMonth).end && !mainLast && live.length)
    out.push({ key: `pay:prepare:${lastMonth}`, group: "blocking", severity: "amber", kind: "payroll_prepare", params: { month: lastMonth }, href: "payroll", action: "prepare" })
  if (mainLast?.state === "prepared" && may("payroll.approve") && (ctx.owner || mainLast.prepared.by !== ctx.uid))
    out.push({ key: `pay:approve:${lastMonth}`, group: "blocking", severity: "amber", kind: "payroll_approve", params: { month: lastMonth }, href: "payroll", action: "approve" })

  // Today's sheet (the supervisor's own sites, or the HR manager's) — due, not yet blocking.
  const recordedToday = new Set(i.thisMonth.filter((w) => w.days?.[today]).map((w) => w.siteId))
  const isRest = new Date(`${today}T00:00:00Z`).getUTCDay() === 5
  if (!isRest)
    for (const s of i.sites)
      if (s.active !== false && !assumesPresence(s.id, s.type) && !recordedToday.has(s.id) && live.some((e) => e.siteId === s.id) && may("attendance.record", s.id) && ctx.roles.has("supervisor"))
        out.push({ key: `sheet:${s.id}`, group: "due", severity: "blue", kind: "sheet_today", params: { site: s.name }, href: `sites/${s.id}`, action: "record" })

  // --- From another module: shown with its source, never a button (TD-03) -------
  if (may("exit.manage"))
    for (const x of i.exits) {
      if (x.state === "leaving" && x.custody?.state === "requested") out.push({ key: `custody:${x.id}`, group: "other", severity: "blue", kind: "wait_custody", params: { name: x.employeeName }, source: "warehouses" })
      if (x.state === "settled") out.push({ key: `fs:${x.id}`, group: "other", severity: "blue", kind: "wait_settlement", params: { name: x.employeeName }, source: "payments" })
    }
  if (may("pay.view"))
    for (const p of i.payrolls)
      if (p.state === "approved" || p.state === "posted") out.push({ key: `fin:${p.key}`, group: "other", severity: "blue", kind: p.state === "approved" ? "wait_post" : "wait_pay", params: { key: p.key }, source: "payments" })
  if (may("request.decide"))
    for (const r of i.requests)
      if (r.state === "finance") out.push({ key: `adv:${r.id}`, group: "other", severity: "blue", kind: "wait_advance", params: { name: r.employeeName, no: r.no }, source: "payments" })

  // --- Due dates ---------------------------------------------------------------
  if (may("documents.manage"))
    for (const e of live) {
      for (const d of DOC_TYPES as readonly DocType[]) {
        if (d === "iqama" && e.nationality === "sa") continue
        const exp = e.docs?.[d]
        if (!exp) continue
        const st = docState(exp, today, i.renewWindowDays)
        if (st === "valid") continue
        if (st === "expired" && d === "iqama" && e.siteId) continue // already blocking
        out.push({ key: `doc:${e.id}:${d}`, group: "due", severity: st === "expired" ? "red" : st === "d30" ? "amber" : "blue", kind: "doc_due", params: { name: name(e), doc: d, date: exp }, href: `people/${e.id}`, action: "renew" })
      }
      // DC-05 — a visa arrival's iqama within 90 days of arriving.
      if (e.source === "visa" && e.nationality !== "sa" && !e.docs?.iqama && e.join && e.join <= today) {
        const due = iqamaDueBy(e.join)
        out.push({ key: `iqclock:${e.id}`, group: "due", severity: today > due ? "red" : daysBetween(today, due) <= 30 ? "amber" : "blue", kind: "iqama_clock", params: { name: name(e), date: due }, href: `people/${e.id}`, action: "renew" })
      }
    }
  for (const inj of i.injuries)
    if (injuryState(inj, today) === "due" && may("injury.report"))
      out.push({ key: `injdue:${inj.id}`, group: "due", severity: "amber", kind: "injury_due", params: { name: inj.employeeName, due: inj.due }, href: `people/${inj.employeeId}`, action: "report" })
  if (may("request.decide"))
    for (const e of live) {
      if (e.probation && !e.probation.decision && e.probation.end >= today && daysBetween(today, e.probation.end) <= DUE_SOON_DAYS && e.id !== ctx.employeeId)
        out.push({ key: `prob:${e.id}`, group: "due", severity: "amber", kind: "probation_end", params: { name: name(e), date: e.probation.end }, href: `people/${e.id}`, action: "decide" })
      if (e.contract?.type === "fixed" && e.contract.end && e.contract.end >= today && daysBetween(today, e.contract.end) <= CONTRACT_NOTICE_DAYS && e.status !== "leaving")
        out.push({ key: `ct:${e.id}`, group: "due", severity: "blue", kind: "contract_end", params: { name: name(e), date: e.contract.end }, href: `people/${e.id}`, action: "open" })
    }

  const rank = { red: 0, amber: 1, blue: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/** TD-03 — rows another module holds that carry an action. Must be zero. */
export const leakage = (items: TodayItem[]) => items.filter((x) => x.group === "other" && (x.action || x.href)).length

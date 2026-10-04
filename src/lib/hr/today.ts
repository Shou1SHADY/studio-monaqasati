// HR 1.0 — Today (PRD TD-01…03): "needs your decision" in four fixed groups —
// blocking now · from another module · people's requests · due dates — each
// row with its first action, and only what THIS viewer may act on. What
// another module holds is shown with its source and no button (TD-03): the
// count of such rows carrying an action must be zero. Computed from the
// record; nothing is ticked by hand. Pure: no I/O.

import { hrAllowed, type HrContext } from "./access"
import { assumesPresence, isRestDay, onLeaveOn, type WorkplaceMonth } from "./attendance"
import { docState, DOC_TYPES, iqamaDueBy, legalOnSite, RENEWAL_ORDER, type DocState, type DocType } from "./documents"
import type { EmployeePay, HrEmployee } from "./employee"
import type { HrExit } from "./exit-writes"
import { nearestDocument } from "./format"
import { injuryState, type HrInjury } from "./injuries"
import { wageOf } from "./pay"
import { onPayroll, sitesToClose, type Payroll } from "./payroll"
import type { ManpowerRequest } from "./manpower"
import type { HrRequest } from "./requests"
import { UNASSIGNED_SITE, type HrSite } from "./sites"
import { addDays, daysBetween, monthRange, r2 } from "./statutory"

export type TodayGroup = "blocking" | "other" | "requests" | "due"
export const TODAY_GROUPS: TodayGroup[] = ["blocking", "other", "requests", "due"]

export type TodaySource = "payments" | "warehouses" | "project-management"

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
  /** Held by another module — shown with its source, never a button (TD-03). An incoming
   * request from another module (a manpower request) has a source AND an action: it is ours to answer. */
  waiting?: boolean
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
  manpower?: ManpowerRequest[]
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
    for (const siteId of sitesToClose(lastMonth, i.sites, i.employees, i.lastMonth))
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

  // Last month's payroll — only if someone was on it (a company that started this month owes none).
  if (may("payroll.prepare") && today > monthRange(lastMonth).end && !mainLast && i.employees.some((e) => onPayroll(e, lastMonth)))
    out.push({ key: `pay:prepare:${lastMonth}`, group: "blocking", severity: "amber", kind: "payroll_prepare", params: { month: lastMonth }, href: "payroll", action: "prepare" })
  // Every prepared payroll waits for its approval — the supplementary "-D" too — never of whoever prepared it.
  if (may("payroll.approve"))
    for (const p of i.payrolls)
      if (p.state === "prepared" && (ctx.owner || p.prepared?.by !== ctx.uid))
        out.push({ key: `pay:approve:${p.key}`, group: "blocking", severity: "amber", kind: "payroll_approve", params: { month: p.key }, href: "payroll", action: "approve" })

  // Custody cleared by Inventory: the settlement is now the HR manager's to prepare (WF-16 step 3) — never his own.
  if (may("exit.manage"))
    for (const x of i.exits)
      if (x.state === "leaving" && x.custody?.state === "cleared" && x.employeeId !== ctx.employeeId)
        out.push({ key: `settle:${x.id}`, group: "blocking", severity: "amber", kind: "settlement_ready", params: { name: x.employeeName }, href: `people/${x.employeeId}`, action: "settle" })

  // Today's sheet (the supervisor's own sites, or the HR manager's) — due, not yet blocking.
  const recordedToday = new Set(i.thisMonth.filter((w) => w.days?.[today]).map((w) => w.siteId))
  const isRest = new Date(`${today}T00:00:00Z`).getUTCDay() === 5
  if (!isRest)
    for (const s of i.sites)
      if (s.active !== false && !assumesPresence(s.id, s.type) && !recordedToday.has(s.id) && live.some((e) => e.siteId === s.id) && may("attendance.record", s.id) && ctx.roles.has("supervisor"))
        out.push({ key: `sheet:${s.id}`, group: "due", severity: "blue", kind: "sheet_today", params: { site: s.name }, href: `sites/${s.id}`, action: "record" })

  // --- From another module ------------------------------------------------------
  // What Projects asks of HR is ours to answer (WF-12)…
  if (may("manpower.answer"))
    for (const m of i.manpower ?? [])
      if (m.state === "open") out.push({ key: `mp:${m.id}`, group: "other", severity: "amber", kind: "manpower", params: { project: m.projectName, count: m.count, trade: m.trade, date: m.from }, href: "sites", action: "answer", source: "project-management" })
  // …what another module holds is shown with its source, never a button (TD-03).
  if (may("exit.manage"))
    for (const x of i.exits) {
      if (x.state === "leaving" && x.custody?.state === "requested") out.push({ key: `custody:${x.id}`, group: "other", severity: "blue", kind: "wait_custody", params: { name: x.employeeName }, source: "warehouses", waiting: true })
      if (x.state === "settled") out.push({ key: `fs:${x.id}`, group: "other", severity: "blue", kind: "wait_settlement", params: { name: x.employeeName }, source: "payments", waiting: true })
    }
  if (may("pay.view"))
    for (const p of i.payrolls)
      if (p.state === "approved" || p.state === "posted") out.push({ key: `fin:${p.key}`, group: "other", severity: "blue", kind: p.state === "approved" ? "wait_post" : "wait_pay", params: { key: p.key }, source: "payments", waiting: true })
  if (may("request.decide"))
    for (const r of i.requests)
      if (r.state === "finance") out.push({ key: `adv:${r.id}`, group: "other", severity: "blue", kind: "wait_advance", params: { name: r.employeeName, no: r.no }, source: "payments", waiting: true })

  // --- Due dates ---------------------------------------------------------------
  if (may("documents.manage"))
    for (const e of live) {
      // DC-04 — one row per PERSON, his renewals in the order they are done
      // (passport → insurance → iqama): one trip to the authorities, not a row
      // per document. An expired iqama on a site is the HR manager's block above
      // ("move") — for him, once. Government relations cannot move anyone: it is
      // his renewal, in red (DC-02).
      const skipIqama = Boolean(e.siteId) && may("employee.assign")
      const chain = renewalChain(e, today, i.renewWindowDays).filter((x) => !(skipIqama && x.type === "iqama" && x.state === "expired"))
      if (chain.length) {
        const worst = chain.reduce((a, x) => (STATE_RANK[x.state] > STATE_RANK[a.state] ? x : a))
        out.push({
          key: `doc:${e.id}`,
          group: "due",
          severity: worst.state === "expired" ? "red" : worst.state === "d30" ? "amber" : "blue",
          kind: "doc_due",
          params: { name: name(e), doc: worst.type, date: worst.expiry, order: chain.map((x) => x.type).join(","), count: chain.length },
          href: `people/${e.id}`,
          action: "renew",
        })
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

  // Letters (EM-08, WF-24) — the Letters package adds its pending-letter rows
  // ("people's requests") here, from its own pure function.

  const rank = { red: 0, amber: 1, blue: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/** TD-03 — rows another module holds that carry an action. Must be zero. */
export const leakage = (items: TodayItem[]) => items.filter((x) => x.waiting && (x.action || x.href)).length

// ---------------------------------------------------------------------------
// DC-04 — the government-relations officer's list, by person
// ---------------------------------------------------------------------------

const STATE_RANK: Record<DocState, number> = { missing: 0, valid: 0, d60: 1, d30: 2, expired: 3 }
/** The renewal order for one person: passport → insurance → iqama, then the licences. */
const CHAIN_ORDER: DocType[] = [...RENEWAL_ORDER, ...DOC_TYPES.filter((d) => !RENEWAL_ORDER.includes(d) && d !== "contract")]

export interface ChainDoc {
  type: DocType
  expiry: string
  state: DocState
  /** Days left — negative once expired. */
  left: number
}

/** One person's documents to renew within `windowDays` (expired included), in the order they are done.
 * The contract is the HR manager's decision, not a renewal; a Saudi has no iqama. */
export function renewalChain(e: Pick<HrEmployee, "nationality" | "docs">, today: string, windowDays: number): ChainDoc[] {
  const out: ChainDoc[] = []
  for (const type of CHAIN_ORDER) {
    if (type === "iqama" && e.nationality === "sa") continue
    const expiry = e.docs?.[type]
    if (!expiry) continue
    const left = daysBetween(today, expiry)
    if (left > windowDays) continue
    out.push({ type, expiry, state: docState(expiry, today, windowDays), left })
  }
  return out
}

/** The renewal queue (the officer's Today): every person with something to renew within
 * `windowDays`, the most urgent person first — one line per person, never per document. */
export function renewalQueue(employees: HrEmployee[], today: string, windowDays = 120): Array<{ employee: HrEmployee; docs: ChainDoc[]; first: number }> {
  return employees
    .filter((e) => e.status !== "left")
    .map((employee) => {
      const docs = renewalChain(employee, today, windowDays)
      return { employee, docs, first: docs.length ? Math.min(...docs.map((d) => d.left)) : Infinity }
    })
    .filter((x) => x.docs.length > 0)
    .sort((a, b) => a.first - b.first)
}

// ---------------------------------------------------------------------------
// Today's attendance by workplace — ONE definition for the KPI and the panel (TD-04)
// ---------------------------------------------------------------------------

export interface SiteToday {
  siteId: string
  /** Working today (active or serving notice), on leave excluded. */
  assigned: number
  present: number
  absent: number
  sick: number
  unrecorded: number
  onLeave: number
}

const WORKING = new Set(["active", "leaving"])

/** Who is present, absent, sick or not yet recorded today, by workplace. An office (and the
 * unassigned) assumes presence and records exceptions only (AT-02); a site with no sheet today is
 * unrecorded; approved leave is leave, never absence; Friday is the rest day. */
export function dutyToday(i: { today: string; employees: HrEmployee[]; sites: HrSite[]; thisMonth: WorkplaceMonth[]; requests: HrRequest[] }): SiteToday[] {
  const leave = onLeaveOn(i.requests, i.today)
  const rest = isRestDay(i.today)
  const by = new Map<string, SiteToday>()
  for (const e of i.employees) {
    if (e.status !== "leave" && !WORKING.has(e.status ?? "active")) continue
    if (e.join && e.join > i.today) continue
    const siteId = e.siteId || UNASSIGNED_SITE
    const row = by.get(siteId) ?? { siteId, assigned: 0, present: 0, absent: 0, sick: 0, unrecorded: 0, onLeave: 0 }
    by.set(siteId, row)
    if (e.status === "leave" || leave.has(e.id)) {
      row.onLeave++
      continue
    }
    row.assigned++
    const sheet = i.thisMonth.find((w) => w.siteId === siteId)?.days?.[i.today]
    const ex = sheet?.ex?.[e.id]?.status
    if (ex === "absent" || ex === "permission") row.absent++
    else if (ex === "sick") row.sick++
    else if (assumesPresence(siteId, i.sites.find((s) => s.id === siteId)?.type ?? null)) row.present++
    else if (sheet?.listed?.includes(e.id)) row.present++
    else if (!rest) row.unrecorded++
  }
  return [...by.values()]
}

// ---------------------------------------------------------------------------
// TD-04 — three KPIs for each role, each the number of the screen it opens
// ---------------------------------------------------------------------------

export type KpiRole = "manager" | "gov" | "payroll" | "supervisor" | "management"

/** The role whose Today a person sees: the prototype gives each user one; a person holding several
 * sees the first of HR manager · payroll · government relations · supervisor · management. */
export function kpiRole(ctx: Pick<HrContext, "roles">): KpiRole | null {
  for (const r of ["manager", "payroll", "gov", "supervisor", "management"] as const) if (ctx.roles.has(r)) return r
  return null
}

export interface TodayKpi {
  id: string
  value: number
  money?: boolean
  /** The note's variant and its values (`today.kpi.<id>.<note>`). */
  note: string
  params: Record<string, string | number>
  tone: "good" | "bad" | "warn" | "neutral"
  /** Relative to the portal's HR root, as Today's rows. */
  href?: string
}

export interface KpiInput {
  ctx: HrContext
  today: string
  renewWindowDays: number
  employees: HrEmployee[]
  sites: HrSite[]
  thisMonth: WorkplaceMonth[]
  requests: HrRequest[]
  payrolls: Payroll[]
  pays: Map<string, EmployeePay>
}

/** The people whose nearest document is expired or inside the renewal window — the People
 * screen's "documents" filter counts exactly these. */
export const needsRenewal = (e: Pick<HrEmployee, "docs" | "status">, today: string, windowDays: number) => {
  if (e.status === "left") return false
  const n = nearestDocument(e.docs, today, windowDays)
  return Boolean(n && n.state !== "valid" && n.state !== "missing")
}

/** The People screen's filters that Today's KPIs open: the count on the KPI is the count of the list. */
export type PeopleFilter = "docs" | "iqama" | "iqama_site"
export const PEOPLE_FILTERS: readonly PeopleFilter[] = ["docs", "iqama", "iqama_site"]
export function inPeopleFilter(f: PeopleFilter, e: HrEmployee, today: string, windowDays: number): boolean {
  if (e.status === "left") return false
  if (f === "docs") return needsRenewal(e, today, windowDays)
  const expired = !legalOnSite({ nationality: e.nationality, docs: e.docs ?? {} }, today)
  return f === "iqama" ? expired : expired && Boolean(e.siteId)
}

const latestMainPayroll =(payrolls: Payroll[]) => payrolls.filter((p) => p.kind === "main").sort((a, b) => b.month.localeCompare(a.month))[0] ?? null

export function todayKpis(i: KpiInput): TodayKpi[] {
  const role = kpiRole(i.ctx)
  if (!role) return []
  const live = i.employees.filter((e) => e.status !== "left")
  const expiredIqama = live.filter((e) => !legalOnSite({ nationality: e.nationality, docs: e.docs ?? {} }, i.today))
  const onSite = (e: HrEmployee) => Boolean(e.siteId)
  const wage = (e: HrEmployee) => {
    const p = i.pays.get(e.id)
    return p ? wageOf(p) : 0
  }
  const returned = [...i.pays.values()].filter((p) => p.ibanState === "returned" && live.some((e) => e.id === p.employeeId))
  const sum = (xs: SiteToday[]) => xs.reduce((a, x) => ({ ...a, assigned: a.assigned + x.assigned, present: a.present + x.present, absent: a.absent + x.absent, sick: a.sick + x.sick, unrecorded: a.unrecorded + x.unrecorded, onLeave: a.onLeave + x.onLeave }), { siteId: "", assigned: 0, present: 0, absent: 0, sick: 0, unrecorded: 0, onLeave: 0 })
  const duty = dutyToday(i)
  const bench = live.filter((e) => !e.siteId && WORKING.has(e.status ?? "active"))
  const rest = isRestDay(i.today)

  if (role === "manager") {
    const all = sum(duty)
    const renew = live.filter((e) => needsRenewal(e, i.today, i.renewWindowDays))
    const p = latestMainPayroll(i.payrolls)
    const sup = i.payrolls.find((x) => x.kind === "supplementary" && x.state === "prepared")
    return [
      { id: "on_duty", value: all.present, note: rest ? "rest" : "note", params: { of: all.assigned, out: all.absent + all.sick, unrecorded: all.unrecorded, bench: bench.length }, tone: all.unrecorded ? "warn" : "neutral" },
      { id: "documents", value: renew.length, note: "note", params: { expired: expiredIqama.length, onSite: expiredIqama.filter(onSite).length, days: i.renewWindowDays }, tone: expiredIqama.length ? "bad" : renew.length ? "warn" : "good", href: "people?filter=docs" },
      p
        ? { id: "payroll", value: payrollNet(p), money: true, note: sup ? "supplementary" : "state", params: { month: p.month, state: p.state, returned: returned.length }, tone: sup || returned.length ? "warn" : "neutral", href: "payroll" }
        : { id: "payroll", value: 0, note: "none", params: {}, tone: "neutral", href: "payroll" },
    ]
  }
  if (role === "gov") {
    const nonSa = live.filter((e) => e.nationality !== "sa")
    const docsWithin = (days: number) => live.flatMap((e) => renewalChain(e, i.today, days)).filter((d) => d.left >= 0)
    const in30 = docsWithin(30).length
    const arrivals = nonSa.filter((e) => e.source === "visa" && !e.docs?.iqama && e.join && e.join <= i.today)
    const nearest = arrivals.map((e) => iqamaDueBy(e.join)).sort()[0] ?? null
    const insurance = live.filter((e) => e.docs?.insurance && daysBetween(i.today, e.docs.insurance) < 0).length
    return [
      { id: "iqama_expired", value: expiredIqama.length, note: "note", params: { onSite: expiredIqama.filter(onSite).length, insurance }, tone: expiredIqama.length ? "bad" : "good", href: "people?filter=iqama" },
      { id: "expiring", value: in30, note: "note", params: { more: docsWithin(60).length - in30 }, tone: in30 ? "warn" : "good" },
      { id: "arrivals", value: arrivals.length, note: nearest ? "nearest" : "none", params: { date: nearest ?? "" }, tone: nearest && daysBetween(i.today, nearest) <= 15 ? "warn" : "neutral" },
    ]
  }
  if (role === "payroll") {
    const month = i.today.slice(0, 7)
    const estimate = r2(live.filter((e) => onPayroll(e, month)).reduce((a, e) => a + wage(e), 0))
    const p = latestMainPayroll(i.payrolls)
    const returnedNet = r2(returned.reduce((a, x) => a + (p?.lines.find((l) => l.employeeId === x.employeeId)?.net ?? 0), 0))
    const advances = [...i.pays.values()].filter((x) => x.advance && x.advance.balance > 0)
    return [
      { id: "estimate", value: estimate, money: true, note: "note", params: { month }, tone: "neutral", href: "payroll" },
      { id: "returned", value: returned.length, note: "note", params: { net: returnedNet }, tone: returned.length ? "bad" : "good" },
      { id: "advances", value: r2(advances.reduce((a, x) => a + (x.advance?.balance ?? 0), 0)), money: true, note: "note", params: { count: advances.length }, tone: "neutral", href: "reports?report=advances" },
    ]
  }
  if (role === "supervisor") {
    const mine = sum(duty.filter((d) => i.ctx.sites.includes(d.siteId)))
    const docs = live.filter((e) => e.siteId && i.ctx.sites.includes(e.siteId) && needsRenewal(e, i.today, i.renewWindowDays))
    return [
      { id: "my_workers", value: mine.present, note: rest ? "rest" : "note", params: { of: mine.assigned, absent: mine.absent, sick: mine.sick, unrecorded: mine.unrecorded, leave: mine.onLeave }, tone: mine.unrecorded ? "warn" : "good" },
      { id: "unrecorded", value: mine.unrecorded, note: mine.unrecorded ? "note" : "done", params: {}, tone: mine.unrecorded ? "bad" : "good" },
      { id: "my_docs", value: docs.length, note: "note", params: {}, tone: docs.length ? "warn" : "good" },
    ]
  }
  // management
  const p = latestMainPayroll(i.payrolls)
  const cost = p ? r2(p.lines.reduce((a, l) => a + l.gross + l.gosiEmployer, 0)) : 0
  const saudi = live.length ? Math.round((live.filter((e) => e.nationality === "sa").length / live.length) * 100) : 0
  const in60 = live.filter(
    (e) =>
      (e.contract?.type === "fixed" && e.contract.end && e.contract.end >= i.today && daysBetween(i.today, e.contract.end) <= 60) ||
      (e.probation && !e.probation.decision && e.probation.end >= i.today && daysBetween(i.today, e.probation.end) <= 60)
  ).length
  return [
    bench.length
      ? { id: "bench", value: r2(bench.reduce((a, e) => a + wage(e), 0)), money: true, note: "note", params: { count: bench.length }, tone: "warn", href: "sites" }
      : { id: "decisions", value: in60, note: "note", params: {}, tone: in60 ? "warn" : "good" },
    p ? { id: "labour_cost", value: cost, money: true, note: "note", params: { month: p.month, perHead: p.lines.length ? r2(cost / p.lines.length) : 0, saudi }, tone: "neutral", href: "reports?report=cost" } : { id: "labour_cost", value: 0, note: "none", params: { saudi }, tone: "neutral" },
    { id: "iqama_on_site", value: expiredIqama.filter(onSite).length, note: "note", params: { returned: returned.length }, tone: expiredIqama.some(onSite) ? "bad" : "good", href: "people?filter=iqama_site" },
  ]
}

const payrollNet = (p: Payroll) => r2(p.lines.reduce((a, l) => a + l.net, 0))

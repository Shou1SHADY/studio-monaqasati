// HR 1.0 — Today (PRD TD-01…03): "needs your decision" in four fixed groups —
// blocking now · from another module · people's requests · due dates — each
// row with its first action, and only what THIS viewer may act on. What
// another module holds is shown with its source and no button (TD-03): the
// count of such rows carrying an action must be zero. Computed from the
// record; nothing is ticked by hand. Each row carries the facts the decision
// is made on (the prototype's second line). Pure: no I/O.

import { hrAllowed, type HrContext } from "./access"
import { assumesPresence, dueDays, isRestDay, missingDays, onLeaveOn, type WorkplaceMonth } from "./attendance"
import { docState, DOC_TYPES, iqamaDueBy, legalOnSite, mayDrive, passportFirst, RENEWAL_ORDER, type DocState, type DocType } from "./documents"
import type { EmployeePay, HrEmployee } from "./employee"
import { gratuity } from "./eos"
import type { HrExit } from "./exit-writes"
import { nearestDocument } from "./format"
import { injuryState, type HrInjury } from "./injuries"
import { leaveBalance } from "./leave"
import { wageOf } from "./pay"
import { onPayroll, sitesToClose, type Payroll } from "./payroll"
import { coverage, type ManpowerRequest } from "./manpower"
import { leaveReturn, type HrRequest, type Stamp } from "./requests"
import { costKindOf, UNASSIGNED_SITE, type AssignFix, type HrSite } from "./sites"
import { addDays, daysBetween, monthRange, r2 } from "./statutory"
import { tradeOf } from "./trades"

export type TodayGroup = "blocking" | "other" | "requests" | "due"
export const TODAY_GROUPS: TodayGroup[] = ["blocking", "other", "requests", "due"]

export type TodaySource = "payments" | "warehouses" | "project-management"

/** One piece of a row's facts line (`today.f.<k>`), the prototype's second line — joined with " · ".
 * Param names the view formats: date/due/since/from/to (a day), doc/order (document names), trade, and
 * money (eos, wage, instalment, cost) — money only ever reaches a viewer who sees pay. */
export interface FactPart {
  k: string
  p?: Record<string, string | number>
}

/** A write done on the spot from Today (no page to open): remind a supervisor of his sheet, record an exit
 * re-entry visa. Never on a row another module holds. */
export type TodayRun = { kind: "remind"; siteId: string } | { kind: "exit_visa"; requestId: string }

export interface TodayItem {
  key: string
  group: TodayGroup
  severity: "red" | "amber" | "blue"
  kind: string
  params: Record<string, string | number>
  /** The facts under the title — what the decision is made on. */
  facts?: FactPart[]
  /** Where the first action is done, relative to the portal's HR root ("people/ID", "sites/ID", "payroll"). */
  href?: string
  /** The first action's label key; never set on a row another module holds. */
  action?: string
  /** The first action as a write on the spot instead of a door (`action` names it). */
  run?: TodayRun
  /** A second door (the prototype's b2) — the person's card beside the workplace's sheet. */
  second?: { action: string; href: string }
  source?: TodaySource
  /** Held by another module — shown with its source, never a button (TD-03). An incoming
   * request from another module (a manpower request) has a source AND an action: it is ours to answer. */
  waiting?: boolean
  /** When the wait began (a day or an ISO time) — shown as its age. */
  since?: string | null
}

/** Fields other packages stamp on records Today reads (LV-08 exit re-entry, AS-02 plan acceptance). */
type LeaveWithVisa = HrRequest & { exitVisa?: Stamp | null }
type AnsweredRequest = ManpowerRequest & { accepted?: Stamp | null }
type ExitWithStamps = HrExit & { settled?: Stamp | null }
type PayrollWithHeld = Payroll & { returned?: Record<string, unknown>; paidHeld?: Record<string, unknown> }

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
  /** AS-03 — supervisors' assignment corrections (the HR manager decides the pending ones). */
  assignFixes?: AssignFix[]
  /** Unused visas in the establishment file — the manpower coverage reads them (AS-02). */
  visas?: number | null
  /** Does any member hold government relations? Without one, the HR manager carries its rows (the prototype's
   * platform rule). Unknown = held. */
  govHeld?: boolean
  /** Rows an optional feature computes (`platforms.ts` for `gov` / `mudad`), sorted in with the rest. */
  extra?: TodayItem[]
}

/** EM-05 — a probation ending within 15 days asks for a decision (no decision = confirmed). */
export const PROBATION_NOTICE_DAYS = 15
/** EX-01 — a fixed contract ending within 45 days asks for renew / not renew (no decision = renewed). */
export const CONTRACT_NOTICE_DAYS = 45
/** LV-08 / EX-06 — government relations' rows: a final exit within this many days. */
const FINAL_EXIT_DAYS = 14
const WORKING = new Set(["active", "leaving"])

/** AS-02 — a manpower request's coverage in the prototype's terms: on time · late · uncovered · excluded. */
export function coverageSummary(m: Pick<ManpowerRequest, "trade" | "count" | "from" | "siteId">, w: { today: string; employees: HrEmployee[]; sites: HrSite[]; visas: number | null }) {
  const c = coverage({ trade: m.trade, count: m.count, from: m.from, today: w.today, siteId: m.siteId, employees: w.employees, sites: w.sites, visas: w.visas })
  let onTime = 0
  let late = 0
  for (const l of c.lines) {
    if (l.source === "hire" || l.source === "ajeer") continue
    if (l.date <= m.from) onTime += l.count
    else late += l.count
  }
  return { onTime, late, short: m.count - c.covered, excluded: c.excluded.length }
}

/** AT-03/04 — a workplace's sheet this month: the last day recorded (or declared) and the first working day
 * missing after it. A day before anyone was there is not missing. Null when yesterday's sheet is there. */
export function sheetStopped(wm: Pick<WorkplaceMonth, "days" | "declarations"> | null, month: string, today: string, firstDay: string | null): { thru: string | null; since: string; missing: number } | null {
  const declared = (wm?.declarations ?? []).flatMap((d) => d.days)
  const recorded = [...Object.keys(wm?.days ?? {}), ...declared].sort()
  const thru = recorded.length ? recorded[recorded.length - 1] : null
  const due = dueDays(month, today)
  const last = due[due.length - 1]
  const missing = missingDays(wm, month, today, { assumed: false }).filter((d) => (!firstDay || d >= firstDay) && (!thru || d > thru))
  if (!last || !missing.includes(last)) return null
  return { thru, since: missing[0], missing: missing.length }
}

/** The first day someone now on a workplace was there (the earliest join among its working people). */
const firstOnSite = (siteId: string, employees: HrEmployee[]) =>
  employees
    .filter((e) => e.siteId === siteId && WORKING.has(e.status ?? "active"))
    .map((e) => e.join)
    .filter(Boolean)
    .sort()[0] ?? null

export function todayItems(i: TodayInput): TodayItem[] {
  const { ctx, today } = i
  const out: TodayItem[] = []
  const may = (a: Parameters<typeof hrAllowed>[1], site?: string | null) => hrAllowed(ctx, a, site === undefined ? {} : { site })
  const live = i.employees.filter((e) => e.status !== "left")
  const name = (e: Pick<HrEmployee, "names">) => e.names?.ar ?? ""
  const siteName = (id: string | null | undefined) => i.sites.find((s) => s.id === id)?.name ?? ""
  const byId = new Map(i.employees.map((e) => [e.id, e]))
  /** "trade · site" — the first facts of a row about a person. */
  const who = (e: HrEmployee | undefined): FactPart[] => (e ? [{ k: "trade", p: { trade: e.trade } }, { k: "site", p: { site: e.siteId ? siteName(e.siteId) : "" } }] : [])
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
  const thisMonth = today.slice(0, 7)
  const seesPay = may("pay.view")
  // Government relations' rows go to its holder — or to the HR manager when no member holds it.
  const govDesk = ctx.roles.has("gov") || (ctx.roles.has("manager") && i.govHeld === false)

  // --- Blocking now -----------------------------------------------------------
  if (may("employee.assign"))
    for (const e of live)
      if (e.siteId && !legalOnSite({ ...e, docs: e.docs ?? {} }, today))
        out.push({ key: `iqama:${e.id}`, group: "blocking", severity: "red", kind: "iqama_on_site", params: { name: name(e), site: siteName(e.siteId) }, facts: [...who(e).slice(0, 1), { k: "renewal_gov" }], href: `people/${e.id}`, action: "move" })

  // DC-06 — drivers whose licence has expired: ONE row — they do not drive until it is renewed.
  if (may("employee.assign")) {
    const grounded = live.filter((e) => WORKING.has(e.status ?? "active") && e.siteId && !mayDrive({ docs: e.docs ?? {}, drives: tradeOf(e.trade)?.drives ?? null }, today))
    if (grounded.length)
      out.push({
        key: "licences",
        group: "blocking",
        severity: "red",
        kind: "licence_expired",
        params: { count: grounded.length },
        facts: [{ k: "names", p: { names: grounded.slice(0, 3).map(name).join("، "), more: Math.max(0, grounded.length - 3) } }, { k: "reassign_or_stop" }],
        href: "people?filter=docs",
        action: "keep_or_stop",
      })
  }

  const mainLast = i.payrolls.find((p) => p.kind === "main" && p.month === lastMonth)
  if (!mainLast || mainLast.state === "prepared") {
    const closed = new Set(i.lastMonth.filter((w) => w.closed).map((w) => w.siteId))
    for (const siteId of sitesToClose(lastMonth, i.sites, i.employees, i.lastMonth))
      if (!closed.has(siteId) && may("attendance.close", siteId)) {
        const thru = Object.keys(i.lastMonth.find((w) => w.siteId === siteId)?.days ?? {}).sort().pop()
        out.push({ key: `close:${siteId}`, group: "blocking", severity: "red", kind: "close_month", params: { site: siteName(siteId), month: lastMonth }, facts: [thru ? { k: "recorded_thru", p: { date: thru } } : { k: "nothing_recorded" }, { k: "no_payroll_before" }], href: `sites/${siteId}`, action: "close" })
      }
  }

  for (const inj of i.injuries)
    if (injuryState(inj, today) === "overdue" && may("injury.report"))
      out.push({ key: `inj:${inj.id}`, group: "blocking", severity: "red", kind: "injury_overdue", params: { name: inj.employeeName, due: inj.due }, facts: [{ k: "quote", p: { text: inj.description } }, { k: "gosi_wages" }], href: `people/${inj.employeeId}`, action: "report" })

  for (const [id, p] of i.pays) {
    const e = byId.get(id)
    if (!e) continue
    if (p.ibanState === "returned" && may("iban.fix")) out.push({ key: `ibanfix:${id}`, group: "blocking", severity: "red", kind: "iban_fix", params: { name: name(e) }, facts: [...who(e), { k: "unpaid_until_fixed" }], href: `people/${id}`, action: "fix_iban" })
    // PY-03 — a new IBAN is a person's request for the HR manager: the hand that changed it never approves it.
    if (p.ibanState === "fixed" && may("iban.approve")) out.push({ key: `ibanok:${id}`, group: "requests", severity: "amber", kind: "iban_approve", params: { name: name(e) }, facts: [{ k: "separation" }], href: `people/${id}`, action: "approve_iban" })
  }

  // Last month's payroll — only if someone was on it (a company that started this month owes none).
  if (may("payroll.prepare") && today > monthRange(lastMonth).end && !mainLast && i.employees.some((e) => onPayroll(e, lastMonth)))
    out.push({ key: `pay:prepare:${lastMonth}`, group: "blocking", severity: "amber", kind: "payroll_prepare", params: { month: lastMonth }, facts: [{ k: "review_then_send" }], href: "payroll", action: "prepare" })
  // Every prepared payroll waits for its approval — the supplementary "-D" too — never of whoever prepared it.
  if (may("payroll.approve"))
    for (const p of i.payrolls)
      if (p.state === "prepared" && (ctx.owner || p.prepared?.by !== ctx.uid)) {
        const held = (p.lines ?? []).filter((l) => l.held).length
        out.push({ key: `pay:approve:${p.key}`, group: "due", severity: "amber", kind: "payroll_approve", params: { month: p.key }, facts: [{ k: "lines", p: { n: (p.lines ?? []).length + (p.supplementary ?? []).length, held } }, { k: "not_preparer" }], href: "payroll", action: "approve" })
      }

  // Custody cleared by Inventory: the settlement is now the HR manager's to prepare (WF-16 step 3) — never his own.
  if (may("exit.manage"))
    for (const x of i.exits)
      if (x.state === "leaving" && x.custody?.state === "cleared" && x.employeeId !== ctx.employeeId) {
        const e = byId.get(x.employeeId)
        const p = i.pays.get(x.employeeId)
        const facts: FactPart[] = []
        if (e?.join && p && seesPay) facts.push({ k: "eos", p: { eos: gratuity(wageOf(p), e.join, x.lastDay, x.reason) } })
        if (e?.join) facts.push({ k: "leave_days", p: { n: Math.max(0, leaveBalance(e.join, x.lastDay, e.leaveTaken ?? 0, e.openingLeave ?? 0)) } })
        out.push({ key: `settle:${x.id}`, group: "blocking", severity: daysBetween(today, x.lastDay) <= 7 ? "amber" : "blue", kind: "settlement_ready", params: { name: x.employeeName, date: x.lastDay }, facts, href: `people/${x.employeeId}`, action: "settle" })
      }

  // AT-05 — an approved leave whose end has passed with no return recorded: absence without leave, the art. 80
  // clock running. The workplace's supervisor (on his sheet) or the HR manager (on the file) records the return —
  // never anyone for himself; someone unassigned is the HR manager's alone. It blocks from the first day (the
  // prototype's "now"); ten days late make the written warning due, fifteen make termination possible: red.
  for (const r of i.requests) {
    const late = leaveReturn(r, today)
    if (!late || r.employeeId === ctx.employeeId) continue
    const mine = r.siteId && r.siteId !== UNASSIGNED_SITE ? may("leave.return", r.siteId) : ctx.roles.has("manager")
    if (!mine) continue
    const onFile = ctx.roles.has("manager") || !r.siteId || r.siteId === UNASSIGNED_SITE
    const card = `people/${r.employeeId}`
    out.push({
      key: `return:${r.id}`,
      group: "blocking",
      severity: late.stage === "termination" ? "red" : "amber",
      kind: `leave_return_${late.stage}`,
      params: { name: r.employeeName, date: r.leave!.to, days: late.daysLate },
      facts: [{ k: "art80" }],
      href: onFile ? card : `sites/${r.siteId}`,
      action: "record",
      second: onFile ? undefined : { action: "card", href: card },
    })
  }

  // AS-03 — "a worker here but not on my list": a people's request — the HR manager corrects it or declines it.
  if (may("employee.assign"))
    for (const f of i.assignFixes ?? [])
      if (f.state === "pending" && f.employeeId !== ctx.employeeId)
        out.push({
          key: `assignfix:${f.id}`,
          group: "requests",
          severity: "amber",
          kind: "assign_fix",
          params: { name: f.employeeName, site: siteName(f.siteId), date: f.since },
          facts: [{ k: "raised_by", p: { name: f.byName ?? "" } }, ...(f.note ? [{ k: "quote", p: { text: f.note } }] : [])],
          href: f.siteId && f.siteId !== UNASSIGNED_SITE ? `sites/${f.siteId}` : `people/${f.employeeId}`,
          action: "decide",
        })

  // Today's sheet (the supervisor's own sites) — all present, then the exceptions.
  const recordedToday = new Set(i.thisMonth.filter((w) => w.days?.[today]).map((w) => w.siteId))
  const leaveToday = onLeaveOn(i.requests, today)
  if (!isRestDay(today))
    for (const s of i.sites) {
      if (s.active === false || assumesPresence(s.id, s.type) || recordedToday.has(s.id) || !may("attendance.record", s.id) || !ctx.roles.has("supervisor")) continue
      const n = live.filter((e) => e.siteId === s.id && WORKING.has(e.status ?? "active") && (!e.join || e.join <= today) && !leaveToday.has(e.id)).length
      if (n) out.push({ key: `sheet:${s.id}`, group: "due", severity: "amber", kind: "sheet_today", params: { site: s.name, n }, facts: [{ k: "all_present_then" }], href: `sites/${s.id}`, action: "record" })
    }

  // AT-03/04 — a workplace whose sheet stopped this month: the HR manager and payroll remind its supervisor (no
  // payroll before it closes); with no supervisor named, they open the sheet themselves.
  if (ctx.roles.has("manager") || ctx.roles.has("payroll"))
    for (const s of i.sites) {
      if (s.active === false || assumesPresence(s.id, s.type)) continue
      const wm = i.thisMonth.find((w) => w.siteId === s.id) ?? null
      if (wm?.closed) continue
      const first = firstOnSite(s.id, live)
      if (!first) continue
      const stop = sheetStopped(wm, thisMonth, today, first)
      if (!stop) continue
      const remind = Boolean(s.supervisorUserId) && s.supervisorUserId !== ctx.uid
      out.push({
        key: `stopped:${s.id}`,
        group: "due",
        severity: "amber",
        kind: "sheet_stopped",
        params: { site: s.name, date: stop.since },
        facts: [{ k: "days_missing", p: { n: stop.missing } }, { k: "day_by_day" }, { k: "no_payroll_before" }],
        ...(remind ? { action: "remind", run: { kind: "remind" as const, siteId: s.id } } : { action: "record", href: `sites/${s.id}` }),
      })
    }

  // --- From another module ------------------------------------------------------
  // What Projects asks of HR is ours to answer (WF-12) — red when the coverage is short or late (AS-02)…
  if (may("manpower.answer"))
    for (const m of i.manpower ?? [])
      if (m.state === "open") {
        const c = coverageSummary(m, { today, employees: i.employees, sites: i.sites, visas: i.visas ?? null })
        out.push({
          key: `mp:${m.id}`,
          group: "other",
          severity: c.short || c.late ? "red" : "amber",
          kind: "manpower",
          params: { project: m.projectName, count: m.count, trade: m.trade, date: m.from },
          facts: [{ k: "coverage", p: { onTime: c.onTime, late: c.late, short: c.short } }, ...(c.excluded ? [{ k: "excluded", p: { n: c.excluded } }] : [])],
          href: `sites?manpower=${m.id}`,
          action: "answer",
          source: "project-management",
        })
      }
  // …what another module holds is shown with its source, never a button (TD-03).
  if (may("manpower.answer"))
    for (const m of (i.manpower ?? []) as AnsweredRequest[])
      if (m.state === "answered" && !m.accepted)
        out.push({ key: `mpack:${m.id}`, group: "other", severity: "blue", kind: "wait_plan", params: { project: m.projectName, count: m.count, trade: m.trade }, source: "project-management", waiting: true, since: m.answer?.at ?? null })
  if (may("exit.manage"))
    for (const x of i.exits as ExitWithStamps[]) {
      if (x.state === "leaving" && x.custody?.state === "requested") out.push({ key: `custody:${x.id}`, group: "other", severity: "blue", kind: "wait_custody", params: { name: x.employeeName }, source: "warehouses", waiting: true, since: x.custody.requestedAt ?? null })
      if (x.state === "settled") out.push({ key: `fs:${x.id}`, group: "other", severity: "blue", kind: "wait_settlement", params: { name: x.employeeName }, source: "payments", waiting: true, since: x.settled?.at ?? null })
    }
  if (may("pay.view")) {
    for (const p of i.payrolls)
      if (p.state === "approved" || p.state === "posted") out.push({ key: `fin:${p.key}`, group: "other", severity: "blue", kind: p.state === "approved" ? "wait_post" : "wait_pay", params: { key: p.key }, source: "payments", waiting: true, since: (p.state === "approved" ? p.approved?.at : p.posted?.at) ?? null })
    // PY-03 — held transfers whose IBAN is fixed and approved: Finance pays them again.
    let reissue = 0
    let since: string | null = null
    for (const p of i.payrolls as PayrollWithHeld[]) {
      if (p.state !== "paid") continue
      for (const l of p.lines ?? [])
        if ((l.held || p.returned?.[l.employeeId]) && !p.paidHeld?.[l.employeeId] && i.pays.get(l.employeeId)?.iban && (i.pays.get(l.employeeId)?.ibanState ?? "ok") === "ok") {
          reissue++
          since = since ?? p.paid?.at ?? null
        }
    }
    if (reissue) out.push({ key: "reissue", group: "other", severity: "blue", kind: "wait_reissue", params: { n: reissue }, source: "payments", waiting: true, since })
  }
  if (may("request.decide"))
    for (const r of i.requests)
      if (r.state === "finance") out.push({ key: `adv:${r.id}`, group: "other", severity: "blue", kind: "wait_advance", params: { name: r.employeeName, no: r.no }, source: "payments", waiting: true, since: r.decision?.at ?? null })

  // --- Due dates (and, when expired, blocking) ------------------------------------
  // Renewals are government relations' queue — the HR manager carries them only when nobody holds that role
  // (DC-04: never the same renewal on two desks).
  if (may("documents.manage") && govDesk)
    for (const e of live) {
      // DC-04 — one row per PERSON, his renewals in the order they are done
      // (passport → insurance → iqama): one trip to the authorities, not a row
      // per document. An expired iqama on a site is the HR manager's block above
      // ("move") — for him, once. Government relations cannot move anyone: it is
      // his renewal, in red, blocking (DC-02).
      const skipIqama = Boolean(e.siteId) && may("employee.assign")
      const chain = renewalChain(e, today, i.renewWindowDays).filter((x) => !(skipIqama && x.type === "iqama" && x.state === "expired"))
      if (chain.length) {
        const worst = chain.reduce((a, x) => (STATE_RANK[x.state] > STATE_RANK[a.state] ? x : a))
        const ppFirst = passportFirst(e.docs ?? {}, today)
        const iqamaOnSite = chain.some((x) => x.type === "iqama" && x.state === "expired") && Boolean(e.siteId) && e.siteId !== UNASSIGNED_SITE
        out.push({
          key: `doc:${e.id}`,
          group: worst.state === "expired" ? "blocking" : "due",
          severity: worst.state === "expired" ? "red" : worst.state === "d30" ? "amber" : "blue",
          kind: "doc_due",
          params: { name: name(e), doc: worst.type, date: worst.expiry, order: chain.map((x) => x.type).join(","), count: chain.length },
          facts: [...who(e), { k: "order", p: { order: chain.map((x) => x.type).join(",") } }, ...(ppFirst ? [{ k: "passport_first" }] : []), ...(iqamaOnSite ? [{ k: "on_site" }] : [])],
          href: `people/${e.id}?renew=${ppFirst ? "passport" : chain[0].type}`,
          action: "renew",
        })
      }
      // DC-05 — a visa arrival's iqama within 90 days of arriving.
      if (e.source === "visa" && e.nationality !== "sa" && !e.docs?.iqama && e.join && e.join <= today) {
        const due = iqamaDueBy(e.join)
        out.push({ key: `iqclock:${e.id}`, group: today > due ? "blocking" : "due", severity: today > due ? "red" : daysBetween(today, due) <= 30 ? "amber" : "blue", kind: "iqama_clock", params: { name: name(e), date: due }, facts: [...who(e), { k: "days_left", p: { n: daysBetween(today, due) } }], href: `people/${e.id}?renew=iqama`, action: "issue" })
      }
    }
  for (const inj of i.injuries)
    if (injuryState(inj, today) === "due" && may("injury.report"))
      out.push({ key: `injdue:${inj.id}`, group: "due", severity: "amber", kind: "injury_due", params: { name: inj.employeeName, due: inj.due }, facts: [{ k: "quote", p: { text: inj.description } }, { k: "gosi_wages" }], href: `people/${inj.employeeId}`, action: "report" })
  if (may("request.decide"))
    for (const e of live) {
      if (e.id === ctx.employeeId) continue
      if (e.probation && !e.probation.decision && e.probation.end >= today && daysBetween(today, e.probation.end) <= PROBATION_NOTICE_DAYS)
        out.push({ key: `prob:${e.id}`, group: "due", severity: "amber", kind: "probation_end", params: { name: name(e), date: e.probation.end }, facts: [...who(e), { k: "no_decision_confirmed" }], href: `people/${e.id}`, action: "decide" })
      // EX-01 — renew or not: the decision is on the person's file (no decision = renewed for the same term).
      if (e.contract?.type === "fixed" && e.contract.end && e.contract.end >= today && daysBetween(today, e.contract.end) <= CONTRACT_NOTICE_DAYS && e.status !== "leaving")
        out.push({ key: `ct:${e.id}`, group: "due", severity: "blue", kind: "contract_end", params: { name: name(e), date: e.contract.end }, facts: [...who(e), { k: "no_decision_renewed" }], href: `people/${e.id}?act=contract`, action: "decide" })
    }

  // LV-08 — an approved leave abroad: the exit re-entry visa before he travels (government relations records it).
  if (govDesk && may("platform.tasks"))
    for (const r of i.requests as LeaveWithVisa[])
      if (r.kind === "leave" && r.state === "approved" && r.leave?.travel && r.leave.from >= today && !r.exitVisa && !r.returned && r.employeeId !== ctx.employeeId)
        out.push({ key: `exitvisa:${r.id}`, group: "due", severity: daysBetween(today, r.leave.from) <= 7 ? "amber" : "blue", kind: "exit_reentry", params: { name: r.employeeName, date: r.leave.from }, facts: [{ k: "approved_leave_visa" }], action: "recorded", run: { kind: "exit_visa", requestId: r.id } })
  // EX-06 — the final exit of a leaver whose last day is near: recorded once the settlement is approved.
  if (govDesk && may("platform.tasks"))
    for (const x of i.exits)
      if (!x.tasks?.finalExit && x.lastDay && daysBetween(today, x.lastDay) <= FINAL_EXIT_DAYS && x.employeeId !== ctx.employeeId) {
        const ready = x.state !== "leaving"
        out.push({ key: `finalexit:${x.id}`, group: "due", severity: ready && x.lastDay <= today ? "amber" : "blue", kind: "final_exit", params: { name: x.employeeName, date: x.lastDay }, facts: [{ k: ready ? "final_exit_ready" : "after_settlement" }], ...(ready ? { href: `people/${x.employeeId}`, action: "record" } : {}) })
      }

  out.push(...(i.extra ?? []))
  const rank = { red: 0, amber: 1, blue: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/** TD-03 — rows another module holds that carry an action. Must be zero. */
export const leakage = (items: TodayItem[]) => items.filter((x) => x.waiting && (x.action || x.href || x.run || x.second)).length

/** TD-01 — the Today tab's count: the decisions waiting for this viewer (never what another module holds). */
export const decisionCount = (items: TodayItem[], extra = 0) => items.filter((x) => !x.waiting).length + extra

const OPEN_REQUEST = new Set(["pending", "endorsed", "finance"])

/** The tab rail's numbers (the prototype's TABS): each the count of the screen the tab opens. A zero is not
 * shown, except on Today, whose count is always shown. */
export function hrTabCounts(i: {
  ctx: HrContext
  items: TodayItem[]
  /** Today's rows plus the requests, penalties and letters waiting for this viewer. */
  decisions: number
  urgent: boolean
  employees: HrEmployee[]
  manpower: ManpowerRequest[]
  payrolls: Payroll[]
  requests: HrRequest[]
}): Partial<Record<"today" | "people" | "sites" | "payroll" | "me", { count: number; urgent?: boolean }>> {
  const out: ReturnType<typeof hrTabCounts> = { today: { count: i.decisions, urgent: i.urgent } }
  const people = i.employees.filter((e) => e.status !== "left").length
  if (people) out.people = { count: people }
  if (hrAllowed(i.ctx, "manpower.answer")) {
    const open = i.manpower.filter((m) => m.state === "open").length
    if (open) out.sites = { count: open, urgent: i.items.some((x) => x.kind === "manpower" && x.severity === "red") }
  }
  const toApprove = hrAllowed(i.ctx, "payroll.approve") ? i.items.filter((x) => x.kind === "payroll_approve").length : 0
  const toPrepare = i.ctx.roles.has("payroll") ? i.items.filter((x) => x.kind === "payroll_prepare").length : 0
  if (toApprove + toPrepare) out.payroll = { count: toApprove + toPrepare }
  if (i.ctx.employeeId) {
    const mine = i.requests.filter((r) => r.employeeId === i.ctx.employeeId && OPEN_REQUEST.has(r.state)).length
    if (mine) out.me = { count: mine }
  }
  return out
}

// ---------------------------------------------------------------------------
// People's requests — the facts a leave or an advance is decided on (TD-02)
// ---------------------------------------------------------------------------

/** Leave: the workplace, the balance at its start, the excess, and the endorsement (LV-02/03/05). Advance (pay
 * roles only): trade · workplace · wage · instalment × months · an outstanding advance · the reason (AD-01/02). */
export function requestFacts(r: HrRequest, w: { employees: HrEmployee[]; sites: HrSite[]; pays: Map<string, EmployeePay>; seesPay: boolean }): FactPart[] {
  const e = w.employees.find((x) => x.id === r.employeeId)
  const site = (id: string | null | undefined) => (id && id !== UNASSIGNED_SITE ? (w.sites.find((s) => s.id === id)?.name ?? "") : "")
  if (r.kind === "leave" && r.leave) {
    const out: FactPart[] = [{ k: "site", p: { site: site(r.siteId) } }, { k: "balance", p: { n: r.leave.balance } }]
    if (r.leave.type === "annual" && r.leave.days > r.leave.balance) out.push({ k: "exceeds", p: { n: r.leave.days - r.leave.balance } })
    out.push(r.endorsement ? { k: "endorsed_by", p: { name: r.endorsement.byName ?? "" } } : { k: "no_endorsement" })
    return out
  }
  if (r.kind === "advance" && r.advance && w.seesPay) {
    const pay = w.pays.get(r.employeeId)
    const out: FactPart[] = []
    if (e) out.push({ k: "trade", p: { trade: e.trade } }, { k: "site", p: { site: site(e.siteId) } })
    if (pay) out.push({ k: "wage", p: { wage: wageOf(pay) } })
    out.push({ k: "instalment", p: { instalment: r.advance.instalment, n: r.advance.months } })
    out.push({ k: pay?.advance && pay.advance.balance > 0 ? "has_advance" : "no_advance" })
    if (r.advance.reason) out.push({ k: "quote", p: { text: r.advance.reason } })
    return out
  }
  return []
}

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

export type DutyStatus = "present" | "absent" | "sick" | "unrecorded" | "leave"

/** One person today: on leave · absent · sick · present · not yet recorded — null when not working today. */
export function dutyStatus(e: HrEmployee, i: { today: string; sites: HrSite[]; thisMonth: WorkplaceMonth[]; leave: Set<string> }): DutyStatus | null {
  if (e.status !== "leave" && !WORKING.has(e.status ?? "active")) return null
  if (e.join && e.join > i.today) return null
  if (e.status === "leave" || i.leave.has(e.id)) return "leave"
  const siteId = e.siteId || UNASSIGNED_SITE
  const sheet = i.thisMonth.find((w) => w.siteId === siteId)?.days?.[i.today]
  const ex = sheet?.ex?.[e.id]?.status
  if (ex === "absent" || ex === "permission") return "absent"
  if (ex === "sick") return "sick"
  if (assumesPresence(siteId, i.sites.find((s) => s.id === siteId)?.type ?? null)) return "present"
  if (sheet?.listed?.includes(e.id)) return "present"
  return isRestDay(i.today) ? null : "unrecorded"
}

/** Who is present, absent, sick or not yet recorded today, by workplace. An office (and the
 * unassigned) assumes presence and records exceptions only (AT-02); a site with no sheet today is
 * unrecorded; approved leave is leave, never absence; Friday is the rest day. */
export function dutyToday(i: { today: string; employees: HrEmployee[]; sites: HrSite[]; thisMonth: WorkplaceMonth[]; requests: HrRequest[] }): SiteToday[] {
  const leave = onLeaveOn(i.requests, i.today)
  const by = new Map<string, SiteToday>()
  for (const e of i.employees) {
    if (e.status !== "leave" && !WORKING.has(e.status ?? "active")) continue
    if (e.join && e.join > i.today) continue
    const siteId = e.siteId || UNASSIGNED_SITE
    const row = by.get(siteId) ?? { siteId, assigned: 0, present: 0, absent: 0, sick: 0, unrecorded: 0, onLeave: 0 }
    by.set(siteId, row)
    const st = dutyStatus(e, { ...i, leave })
    if (st === "leave") {
      row.onLeave++
      continue
    }
    row.assigned++
    if (st === "absent") row.absent++
    else if (st === "sick") row.sick++
    else if (st === "present") row.present++
    else if (st === "unrecorded") row.unrecorded++
  }
  return [...by.values()]
}

/** The supervisor's "my workers by trade" (todaySup): per trade, present of working, and expired iqamas. */
export function tradesToday(i: { today: string; employees: HrEmployee[]; sites: HrSite[]; thisMonth: WorkplaceMonth[]; requests: HrRequest[]; siteIds: readonly string[] }): Array<{ trade: string; total: number; present: number; expired: number }> {
  const leave = onLeaveOn(i.requests, i.today)
  const by = new Map<string, { trade: string; total: number; present: number; expired: number }>()
  for (const e of i.employees) {
    if (!e.siteId || !i.siteIds.includes(e.siteId)) continue
    const st = dutyStatus(e, { ...i, leave })
    if (st === null || st === "leave") continue
    const row = by.get(e.trade) ?? { trade: e.trade, total: 0, present: 0, expired: 0 }
    row.total++
    if (st === "present") row.present++
    if (!legalOnSite({ ...e, docs: e.docs ?? {} }, i.today)) row.expired++
    by.set(e.trade, row)
  }
  return [...by.values()].sort((a, b) => b.total - a.total)
}

// ---------------------------------------------------------------------------
// AT-03/04 — the month's progress by workplace (payroll's panel)
// ---------------------------------------------------------------------------

export interface MonthProgressRow {
  siteId: string
  people: number
  state: "closed" | "current" | "stopped"
  /** The last day recorded; when stopped, the first day missing. */
  thru: string | null
  since?: string | null
}

/** Last month's workplaces still to close (with the day they were recorded through) and this month's progress
 * per workplace: closed · recorded through yesterday · stopped since a day. Offices assume presence. */
export function monthProgress(i: { today: string; sites: HrSite[]; employees: HrEmployee[]; lastMonth: WorkplaceMonth[]; thisMonth: WorkplaceMonth[] }): { toClose: Array<{ siteId: string; thru: string | null }>; current: MonthProgressRow[] } {
  const last = addDays(`${i.today.slice(0, 7)}-01`, -1).slice(0, 7)
  const closed = new Set(i.lastMonth.filter((w) => w.closed).map((w) => w.siteId))
  const toClose = sitesToClose(last, i.sites, i.employees, i.lastMonth)
    .filter((s) => !closed.has(s))
    .map((siteId) => ({ siteId, thru: Object.keys(i.lastMonth.find((w) => w.siteId === siteId)?.days ?? {}).sort().pop() ?? null }))
  const live = i.employees.filter((e) => e.status !== "left")
  const current: MonthProgressRow[] = []
  for (const s of i.sites) {
    if (s.active === false || assumesPresence(s.id, s.type)) continue
    const people = live.filter((e) => e.siteId === s.id && WORKING.has(e.status ?? "active")).length
    if (!people) continue
    const wm = i.thisMonth.find((w) => w.siteId === s.id) ?? null
    const thru = Object.keys(wm?.days ?? {}).sort().pop() ?? null
    if (wm?.closed) {
      current.push({ siteId: s.id, people, state: "closed", thru })
      continue
    }
    const stop = sheetStopped(wm, i.today.slice(0, 7), i.today, firstOnSite(s.id, live))
    current.push({ siteId: s.id, people, state: stop ? "stopped" : "current", thru, since: stop?.since ?? null })
  }
  return { toClose, current }
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
  /** The company's pay day (policy) — management compares the last payroll's payment with it. */
  payDay?: number
  /** ST-05 — the HR manager of a company still moving in sees the build-time three (employees · workplaces · payroll). */
  moving?: boolean
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

const latestMainPayroll = (payrolls: Payroll[]) => payrolls.filter((p) => p.kind === "main").sort((a, b) => b.month.localeCompare(a.month))[0] ?? null

/** Workplaces ending within 45 days (AS-02) — the soonest first, with who works there. */
export const ENDING_DAYS = 45
export function endingSites(sites: HrSite[], employees: HrEmployee[], today: string): Array<{ site: HrSite; people: HrEmployee[] }> {
  return sites
    .filter((s) => s.active !== false && s.endDate && s.endDate >= today && daysBetween(today, s.endDate) <= ENDING_DAYS)
    .sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string))
    .map((site) => ({ site, people: employees.filter((e) => e.siteId === site.id && WORKING.has(e.status ?? "active")) }))
}

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
  const benchCost = r2(bench.reduce((a, e) => a + wage(e), 0))
  const rest = isRestDay(i.today)
  const money = hrAllowed(i.ctx, "pay.view")

  if (role === "manager" && i.moving) {
    // ST-05 — moving in: the record as it fills (todayNew).
    const all = sum(duty)
    const p = latestMainPayroll(i.payrolls)
    const active = i.sites.filter((s) => s.active !== false)
    return [
      { id: "new_people", value: live.length, note: live.length ? "note" : "none", params: { present: all.present, bench: bench.length }, tone: "neutral", href: "people" },
      { id: "new_sites", value: active.length, note: active.length ? "note" : "none", params: { names: active.slice(0, 4).map((s) => s.name).join(" · ") }, tone: "neutral", href: "sites" },
      p ? { id: "payroll", value: payrollNet(p), money: true, note: "state", params: { month: p.month, state: p.state, returned: returned.length }, tone: "neutral", href: "payroll" } : { id: "payroll", value: 0, note: "none", params: {}, tone: "neutral", href: "payroll" },
    ]
  }

  if (role === "manager") {
    const all = sum(duty)
    const renew = live.filter((e) => needsRenewal(e, i.today, i.renewWindowDays))
    const p = latestMainPayroll(i.payrolls)
    const sup = i.payrolls.find((x) => x.kind === "supplementary" && x.state === "prepared")
    return [
      { id: "on_duty", value: all.present, note: rest ? "rest" : money && bench.length ? "note_cost" : "note", params: { of: all.assigned, out: all.absent + all.sick, unrecorded: all.unrecorded, bench: bench.length, cost: benchCost }, tone: bench.length > 5 ? "warn" : "neutral", href: "people" },
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
    const progress = monthProgress({ today: i.today, sites: i.sites, employees: i.employees, lastMonth: [], thisMonth: i.thisMonth }).current
    return [
      { id: "estimate", value: estimate, money: true, note: "note", params: { month, current: progress.filter((x) => x.state !== "stopped").length, of: progress.length }, tone: "neutral", href: "payroll" },
      { id: "returned", value: returned.length, note: "note", params: { net: returnedNet }, tone: returned.length ? "bad" : "good" },
      { id: "advances", value: r2(advances.reduce((a, x) => a + (x.advance?.balance ?? 0), 0)), money: true, note: "note", params: { count: advances.length }, tone: "neutral", href: "reports?report=advances" },
    ]
  }
  if (role === "supervisor") {
    const mine = sum(duty.filter((d) => i.ctx.sites.includes(d.siteId)))
    const docs = live.filter((e) => e.siteId && i.ctx.sites.includes(e.siteId) && needsRenewal(e, i.today, i.renewWindowDays))
    const expired = docs.some((e) => nearestDocument(e.docs, i.today, i.renewWindowDays)?.state === "expired")
    return [
      { id: "my_workers", value: mine.present, note: rest ? "rest" : "note", params: { of: mine.assigned, absent: mine.absent, sick: mine.sick, unrecorded: mine.unrecorded, leave: mine.onLeave }, tone: mine.unrecorded ? "warn" : "good" },
      { id: "unrecorded", value: mine.unrecorded, note: mine.unrecorded ? "note" : "done", params: {}, tone: mine.unrecorded ? "bad" : "good" },
      { id: "my_docs", value: docs.length, note: "note", params: {}, tone: expired ? "bad" : docs.length ? "warn" : "good" },
    ]
  }
  // management
  const p = latestMainPayroll(i.payrolls)
  const cost = p ? r2(p.lines.reduce((a, l) => a + l.gross + l.gosiEmployer, 0)) : 0
  const admin = p ? r2(p.lines.filter((l) => (l.costKind ?? costKindOf(UNASSIGNED_SITE)) === "admin").reduce((a, l) => a + l.gross + l.gosiEmployer, 0)) : 0
  const saudi = live.length ? Math.round((live.filter((e) => e.nationality === "sa").length / live.length) * 100) : 0
  const ending = endingSites(i.sites, live, i.today)[0] ?? null
  const contracts = live.filter((e) => e.contract?.type === "fixed" && e.contract.end && e.contract.end >= i.today && daysBetween(i.today, e.contract.end) <= 60).length
  const probations = live.filter((e) => e.probation && !e.probation.decision && e.probation.end >= i.today && daysBetween(i.today, e.probation.end) <= 30).length
  const paidDay = p?.paid?.date ?? p?.paid?.at?.slice(0, 10) ?? null
  const paidOn = paidDay ? Number(paidDay.slice(8, 10)) : null
  const endParams: Record<string, string | number> = ending ? { site: ending.site.name, n: ending.people.length, endCost: r2(ending.people.reduce((a, e) => a + wage(e), 0)), date: ending.site.endDate as string } : {}
  return [
    bench.length
      ? { id: "bench", value: benchCost, money: true, note: ending ? "note_ending" : "note", params: { count: bench.length, ...endParams }, tone: "warn", href: "sites" }
      : { id: "decisions", value: contracts + probations, note: ending ? "note_ending" : "note", params: { contracts, probations, ...endParams }, tone: contracts + probations ? "warn" : "good" },
    p
      ? { id: "labour_cost", value: cost, money: true, note: "note", params: { month: p.month, perHead: p.lines.length ? r2(cost / p.lines.length) : 0, saudi, admin: cost ? Math.round((admin / cost) * 100) : 0 }, tone: "neutral", href: "reports?report=cost" }
      : { id: "labour_cost", value: 0, note: "none", params: { saudi }, tone: "neutral" },
    { id: "iqama_on_site", value: expiredIqama.filter(onSite).length, note: paidOn && i.payDay ? "note_payday" : "note", params: { returned: returned.length, paid: paidOn ?? 0, policy: i.payDay ?? 0 }, tone: expiredIqama.some(onSite) ? "bad" : "good", href: "people?filter=iqama_site" },
  ]
}

const payrollNet = (p: Payroll) => r2(p.lines.reduce((a, l) => a + l.net, 0))

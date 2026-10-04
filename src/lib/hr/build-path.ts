// HR 1.0 — moving in (PRD ST-05, WF-01 step 8): the build path of ten steps,
// each computed from the record — never ticked by hand — and the "what turned
// out missing" panel: the gaps in the company's own data that will bite later
// (a site nobody records, a non-Saudi with no iqama, a line with no IBAN, a
// role nobody holds). A step locked behind the one before says so. Pure: no I/O.

import type { HrContext } from "./access"
import type { WorkplaceMonth } from "./attendance"
import type { EmployeePay, HrEmployee } from "./employee"
import { onPayroll, sitesToClose, type Payroll } from "./payroll"
import { isOffice, type HrSite } from "./sites"
import type { HrSettings } from "./settings"
import { addDays } from "./statutory"

export const BUILD_STEPS = ["establishment", "sites", "policies", "team", "employees", "attendance", "documents", "close", "payroll", "files"] as const
export type BuildStepKey = (typeof BUILD_STEPS)[number]

/** Where each step is done: an HR tab, or the company's team page. */
export type BuildTarget = "settings" | "sites" | "team" | "people" | "today" | "payroll" | "reports"

export interface BuildStep {
  key: BuildStepKey
  done: boolean
  /** Waits for an earlier step. */
  locked: boolean
  target: BuildTarget
  /** How many there are, where a count says more than a tick (workplaces, members, employees). */
  count?: number
}

export interface BuildInput {
  today: string
  settings: Pick<HrSettings, "establishment" | "businessType">
  settingsSaved: boolean
  employees: HrEmployee[]
  sites: HrSite[]
  /** Members other than the owner who hold an HR role in their default group. */
  teamMembers: number
  lastMonth: WorkplaceMonth[]
  thisMonth: WorkplaceMonth[]
  payrolls: Payroll[]
}

const lastMonthOf = (today: string) => addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)

export function buildSteps(i: BuildInput): BuildStep[] {
  const live = i.employees.filter((e) => e.status !== "left")
  const sites = i.sites.filter((s) => s.active !== false)
  const month = lastMonthOf(i.today)
  const someoneLastMonth = live.some((e) => onPayroll(e, month))
  const closed = new Set(i.lastMonth.filter((w) => w.closed).map((w) => w.siteId))
  const closeDone = someoneLastMonth && sitesToClose(month, i.sites, i.employees, i.lastMonth).every((id) => closed.has(id))
  const recorded = [...i.thisMonth, ...i.lastMonth].some((w) => Object.keys(w.days ?? {}).length > 0 || (w.declarations ?? []).length > 0)
  // An office-only company assumes presence (AT-02): nothing to record for it to be done.
  const allAssumed = live.length > 0 && live.every((e) => !e.siteId || isOffice(i.sites.find((s) => s.id === e.siteId)?.type ?? "hq"))
  const approved = i.payrolls.some((p) => p.kind === "main" && p.state !== "prepared")
  const paid = i.payrolls.some((p) => p.state === "paid")
  const est = i.settings.establishment
  return [
    { key: "establishment", done: Boolean(est.name && est.cr && i.settings.businessType), locked: false, target: "settings" },
    { key: "sites", done: sites.length > 0, locked: false, target: "sites", count: sites.length },
    { key: "policies", done: i.settingsSaved, locked: false, target: "settings" },
    { key: "team", done: i.teamMembers > 0, locked: false, target: "team", count: i.teamMembers },
    { key: "employees", done: live.length > 0, locked: sites.length === 0, target: "people", count: live.length },
    { key: "attendance", done: recorded || allAssumed, locked: live.length === 0, target: "sites" },
    {
      key: "documents",
      done: live.length > 0 && live.filter((e) => e.nationality !== "sa").every((e) => Boolean(e.docs?.iqama) || e.source === "visa"),
      locked: live.length === 0,
      target: "people",
    },
    { key: "close", done: closeDone, locked: live.length === 0 || !someoneLastMonth, target: "today" },
    { key: "payroll", done: approved, locked: !closeDone, target: "payroll" },
    { key: "files", done: paid, locked: !approved, target: "reports" },
  ]
}

/** The next step to take: the first not done and not locked. */
export const nextStep = (steps: BuildStep[]) => steps.find((s) => !s.done && !s.locked) ?? null

export type GapKind = "site_no_supervisor" | "no_iqama" | "no_iban" | "no_payroll_officer" | "no_gov_officer" | "manager_not_on_record"
export interface Gap {
  kind: GapKind
  params: Record<string, string>
}

export interface GapInput {
  ctx: Pick<HrContext, "employeeId" | "roles">
  employees: HrEmployee[]
  sites: HrSite[]
  /** Pay roles only — without it the IBAN gaps are not judged. */
  pays: Map<string, EmployeePay> | null
  /** HR roles held by members (the owner aside), from their default groups. */
  heldRoles: ReadonlySet<string>
}

/** "What turned out missing" (WF-01 step 8) — from the record, updated with every step. */
export function setupGaps(i: GapInput): Gap[] {
  const out: Gap[] = []
  const live = i.employees.filter((e) => e.status !== "left")
  const name = (e: HrEmployee) => e.names?.ar ?? ""
  for (const s of i.sites) if (s.active !== false && !isOffice(s.type) && !s.supervisorUserId) out.push({ kind: "site_no_supervisor", params: { site: s.name } })
  for (const e of live) if (e.nationality !== "sa" && !e.docs?.iqama && e.source !== "visa") out.push({ kind: "no_iqama", params: { name: name(e) } })
  if (i.pays) for (const e of live) if (!i.pays.get(e.id)?.iban) out.push({ kind: "no_iban", params: { name: name(e) } })
  if (!i.heldRoles.has("payroll")) out.push({ kind: "no_payroll_officer", params: {} })
  if (!i.heldRoles.has("gov") && live.some((e) => e.nationality !== "sa")) out.push({ kind: "no_gov_officer", params: {} })
  if (i.ctx.roles.has("manager") && !i.ctx.employeeId) out.push({ kind: "manager_not_on_record", params: {} })
  return out
}

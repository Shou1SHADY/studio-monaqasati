// HR 1.0 — who may do what (PRD §3–4, RL-01…04). Six roles, this module only;
// the line manager is a relation, not a role. One guard table maps each action
// to the roles that may take it, checked before every write and mirrored in
// firestore.rules. Pay is hidden from government relations and supervisors, on
// the server (RL-03). Nobody approves his own request: the HR manager's own go
// to management (RL-02, LV-05). Pure: no I/O.

import type { HrFeature } from "./settings"

export const HR_ROLES = ["manager", "gov", "payroll", "supervisor", "management"] as const
export type HrRole = (typeof HR_ROLES)[number]

/** The team-group permission that carries each role (src/lib/permissions.ts). */
export const HR_ROLE_PERMISSION: Record<HrRole, string> = {
  manager: "employees.manage",
  gov: "hr.gov",
  payroll: "hr.payroll",
  supervisor: "hr.supervisor",
  management: "hr.management",
}

/** A person's HR roles: the owner (or a '*' group) is HR manager and management. */
export function hrRolesOf(input: { owner: boolean; permissions: readonly string[] }): Set<HrRole> {
  if (input.owner || input.permissions.includes("*")) return new Set<HrRole>(["manager", "management"])
  return new Set(HR_ROLES.filter((r) => input.permissions.includes(HR_ROLE_PERMISSION[r])))
}

export interface HrContext {
  uid: string
  owner: boolean
  roles: ReadonlySet<HrRole>
  /** The caller's own employee record, when linked — gives "My file". */
  employeeId: string | null
  /** Workplaces this person supervises (a supervisor acts on these only). */
  sites: readonly string[]
}

// ---------------------------------------------------------------------------
// The guard: action → roles (PRD §4 matrix). Site-scoped actions also need the
// site to be one the supervisor holds — `hrAllowed(ctx, action, { site })`.
// ---------------------------------------------------------------------------

/** `owner`: the org owner may take it although his roles (HR manager and management) do not carry it — a
 * company with no one in that role must not be stuck (AC-04: a returned IBAN with no payroll officer). */
type Rule = { roles: readonly HrRole[]; siteScoped?: readonly HrRole[]; owner?: true }

export const HR_GUARD = {
  "pay.view": { roles: ["manager", "payroll", "management"] },
  "employee.create": { roles: ["manager", "gov"] },
  "employee.import": { roles: ["manager", "gov"] },
  // Linking a record to a platform user: the link decides whose pay that user
  // reads (RL-03), so it is the HR manager's — never a role that sees no pay.
  "employee.edit": { roles: ["manager"] },
  "employee.assign": { roles: ["manager"] },
  "assignment.correct": { roles: ["manager", "supervisor"], siteScoped: ["supervisor"] },
  "manpower.answer": { roles: ["manager"] },
  "attendance.record": { roles: ["manager", "payroll", "supervisor"], siteScoped: ["supervisor"] },
  "attendance.close": { roles: ["manager", "payroll", "supervisor"], siteScoped: ["supervisor"] },
  "attendance.declare": { roles: ["manager", "supervisor"], siteScoped: ["supervisor"] },
  // SH-03 (optional: punch) — a worker's shift from a date: the HR manager, or the workplace's supervisor.
  "shift.set": { roles: ["manager", "supervisor"], siteScoped: ["supervisor"] },
  "payroll.prepare": { roles: ["manager", "payroll"] },
  "payroll.approve": { roles: ["manager"] },
  // Payroll fixes, the HR manager approves — never the same hand (RL-02); the owner, who answers to nobody,
  // may do both (flagged on approval), so a company without a payroll officer can pay the line again.
  "iban.fix": { roles: ["payroll"], owner: true },
  "iban.approve": { roles: ["manager"] },
  "leave.endorse": { roles: ["supervisor"], siteScoped: ["supervisor"] },
  // AT-05 — "started today" after a leave: the workplace's supervisor or the HR manager.
  "leave.return": { roles: ["manager", "supervisor"], siteScoped: ["supervisor"] },
  "request.decide": { roles: ["manager"] },
  // Letters (EM-08, WF-24): the HR manager asks for an employee (his own come
  // from My file); the HR manager, government relations (embassy letters) and
  // management (the HR manager's own) sign — which letter is `maySignLetter`'s.
  "letter.file": { roles: ["manager"] },
  "letter.sign": { roles: ["manager", "gov", "management"] },
  "pay.change": { roles: ["manager"] },
  "violation.record": { roles: ["manager", "supervisor"], siteScoped: ["supervisor"] },
  // DC-07 — government relations may record a work injury too (the prototype: hr, gov; owner default 4).
  "injury.record": { roles: ["manager", "gov", "supervisor"], siteScoped: ["supervisor"] },
  "injury.report": { roles: ["gov", "manager"] },
  "penalty.apply": { roles: ["manager"] },
  "exit.manage": { roles: ["manager"] },
  "documents.manage": { roles: ["manager", "gov"] },
  "platform.tasks": { roles: ["gov", "manager"] },
  "settings.manage": { roles: ["manager"] },
  "reports.view": { roles: ["manager", "gov", "payroll", "management"] },
  // Hiring (optional: hire — WF-17/18): the HR manager runs openings and the individuals track; a recruitment
  // batch, the conversion to employee and the onboarding ticks are government relations' too; management
  // approves a new position and an offer above the band (ST-03).
  "hire.manage": { roles: ["manager"] },
  "hire.batch": { roles: ["manager", "gov"] },
  "hire.convert": { roles: ["manager", "gov"] },
  "hire.onboard": { roles: ["manager", "gov"] },
  "hire.approve": { roles: ["management"] },
  // Training (TR-01…05) and performance (PF-01…07) — optional features `train` / `perf`. Rating is the line
  // manager's (a relation, named on each review), never a role; calibration and raises are the office's.
  "train.manage": { roles: ["manager"] },
  "perf.cycle": { roles: ["manager"] },
  "perf.calibrate": { roles: ["manager", "management"] },
  "perf.approve": { roles: ["manager"] },
  "perf.raise": { roles: ["manager"] },
  "perf.raise.decide": { roles: ["management"] },
} as const satisfies Record<string, Rule>

export type HrAction = keyof typeof HR_GUARD

export type HrRefusal = "no_role" | "not_your_site" | "own_request"

/** The check every HR write runs first. Null means allowed. */
export function hrRefusal(ctx: HrContext, action: HrAction, scope: { site?: string | null } = {}): HrRefusal | null {
  const rule: Rule = HR_GUARD[action]
  if (rule.owner && ctx.owner) return null
  const held = rule.roles.filter((r) => ctx.roles.has(r))
  if (!held.length) return "no_role"
  // A role that is not site-scoped for this action passes anywhere.
  const unscoped = held.some((r) => !rule.siteScoped?.includes(r))
  if (unscoped) return null
  if (scope.site && !ctx.sites.includes(scope.site)) return "not_your_site"
  return null
}

export const hrAllowed = (ctx: HrContext, action: HrAction, scope: { site?: string | null } = {}) => hrRefusal(ctx, action, scope) === null

/** RL-03 — pay is seen by money roles, and by the employee on his own file. */
export function seesPay(ctx: HrContext, employeeId?: string | null): boolean {
  if (hrAllowed(ctx, "pay.view")) return true
  return Boolean(employeeId && ctx.employeeId && employeeId === ctx.employeeId)
}

/** RL-01 — whose records a viewer reads (employees, leaves, injuries, corrections): null = the whole company
 * (every HR role but the supervisor, and the owner); a supervisor and nothing else reads HIS workplaces only —
 * firestore.rules refuse a company-wide query from him, so his screens ask workplace by workplace; with no HR
 * role, nobody's (his own file is read through its link). */
export function hrPeopleScope(ctx: Pick<HrContext, "owner" | "roles" | "sites">): readonly string[] | null {
  if (ctx.owner || HR_ROLES.some((r) => r !== "supervisor" && ctx.roles.has(r))) return null
  return ctx.roles.has("supervisor") ? ctx.sites : []
}

/** A scope narrowed to one workplace (a record on a site): the whole company stays whole; a supervisor's scope
 * keeps the site only if it is his. */
export const hrScopeAt = (scope: readonly string[] | null, siteId: string | null | undefined): readonly string[] | null =>
  scope === null ? null : siteId && scope.includes(siteId) ? [siteId] : []

// ---------------------------------------------------------------------------
// Tabs (RL-01, TD-01): Today first; each role sees its own; every staff user
// with an employee record also has "My file" (ES-00).
// ---------------------------------------------------------------------------

export const HR_TABS = ["today", "people", "sites", "attendance", "payroll", "hiring", "platforms", "perf", "reports", "settings", "me"] as const
export type HrTab = (typeof HR_TABS)[number]

const ROLE_TABS: Record<HrRole, readonly HrTab[]> = {
  manager: ["today", "people", "sites", "attendance", "payroll", "hiring", "platforms", "perf", "reports", "settings"],
  gov: ["today", "people", "hiring", "platforms", "reports"],
  payroll: ["today", "people", "sites", "attendance", "payroll", "reports"],
  supervisor: ["today", "sites", "perf"],
  // Platforms are government relations' (the HR manager's only when nobody holds it) — never management's.
  management: ["today", "people", "sites", "attendance", "payroll", "hiring", "perf", "reports"],
}

/** The tab a feature switch hides (ST-02: off = tab, decisions and sections disappear). Attendance is core
 * (AT-03/04: the closing across workplaces needs no punch) — `punch` adds its sources and exceptions to it. */
const TAB_FEATURE: Partial<Record<HrTab, (f: ReadonlySet<HrFeature>) => boolean>> = {
  hiring: (f) => f.has("hire"),
  platforms: (f) => f.has("gov"),
  perf: (f) => f.has("perf") || f.has("train"),
}

/** `govHeld`: does any member of the company hold government relations? The platforms tab is government
 * relations' — the HR manager has it only when no member holds that role (the prototype's TABS). Unknown = held. */
export function hrTabs(ctx: Pick<HrContext, "roles" | "employeeId">, features: ReadonlySet<HrFeature>, opts: { govHeld?: boolean } = {}): HrTab[] {
  const set = new Set<HrTab>()
  for (const r of ctx.roles) for (const t of ROLE_TABS[r]) if (t !== "platforms" || r !== "manager" || opts.govHeld === false) set.add(t)
  if (ctx.employeeId) set.add("me")
  return HR_TABS.filter((t) => set.has(t) && (!TAB_FEATURE[t] || TAB_FEATURE[t]!(features)))
}

// ---------------------------------------------------------------------------
// Rules that need the request's data (RL-02, LV-05)
// ---------------------------------------------------------------------------

/** RL-02, LV-05 — is the platform user behind an employee record an HR manager?
 * Read from HIS default group, the way firestore.rules read it (hrUserManages):
 * the org owner (an account with no organizationRole is a legacy owner) or a
 * group holding `employees.manage` or '*'. A user of another company is not. */
export function userIsHrManager(
  user: { id: string; organizationId?: string | null; organizationRole?: string | null; defaultGroupId?: string | null } | null,
  group: { organizationId?: string | null; permissions?: readonly string[] | null } | null,
  orgId: string
): boolean {
  if (!user || (user.organizationId !== orgId && user.id !== orgId)) return false
  if (!("organizationRole" in user) || user.organizationRole === "owner") return true
  if (!group || group.organizationId !== orgId) return false
  return (group.permissions ?? []).some((p) => p === "*" || p === HR_ROLE_PERMISSION.manager)
}

/** Who decides a request: the HR manager — except on his own, which goes to
 * management. The owner, who has nobody above, decides his own, flagged. */
export function requestDecider(requester: { employeeId: string; isHrManager: boolean }): "manager" | "management" {
  return requester.isHrManager ? "management" : "manager"
}

export type DecideRefusal = "own_request" | "no_role"

export function mayDecideRequest(ctx: HrContext, requester: { employeeId: string; isHrManager: boolean }): DecideRefusal | null {
  const own = Boolean(ctx.employeeId) && ctx.employeeId === requester.employeeId
  if (own && !ctx.owner) return "own_request"
  const who = requestDecider(requester)
  return ctx.roles.has(who) || ctx.owner ? null : "no_role"
}

/** A supervisor endorses his workers' leave — never his own. */
export function mayEndorse(ctx: HrContext, requester: { employeeId: string; site: string | null; lineManagerId?: string | null }): boolean {
  if (ctx.employeeId && ctx.employeeId === requester.employeeId) return false
  if (requester.lineManagerId && ctx.employeeId === requester.lineManagerId) return true
  return ctx.roles.has("supervisor") && Boolean(requester.site) && ctx.sites.includes(requester.site as string)
}

/** The line manager (RL-04): explicit on the card, else the site's supervisor —
 * never the person himself; null means management. */
export function lineManagerOf(emp: { id: string; managerId?: string | null; siteId?: string | null }, siteSupervisor: (siteId: string) => string | null): string | null {
  if (emp.managerId && emp.managerId !== emp.id) return emp.managerId
  const sup = emp.siteId ? siteSupervisor(emp.siteId) : null
  return sup && sup !== emp.id ? sup : null
}

/** RL-02 — whoever approves a payroll did not prepare it. */
export const mayApprovePayroll = (ctx: HrContext, preparedBy: string) => hrAllowed(ctx, "payroll.approve") && ctx.uid !== preparedBy

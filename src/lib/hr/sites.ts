// HR 1.0 — workplaces (PRD AS-01, AS-04, WF-13). Every employee is in exactly
// one place: a project site, the workshop, a warehouse, the fleet, a showroom,
// a department or the head office — or "unassigned", a virtual place whose
// cost is its own row labelled "no output". Cost follows the assignment: the
// place's type decides which kind of labour cost it is (§11, Pipeline §5).
// Pure: no I/O.

export const SITE_TYPES = ["project", "workshop", "warehouse", "fleet", "showroom", "department", "hq"] as const
export type SiteType = (typeof SITE_TYPES)[number]

/** The virtual place of whoever is not assigned. */
export const UNASSIGNED_SITE = "__bench__"

/** Which labour cost a place carries (the Finance contract's four debits):
 * direct labour on a project · workshop labour absorbed by Manufacturing ·
 * sales & distribution salaries · administrative salaries. Unassigned people
 * are administrative cost with no output. */
export type CostKind = "direct" | "workshop" | "distribution" | "admin"

export const costKindOf = (type: SiteType | typeof UNASSIGNED_SITE): CostKind => {
  switch (type) {
    case "project":
      return "direct"
    case "workshop":
      return "workshop"
    case "warehouse":
    case "fleet":
    case "showroom":
      return "distribution"
    default:
      return "admin"
  }
}

/** Offices assume attendance and record only exceptions (AT-02); they close with the month. */
export const isOffice = (type: SiteType) => type === "department" || type === "hq"

export interface HrSite {
  id: string
  organizationId: string
  name: string
  /** The English name (form "site": n / en) — shown in English, the Arabic one otherwise. */
  nameEn?: string | null
  type: SiteType
  /** A project site names its project; its end date drives coverage (AS-02). */
  projectId?: string | null
  endDate?: string | null
  /** The workplace supervisor: an employee, and the platform user who acts as him. */
  supervisorEmployeeId?: string | null
  supervisorUserId?: string | null
  active: boolean
}

// ---------------------------------------------------------------------------
// Assignment correction (AS-03, WF-13)
// ---------------------------------------------------------------------------

/** `hrAssignFixes/{id}` — a supervisor's "a worker here but not on my list"; the HR manager decides. */
export const HR_ASSIGN_FIXES = "hrAssignFixes"

export interface AssignFix {
  id: string
  organizationId: string
  /** Null while a correction raised by ID number waits: a supervisor cannot read a record outside his
   * workplaces (RL-01), so the HR manager's decision resolves `idNo` to the record and fills these in. */
  employeeId: string | null
  idNo?: string | null
  employeeName: string
  /** Where the record places him, and the site he actually works on (the raiser's). */
  fromSiteId: string | null
  siteId: string
  /** Working here since — the correction takes effect from it. */
  since: string
  note: string | null
  by: string
  byName: string | null
  at: string
  state: "pending" | "done" | "declined"
  decision?: { by: string; byName: string | null; at: string; note: string | null } | null
}

export type AssignFixBlock = "same_place" | "no_date" | "future" | "left" | "pending" | "no_id" | "no_name" | "no_match" | "many_match" | "by_id"

/** A correction is an assignment correction, not a manpower request (that one is Projects'):
 * someone the record places elsewhere, working here since a day not in the future, one at a time. */
export function assignFixBlocks(emp: { siteId?: string | null; status: string }, siteId: string, since: string | null, today: string, pending: boolean): AssignFixBlock[] {
  const out: AssignFixBlock[] = []
  if (emp.status === "left") out.push("left")
  if ((emp.siteId ?? UNASSIGNED_SITE) === siteId) out.push("same_place")
  if (!since) out.push("no_date")
  else if (since > today) out.push("future")
  if (pending) out.push("pending")
  return out
}

export type SiteBlock = "no_name" | "project_needed" | "bad_end"

export function siteBlocks(input: { name: string; type: SiteType; projectId?: string | null; endDate?: string | null }): SiteBlock[] {
  const out: SiteBlock[] = []
  if (!input.name.trim()) out.push("no_name")
  if (input.type === "project" && !input.projectId) out.push("project_needed")
  if (input.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) out.push("bad_end")
  return out
}

/** A workplace's name in the reader's language. */
export const siteLabel = (s: Pick<HrSite, "name" | "nameEn">, locale: string) => (locale === "ar" ? s.name : s.nameEn?.trim() || s.name)

// ---------------------------------------------------------------------------
// The Sites tab and the site page (§5 Sites, AS-01, AS-04, ST-06)
// ---------------------------------------------------------------------------

/** ST-06 — what a company calls its workplaces: a contractor's sites, a supplier's branches and warehouses,
 * a developer's departments and projects; before a business type is chosen, workplaces. */
export type SiteWord = "contractor" | "supplier" | "developer" | "none"
export const siteWordOf = (businessType: string | null | undefined): SiteWord =>
  businessType === "contractor" || businessType === "supplier" || businessType === "developer" ? businessType : "none"

/** A project site's end comes from Projects (§data "Workplace: project/end"): a PM 1.0 project's start plus
 * its duration (and any extension granted); otherwise the date typed on the workplace. */
export function siteEndOf(site: Pick<HrSite, "endDate">, project?: { pm?: { startOn?: string | null; durationDays?: number | null; grantedDays?: number | null } | null; endDate?: string | null } | null): string | null {
  const pm = project?.pm
  if (pm?.startOn && typeof pm.durationDays === "number" && pm.durationDays > 0) {
    const d = new Date(`${pm.startOn.slice(0, 10)}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + pm.durationDays + (pm.grantedDays ?? 0))
    return d.toISOString().slice(0, 10)
  }
  return site.endDate || project?.endDate || null
}

/** By trade on a workplace (§5 Sites "labour by trade"): assigned · present today · expired iqamas — most first. */
export function tradeRows<T extends { id: string; trade: string }>(people: readonly T[], present: ReadonlySet<string>, expired: (p: T) => boolean): Array<{ trade: string; n: number; p: number; x: number }> {
  const by = new Map<string, { trade: string; n: number; p: number; x: number }>()
  for (const e of people) {
    const r = by.get(e.trade) ?? { trade: e.trade, n: 0, p: 0, x: 0 }
    r.n++
    if (present.has(e.id)) r.p++
    if (expired(e)) r.x++
    by.set(e.trade, r)
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.trade.localeCompare(b.trade))
}

/** Since when someone is unassigned (AS-04): the day he moved off his last workplace, or his join day. */
export const benchSince = (e: { siteId?: string | null; siteSince?: string | null; join?: string | null }): string | null => (e.siteId ? null : (e.siteSince ?? e.join ?? null))

// HR 1.0 — training and certificates (PRD TR-01…06, WF-20; optional feature `train`). A safety certificate is a
// dated document on the person's record (`employees.certs`), its state computed from its date like any document
// (DC-01) — never typed. What a person must hold follows from his trade and his workplace (`reqCerts`): the
// site safety induction for anyone on a project, workshop, warehouse or fleet (three days' grace after joining),
// work at height for the trades that climb on a project, first aid for safety officers, foremen and warehouse
// heads. A missing or expired one on someone at work is a gap that needs a session — it does NOT block his
// assignment (the prototype's rule). Sessions are scheduled by the HR manager from the gaps (worst first) or
// from the training needs reviews named; the result issues the certificates and an external course's cost goes
// to Finance as a payment request (hr:TRN). Pure: no I/O.

import { docState } from "./documents"
import type { HrEmployee } from "./employee"
import type { HrSite, SiteType } from "./sites"
import { costKindOf, UNASSIGNED_SITE, type CostKind } from "./sites"
import { daysBetween, r2 } from "./statutory"

/** `hrTraining/{id}` — the sessions (one collection; `kind` leaves room for a course catalogue later). */
export const HR_TRAINING = "hrTraining"

export const CERT_KEYS = ["ind", "hgt", "fa"] as const
export type CertKey = (typeof CERT_KEYS)[number]

/** The certificate catalogue (the prototype's CERTS): validity in months. */
export const CERTS: Record<CertKey, { months: number }> = {
  ind: { months: 12 },
  hgt: { months: 24 },
  fa: { months: 24 },
}

export interface Course {
  id: string
  /** The certificate a pass issues — none for a skills course. */
  cert: CertKey | null
  kind: "internal" | "external"
  /** Per trainee (SAR) — shown to money roles only. */
  cost: number
  hours: number
}

/** The course catalogue (the prototype's COURSES). Names and providers: `Portal.HR.train.course.<id>` / `.provider.<id>`. */
export const COURSES: readonly Course[] = [
  { id: "ind", cert: "ind", kind: "internal", cost: 0, hours: 3 },
  { id: "hgt", cert: "hgt", kind: "external", cost: 350, hours: 8 },
  { id: "fa", cert: "fa", kind: "external", cost: 280, hours: 12 },
  { id: "sup", cert: null, kind: "external", cost: 1200, hours: 16 },
  { id: "xl", cert: null, kind: "external", cost: 600, hours: 12 },
]
export const courseOf = (id: string | null | undefined): Course | null => COURSES.find((c) => c.id === id) ?? null
export const courseForCert = (k: CertKey): Course => COURSES.find((c) => c.cert === k) as Course
/** Skills courses a review may name as a training need (TR-06). */
export const NEED_COURSES = COURSES.filter((c) => !c.cert)

/** Workplaces where the site safety induction is required (prototype SITEK: prj, ws, wh, fleet). */
export const CERT_SITE_TYPES: readonly SiteType[] = ["project", "workshop", "warehouse", "fleet"]
/** Work at height on a project: carpenter, steel fixer, painter, plasterer, electrician, foreman. */
export const HEIGHT_TRADES: readonly string[] = ["carpenter", "steelFixer", "painter", "plasterer", "electrician", "foreman"]
/** First aid: the safety officer, the foreman, the warehouse head. */
export const FIRST_AID_TRADES: readonly string[] = ["safety", "foreman", "warehouseSupervisor"]
/** TR-02 — the induction's grace after joining: three days. */
export const INDUCTION_GRACE_DAYS = 3

/** Why a certificate is required of this person (the file's «لماذا مطلوبة»). */
export type CertWhy = "site" | "height" | "trade"

/** TR-01 — the certificates a person must hold, from his trade and workplace. None before he arrives. */
export function reqCerts(emp: Pick<HrEmployee, "status" | "trade" | "siteId">, siteType: SiteType | null | undefined): CertKey[] {
  if (emp.status === "expected" || emp.status === "left") return []
  const out: CertKey[] = []
  const placed = emp.siteId && emp.siteId !== UNASSIGNED_SITE ? siteType : null
  if (placed && CERT_SITE_TYPES.includes(placed)) out.push("ind")
  if (placed === "project" && HEIGHT_TRADES.includes(emp.trade)) out.push("hgt")
  if (FIRST_AID_TRADES.includes(emp.trade)) out.push("fa")
  return out
}

export const certWhy = (k: CertKey): CertWhy => (k === "ind" ? "site" : k === "hgt" ? "height" : "trade")

export type CertState = "missing" | "valid" | "d60" | "d30" | "expired"

/** A certificate's state from its date — the same states as a document (DC-01). */
export const certState = (certs: Partial<Record<CertKey, string | null>> | null | undefined, k: CertKey, today: string, windowDays = 60): CertState => docState(certs?.[k] ?? null, today, windowDays)

export interface CertGap {
  employeeId: string
  cert: CertKey
  state: Exclude<CertState, "valid">
  siteId: string | null
}

type GapPerson = Pick<HrEmployee, "id" | "status" | "trade" | "siteId" | "join"> & { certs?: Partial<Record<CertKey, string | null>> | null }

/** TR-02 — every required certificate not valid, for people at work or on leave. */
export function certGaps(people: readonly GapPerson[], siteTypeOf: (siteId: string | null | undefined) => SiteType | null, today: string, windowDays = 60): CertGap[] {
  const out: CertGap[] = []
  for (const e of people) {
    if (e.status !== "active" && e.status !== "leave") continue
    for (const k of reqCerts(e, siteTypeOf(e.siteId))) {
      const state = certState(e.certs, k, today, windowDays)
      if (state !== "valid") out.push({ employeeId: e.id, cert: k, state, siteId: e.siteId ?? null })
    }
  }
  return out
}

/** TR-02 — the red fact: missing or expired, on someone at work, past the induction's three-day grace. */
export function gapBad(g: CertGap, e: Pick<HrEmployee, "status" | "join"> | undefined, today: string): boolean {
  if (g.state !== "missing" && g.state !== "expired") return false
  if (!e || e.status !== "active") return false
  return g.cert !== "ind" || daysBetween(e.join, today) > INDUCTION_GRACE_DAYS
}

/** Worst first: missing/expired before expiring, then the earliest expiry. */
export const gapRank = (g: CertGap, e: GapPerson | undefined, today: string) => [gapBad(g, e, today) ? 0 : 1, e?.certs?.[g.cert] ?? ""] as const
export function sortGaps<G extends CertGap>(gaps: readonly G[], byId: (id: string) => GapPerson | undefined, today: string): G[] {
  return [...gaps].sort((a, b) => {
    const x = gapRank(a, byId(a.employeeId), today)
    const y = gapRank(b, byId(b.employeeId), today)
    return x[0] - y[0] || x[1].localeCompare(y[1])
  })
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface TrainingSession {
  id: string
  organizationId: string
  kind: "session"
  course: string
  /** The day it runs. */
  at: string
  /** Internal: the workplace it runs at; external: null (the provider's premises). */
  siteId: string | null
  seats: number
  /** Participants (employee ids), their names and workplaces as scheduled — the supervisor and My file read them. */
  ppl: string[]
  names: Record<string, string>
  siteIds: string[]
  state: "plan" | "done"
  /** Who did not attend (the rest passed). */
  abs?: string[]
  by: string
  byName: string | null
  createdAt: string
  done?: { by: string; byName: string | null; at: string } | null
  /** The payment request to Finance (an external course with attendees): its event key. */
  event?: string | null
}

export const isPlanned = (s: Pick<TrainingSession, "state">) => s.state === "plan"

/** The planned session a person is booked on for a certificate. */
export const inSession = (sessions: readonly TrainingSession[], employeeId: string, k: CertKey) =>
  sessions.find((s) => s.state === "plan" && courseOf(s.course)?.cert === k && s.ppl.includes(employeeId)) ?? null

/** The next planned session for a certificate (the supervisor's «الجلسة القادمة»). */
export const nextSession = (sessions: readonly TrainingSession[], k: CertKey) =>
  sessions.filter((s) => s.state === "plan" && courseOf(s.course)?.cert === k).sort((a, b) => a.at.localeCompare(b.at))[0] ?? null

/** TR-06 — people a review named for a skills course and who are not booked on it yet. */
export function courseNeeds(needs: ReadonlyArray<{ employeeId: string; need?: string | null }>, sessions: readonly TrainingSession[], courseId: string): string[] {
  return needs.filter((r) => r.need === courseId && !sessions.some((s) => s.course === courseId && s.ppl.includes(r.employeeId))).map((r) => r.employeeId)
}

/** TR-06 — training hours done in a year: attendees × the course's hours (the training disclosure). */
export function trainHours(sessions: readonly TrainingSession[], year: string): number {
  return sessions.filter((s) => s.state === "done" && s.at.startsWith(year)).reduce((a, s) => a + attendees(s).length * (courseOf(s.course)?.hours ?? 0), 0)
}

export const attendees = (s: Pick<TrainingSession, "ppl" | "abs">) => s.ppl.filter((id) => !(s.abs ?? []).includes(id))

/** A certificate issued by a pass on `at`: valid for the course's months (calendar months). */
export function certExpiry(at: string, k: CertKey): string {
  const [y, m, d] = at.split("-").map(Number)
  const total = m - 1 + CERTS[k].months
  const yy = y + Math.floor(total / 12)
  const mm = (total % 12) + 1
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`
}

export type ScheduleBlock = "no_course" | "no_date" | "past" | "bad_seats" | "no_one" | "over_seats"

/** Form 28 — a session needs a day not in the past, seats, and at least one participant within them. */
export function scheduleBlocks(input: { course: string; at: string | null; seats: number; ppl: readonly string[] }, today: string): ScheduleBlock[] {
  const out: ScheduleBlock[] = []
  if (!courseOf(input.course)) out.push("no_course")
  if (!input.at) out.push("no_date")
  else if (input.at < today) out.push("past")
  if (!(Number.isInteger(input.seats) && input.seats >= 1)) out.push("bad_seats")
  if (!input.ppl.length) out.push("no_one")
  else if (input.seats >= 1 && input.ppl.length > input.seats) out.push("over_seats")
  return out
}

export type ResultBlock = "not_planned" | "not_yet" | "no_one"

/** Form 28 — the result is recorded on or after the day, once, with at least one attendee. */
export function resultBlocks(s: Pick<TrainingSession, "state" | "at" | "ppl">, absent: readonly string[], today: string): ResultBlock[] {
  const out: ResultBlock[] = []
  if (s.state !== "plan") out.push("not_planned")
  if (s.at > today) out.push("not_yet")
  if (!s.ppl.some((id) => !absent.includes(id))) out.push("no_one")
  return out
}

/** The pool a session draws from (form 28): a certificate course takes the gaps for that certificate not already
 * booked (one workplace or all), worst first; a skills course takes the people reviews named for it. */
export function sessionPool(
  course: Course,
  w: { gaps: readonly CertGap[]; sessions: readonly TrainingSession[]; needs: ReadonlyArray<{ employeeId: string; need?: string | null }>; byId: (id: string) => GapPerson | undefined; today: string; siteId?: string | null }
): string[] {
  if (!course.cert) return courseNeeds(w.needs, w.sessions, course.id)
  const k = course.cert
  const gaps = w.gaps.filter((g) => g.cert === k && (!w.siteId || g.siteId === w.siteId) && !inSession(w.sessions, g.employeeId, k))
  return sortGaps(gaps, w.byId, w.today).map((g) => g.employeeId)
}

// ---------------------------------------------------------------------------
// The cost to Finance (WF-20 step 6): an external course's attendees × its price, charged to their workplaces
// ---------------------------------------------------------------------------

export const trainingEventKey = (sessionId: string) => `hr:TRN:${sessionId}`

export interface TrainingCostLine {
  costKind: CostKind
  projectId: string | null
  amount: number
}

/** The payment request's amount and how it splits over the attendees' workplaces (cost kind, project). */
export function trainingCost(course: Course, attendeeSites: ReadonlyArray<string | null>, sites: readonly Pick<HrSite, "id" | "type" | "projectId">[]): { amount: number; lines: TrainingCostLine[] } {
  if (course.kind !== "external" || !course.cost || !attendeeSites.length) return { amount: 0, lines: [] }
  const by = new Map<string, TrainingCostLine>()
  for (const siteId of attendeeSites) {
    const site = siteId ? sites.find((s) => s.id === siteId) : null
    const costKind = costKindOf(site?.type ?? UNASSIGNED_SITE)
    const projectId = site?.type === "project" ? (site.projectId ?? null) : null
    const key = `${costKind}|${projectId ?? ""}`
    const line = by.get(key) ?? { costKind, projectId, amount: 0 }
    line.amount = r2(line.amount + course.cost)
    by.set(key, line)
  }
  const lines = [...by.values()]
  return { amount: r2(lines.reduce((a, l) => a + l.amount, 0)), lines }
}

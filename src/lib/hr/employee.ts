// HR 1.0 — the employee, the backbone (PRD EM-01…06, DC-01…05, AS-01…03,
// ES-01). Everything about a person is on the card and computed; blanks stay
// blank and show as not recorded. Pay lives apart (`employeePay`) so that the
// people who may not see it never receive it (RL-03). The number is permanent:
// it never changes and is never reused — the device user number and the
// payroll key; the ID/iqama number keys the Mudad and GOSI rows. Pure: no I/O.

import { cleanIban, driveDocOf, IBAN_RE, legalOnSite, mayDrive, passportFirst, type DocDates, type DocType } from "./documents"
import { accruedDays } from "./leave"
import type { HrContext } from "./access"
import type { PayStep } from "./pay"
import { addDays, daysBetween, STATUTORY } from "./statutory"
import { NITAQAT_MIN_BASIC, tradeOf } from "./trades"
import { UNASSIGNED_SITE, type SiteType } from "./sites"

export const EMPLOYEE_STATUSES = ["expected", "active", "leave", "leaving", "left"] as const
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]

export const HIRE_SOURCES = ["local", "transfer", "visa"] as const
export type HireSource = (typeof HIRE_SOURCES)[number]

export interface Probation {
  /** The last day of probation. */
  end: string
  /** Extended with the worker's written consent (art. 53) — the day he signed. */
  consentOn?: string | null
  decision?: "confirmed" | "ended" | null
  decidedOn?: string | null
}

export const PROBATION_RECOMMENDS = ["confirm", "extend", "end"] as const
export type ProbationRecommend = (typeof PROBATION_RECOMMENDS)[number]

/** The line manager's probation view (EM-05; the prototype's `pe`): 3 meets · 2 partly · 1 does not. */
export interface ProbationView {
  by: string
  byName: string | null
  at: string
  rating: 1 | 2 | 3
  recommend: ProbationRecommend
  note: string | null
}

/** A move dated ahead (AS-03): the record keeps its place until the day, then takes this one. */
export interface ScheduledMove {
  to: string | null
  on: string
  by: string
  byName: string | null
  at: string
  /** The manpower request it answers (AS-02), when named. */
  mr?: string | null
}

export interface HrEmployee {
  id: string
  organizationId: string
  /** Permanent employee number (EM-02). */
  no: number
  names: { ar: string; en?: string | null }
  nationality: string
  gender: "m" | "f"
  /** National ID or iqama number — keys the Mudad and GOSI rows. */
  idNo?: string | null
  trade: string
  category: "labour" | "staff"
  siteId: string | null
  /** The day he took his current place (AS-04: "unassigned since"). */
  siteSince?: string | null
  /** A move that takes effect on a later day. */
  move?: ScheduledMove | null
  /** The line manager set by the HR manager (RL-04) — else derived (`lineManagerChain`). */
  managerId?: string | null
  /** The platform user who is this employee — gives him "My file". */
  userId?: string | null
  join: string
  /** Imported staff enter payroll from this month (PY-10). */
  since?: string | null
  source: HireSource
  contract: { type: "open" | "fixed"; end?: string | null }
  probation: Probation
  /** EM-05 — the line manager's view before the probation decision: shown to the HR manager, never blocking.
   * Its own field (not inside `probation`) so the rules can let the line manager write it and nothing else. */
  probationView?: ProbationView | null
  status: EmployeeStatus
  /** Set when the exit starts (EX-01): payroll stops the month it falls in — the settlement pays that month (EX-05). */
  lastDay?: string | null
  docs: DocDates
  /** Annual leave days taken since joining (opening balance adjusts accrual). */
  leaveTaken: number
  openingLeave?: number
  /** IM-04 — the opening balance entered once from the card: the leave days as of that day, who and when (no amount here). */
  opening?: { leave: number; at: string; by: string; byName: string | null } | null
  /** Sick days used in the current service year, and which year. */
  sick?: { year: number; days: number } | null
  hajjTaken?: boolean
  /** Highest qualification (EM-01). */
  education?: string | null
  /** Contact details — changed only by an approved data-update request (ES-03). */
  contact?: { mobile?: string | null; address?: string | null; emergency?: string | null } | null
}

export interface EmployeePay {
  employeeId: string
  organizationId: string
  basic: number
  housing: number
  transport: number
  iban?: string | null
  /** SAMA bank code (`SA_BANKS`) — derived from the IBAN when not recorded. */
  bank?: string | null
  /** ok · returned (a transfer bounced) · fixed (payroll fixed it, HR approves) · approved. */
  ibanState?: "ok" | "returned" | "fixed" | null
  advance?: { amount: number; balance: number; instalment: number } | null
  /** Retro differences waiting for the supplementary payroll (EM-04); `id` names the item the supplementary paid. */
  retro?: Array<{ id?: string; month: string; amount: number; reason: string }>
  /** The pay's history (EM-04): each decision from its effective day. The top-level figures are the pay in
   * force when last written — read the pay of a day or a month through `payOn` / `paySegments`. */
  steps?: Array<PayStep & PayStepMeta> | null
  /** Commission Sales approved, by the month it is paid with (PY-01) — the record stays; a payroll names what it paid. */
  commissions?: Array<{ id: string; month: string; amount: number; reason: string; at: string; by: string }>
}

/** What a pay step records beside its figures (the prototype's `changes[]`): the kind, why, by whom — the pay
 * history on the file reads it; the log names the change without the amount (RL-03). */
export interface PayStepMeta {
  kind?: "raise" | "promotion" | "correction" | null
  reason?: string | null
  byName?: string | null
}

export const displayName =(e: Pick<HrEmployee, "names">, locale: string) => (locale === "ar" ? e.names.ar : e.names.en || e.names.ar) || "—"

/** EM-05 — probation ends 90 days after joining. */
export const probationEnd = (join: string) => addDays(join, STATUTORY.probation.days - 1)
/** …and can be extended to at most 180 days. */
export const probationMaxEnd = (join: string) => addDays(join, STATUTORY.probation.maxDays - 1)

export const onProbation = (e: Pick<HrEmployee, "probation">, today: string) => !e.probation.decision && today <= e.probation.end

/** EM-05 (art. 53) — where a probation stands: decided, running, or past its end with no
 * decision — then it is over and the contract simply continues ("lapsed"): an imported
 * worker of ten years has no probation to decide. */
export function probationState(e: Pick<HrEmployee, "probation">, today: string): "on" | "lapsed" | "confirmed" | "ended" {
  if (e.probation?.decision) return e.probation.decision
  return e.probation?.end && today > e.probation.end ? "lapsed" : "on"
}

/** The employee's state as of a day: "expected" ends on the join day — from then he is at work
 * (WF-03 step 4: attendance from the start day), whether or not anyone has recorded it yet. */
export function statusOn(e: Pick<HrEmployee, "status" | "join">, today: string): EmployeeStatus {
  const s = e.status ?? "active"
  return s === "expected" && e.join && e.join <= today ? "active" : s
}

// ---------------------------------------------------------------------------
// New employee (EM-03)
// ---------------------------------------------------------------------------

export interface NewEmployeeInput {
  source: HireSource
  nameAr: string
  nameEn?: string | null
  nationality: string
  gender: "m" | "f"
  idNo?: string | null
  trade: string
  siteId: string | null
  join: string
  contractType: "open" | "fixed"
  contractEnd?: string | null
  basic?: number | null
  docs: DocDates
  iban?: string | null
  education?: string | null
}

export type NewEmployeeBlock = "no_name" | "no_name_en" | "bad_id" | "bad_iban" | "no_trade" | "no_join" | "no_visas" | "saudi_only" | "iqama_expired_site" | "fixed_needs_end" | "bad_basic"

/** A national ID starts with 1, an iqama with 2 — ten digits either way (Mudad and GOSI key on it). */
export const idNoValid = (idNo: string, nationality: string) => (nationality === "sa" ? /^1\d{9}$/ : /^2\d{9}$/).test(idNo.trim())
export type NewEmployeeWarning = "saudi_below_nitaqat" | "no_basic"

/** `form`: the New employee form's own checks (EM-03, the prototype's `ok0`) — the passport-English name the WPS
 * row carries, and the ID's shape. An import keeps its own notes (a blank stays blank there). */
export function newEmployeeBlocks(input: NewEmployeeInput, ctx: { visas: number | null; today: string; form?: boolean }): { blocks: NewEmployeeBlock[]; warnings: NewEmployeeWarning[] } {
  const blocks: NewEmployeeBlock[] = []
  const warnings: NewEmployeeWarning[] = []
  const trade = tradeOf(input.trade)
  if (!input.nameAr.trim()) blocks.push("no_name")
  if (ctx.form && !input.nameEn?.trim()) blocks.push("no_name_en")
  if (ctx.form && input.idNo?.trim() && !idNoValid(input.idNo, input.nationality)) blocks.push("bad_id")
  if (input.iban?.trim() && !IBAN_RE.test(cleanIban(input.iban))) blocks.push("bad_iban")
  if (!trade) blocks.push("no_trade")
  if (!input.join) blocks.push("no_join")
  // A new visa arrival needs a visa in the establishment file.
  if (input.source === "visa" && (ctx.visas ?? 0) <= 0) blocks.push("no_visas")
  if (trade?.saudiOnly && input.nationality !== "sa") blocks.push("saudi_only")
  if (input.siteId && input.siteId !== UNASSIGNED_SITE && !legalOnSite({ nationality: input.nationality, docs: input.docs, source: input.source, join: input.join }, ctx.today)) blocks.push("iqama_expired_site")
  if (input.contractType === "fixed" && !input.contractEnd) blocks.push("fixed_needs_end")
  if (input.basic != null && !(input.basic > 0)) blocks.push("bad_basic")
  if (input.basic == null) warnings.push("no_basic")
  if (input.nationality === "sa" && input.basic != null && input.basic > 0 && input.basic < NITAQAT_MIN_BASIC) warnings.push("saudi_below_nitaqat")
  return { blocks, warnings }
}

// ---------------------------------------------------------------------------
// Assignment and move (AS-01, AS-03, DC-02)
// ---------------------------------------------------------------------------

export type AssignBlock = "iqama_expired" | "licence_expired" | "same_place" | "left" | "no_date"

/** Places where a driver drives (DC-06; the prototype's fleet / project / warehouse). */
export const DRIVING_PLACES: readonly SiteType[] = ["project", "fleet", "warehouse"]

/** An expired iqama cannot be assigned or moved to a site — only to unassigned. A driver (or forklift operator)
 * whose licence has expired is not moved to driving work (DC-06) — checked on the day the move takes effect. */
export function assignBlocks(
  emp: Pick<HrEmployee, "nationality" | "docs" | "siteId" | "status"> & Partial<Pick<HrEmployee, "source" | "join" | "trade">>,
  to: string | null,
  effectiveOn: string | null,
  today: string,
  target: { type?: SiteType | null } = {}
): AssignBlock[] {
  const out: AssignBlock[] = []
  if (emp.status === "left") out.push("left")
  if (!effectiveOn) out.push("no_date")
  if ((to ?? UNASSIGNED_SITE) === (emp.siteId ?? UNASSIGNED_SITE)) out.push("same_place")
  if (to && to !== UNASSIGNED_SITE && !legalOnSite(emp, today)) out.push("iqama_expired")
  const on = effectiveOn && effectiveOn > today ? effectiveOn : today
  const drives = driveDocOf(emp.trade)
  if (to && to !== UNASSIGNED_SITE && drives && target.type && DRIVING_PLACES.includes(target.type) && !mayDrive({ docs: emp.docs ?? {}, drives }, on)) out.push("licence_expired")
  return out
}

// ---------------------------------------------------------------------------
// Pay change and promotion (EM-04)
// ---------------------------------------------------------------------------

export type PayChangeBlock = "bad_basic" | "no_reason" | "no_date" | "too_old" | "no_change" | "saudi_only"
export type PayChangeWarning = "pay_cut" | "saudi_below_nitaqat"

/** A pay change applies from its effective date; one CLOSED month back at most,
 * paid through the supplementary payroll — a closed month never reopens. A
 * promotion into a trade reserved for Saudis is blocked for a non-Saudi, as at
 * hiring (EM-03). */
export function payChangeBlocks(input: { basic: number; currentBasic: number; effectiveOn: string | null; reason: string; nationality: string; lastClosedMonthStart: string | null; trade?: string | null }): { blocks: PayChangeBlock[]; warnings: PayChangeWarning[] } {
  const blocks: PayChangeBlock[] = []
  const warnings: PayChangeWarning[] = []
  if (input.trade && tradeOf(input.trade)?.saudiOnly && input.nationality !== "sa") blocks.push("saudi_only")
  if (!(input.basic > 0)) blocks.push("bad_basic")
  if (!input.reason.trim()) blocks.push("no_reason")
  if (!input.effectiveOn) blocks.push("no_date")
  else if (input.lastClosedMonthStart && input.effectiveOn < input.lastClosedMonthStart) blocks.push("too_old")
  if (input.basic === input.currentBasic) blocks.push("no_change")
  if (input.basic > 0 && input.basic < input.currentBasic) warnings.push("pay_cut")
  if (input.nationality === "sa" && input.basic > 0 && input.basic < NITAQAT_MIN_BASIC) warnings.push("saudi_below_nitaqat")
  return { blocks, warnings }
}

// ---------------------------------------------------------------------------
// Probation decision (EM-05)
// ---------------------------------------------------------------------------

export type ProbationBlock = "decided" | "over" | "extend_needs_consent" | "extend_too_long" | "extend_not_later"

/** With `today`, a probation past its end is over (art. 53) — nothing is decided on it any more. */
export function probationBlocks(emp: Pick<HrEmployee, "join" | "probation">, decision: "confirm" | "extend" | "end", ext: { to?: string | null; consentOn?: string | null }, today?: string): ProbationBlock[] {
  const out: ProbationBlock[] = []
  if (emp.probation.decision) out.push("decided")
  else if (today && probationState(emp, today) === "lapsed") out.push("over")
  if (decision === "extend") {
    if (!ext.consentOn) out.push("extend_needs_consent")
    if (!ext.to || ext.to > probationMaxEnd(emp.join)) out.push("extend_too_long")
    else if (ext.to <= emp.probation.end) out.push("extend_not_later")
  }
  return out
}

// ---------------------------------------------------------------------------
// Documents — recording a renewal (DC-03)
// ---------------------------------------------------------------------------

export type RenewalBlock = "bad_date" | "passport_first" | "not_later"

export function renewalBlocks(docs: DocDates, type: DocType, newExpiry: string | null, today: string): RenewalBlock[] {
  const out: RenewalBlock[] = []
  if (!newExpiry || daysBetween(today, newExpiry) <= 0) out.push("bad_date")
  else if (docs[type] && newExpiry <= (docs[type] as string)) out.push("not_later")
  // A passport expiring before the iqama is renewed first (blocking).
  if (type === "iqama" && passportFirst(docs, today)) out.push("passport_first")
  return out
}

// ---------------------------------------------------------------------------
// Opening balance from the card (IM-04)
// ---------------------------------------------------------------------------

export type OpeningBlock = "recorded" | "too_recent" | "leave_taken" | "bad_leave" | "above_accrued" | "bad_advance" | "advance_exists"

/** Once, by the HR manager, for someone who joined before the system (over 30 days ago) and has
 * taken no leave here yet: the leave balance today — at most what his service could have accrued —
 * and the advance still outstanding (none already on his pay). */
export function openingBlocks(
  emp: Pick<HrEmployee, "join" | "leaveTaken" | "opening">,
  input: { leave: number; advance: number },
  pay: Pick<EmployeePay, "advance"> | null,
  today: string
): OpeningBlock[] {
  const out: OpeningBlock[] = []
  if (emp.opening) out.push("recorded")
  else if (daysBetween(emp.join, today) <= 30) out.push("too_recent")
  else if ((emp.leaveTaken ?? 0) > 0) out.push("leave_taken")
  if (!(Number.isFinite(input.leave) && input.leave >= 0)) out.push("bad_leave")
  else if (input.leave > Math.floor(accruedDays(emp.join, today))) out.push("above_accrued")
  if (!(Number.isFinite(input.advance) && input.advance >= 0)) out.push("bad_advance")
  else if (input.advance > 0 && (pay?.advance?.balance ?? 0) > 0) out.push("advance_exists")
  return out
}

/** Years of service, for the card (ES-01). */
export const serviceDays = (join: string, today: string) => Math.max(0, daysBetween(join, today))

// ---------------------------------------------------------------------------
// What the file and the list say about a person (the prototype's stPill / nextDue / efAtt)
// ---------------------------------------------------------------------------

/** The ledger account a workplace's labour cost goes to (§11, Finance's four debits). */
export const COST_ACCOUNT: Record<"direct" | "workshop" | "distribution" | "admin", string> = { direct: "510201", workshop: "510701", distribution: "520202", admin: "520101" }

export type TodayState = "present" | "absent" | "sick" | "permission" | "leave" | "unrecorded"

/** His day today on his workplace's sheet: on leave wins; else what the sheet says; else not recorded yet. */
export function todayStateOf(
  empId: string,
  sheet: { listed?: string[]; ex?: Record<string, { status?: string | null }> } | null | undefined,
  onLeave: boolean
): TodayState {
  if (onLeave) return "leave"
  if (!sheet || !(sheet.listed ?? []).includes(empId)) return "unrecorded"
  const s = sheet.ex?.[empId]?.status
  return s === "absent" || s === "sick" || s === "permission" ? s : "present"
}

export type StatusFact = { kind: "leaving"; date: string } | { kind: "leave"; date: string } | { kind: "unassigned"; date: string | null } | { kind: "absent" } | { kind: "sick" }

/** The status pill's fact (the prototype's `stPill`): leaving · last day; on leave until; unassigned since; absent
 * or sick today. Null when there is nothing to add to the status. */
export function statusFact(
  emp: Pick<HrEmployee, "status" | "lastDay" | "siteId" | "siteSince" | "join">,
  ctx: { leaveTo?: string | null; today?: TodayState | null }
): StatusFact | null {
  if (emp.status === "leaving" && emp.lastDay) return { kind: "leaving", date: emp.lastDay }
  if (ctx.leaveTo) return { kind: "leave", date: ctx.leaveTo }
  if (emp.status === "left" || emp.status === "expected") return null
  if (!emp.siteId || emp.siteId === UNASSIGNED_SITE) return { kind: "unassigned", date: emp.siteSince ?? null }
  if (ctx.today === "absent") return { kind: "absent" }
  if (ctx.today === "sick") return { kind: "sick" }
  return null
}

/** The next date that matters (the prototype's `nextDue`): the probation's end while it runs, or the nearest
 * document not yet expired — whichever comes first. */
export function nextDue(emp: Pick<HrEmployee, "probation">, rows: ReadonlyArray<{ type: DocType; expiry: string | null }>, today: string): { what: "probation" | DocType; date: string } | null {
  const items: Array<{ what: "probation" | DocType; date: string }> = []
  if (emp.probation && probationState(emp, today) === "on") items.push({ what: "probation", date: emp.probation.end })
  for (const r of rows) if (r.expiry && r.expiry >= today) items.push({ what: r.type, date: r.expiry })
  items.sort((a, b) => a.date.localeCompare(b.date))
  return items[0] ?? null
}

/** The day annual leave becomes 30 days a year (art. 109: after five years). */
export function thirtyDaysFrom(join: string): string {
  const [y, m, d] = join.split("-").map(Number)
  return `${y + STATUTORY.leave.fiveYears}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/** Where this year's sick days stand in art. 117's bands: full pay · three quarters · unpaid · beyond. */
export function sickBand(days: number): "full" | "threeQuarters" | "unpaid" | "beyond" {
  const S = STATUTORY.sick
  if (days <= S.full) return "full"
  if (days <= S.full + S.threeQuarters) return "threeQuarters"
  if (days <= S.full + S.threeQuarters + S.unpaid) return "unpaid"
  return "beyond"
}

/** Approved leave days inside a month (calendar days), up to `upTo` when given — the month card's «إجازة». */
export function leaveDaysIn(requests: ReadonlyArray<{ kind: string; state: string; leave?: { from: string; to: string } | null }>, month: string, upTo?: string | null): number {
  const start = `${month}-01`
  const end = addDays(addDays(`${month}-28`, 4).slice(0, 7) + "-01", -1)
  const last = upTo && upTo < end ? upTo : end
  let n = 0
  for (const r of requests) {
    if (r.kind !== "leave" || r.state !== "approved" || !r.leave) continue
    const from = r.leave.from > start ? r.leave.from : start
    const to = r.leave.to < last ? r.leave.to : last
    if (to >= from) n += daysBetween(from, to) + 1
  }
  return n
}

// ---------------------------------------------------------------------------
// The line manager (RL-04; the prototype's `mgrOf` / `siteHead`)
// ---------------------------------------------------------------------------

type Person = Pick<HrEmployee, "id" | "siteId" | "category" | "trade" | "status" | "join"> & Partial<Pick<HrEmployee, "managerId">>

export type LineManagerVia = "explicit" | "supervisor" | "foreman" | "senior" | "management"

/** Someone who can manage: at work or leaving, never a recruit not yet arrived, never gone. */
const canManage = (x: Pick<HrEmployee, "status"> | null | undefined): x is Pick<HrEmployee, "status"> => Boolean(x && x.status !== "left" && x.status !== "expected")

/** The senior staff member of a place — by the trade's reference wage (never a person's pay: RL-03), then the
 * earliest joiner. */
function seniorOf<P extends Person>(people: readonly P[]): P | null {
  return [...people].sort((a, b) => (tradeOf(b.trade)?.ref ?? 0) - (tradeOf(a.trade)?.ref ?? 0) || a.join.localeCompare(b.join))[0] ?? null
}

/** Who a person answers to: the one the HR manager set; else, for labour, the workplace's supervisor or a foreman
 * there; else the senior staff member of the place (not himself); else management. The HR manager's own line
 * manager is management. `derived` marks every answer but the one set on the card. */
export function lineManagerChain(
  emp: Person,
  ctx: { employees: readonly Person[]; supervisorOf: (siteId: string) => string | null; isHrManager?: boolean }
): { id: string | null; via: LineManagerVia; derived: boolean } {
  const management = { id: null, via: "management" as const, derived: true }
  if (ctx.isHrManager) return management
  const find = (id: string | null | undefined) => (id ? (ctx.employees.find((x) => x.id === id) ?? null) : null)
  const set = find(emp.managerId)
  if (set && set.id !== emp.id && canManage(set)) return { id: set.id, via: "explicit", derived: false }
  const site = emp.siteId && emp.siteId !== UNASSIGNED_SITE ? emp.siteId : null
  if (!site) return management
  const here = ctx.employees.filter((x) => x.siteId === site && canManage(x))
  if (emp.category === "labour") {
    const sup = find(ctx.supervisorOf(site))
    if (sup && sup.id !== emp.id && canManage(sup)) return { id: sup.id, via: "supervisor", derived: true }
    const foreman = here.filter((x) => x.trade === "foreman" && x.id !== emp.id).sort((a, b) => a.join.localeCompare(b.join))[0]
    if (foreman) return { id: foreman.id, via: "foreman", derived: true }
  }
  // The head of the place among its staff — if that is the person himself, he answers to management.
  const head = seniorOf(here.filter((x) => x.category === "staff").concat(emp.category === "staff" && !here.some((x) => x.id === emp.id) ? [emp] : []))
  if (head && head.id !== emp.id) return { id: head.id, via: "senior", derived: true }
  return management
}

/** The people the HR manager may name (the prototype's `mgr` form): staff at work, never himself — the same
 * workplace first. */
export function lineManagerOptions<P extends Person>(emp: Person, employees: readonly P[]): P[] {
  const pool = employees.filter((x) => x.id !== emp.id && x.category === "staff" && canManage(x))
  const same = (x: P) => (emp.siteId && x.siteId === emp.siteId ? 0 : 1)
  return pool.sort((a, b) => same(a) - same(b) || (tradeOf(b.trade)?.ref ?? 0) - (tradeOf(a.trade)?.ref ?? 0))
}

export type LineManagerBlock = "left" | "self" | "not_active" | "same" | "circular"

/** Setting the line manager (RL-04): never himself, never someone gone or not yet arrived, never someone who
 * answers to him (a circle); `null` clears it — he is derived again. */
export function lineManagerBlocks(emp: Person, managerId: string | null, employees: readonly Person[]): LineManagerBlock[] {
  const out: LineManagerBlock[] = []
  if (emp.status === "left") out.push("left")
  if ((managerId ?? null) === (emp.managerId ?? null)) out.push("same")
  if (!managerId) return out
  if (managerId === emp.id) out.push("self")
  const m = employees.find((x) => x.id === managerId)
  if (!canManage(m)) out.push("not_active")
  else if ((m as Person).managerId === emp.id) out.push("circular")
  return out
}

// ---------------------------------------------------------------------------
// The line manager's probation view (EM-05) — attached, never blocking
// ---------------------------------------------------------------------------

export type ProbationViewBlock = "not_on" | "no_rating" | "no_recommend"

export function probationViewBlocks(emp: Pick<HrEmployee, "probation">, input: { rating: number | null; recommend: ProbationRecommend | null }, today: string): ProbationViewBlock[] {
  const out: ProbationViewBlock[] = []
  if (!emp.probation || probationState(emp, today) !== "on") out.push("not_on")
  if (input.rating !== 1 && input.rating !== 2 && input.rating !== 3) out.push("no_rating")
  if (!input.recommend || !PROBATION_RECOMMENDS.includes(input.recommend)) out.push("no_recommend")
  return out
}

// ---------------------------------------------------------------------------
// A fixed-term contract's end (EX-01; the prototype's `ct` form): renew, or let it end
// ---------------------------------------------------------------------------

export type ContractBlock = "not_fixed" | "left" | "no_date" | "not_later"

/** Renewed "for a like period" — the prototype's two years. */
export const contractRenewalDefault = (end: string) => addDays(end, 730)

export function contractBlocks(emp: Pick<HrEmployee, "contract" | "status">, decision: "renew" | "end", until: string | null): ContractBlock[] {
  const out: ContractBlock[] = []
  if (emp.contract?.type !== "fixed" || !emp.contract.end) out.push("not_fixed")
  if (emp.status === "left" || emp.status === "leaving") out.push("left")
  if (decision === "renew") {
    if (!until) out.push("no_date")
    else if (emp.contract?.end && until <= emp.contract.end) out.push("not_later")
  }
  return out
}

// ---------------------------------------------------------------------------
// A raise request (EM-04): asked, then decided as a pay change
// ---------------------------------------------------------------------------

export const PAY_CHANGE_KINDS = ["raise", "promotion", "correction"] as const
export type PayChangeKind = (typeof PAY_CHANGE_KINDS)[number]

/** What a raise request asks — the new basic from a day, and why (a line manager's recommendation is named in it). */
export interface RaiseFields {
  basic: number
  kind: PayChangeKind
  effectiveOn: string
  reason: string
  trade?: string | null
}

export type RaiseBlock = "bad_basic" | "no_reason" | "no_date" | "no_change" | "saudi_only"

export function raiseRequestBlocks(input: RaiseFields, ctx: { currentBasic?: number | null; nationality: string }): RaiseBlock[] {
  const out: RaiseBlock[] = []
  if (!(input.basic > 0)) out.push("bad_basic")
  if (!input.reason?.trim()) out.push("no_reason")
  if (!input.effectiveOn) out.push("no_date")
  if (ctx.currentBasic != null && input.basic === ctx.currentBasic && input.kind !== "promotion") out.push("no_change")
  if (input.kind === "promotion" && tradeOf(input.trade)?.saudiOnly && ctx.nationality !== "sa") out.push("saudi_only")
  return out
}

/** Who changes a person's pay (EM-04, RL-02): the HR manager — never his own; the HR manager's own pay is
 * management's (the prototype's «يعتمده المدير العام»). The owner, who answers to nobody, may change any. */
export function payChangeRefusal(ctx: Pick<HrContext, "owner" | "roles">, target: { own: boolean; isHrManager: boolean }): "own_request" | "no_role" | null {
  if (ctx.owner) return null
  if (target.own) return "own_request"
  if (ctx.roles.has("manager")) return null
  return ctx.roles.has("management") && target.isHrManager ? null : "no_role"
}

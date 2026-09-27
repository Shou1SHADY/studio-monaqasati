// HR 1.0 — the employee, the backbone (PRD EM-01…06, DC-01…05, AS-01…03,
// ES-01). Everything about a person is on the card and computed; blanks stay
// blank and show as not recorded. Pay lives apart (`employeePay`) so that the
// people who may not see it never receive it (RL-03). The number is permanent:
// it never changes and is never reused — the device user number and the
// payroll key; the ID/iqama number keys the Mudad and GOSI rows. Pure: no I/O.

import { legalOnSite, passportFirst, type DocDates, type DocType } from "./documents"
import { addDays, daysBetween, STATUTORY } from "./statutory"
import { NITAQAT_MIN_BASIC, tradeOf } from "./trades"
import { UNASSIGNED_SITE } from "./sites"

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
  managerId?: string | null
  /** The platform user who is this employee — gives him "My file". */
  userId?: string | null
  join: string
  /** Imported staff enter payroll from this month (PY-10). */
  since?: string | null
  source: HireSource
  contract: { type: "open" | "fixed"; end?: string | null }
  probation: Probation
  status: EmployeeStatus
  /** Set when the exit starts (EX-01): payroll stops the month it falls in — the settlement pays that month (EX-05). */
  lastDay?: string | null
  docs: DocDates
  /** Annual leave days taken since joining (opening balance adjusts accrual). */
  leaveTaken: number
  openingLeave?: number
  /** Sick days used in the current service year, and which year. */
  sick?: { year: number; days: number } | null
  hajjTaken?: boolean
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
  /** ok · returned (a transfer bounced) · fixed (payroll fixed it, HR approves) · approved. */
  ibanState?: "ok" | "returned" | "fixed" | null
  advance?: { amount: number; balance: number; instalment: number } | null
  /** Retro differences waiting for the supplementary payroll (EM-04). */
  retro?: Array<{ month: string; amount: number; reason: string }>
}

export const displayName = (e: Pick<HrEmployee, "names">, locale: string) => (locale === "ar" ? e.names.ar : e.names.en || e.names.ar) || "—"

/** EM-05 — probation ends 90 days after joining. */
export const probationEnd = (join: string) => addDays(join, STATUTORY.probation.days - 1)
/** …and can be extended to at most 180 days. */
export const probationMaxEnd = (join: string) => addDays(join, STATUTORY.probation.maxDays - 1)

export const onProbation = (e: Pick<HrEmployee, "probation">, today: string) => !e.probation.decision && today <= e.probation.end

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
}

export type NewEmployeeBlock = "no_name" | "no_trade" | "no_join" | "no_visas" | "saudi_only" | "iqama_expired_site" | "fixed_needs_end" | "bad_basic"
export type NewEmployeeWarning = "saudi_below_nitaqat" | "no_basic"

export function newEmployeeBlocks(input: NewEmployeeInput, ctx: { visas: number | null; today: string }): { blocks: NewEmployeeBlock[]; warnings: NewEmployeeWarning[] } {
  const blocks: NewEmployeeBlock[] = []
  const warnings: NewEmployeeWarning[] = []
  const trade = tradeOf(input.trade)
  if (!input.nameAr.trim()) blocks.push("no_name")
  if (!trade) blocks.push("no_trade")
  if (!input.join) blocks.push("no_join")
  // A new visa arrival needs a visa in the establishment file.
  if (input.source === "visa" && (ctx.visas ?? 0) <= 0) blocks.push("no_visas")
  if (trade?.saudiOnly && input.nationality !== "sa") blocks.push("saudi_only")
  if (input.siteId && input.siteId !== UNASSIGNED_SITE && !legalOnSite({ nationality: input.nationality, docs: input.docs }, ctx.today)) blocks.push("iqama_expired_site")
  if (input.contractType === "fixed" && !input.contractEnd) blocks.push("fixed_needs_end")
  if (input.basic != null && !(input.basic > 0)) blocks.push("bad_basic")
  if (input.basic == null) warnings.push("no_basic")
  if (input.nationality === "sa" && input.basic != null && input.basic > 0 && input.basic < NITAQAT_MIN_BASIC) warnings.push("saudi_below_nitaqat")
  return { blocks, warnings }
}

// ---------------------------------------------------------------------------
// Assignment and move (AS-01, AS-03, DC-02)
// ---------------------------------------------------------------------------

export type AssignBlock = "iqama_expired" | "same_place" | "left" | "no_date"

/** An expired iqama cannot be assigned or moved to a site — only to unassigned. */
export function assignBlocks(emp: Pick<HrEmployee, "nationality" | "docs" | "siteId" | "status">, to: string | null, effectiveOn: string | null, today: string): AssignBlock[] {
  const out: AssignBlock[] = []
  if (emp.status === "left") out.push("left")
  if (!effectiveOn) out.push("no_date")
  if ((to ?? UNASSIGNED_SITE) === (emp.siteId ?? UNASSIGNED_SITE)) out.push("same_place")
  if (to && to !== UNASSIGNED_SITE && !legalOnSite(emp, today)) out.push("iqama_expired")
  return out
}

// ---------------------------------------------------------------------------
// Pay change and promotion (EM-04)
// ---------------------------------------------------------------------------

export type PayChangeBlock = "bad_basic" | "no_reason" | "no_date" | "too_old" | "no_change"
export type PayChangeWarning = "pay_cut" | "saudi_below_nitaqat"

/** A pay change applies from its effective date; one CLOSED month back at most,
 * paid through the supplementary payroll — a closed month never reopens. */
export function payChangeBlocks(input: { basic: number; currentBasic: number; effectiveOn: string | null; reason: string; nationality: string; lastClosedMonthStart: string | null }): { blocks: PayChangeBlock[]; warnings: PayChangeWarning[] } {
  const blocks: PayChangeBlock[] = []
  const warnings: PayChangeWarning[] = []
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

export type ProbationBlock = "decided" | "extend_needs_consent" | "extend_too_long" | "extend_not_later"

export function probationBlocks(emp: Pick<HrEmployee, "join" | "probation">, decision: "confirm" | "extend" | "end", ext: { to?: string | null; consentOn?: string | null }): ProbationBlock[] {
  const out: ProbationBlock[] = []
  if (emp.probation.decision) out.push("decided")
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

/** Years of service, for the card (ES-01). */
export const serviceDays = (join: string, today: string) => Math.max(0, daysBetween(join, today))

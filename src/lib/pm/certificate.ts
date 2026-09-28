// PM 1.0 — the owner certificate (PRD IPC-01…05, RET-01, §8.6, WF-05,
// INV-02…04). Built from approved executed work not yet billed — never more,
// never zero. The formula (§8.6), the same in the form, the certification and
// the save:
//   G         = chosen unbilled + consultant deductions returned to unbilled
//   recovery  = G × advance rate               (never past the advance left)
//   retention = min(G × rate, cap × contract − already held)   — a rate above
//               the cap is allowed (10% up to 5% is the common FIDIC form)
//   VAT       = (G − recovery) × 15%
//   net       = G − recovery − retention + VAT
// The QS prepares; someone else approves internally (a small firm records an
// explicit self-approval); the consultant certifies in full or with a
// deduction — everything recomputes on the certified amount, the deduction
// returns to unbilled, and Finance hears the certified amount once. A
// certificate keeps the terms it was prepared under: a later addendum never
// recomputes it (AMD-04). Pure: no I/O.

import type { PmEvent } from "./events"
import type { ContractTerms } from "./terms"

/** `projects/{id}/pmCertificates/{NN}`, numbered by the project's `pm.ipcCount`. */
export const PM_CERTIFICATES = "pmCertificates"

/** VAT is a company setting, never a contract term (§13, NFR-11). */
export const PM_VAT = 0.15

/** Unbilled above this is a red "certificate ready" decision (§12, §13). */
export const CERTIFICATE_READY_AT = 40_000

/** int = prepared, awaiting internal approval · sub = with the consultant ·
 * appr = certified (Finance told) · part / paid are read from Finance. `void` =
 * withdrawn before submission; its billing is undone. */
export const CERTIFICATE_STATUSES = ["int", "sub", "appr", "part", "paid", "void"] as const
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number]

const r2 = (n: number) => Math.round(n * 100) / 100

export const certificateNo = (seq: number) => String(seq).padStart(2, "0")

/** The terms a certificate is prepared under — kept with it. */
export type CertificateTerms = Pick<ContractTerms, "payer" | "advance" | "advanceRecovery" | "retention" | "retentionCap" | "paymentDays" | "consultantDays">

export const termsSnapshot = (t: ContractTerms): CertificateTerms => ({
  payer: t.payer,
  advance: t.advance,
  advanceRecovery: t.advanceRecovery,
  retention: t.retention,
  retentionCap: t.retentionCap,
  paymentDays: t.paymentDays,
  consultantDays: t.consultantDays,
})

export interface CertificateLine {
  itemId: string
  code?: string | null
  /** Unbilled quantity billed by this certificate. */
  qty: number
  rate: number
  amount: number
}

export interface Amounts {
  gross: number
  recovery: number
  retention: number
  vat: number
  net: number
}

/** §8.6. `held` is the retention on every OTHER live certificate; `recovered`
 * the advance recovered on them. The cap is applied, and a rate above it is fine. */
export function certificateAmounts(input: { gross: number; terms: Pick<CertificateTerms, "advance" | "retention" | "retentionCap">; contractValue: number; held: number; recovered: number }): Amounts {
  const gross = r2(Math.max(0, input.gross))
  const advanceTotal = input.contractValue * input.terms.advance
  const recovery = r2(Math.max(0, Math.min(gross * input.terms.advance, advanceTotal - input.recovered)))
  const retention = r2(Math.max(0, Math.min(gross * input.terms.retention, input.terms.retentionCap * input.contractValue - input.held)))
  const vat = r2((gross - recovery) * PM_VAT)
  return { gross, recovery, retention, vat, net: r2(gross - recovery - retention + vat) }
}

/** A BOQ line as billing reads it. */
export interface BillableItem {
  id: string
  code?: string | null
  rate: number
  executed: number
  billed: number
}

/** Unbilled quantity of an item: approved executed − billed. Unpriced = nothing to bill (CON-02). */
export const unbilledQty = (i: Pick<BillableItem, "executed" | "billed">) => r2(Math.max(0, i.executed - i.billed))
export const unbilledValue = (i: BillableItem) => (i.rate > 0 ? r2(unbilledQty(i) * i.rate) : 0)

/** The lines a certificate bills: every chosen priced item's whole unbilled quantity. */
export function certificateLines(items: BillableItem[], chosen: ReadonlySet<string>): CertificateLine[] {
  return items
    .filter((i) => chosen.has(i.id) && unbilledValue(i) > 0)
    .map((i) => ({ itemId: i.id, code: i.code ?? null, qty: unbilledQty(i), rate: i.rate, amount: unbilledValue(i) }))
}

export type PrepareBlock = "archived" | "not_started" | "no_client" | "zero"

/** What stops preparing a certificate. "Nobody pays" has no certificates (TRM-01);
 * a zero certificate is never saved (IPC-01). */
export function prepareBlocks(input: { archived: boolean; lifecycle: string; payer: string; gross: number }): PrepareBlock[] {
  const out: PrepareBlock[] = []
  if (input.archived) out.push("archived")
  else if (input.lifecycle === "plan") out.push("not_started")
  if (input.payer === "none") out.push("no_client")
  if (!(input.gross > 0)) out.push("zero")
  return out
}

export type CertifyBlock = "not_submitted" | "bad_amount" | "over_gross" | "cut_reason"

/** Why the consultant cut (prototype CUTR) — the reason decides the follow-up:
 * quantities are re-measured, an uninspected item gets its inspection, a
 * variation rate is negotiated. Stored as the code, shown translated. */
export const CUT_REASONS = ["qty", "wir", "rate", "oth"] as const
export type CutReason = (typeof CUT_REASONS)[number]
export const isCutReason = (r: unknown): r is CutReason => (CUT_REASONS as readonly unknown[]).includes(r)

/** The consultant certifies the submitted gross, or less — never more; a
 * deduction states one of the four reasons. */
export function certifyBlocks(input: { status: CertificateStatus; gross: number; certified: number; reason?: string | null }): CertifyBlock[] {
  const out: CertifyBlock[] = []
  if (input.status !== "sub") out.push("not_submitted")
  if (!(input.certified > 0) || !Number.isFinite(input.certified)) out.push("bad_amount")
  else if (input.certified > input.gross + 0.005) out.push("over_gross")
  else if (input.gross - input.certified > 0.005 && !isCutReason(input.reason)) out.push("cut_reason")
  return out
}

/** Cut certificates whose deduction is still in the unbilled pool — a later
 * certificate that re-claimed deductions takes every earlier cut with it
 * (prototype `!i.cutBack`). */
export function unreclaimedCuts<T extends { seq: number; status: CertificateStatus; cut?: number | null; cutsIncluded?: number | null }>(certs: T[]): T[] {
  return certs.filter((c) => (c.cut ?? 0) > 0 && c.status !== "void" && !certs.some((x) => x.seq > c.seq && x.status !== "void" && (x.cutsIncluded ?? 0) > 0))
}

/** The payment due date: certification + the payment period (§13). */
export function dueDate(certifiedOn: string, paymentDays: number): string {
  const d = new Date(`${certifiedOn}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + paymentDays)
  return d.toISOString().slice(0, 10)
}

/** prj:IPC:<project>:<certificate> — at the CERTIFIED amount, once (IPC-03).
 * The key carries the project because certificate numbers repeat across
 * projects (conflict 5). PM sends no account numbers: Finance posts. */
export function certificateEvent(input: {
  organizationId: string
  projectId: string
  projectNo: string
  seq: number
  amounts: Amounts
  dueOn: string
  by: string
  at: string
}): PmEvent {
  return {
    key: `prj:IPC:${input.projectNo}:${certificateNo(input.seq)}`,
    kind: "IPC",
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectNo: input.projectNo,
    amount: input.amounts.gross,
    params: {
      certificate: certificateNo(input.seq),
      gross: input.amounts.gross,
      recovery: input.amounts.recovery,
      retention: input.amounts.retention,
      vat: input.amounts.vat,
      net: input.amounts.net,
      due: input.dueOn,
    },
    by: input.by,
    at: input.at,
  }
}

// ---------------------------------------------------------------------------
// Approved variations on a certificate (IPC-01: "claimable variations"). Only an
// approved variation enters, for the share executed since it was last billed;
// work on an unapproved one is shown as excluded risk, never billed (VO-03).
// ---------------------------------------------------------------------------

export interface ClaimableVariation {
  id: string
  seq: number
  title: string
  status: string
  value: number
  executedPct: number
  billedPct?: number
}

export interface CertificateVoLine {
  voId: string
  seq: number
  title: string
  value: number
  /** Billed share before and after this certificate (0…1). */
  from: number
  to: number
  amount: number
}

export const voClaimable = <T extends ClaimableVariation>(vos: T[]) => vos.filter((v) => v.status === "appr" && v.value > 0 && v.executedPct > (v.billedPct ?? 0) + 0.000005)

export const voClaimAmount = (v: ClaimableVariation) => r2(v.value * Math.max(0, v.executedPct - (v.billedPct ?? 0)))

export function certificateVoLines(vos: ClaimableVariation[], chosen: ReadonlySet<string>): CertificateVoLine[] {
  return voClaimable(vos)
    .filter((v) => chosen.has(v.id))
    .map((v) => ({ voId: v.id, seq: v.seq, title: v.title, value: v.value, from: v.billedPct ?? 0, to: v.executedPct, amount: voClaimAmount(v) }))
}

/** Work executed on variations nobody approved in writing — kept out of every certificate. */
export const voRisk = (vos: ClaimableVariation[]) => r2(vos.filter((v) => (v.status === "draft" || v.status === "wait") && v.executedPct > 0).reduce((a, v) => a + v.value * v.executedPct, 0))

/** The pre-submission checklist (form 45): a person ticks these, so they never block. */
export const CERTIFICATE_CHECKS = ["sig", "ph", "mat"] as const
export type CertificateCheck = (typeof CERTIFICATE_CHECKS)[number]

// ---------------------------------------------------------------------------
// Period, collection and totals (IPC-04, CST-05). Collection is Finance's
// figure (`collected`, a 0…1 share of the net); the project only reads it.
// ---------------------------------------------------------------------------

export interface CertificateFacts {
  seq: number
  status: CertificateStatus
  gross: number
  net: number
  vat: number
  retention: number
  recovery: number
  prepOn: string
  apprOn?: string | null
  dueOn?: string | null
  collected?: number | null
  periodFrom?: string | null
  periodTo?: string | null
}

const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`)
export const daysBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000)

export const collectedShare = (c: Pick<CertificateFacts, "status" | "collected">) => (c.status === "paid" ? 1 : Math.min(1, Math.max(0, c.collected ?? 0)))

export const collectedAmount = (c: Pick<CertificateFacts, "status" | "collected" | "net">) => r2(c.net * collectedShare(c))

/** Certified by the consultant: the receivable exists (appr → part → paid). */
export const isCertified = (c: Pick<CertificateFacts, "status">) => c.status === "appr" || c.status === "part" || c.status === "paid"

/** Days past the payment due date with money still out — 0 when not late. */
export function lateDays(c: Pick<CertificateFacts, "status" | "collected" | "dueOn">, today: string): number {
  if (!isCertified(c) || !c.dueOn || collectedShare(c) >= 1) return 0
  return Math.max(0, daysBetween(c.dueOn, today))
}

/** Each certificate's period: stored from/to, else from the previous live
 * certificate (or the start) to the day it was prepared. */
export function certificatePeriods(certs: CertificateFacts[], startOn: string | null): Map<number, { from: string | null; to: string }> {
  const out = new Map<number, { from: string | null; to: string }>()
  let prev: string | null = startOn ? startOn.slice(0, 10) : null
  for (const c of certs.slice().sort((a, b) => a.seq - b.seq)) {
    out.set(c.seq, { from: c.periodFrom ?? prev, to: c.periodTo ?? c.prepOn })
    if (c.status !== "void") prev = c.periodTo ?? c.prepOn
  }
  return out
}

export function certificateTotals(certs: CertificateFacts[]): { gross: number; net: number; collected: number } {
  const live = certs.filter((c) => c.status !== "void")
  return {
    gross: r2(live.reduce((a, c) => a + c.gross, 0)),
    net: r2(live.reduce((a, c) => a + c.net, 0)),
    collected: r2(live.reduce((a, c) => a + collectedAmount(c), 0)),
  }
}

export interface CollectionFigures {
  /** Certified and not yet collected. */
  outstanding: number
  overdue: number
  late: Array<{ seq: number; days: number; amount: number }>
  /** Advance received (once the project started) + collected − the VAT in it (not ours). */
  cashIn: number
  advanceTotal: number
  advanceLeft: number
  /** Retention the client holds on certified certificates, until Finance releases it. */
  retentionHeld: number
}

export function collectionFigures(input: {
  certs: CertificateFacts[]
  today: string
  contractValue: number
  advance: number
  started: boolean
  retentionReleased: boolean
  /** Finance received the first half after the provisional handover (a "half" release term). */
  retentionHalfReleased?: boolean
}): CollectionFigures {
  const certified = input.certs.filter(isCertified)
  const outstanding = r2(certified.reduce((a, c) => a + c.net * (1 - collectedShare(c)), 0))
  const late = certified
    .map((c) => ({ seq: c.seq, days: lateDays(c, input.today), amount: r2(c.net * (1 - collectedShare(c))) }))
    .filter((l) => l.days > 0 && l.amount > 0.005)
    .sort((a, b) => b.days - a.days)
  const advanceTotal = r2(input.contractValue * input.advance)
  const recovered = input.certs.filter((c) => c.status !== "void").reduce((a, c) => a + c.recovery, 0)
  const collected = certified.reduce((a, c) => a + collectedAmount(c), 0)
  const vatIn = certified.reduce((a, c) => a + c.vat * collectedShare(c), 0)
  return {
    outstanding,
    overdue: r2(late.reduce((a, l) => a + l.amount, 0)),
    late,
    cashIn: r2((input.started ? advanceTotal : 0) + collected - vatIn),
    advanceTotal,
    advanceLeft: r2(Math.max(0, advanceTotal - recovered)),
    retentionHeld: input.retentionReleased ? 0 : r2(certified.reduce((a, c) => a + c.retention, 0) * (input.retentionHalfReleased ? 0.5 : 1)),
  }
}

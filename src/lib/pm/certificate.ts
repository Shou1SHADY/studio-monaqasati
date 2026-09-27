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

/** The consultant certifies the submitted gross, or less — never more; a
 * deduction states its reason. */
export function certifyBlocks(input: { status: CertificateStatus; gross: number; certified: number; reason?: string | null }): CertifyBlock[] {
  const out: CertifyBlock[] = []
  if (input.status !== "sub") out.push("not_submitted")
  if (!(input.certified > 0) || !Number.isFinite(input.certified)) out.push("bad_amount")
  else if (input.certified > input.gross + 0.005) out.push("over_gross")
  else if (input.gross - input.certified > 0.005 && !input.reason?.trim()) out.push("cut_reason")
  return out
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

// The payment-schedule calculus, on its own — every figure a payments screen
// shows about a quotation's instalments, derived from the quotation document
// and nothing else.
//
// Split out of sales.ts so the MOBILE app can mirror it verbatim: sales.ts
// pulls in manufacturing and the sales-order write layer, which the phone
// neither has nor wants. This file depends only on the CRM types. sales.ts
// re-exports everything here, so web imports are unchanged.

import {
  INSTALLMENT_FULL_ID,
  installmentAmount,
  quotationInstallments,
  type CrmQuotation,
  type QuotationInstallment,
  type QuotationPayment,
  type QuotationPaymentEntry,
} from "./crm"

export interface InstallmentState extends QuotationInstallment {
  amount: number
  /** Running total paid against it — null until the first payment. */
  payment: QuotationPayment | null
  /** The individual payments, oldest first. */
  entries: QuotationPaymentEntry[]
  paid: number
  remaining: number
  /** Fully covered — an installment settles only when its amount is paid. */
  settled: boolean
}

const MONEY_EPSILON = 0.005
const round2 = (n: number) => Math.round(n * 100) / 100

function paymentEntries(p: QuotationPayment | null): QuotationPaymentEntry[] {
  if (!p) return []
  if (p.entries && p.entries.length > 0) return p.entries
  return [{ paidAt: p.paidAt, paidAmount: p.paidAmount, paidByUserId: p.paidByUserId ?? null, paidByUserName: p.paidByUserName ?? null, note: p.note ?? null }]
}

/**
 * Each installment with its computed amount and whatever was paid against it
 * so far. A partial payment leaves a remainder due; the installment settles
 * only when covered. A quotation marked paid before schedules existed reads
 * as its single installment settled, so old records keep their meaning.
 */
export function installmentStates(q: Pick<CrmQuotation, "amount" | "installments" | "payments" | "paidAt" | "paidAmount" | "paidByUserId" | "paidByUserName" | "paymentNote">): InstallmentState[] {
  const payments = q.payments || {}
  return quotationInstallments(q).map((inst) => {
    const amount = installmentAmount(q, inst)
    let payment = payments[inst.id] ?? null
    if (!payment && inst.id === INSTALLMENT_FULL_ID && q.paidAt) {
      payment = {
        paidAt: q.paidAt,
        paidAmount: q.paidAmount ?? amount,
        paidByUserId: q.paidByUserId ?? null,
        paidByUserName: q.paidByUserName ?? null,
        note: q.paymentNote ?? null,
      }
    }
    const paid = round2(Number(payment?.paidAmount) || 0)
    return {
      ...inst,
      amount,
      payment,
      entries: paymentEntries(payment),
      paid,
      remaining: Math.max(0, round2(amount - paid)),
      settled: paid + MONEY_EPSILON >= amount,
    }
  })
}

export function paidSoFar(q: CrmQuotation): number {
  return round2(installmentStates(q).reduce((sum, s) => sum + s.paid, 0))
}

export function isFullyPaid(q: CrmQuotation): boolean {
  if (q.paidAt) return true
  const states = installmentStates(q)
  return states.length > 0 && states.every((s) => s.settled)
}

/** The first installment with money still owed on it. */
export function nextUnpaidInstallment(q: CrmQuotation): InstallmentState | null {
  return installmentStates(q).find((s) => !s.settled) ?? null
}

/** Pure half of `recordInstallmentPayment`: the fields the quotation gets.
 * The entry ADDS to what the installment already received; the quotation is
 * paid only when every installment is fully covered. */
export function applyInstallmentPayment(
  quotation: CrmQuotation,
  installmentId: string,
  entry: QuotationPaymentEntry
): { payments: Record<string, QuotationPayment>; paidAmount: number; paidAt: string | null; allPaid: boolean; installmentSettled: boolean } {
  const states = installmentStates(quotation)
  const payments: Record<string, QuotationPayment> = { ...(quotation.payments || {}) }
  // Carry a pre-schedule "paid" mark into the map so it is not lost.
  for (const s of states) if (s.payment && !payments[s.id]) payments[s.id] = s.payment
  const target = states.find((s) => s.id === installmentId) ?? null
  const entries = [...(target?.entries ?? []), entry]
  const paidOnInstallment = round2(entries.reduce((sum, e) => sum + (Number(e.paidAmount) || 0), 0))
  payments[installmentId] = {
    paidAt: entry.paidAt,
    paidAmount: paidOnInstallment,
    paidByUserId: entry.paidByUserId,
    paidByUserName: entry.paidByUserName,
    note: entry.note,
    entries,
  }
  const installmentSettled = !!target && paidOnInstallment + MONEY_EPSILON >= target.amount
  const allPaid = !!target && states.every((s) => (s.id === installmentId ? installmentSettled : s.settled))
  const paidAmount = round2(Object.values(payments).reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0))
  return { payments, paidAmount, paidAt: allPaid ? entry.paidAt : quotation.paidAt ?? null, allPaid, installmentSettled }
}

export interface InstallmentDue {
  quotation: CrmQuotation
  installment: InstallmentState
  /** Set on "received" rows: the individual payment this row is. */
  entry?: QuotationPaymentEntry
}

/** Every installment of every accepted quotation, split into what customers
 * still owe (oldest quotation first — partially paid ones included, with
 * their remainder) and each payment that came in (latest first). */
export function collectInstallments(quotations: CrmQuotation[]): { due: InstallmentDue[]; received: InstallmentDue[] } {
  const due: InstallmentDue[] = []
  const received: InstallmentDue[] = []
  for (const quotation of quotations) {
    if (quotation.status !== "accepted") continue
    for (const installment of installmentStates(quotation)) {
      if (!installment.settled) due.push({ quotation, installment })
      for (const entry of installment.entries) received.push({ quotation, installment, entry })
    }
  }
  due.sort((a, b) => (a.quotation.date || "").localeCompare(b.quotation.date || ""))
  received.sort((a, b) => (b.entry?.paidAt || "").localeCompare(a.entry?.paidAt || ""))
  return { due, received }
}

// Without Finance in the package (Procurement 1.5, PUR-10, question 5): no ledger in
// Procurement — the company's accounting lives in another system. The order carries an
// OPTIONAL payment status (لم يُدفع · دُفع جزء · دُفع) with its day, and optionally an amount,
// a reference and a copy of the transfer; the supplier reads it on his order; it never stops
// the order from closing. An advance is marked paid with its day, because the supplier's
// date counts from it. The supplier's invoice is a FILE on the order, sent to the
// accountant. Written by the server (/api/procurement/payment-mark). Pure.

import { addDays } from "./po"
import type { PurchaseOrder } from "./types"

export const PAYMENT_STATES = ["unpaid", "part", "paid"] as const
export type PaymentState = (typeof PAYMENT_STATES)[number]

export interface PaymentMark {
  state: PaymentState
  /** `YYYY-MM-DD` — the day it was paid (or marked). */
  day: string
  amount?: number | null
  reference?: string | null
  byName: string
  at: string
}

export interface InvoiceFile {
  name: string
  url: string
  path?: string | null
  /** Uploaded by the buyer, or from the supplier's portal. */
  from: "buyer" | "supplier"
  number?: string | null
  at: string
  sentToAccountantAt?: string | null
}

export interface FinancelessFields {
  paymentMark?: PaymentMark | null
  paymentMarks?: PaymentMark[]
  /** The advance the offer asked for, marked paid on this day. */
  advancePaidDay?: string | null
  invoiceFiles?: InvoiceFile[]
}

export type FinancelessPo = PurchaseOrder & FinancelessFields

export const paymentStateOf = (po: FinancelessFields): PaymentState => po.paymentMark?.state || "unpaid"

/** A mark asks for a day not in the future; «دُفع جزء» names no more than the order. */
export function paymentMarkRefusal(input: { state: PaymentState; day: string; amount?: number | null }, po: Pick<PurchaseOrder, "totalExVat" | "vatRate">, today: string): "day" | "amount" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || input.day > today) return "day"
  const total = Math.round(po.totalExVat * (1 + (po.vatRate || 0)) * 100) / 100
  if (input.amount != null && (input.amount < 0 || input.amount > total + 0.01)) return "amount"
  return null
}

/** The supplier's date when an advance gates it: the day the advance was paid + his lead time. */
export function datedFromAdvance(advancePaidDay: string | null | undefined, leadDays: number | null | undefined): string | null {
  if (!advancePaidDay || !(Number(leadDays) > 0)) return null
  return addDays(advancePaidDay, Number(leadDays))
}

/** «بانتظار دفعة مقدّمة» — orders whose supplier's clock waits for an advance not marked paid. */
export const awaitsAdvance = (po: FinancelessPo & { advancePercent?: number | null }): boolean =>
  (po.status === "approved" || po.status === "sent" || po.status === "accepted") && Number(po.advancePercent) > 0 && !po.advancePaidDay

// The receipt voucher (سند قبض, 11 Oct 2026): every payment Sales records from a client — typed in, or a reported
// transfer Finance confirmed — gets a yearly number drawn in the same transaction that records it, so a number is
// never skipped or used twice. A sales-only supplier (Finance switched off) records and prints it from Sales →
// Payments; with Finance on, it is the same document. Pure helpers here; the writes are in sales.ts and
// sales-transfers.ts.

import type { Firestore, Transaction } from "firebase/firestore"
import type { CrmQuotation, PaymentMethod, QuotationPaymentEntry } from "./crm"
import { drawYearlyDocNumber } from "./sales-numbering"

export const RECEIPT_DOC = "RV"

/** Read and bump the voucher sequence inside the caller's transaction. */
export function drawReceiptNumber(firestore: Firestore, tx: Transaction, organizationId: string): Promise<string> {
  return drawYearlyDocNumber(firestore, tx, organizationId, RECEIPT_DOC)
}

/** What the voucher prints: who paid, how much, how, for what — the facts the payment entry and its quotation hold. */
export interface ReceiptVoucher {
  receiptNumber: string
  date: string
  contactName: string
  amount: number
  method: PaymentMethod | null
  reference: string | null
  quotationNumber: string
  installmentLabel: string
  receivedBy: string
  note: string | null
}

export function receiptVoucher(quotation: Pick<CrmQuotation, "quotationNumber" | "contactName">, installmentLabel: string, entry: QuotationPaymentEntry): ReceiptVoucher | null {
  if (!entry.receiptNumber) return null
  return {
    receiptNumber: entry.receiptNumber,
    date: entry.paidAt,
    contactName: quotation.contactName || "",
    amount: entry.paidAmount,
    method: entry.method ?? null,
    reference: entry.reference ?? null,
    quotationNumber: quotation.quotationNumber,
    installmentLabel,
    receivedBy: entry.paidByUserName || "",
    note: entry.note,
  }
}

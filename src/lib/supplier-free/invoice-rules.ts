// What blocks a supplier's invoice (PRD BIL-01/02, G-07), as plain facts so the form shows it live and the server
// runs the same rule again before anything is stored (NFR-08):
//  - the invoice covers receipts the contractor recorded — one per receipt (decision 1) — and never more than they accepted;
//  - its date is not before the last receipt it covers and not after today;
//  - it carries the supplier's own invoice number and his own file — Mdmak issues no invoice (B-07);
//  - a receipt is billed once, and an invoice number is not used twice by one supplier.

export type InvoiceBlockCode = "number" | "amount" | "over" | "dateBefore" | "dateFuture" | "file" | "noReceipt" | "billed" | "duplicate"

export interface InvoiceReceiptFact {
  /** The receipt's id as the invoice names it (its number). */
  id: string
  /** The day it was recorded. */
  day: string
  /** Accepted value of this receipt, before VAT — null on a lump-sum order until it is complete. */
  net: number | null
}

export interface InvoiceFacts {
  today: string
  receipts: InvoiceReceiptFact[]
  /** Receipts already named by an invoice of this order. */
  billed: string[]
  /** The order is lump-sum and fully received: its total is what the last invoice may carry. */
  lumpTotalWhenComplete: number | null
  /** Invoice numbers this supplier has already used. */
  usedNumbers: string[]
}

export interface InvoiceInput {
  number: string
  date: string
  amountNet: number
  hasFile: boolean
  grns: string[]
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** The most these receipts allow to be invoiced, before VAT. */
export function invoiceCap(facts: InvoiceFacts, grns: readonly string[]): number {
  const chosen = facts.receipts.filter((r) => grns.includes(r.id))
  if (facts.lumpTotalWhenComplete != null) {
    const all = facts.receipts.every((r) => grns.includes(r.id) || facts.billed.includes(r.id))
    return all ? facts.lumpTotalWhenComplete : 0
  }
  return r2(chosen.reduce((s, r) => s + (r.net || 0), 0))
}

export function invoiceBlocks(facts: InvoiceFacts, input: InvoiceInput): InvoiceBlockCode[] {
  const out: InvoiceBlockCode[] = []
  if (!input.number.trim()) out.push("number")
  if (input.number.trim() && facts.usedNumbers.some((n) => n.trim().toLowerCase() === input.number.trim().toLowerCase())) out.push("duplicate")
  const chosen = facts.receipts.filter((r) => input.grns.includes(r.id))
  if (!input.grns.length || chosen.length !== input.grns.length) out.push("noReceipt")
  if (input.grns.some((g) => facts.billed.includes(g))) out.push("billed")
  if (!(input.amountNet > 0)) out.push("amount")
  else if (input.amountNet > invoiceCap(facts, input.grns) + 0.009) out.push("over")
  if (input.date) {
    const last = chosen.map((r) => r.day).sort().pop()
    if (last && input.date < last) out.push("dateBefore")
    if (input.date > facts.today) out.push("dateFuture")
  } else out.push("dateBefore")
  if (!input.hasFile) out.push("file")
  return out
}

/** A stored invoice's own figures (BIL-03): before VAT, the VAT rate it carried — 0 for a supplier with no tax number,
 * 15% when it names none — the VAT and its total. Never re-read from the supplier's current flag. */
export function invoiceFigures(i: Record<string, unknown>): { net: number; vatRate: number; vat: number; gross: number } {
  const net = typeof i.amountNet === "number" && Number.isFinite(i.amountNet) ? i.amountNet : 0
  const vatRate = typeof i.vat === "number" && Number.isFinite(i.vat) ? i.vat : 0.15
  const vat = r2(net * vatRate)
  return { net, vatRate, vat, gross: r2(net + vat) }
}

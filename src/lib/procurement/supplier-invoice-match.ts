// Finance's side of a supplier's invoice (Supplier 1.0 boundary table: "Finance — the invoice → three-way match with
// the PO and the receipt, then scheduling"). The free supplier files the invoice on the server (`invoice-server.ts`);
// here the buying company's Finance reads it against its own two documents — the order's price and what its receipts
// accepted — and sees when each share falls due under the terms frozen on the order (G-08). Nothing is written: paying
// and holding stay in the order drawer, as for every other order.

import { addDaysTo, dayNum } from "@/lib/supplier-free/deal-logic"
import { discountReceipts } from "@/lib/supplier-free/discount-receipts"
import { invoiceFigures } from "@/lib/supplier-free/invoice-rules"
import { allLinesComplete } from "./po"
import type { PurchaseOrder, ReceiptFact } from "./types"

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** A `supplierInvoices` document as Finance reads it. */
export type SupplierInvoiceDoc = Record<string, unknown> & { id: string }

export type MatchState = "match" | "under" | "check"

export interface ReceiptMatch {
  grn: string
  /** The receipt is one of ours, confirmed, on this order. */
  found: boolean
  /** Accepted quantity × the order's price, before VAT; null when a line has no price. */
  net: number | null
}

export interface InvoiceMatch {
  receipts: ReceiptMatch[]
  /** What the order and the receipts say the invoice should come to, before VAT; null when it cannot be told. */
  expectedNet: number | null
  net: number
  vatRate: number
  vat: number
  gross: number
  /** Invoice − expected, before VAT. The server refuses an invoice above its receipts, so it is ≤ 0 when known. */
  diff: number | null
  /** `match` — equal; `under` — billed less than received; `check` — a receipt is not ours or a price is missing. */
  state: MatchState
}

/** The three-way match of one invoice against its order and the receipts it names. */
export function matchInvoice(inv: SupplierInvoiceDoc, po: PurchaseOrder, deliveries: readonly ReceiptFact[]): InvoiceMatch {
  const fig = invoiceFigures(inv)
  const grns = Array.isArray(inv.grns) ? (inv.grns as unknown[]).map(String) : []
  const priceOf = new Map(po.lines.map((l) => [l.id, l.unitPrice]))
  const ours = deliveries.filter((d) => d.poId === po.id && d.status === "confirmed")
  const discounts = new Map(discountReceipts(po).map((d) => [d.id, d.net]))
  const lump = po.lines.length === 0 || po.lines.some((l) => l.unitPrice == null)

  const receipts: ReceiptMatch[] = grns.map((grn) => {
    if (discounts.has(grn)) return { grn, found: true, net: discounts.get(grn) as number }
    const d = ours.find((x) => (x.docNumber || x.id) === grn)
    if (!d) return { grn, found: false, net: null }
    if (lump) return { grn, found: true, net: null }
    const net = r2((d.lines || []).reduce((s, l) => s + (Number(l.accepted) || 0) * (Number(priceOf.get(l.poLineId)) || 0), 0))
    return { grn, found: true, net }
  })

  const allFound = receipts.length > 0 && receipts.every((r) => r.found)
  // A lump-sum order is billed once, for its total, when every line is complete.
  const expectedNet = !allFound ? null : lump ? (allLinesComplete(po) ? r2(Number(po.totalExVat) || 0) : null) : r2(receipts.reduce((s, r) => s + (r.net || 0), 0))
  const diff = expectedNet == null ? null : r2(fig.net - expectedNet)
  const state: MatchState = diff == null ? "check" : Math.abs(diff) <= 0.01 ? "match" : diff < 0 ? "under" : "check"
  return { receipts, expectedNet, ...fig, diff, state }
}

export interface Instalment {
  pct: number
  amount: number
  due: string
  /** Not yet covered by the transfers Finance reported (transfers cover oldest invoice first), VAT included. */
  open: number
}

export interface InvoiceSchedule {
  instalments: Instalment[]
  /** What of this invoice is not yet covered by a reported transfer, VAT included. */
  left: number
  /** The first instalment not covered, or null when paid. */
  next: Instalment | null
}

/** The order's frozen terms, or the default 100% at 30 days (the same fallback the supplier reads). */
export function termsOfOrder(po: PurchaseOrder): { pct: number; days: number }[] {
  const list = Array.isArray(po.termsList) ? po.termsList.filter((x) => Number(x.pct) > 0) : []
  return list.length ? list.map((x) => ({ pct: Number(x.pct), days: Number(x.days) || 0 })) : [{ pct: 100, days: 30 }]
}

/**
 * Each invoice of ONE order spread over the order's terms — a share of its total due on its date + the term's days —
 * and the transfers Finance reported (`paid`, VAT included; a transfer the supplier answered "not received" excluded by
 * the caller) covering the instalments in order, invoice by invoice, oldest first: the same reading as the supplier's.
 */
export function scheduleInvoices(invoices: readonly SupplierInvoiceDoc[], po: PurchaseOrder, paid: number): Map<string, InvoiceSchedule> {
  const terms = termsOfOrder(po)
  let cover = r2(paid)
  const out = new Map<string, InvoiceSchedule>()
  const ordered = [...invoices].sort((a, b) => dayNum(str(a.date) || "1970-01-01") - dayNum(str(b.date) || "1970-01-01") || a.id.localeCompare(b.id))
  for (const inv of ordered) {
    const { gross } = invoiceFigures(inv)
    const date = str(inv.date).slice(0, 10)
    const instalments: Instalment[] = terms.map((x) => {
      const amount = r2((gross * x.pct) / 100)
      const used = Math.min(cover, amount)
      cover = r2(cover - used)
      const open = r2(amount - used)
      return { pct: x.pct, amount, due: date ? addDaysTo(date, x.days) : "", open: open <= 0.01 ? 0 : open }
    })
    const next = instalments.find((i) => i.open > 0) || null
    out.set(inv.id, { instalments, left: r2(instalments.reduce((s, i) => s + i.open, 0)), next })
  }
  return out
}

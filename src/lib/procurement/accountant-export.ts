// «صدّر للمحاسبة» (Procurement 1.5, PUR-10, question 5): a company without Finance keeps its books
// in another system, so Procurement hands its accountant a FILE for a period — the approved
// orders and the goods receipts, in fixed columns that never change between exports, with the
// links to the supplier invoices. An export, not a link: nothing here posts. Pure; the screen
// writes the workbook.

import { riyadhDay } from "../hr/format"
import { paymentStateOf, type FinancelessPo } from "./payment-mark"
import type { ReceiptFact } from "./types"

/** Column ids, in order — the headers are the screen's translations of `col_<id>`. */
export const ORDER_COLUMNS = ["number", "approved", "supplier", "vat_no", "title", "ex_vat", "vat", "total", "received", "payment", "paid_day", "invoices"] as const
export const RECEIPT_COLUMNS = ["number", "day", "order", "supplier", "material", "accepted", "unit", "price", "value"] as const

export type Cell = string | number | null

/** The Riyadh calendar day of a timestamp (an order approved at 01:00 Riyadh belongs to that day, not
 * the UTC one before it); a bare `YYYY-MM-DD` is already a day. */
const day = (v: string | null | undefined): string | null => {
  if (!v) return null
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const t = Date.parse(s)
  return Number.isFinite(t) ? riyadhDay(new Date(t)) : s.slice(0, 10)
}
const round2 = (n: number) => Math.round(n * 100) / 100
const inPeriod = (d: string | null, from: string, to: string) => Boolean(d && d >= from && d <= to)

export interface AccountantExport {
  /** The orders of `orders`, in the same order — the ids whose invoice files the zip carries. */
  poIds: string[]
  orders: Cell[][]
  receipts: Cell[][]
  /** Invoice files of the exported orders — name and link. */
  invoices: Array<{ order: string; name: string; url: string }>
}

/** What was accepted, ex VAT: accepted × the line's price; a lump-sum order (no unit prices) by the share of
 * its quantity accepted. Never the order's whole value just because nothing is left open — a remainder
 * cancelled or closed short was not received. */
export function receivedValue(po: Pick<FinancelessPo, "lines" | "totalExVat">): number {
  const priced = po.lines.some((l) => Number(l.unitPrice) > 0)
  if (priced) return round2(po.lines.reduce((s, l) => s + (Number(l.accepted) || 0) * (Number(l.unitPrice) || 0), 0))
  const ordered = po.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  const accepted = po.lines.reduce((s, l) => s + (Number(l.accepted) || 0), 0)
  return ordered > 0 ? round2((po.totalExVat * Math.min(accepted, ordered)) / ordered) : 0
}

/** Orders APPROVED in [from, to] (never a draft, a return or a cancelled one), and receipts CONFIRMED in it. */
export function accountantExport(
  orders: Array<FinancelessPo & { supplierVatNumber?: string | null }>,
  receipts: ReceiptFact[],
  period: { from: string; to: string },
  stateLabel: (s: ReturnType<typeof paymentStateOf>) => string
): AccountantExport {
  const { from, to } = period
  const approved = orders
    .filter((po) => po.status !== "awaiting_approval" && po.status !== "cancelled" && inPeriod(day(po.approvedAt), from, to))
    .sort((a, b) => String(a.docNumber).localeCompare(String(b.docNumber)))
  const invoices: AccountantExport["invoices"] = []
  const orderRows = approved.map((po) => {
    const exVat = round2(po.totalExVat)
    const vat = round2(exVat * (po.vatRate || 0))
    const files = po.invoiceFiles || []
    for (const f of files) invoices.push({ order: po.docNumber, name: f.number || f.name, url: f.url })
    return [po.docNumber, day(po.approvedAt), po.supplierName, po.supplierVatNumber || null, po.rfqTitle || null, exVat, vat, round2(exVat + vat), receivedValue(po), stateLabel(paymentStateOf(po)), po.paymentMark?.state === "paid" ? po.paymentMark.day : null, files.map((f) => f.url).join(" ") || null] as Cell[]
  })
  const byId = new Map(orders.map((po) => [po.id, po]))
  const receiptRows: Cell[][] = []
  for (const r of receipts) {
    if (r.status !== "confirmed" || !r.poId || !inPeriod(day(r.confirmedAt || r.deliveryDate), from, to)) continue
    const po = byId.get(r.poId)
    if (!po) continue
    for (const l of r.lines || []) {
      const line = po.lines.find((x) => x.id === l.poLineId)
      const accepted = Number(l.accepted) || 0
      if (!line || accepted <= 0) continue
      const price = Number(line.unitPrice) || 0
      receiptRows.push([r.docNumber || null, day(r.confirmedAt || r.deliveryDate), po.docNumber, po.supplierName, line.name, accepted, line.unit, price, round2(accepted * price)])
    }
  }
  receiptRows.sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[0]).localeCompare(String(b[0])))
  return { poIds: approved.map((po) => po.id), orders: orderRows, receipts: receiptRows, invoices }
}

/** CSV (UTF-8 with BOM, so Excel reads Arabic) — one table after the other. */
export function toCsv(tables: Array<{ title: string; head: string[]; rows: Cell[][] }>): string {
  const q = (c: Cell) => {
    if (c == null) return ""
    const s = String(c)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const parts = tables.map((t) => [t.title, t.head.map(q).join(","), ...t.rows.map((r) => r.map(q).join(","))].join("\r\n"))
  return "﻿" + parts.join("\r\n\r\n")
}

// «صدّر سندات الاستلام» (PRD 2.0 RCV-06): for the accountant or the archive — a table in fixed columns (Excel or CSV) for a period and a
// location, and a zip with one print-ready document per receipt (their attachments beside them when asked). Without Finance the file
// can be sent to the accountant's address in the policies. Pure: the screen writes the workbook and the zip; the table holds no money
// unless the reader sees prices.

import { strToU8, zipSync } from "fflate"
import { riyadhDay } from "../hr/format"
import { receiptDay } from "./po"
import { isNoPo, receiptLinesOf, type DeskDelivery } from "./receipt-desk"
import { acceptedOf } from "./po"
import type { PurchaseOrder } from "./types"

/** Column ids in order — the headers are the screen's translations of `export.col_<id>`; the invoice value rides only for a reader who sees prices. */
export const EXPORT_COLUMNS = ["receipt", "date", "supplier", "po", "material", "unit", "counted", "accepted", "rejected", "reason", "place", "receiver", "recordedIn", "invoice_no", "invoice_value", "kind"] as const
export type ExportColumn = (typeof EXPORT_COLUMNS)[number]

export const EXPORT_FORMATS = ["xlsx", "csv", "zip"] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export interface ExportFilter {
  /** `YYYY-MM-DD`, inclusive. */
  from: string
  to: string
  /** A warehouse id, or `all`. */
  place: string
}

export const ALL_PLACES = "all"

export const placeOfDelivery = (d: Pick<DeskDelivery, "landedWarehouseId"> & { warehouseId?: string | null; manualDraft?: { warehouseId?: string } | null }): string => d.landedWarehouseId || d.warehouseId || d.manualDraft?.warehouseId || ""

/** The receipts a filter takes: confirmed ones, whose day is inside the period and whose place matches. */
export function exportedReceipts(deliveries: DeskDelivery[], filter: ExportFilter): DeskDelivery[] {
  return deliveries
    .filter((d) => d.status === "confirmed")
    .filter((d) => {
      const day = receiptDay(d)
      return Boolean(day) && day >= filter.from && day <= filter.to
    })
    .filter((d) => filter.place === ALL_PLACES || placeOfDelivery(d) === filter.place)
    .sort((a, b) => receiptDay(a).localeCompare(receiptDay(b)) || String(a.docNumber).localeCompare(String(b.docNumber)))
}

/** «N سنداً في الفترة، منها N يدوي». */
export function exportCounts(deliveries: DeskDelivery[], filter: ExportFilter): { total: number; manual: number } {
  const rows = exportedReceipts(deliveries, filter)
  return { total: rows.length, manual: rows.filter((d) => d.source === "manual").length }
}

export interface ExportWords {
  headers: Record<ExportColumn, string>
  /** The module that recorded it: Procurement by hand, else the module that keeps the place. */
  recordedIn: { procurement: string; inventory: string; projects: string }
  kind: { receipt: string; manual: string; noNotice: string }
  reasons: (code: string) => string
  noPo: string
}

const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`

/** One row per receipt line. Money only when asked for (`withPrices`), and only a manual receipt carries an invoice value. */
export function exportRows(deliveries: DeskDelivery[], orders: PurchaseOrder[], placeName: (id: string) => string, words: ExportWords, withPrices: boolean): string[][] {
  const byId = new Map(orders.map((o) => [o.id, o]))
  const out: string[][] = []
  for (const d of deliveries) {
    const po = d.poId ? byId.get(d.poId) || null : null
    const lines = receiptLinesOf(d)
    const place = placeName(placeOfDelivery(d))
    const module = d.source === "manual" ? words.recordedIn.procurement : d.receiverModule === "projects" ? words.recordedIn.projects : words.recordedIn.inventory
    const kind = d.source === "manual" ? words.kind.manual : d.noNotice ? words.kind.noNotice : words.kind.receipt
    const poCell = po?.docNumber || d.poNumber || (isNoPo(d) ? words.noPo : "")
    const head = [d.docNumber || "", receiptDay(d), d.supplierName || po?.supplierName || "", poCell]
    const tail = [place, d.receivedByName || "", module]
    const invoice = [d.invoiceNumber || "", withPrices && d.invoiceValue != null ? String(d.invoiceValue) : ""]
    if (!lines.length) {
      out.push([...head, "", "", "", "", "", "", ...tail, ...invoice, kind])
      continue
    }
    for (const l of lines) {
      out.push([...head, l.name, l.unit, String(Number(l.counted) || 0), String(l.accepted ?? acceptedOf(l)), String(Number(l.rejected) || 0), l.rejectReason ? words.reasons(l.rejectReason) : "", ...tail, ...invoice, kind])
    }
  }
  return out
}

/** The columns a reader gets: the invoice value only when he sees prices. */
export const exportColumns = (withPrices: boolean): ExportColumn[] => EXPORT_COLUMNS.filter((c) => withPrices || c !== "invoice_value")

export function exportMatrix(rows: string[][], words: ExportWords, withPrices: boolean): string[][] {
  const keep = EXPORT_COLUMNS.map((c) => withPrices || c !== "invoice_value")
  const trim = (r: string[]) => r.filter((_, i) => keep[i])
  return [exportColumns(withPrices).map((c) => words.headers[c]), ...rows.map(trim)]
}

/** UTF-8 with BOM so Excel reads the Arabic; every cell quoted. */
export function exportCsv(matrix: string[][]): string {
  return "﻿" + matrix.map((r) => r.map(cell).join(",")).join("\r\n")
}

export const exportFilename = (filter: ExportFilter, ext: ExportFormat): string => `receipts-${filter.from}_${filter.to}.${ext}`

/** A voucher number as a file name: `GR-2026/031` → `GR-2026-031`. */
export const voucherFile = (docNumber: string | null | undefined, id: string): string => (docNumber || `DEL-${id.slice(0, 8)}`).replace(/[^\w.-]+/g, "-")

export interface ZipEntry {
  /** Path inside the zip. */
  path: string
  bytes: Uint8Array
}

/** The zip: the table, then one print-ready document per receipt (`<number>.html`, which opens the print dialog — save it as PDF) and, when asked,
 * its attachments in a folder of the same name. */
export function receiptsZip(input: { table?: { filename: string; bytes: Uint8Array } | null; documents: Array<{ name: string; html: string }>; attachments?: ZipEntry[] }): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  if (input.table) files[input.table.filename] = input.table.bytes
  for (const d of input.documents) files[`${d.name}.html`] = strToU8(d.html)
  for (const a of input.attachments || []) files[a.path] = a.bytes
  return zipSync(files, { level: 6 })
}

/** The attachments of a receipt that may travel in the zip: its own files and the ones the receiver attached, once each. */
export function attachmentUrlsOf(d: Pick<DeskDelivery, "attachmentUrls" | "receiverReport">): string[] {
  return Array.from(new Set([...(d.attachmentUrls || []), ...((d.receiverReport?.files || []).map((f) => f.url))].filter(Boolean)))
}

/** The Riyadh month's first day to today — the period the dialog opens with. */
export const defaultPeriod = (now: Date): { from: string; to: string } => {
  const today = riyadhDay(now)
  return { from: `${today.slice(0, 7)}-01`, to: today }
}


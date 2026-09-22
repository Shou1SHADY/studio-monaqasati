// The goods-received desk, derived (PRD 3.0 §7.2 "Goods receipts" tab). Three
// segments over the same two collections: what is ON THE WAY (the suppliers'
// pending notices, and the live orders whose promised day is close or past
// with no notice at all), the RECEIPTS log, and the receipts with NO ORDER
// that wait to be regularised. Search runs across the segments; the CSV is
// one row per receipt line and carries no money (an expediter may export it).
// Pure: every function takes what it needs and `now`.

import { daysFromNow, dayOf, lineToArrive, poStatus, receiptDay } from "./po"
import { receiptState, shortVsNotice, type ReceiptState } from "./receipts"
import { acceptedOf } from "./po"
import type { DeliveryLine, PurchaseOrder, ReceiptFact } from "./types"
import { matchesSearch } from "../search-text"

export const RECEIPT_SEGMENTS = ["incoming", "log", "nopo"] as const
export type ReceiptSegment = (typeof RECEIPT_SEGMENTS)[number]

/** How far ahead "on the way" looks for an order with no notice. */
export const INCOMING_HORIZON_DAYS = 7

/** The delivery as the desk reads it (the world's `ProcDelivery`, reduced). */
export interface DeskDelivery extends ReceiptFact {
  rfqTitle?: string | null
  receivedByName?: string | null
  deliveryPersonName?: string | null
  supplierId?: string | null
  items?: Array<{ name?: string; quantity?: number; unit?: string; unitOfMeasure?: string }> | null
  notes?: string | null
  noNotice?: boolean
  regularisation?: "expense" | null
  createdAt?: unknown
}

const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0)

/** A receipt with no order: manual, naming no order and no award. */
export const isNoPo = (d: Pick<DeskDelivery, "source" | "poId" | "offerId">): boolean => d.source === "manual" && !d.poId && !d.offerId

/** Which segment a delivery belongs to. */
export function receiptSegment(d: DeskDelivery): ReceiptSegment {
  if (d.status !== "confirmed") return "incoming"
  return isNoPo(d) ? "nopo" : "log"
}

// ---------------------------------------------------------------------------
// On the way
// ---------------------------------------------------------------------------

export type IncomingRow =
  | { kind: "notice"; id: string; delivery: DeskDelivery; po: PurchaseOrder | null; state: ReceiptState; day: string; daysFromNow: number | null; afterPromise: number }
  | { kind: "due"; id: string; po: PurchaseOrder; day: string; daysFromNow: number | null; daysLate: number }

/** Pending notices first by their day; then live orders whose promise is within
 * the horizon (or past) and have no pending notice. Sorted by day ascending. */
export function incomingRows(deliveries: DeskDelivery[], orders: PurchaseOrder[], now: Date, horizonDays = INCOMING_HORIZON_DAYS): IncomingRow[] {
  const byId = new Map(orders.map((o) => [o.id, o]))
  const out: IncomingRow[] = []
  const noticed = new Set<string>()
  for (const d of deliveries) {
    if (d.status === "confirmed") continue
    const po = d.poId ? byId.get(d.poId) || null : null
    if (po) noticed.add(po.id)
    const day = dayOf(d.deliveryDate)
    const afterPromise = po?.promisedDate && day ? Math.max(0, Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${po.promisedDate}T00:00:00Z`)) / 86400000)) : 0
    out.push({ kind: "notice", id: `n:${d.id}`, delivery: d, po, state: receiptState(d, now), day, daysFromNow: daysFromNow(day, now), afterPromise })
  }
  for (const po of orders) {
    const st = poStatus(po)
    if (st !== "in_delivery" && st !== "part_received") continue
    if (noticed.has(po.id) || !po.promisedDate) continue
    if (!po.lines.some((l) => lineToArrive(l) > 0)) continue
    const d = daysFromNow(po.promisedDate, now)
    if (d == null || d > horizonDays) continue
    out.push({ kind: "due", id: `d:${po.id}`, po, day: po.promisedDate, daysFromNow: d, daysLate: d < 0 ? -d : 0 })
  }
  return out.sort((a, b) => (a.day || "9999").localeCompare(b.day || "9999"))
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

export interface ReceiptRow {
  delivery: DeskDelivery
  po: PurchaseOrder | null
  state: ReceiptState
  day: string
  /** Accepted per line (or the legacy items). */
  lines: DeliveryLine[]
  rejected: number
  held: number
  short: number
  /** The order is complete after this receipt (nothing left to arrive). */
  complete: boolean | null
}

/** The lines a confirmed delivery shows: its receipt lines, else its legacy items counted in full. */
export function receiptLinesOf(d: Pick<DeskDelivery, "lines" | "items" | "source">): DeliveryLine[] {
  if (d.lines && d.lines.length) return d.lines
  // A legacy notice's items WERE the notice; a manual receipt's items are what was typed — nothing to compare against.
  const notice = d.source === "manual" ? 0 : null
  return (d.items || [])
    .map((it, i) => ({ poLineId: `i${i + 1}`, name: it.name || "", unit: it.unitOfMeasure || it.unit || "", noticeQuantity: notice ?? num(it.quantity), counted: num(it.quantity), accepted: num(it.quantity) }))
    .filter((l) => l.name)
}

export function receiptRow(d: DeskDelivery, orders: PurchaseOrder[], now: Date): ReceiptRow {
  const po = d.poId ? orders.find((o) => o.id === d.poId) || null : null
  const lines = receiptLinesOf(d)
  return {
    delivery: d,
    po,
    state: receiptState(d, now),
    day: receiptDay(d),
    lines,
    rejected: lines.reduce((s, l) => s + num(l.rejected), 0),
    held: lines.reduce((s, l) => s + num(l.held), 0),
    short: lines.reduce((s, l) => s + shortVsNotice(l), 0),
    complete: po ? !po.lines.some((l) => lineToArrive(l) > 0) : null,
  }
}

/** Confirmed receipts of a segment, newest first. */
export function receiptRows(deliveries: DeskDelivery[], orders: PurchaseOrder[], segment: "log" | "nopo", now: Date): ReceiptRow[] {
  return deliveries
    .filter((d) => receiptSegment(d) === segment)
    .map((d) => receiptRow(d, orders, now))
    .sort((a, b) => (b.day || "").localeCompare(a.day || ""))
}

// ---------------------------------------------------------------------------
// Search, filters, counts
// ---------------------------------------------------------------------------

/** What a search box may find a delivery by. */
export function receiptSearchFields(d: DeskDelivery, po?: PurchaseOrder | null): Array<string | null | undefined> {
  return [d.docNumber, d.poNumber, po?.docNumber, d.supplierName, po?.supplierName, d.rfqTitle, po?.rfqTitle, d.receivedByName, d.deliveryPersonName, d.paperNoteNumber, d.vehiclePlate, d.notes, ...receiptLinesOf(d).map((l) => l.name)]
}

export function deliveryMatches(term: string, d: DeskDelivery, po?: PurchaseOrder | null): boolean {
  return matchesSearch(term, receiptSearchFields(d, po))
}

export function orderMatches(term: string, po: PurchaseOrder): boolean {
  return matchesSearch(term, [po.docNumber, po.supplierName, po.rfqTitle, ...po.lines.map((l) => l.name)])
}

export interface DeskFilter {
  term: string
  projectId: string | null
}

const projectOf = (d: DeskDelivery, po: PurchaseOrder | null) => d.projectId || po?.projectId || null

/** The three counts, after the search and the project filter — so the tabs say
 * how many of what you are looking for sit behind each. */
export function segmentCounts(deliveries: DeskDelivery[], orders: PurchaseOrder[], filter: DeskFilter, now: Date): Record<ReceiptSegment, number> {
  const inc = incomingRows(deliveries, orders, now).filter((r) => incomingRowMatches(r, filter))
  const byId = new Map(orders.map((o) => [o.id, o]))
  const keep = (d: DeskDelivery) => {
    const po = d.poId ? byId.get(d.poId) || null : null
    return (!filter.projectId || projectOf(d, po) === filter.projectId) && deliveryMatches(filter.term, d, po)
  }
  return {
    incoming: inc.length,
    log: deliveries.filter((d) => receiptSegment(d) === "log" && keep(d)).length,
    nopo: deliveries.filter((d) => receiptSegment(d) === "nopo" && keep(d)).length,
  }
}

export function incomingRowMatches(r: IncomingRow, filter: DeskFilter): boolean {
  if (r.kind === "notice") {
    if (filter.projectId && projectOf(r.delivery, r.po) !== filter.projectId) return false
    return deliveryMatches(filter.term, r.delivery, r.po)
  }
  if (filter.projectId && r.po.projectId !== filter.projectId) return false
  return orderMatches(filter.term, r.po)
}

export function receiptRowMatches(r: ReceiptRow, filter: DeskFilter): boolean {
  if (filter.projectId && projectOf(r.delivery, r.po) !== filter.projectId) return false
  return deliveryMatches(filter.term, r.delivery, r.po)
}

// ---------------------------------------------------------------------------
// CSV — one row per receipt line, no money
// ---------------------------------------------------------------------------

export const RECEIPT_CSV_COLUMNS = ["receipt", "date", "supplier", "po", "material", "perNotice", "counted", "accepted", "rejected", "held", "place", "receiver", "recordedIn"] as const
export type ReceiptCsvColumn = (typeof RECEIPT_CSV_COLUMNS)[number]

export interface CsvWords {
  headers: Record<ReceiptCsvColumn, string>
  /** "recorded in": manual / at the gate / no PO. */
  recordedManual: string
  recordedGate: string
  noPo: string
  noNotice: string
}

/** Cells per line of every confirmed receipt (the whole log, filters ignored). */
export function receiptCsvRows(deliveries: DeskDelivery[], orders: PurchaseOrder[], warehouseName: (id: string | null | undefined) => string, words: CsvWords): string[][] {
  const rows: string[][] = []
  const byId = new Map(orders.map((o) => [o.id, o]))
  const confirmed = deliveries.filter((d) => d.status === "confirmed").sort((a, b) => receiptDay(b).localeCompare(receiptDay(a)))
  for (const d of confirmed) {
    const po = d.poId ? byId.get(d.poId) || null : null
    const lines = receiptLinesOf(d)
    const place = warehouseName(d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId)
    const recorded = d.source === "manual" ? words.recordedManual : words.recordedGate
    const poCell = po?.docNumber || d.poNumber || (isNoPo(d) ? words.noPo : "")
    if (!lines.length) {
      rows.push([d.docNumber || "", receiptDay(d), d.supplierName || "", poCell, "", "", "", "", "", "", place, d.receivedByName || "", recorded])
      continue
    }
    for (const l of lines) {
      const counted = num(l.counted)
      rows.push([
        d.docNumber || "",
        receiptDay(d),
        d.supplierName || po?.supplierName || "",
        poCell,
        [l.name, l.unit].filter(Boolean).join(" · "),
        num(l.noticeQuantity) > 0 ? String(l.noticeQuantity) : d.noNotice || !d.lines?.length ? words.noNotice : "",
        String(counted),
        String(l.accepted ?? acceptedOf(l)),
        String(num(l.rejected)),
        String(num(l.held)),
        place,
        d.receivedByName || "",
        recorded,
      ])
    }
  }
  return rows
}

const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`

/** UTF-8 with BOM so Excel reads the Arabic; every cell quoted. */
export function receiptCsv(rows: string[][], words: CsvWords): string {
  const header = RECEIPT_CSV_COLUMNS.map((c) => cell(words.headers[c])).join(",")
  return "﻿" + [header, ...rows.map((r) => r.map(cell).join(","))].join("\r\n")
}

export const receiptCsvFilename = (now: Date) => `receipts-${dayOf(now.toISOString())}.csv`

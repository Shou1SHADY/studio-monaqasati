// The goods-received desk, derived (PRD 3.0 §7.2 "Goods receipts" tab). Three
// segments over the same two collections: what is ON THE WAY (the suppliers'
// pending notices, and the live orders whose promised day is close or past
// with no notice at all), the RECEIPTS log, and the receipts with NO ORDER
// that wait to be regularised. Search runs across the segments; the CSV is
// one row per receipt line and carries no money (an expediter may export it).
// Pure: every function takes what it needs and `now`.

import { daysFromNow, dayOf, lineToArrive, poStatus, receiptDay, round2 } from "./po"
import { receiptState, shortVsNotice, type ReceiptState } from "./receipts"
import { acceptedOf } from "./po"
import type { NoticeRouting } from "./policies"
import { forwardUrgency, receiversForPlace, type ProcReceiver, type ReceiverChoice, type ReceiverModule } from "./receivers"
import type { DeliveryLine, PoLine, PurchaseOrder, ReceiptFact } from "./types"
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
  items?: Array<{ name?: string; quantity?: number; unit?: string; unitOfMeasure?: string; unitPrice?: number | null }> | null
  notes?: string | null
  noNotice?: boolean
  regularisation?: "expense" | null
  regularisedAt?: string | null
  regularisedById?: string | null
  createdAt?: unknown
  attachmentUrls?: string[] | null
  /** Procurement forwarded it to the person receiving on site (22 Sep review). */
  forwardedTo?: ForwardedTo | null
  /** What that person counted and signed for, verified by a code to their phone. */
  receiverReport?: ReceiverReportFact | null
  /** A receipt recorded without this notice took everything it announced (receipt-writes). */
  closedByReceipt?: { deliveryId: string; docNumber: string } | null
}

export interface ForwardedTo {
  linkId: string
  name: string
  userId: string | null
  phoneMasked: string
  byName: string
  at: string
  /** Procurement's note to the receiver («ملاحظة للمستلم»), shown on the link as «ملاحظة المشتريات». */
  note?: string | null
}

/** Written by the server when the receiver signs (src/lib/receipt-links.ts). */
export interface ReceiverReportFact {
  linkId: string
  receiverName: string
  receiverUserId: string | null
  phoneMasked: string
  lines: Array<{ poLineId: string; name: string; unit: string; counted: number; rejected: number; rejectReason: string | null; note: string | null }>
  note: string | null
  signatureData: string | null
  signedAt: string
  verifiedBy: "sms_code"
}

/** Where a forwarded delivery stands on the desk. */
export function forwardState(d: Pick<DeskDelivery, "forwardedTo" | "receiverReport">): "none" | "forwarded" | "signed" {
  if (d.receiverReport) return "signed"
  if (d.forwardedTo) return "forwarded"
  return "none"
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
    if (d.status === "confirmed" || d.closedByReceipt) continue
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
  /** What is still to arrive on the whole order, summed over its lines. */
  remaining: number | null
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
    remaining: po ? round2(po.lines.reduce((s, l) => s + lineToArrive(l), 0)) : null,
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

/** Besides a project id, the place filter offers two pseudo-places: general
 * stock (no project, not the workshop) and the manufacturing workshop (an order
 * that answers a work order's shortfall). */
export const PLACE_GENERAL = "__general__"
export const PLACE_WORKSHOP = "__workshop__"

export interface DeskFilter {
  term: string
  projectId: string | null
}

const projectOf = (d: DeskDelivery, po: PurchaseOrder | null) => d.projectId || po?.projectId || null

export const isWorkshopOrder = (po: Pick<PurchaseOrder, "purchaseSource"> | null | undefined): boolean => po?.purchaseSource?.kind === "mfg_purchase"

export function placeMatches(projectId: string | null, po: PurchaseOrder | null, filter: string | null): boolean {
  if (!filter) return true
  if (filter === PLACE_WORKSHOP) return isWorkshopOrder(po)
  if (filter === PLACE_GENERAL) return !projectId && !isWorkshopOrder(po)
  return projectId === filter
}

/** The three counts, after the search and the project filter — so the tabs say
 * how many of what you are looking for sit behind each. */
export function segmentCounts(deliveries: DeskDelivery[], orders: PurchaseOrder[], filter: DeskFilter, now: Date): Record<ReceiptSegment, number> {
  const inc = incomingRows(deliveries, orders, now).filter((r) => incomingRowMatches(r, filter))
  const byId = new Map(orders.map((o) => [o.id, o]))
  const keep = (d: DeskDelivery) => {
    const po = d.poId ? byId.get(d.poId) || null : null
    return placeMatches(projectOf(d, po), po, filter.projectId) && deliveryMatches(filter.term, d, po)
  }
  return {
    incoming: inc.length,
    log: deliveries.filter((d) => receiptSegment(d) === "log" && keep(d)).length,
    nopo: deliveries.filter((d) => receiptSegment(d) === "nopo" && keep(d)).length,
  }
}

export function incomingRowMatches(r: IncomingRow, filter: DeskFilter): boolean {
  if (r.kind === "notice") {
    if (!placeMatches(projectOf(r.delivery, r.po), r.po, filter.projectId)) return false
    return deliveryMatches(filter.term, r.delivery, r.po)
  }
  if (!placeMatches(r.po.projectId || null, r.po, filter.projectId)) return false
  return orderMatches(filter.term, r.po)
}

export function receiptRowMatches(r: ReceiptRow, filter: DeskFilter): boolean {
  if (!placeMatches(projectOf(r.delivery, r.po), r.po, filter.projectId)) return false
  return deliveryMatches(filter.term, r.delivery, r.po)
}

/** The log's own filter: every receipt, the final ones (their order has
 * nothing left to arrive), or the partial ones. A receipt with no order has no
 * completeness to speak of and shows only under "all". */
export const LOG_COMPLETENESS = ["all", "done", "open"] as const
export type LogCompleteness = (typeof LOG_COMPLETENESS)[number]

export function completenessMatches(r: Pick<ReceiptRow, "complete">, f: LogCompleteness): boolean {
  if (f === "all") return true
  if (r.complete == null) return false
  return f === "done" ? r.complete : !r.complete
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

// ---------------------------------------------------------------------------
// On the way — the row's pill, its shipment, and who should receive it
// ---------------------------------------------------------------------------

export type IncomingPill =
  | { kind: "to_forward"; tone: "bad" | "warn" | "info" }
  | { kind: "due_late"; days: number }
  | { kind: "due_no_notice" }
  | { kind: "after_promise"; days: number }
  | { kind: "passed_no_receipt" }
  | { kind: "in_days"; days: number | null }

/** First match wins, in the prototype's order: a notice still with us is OUR
 * task (red past the day, amber inside the forwarding window, blue before it) —
 * unless the notice reaches the receiver directly (`noticeRouting: both`); an
 * order with no notice is the supplier's; then lateness against the promise;
 * then a notice whose day passed with no receipt; else how far off it is. */
export function incomingPill(r: IncomingRow, forwardWindowDays: number, routing: NoticeRouting = "procurement"): IncomingPill {
  if (r.kind === "due") return r.daysLate > 0 ? { kind: "due_late", days: r.daysLate } : { kind: "due_no_notice" }
  if (routing === "procurement" && forwardState(r.delivery) === "none") {
    const u = forwardUrgency(r.daysFromNow, forwardWindowDays)
    return { kind: "to_forward", tone: u === "overdue" || (u === "due" && (r.daysFromNow ?? 0) <= 0) ? "bad" : u === "due" ? "warn" : "info" }
  }
  if (r.afterPromise > 0) return { kind: "after_promise", days: r.afterPromise }
  if (r.daysFromNow != null && r.daysFromNow < 0) return { kind: "passed_no_receipt" }
  return { kind: "in_days", days: r.daysFromNow }
}

const createdKey = (d: DeskDelivery) => `${dayOf(d.deliveryDate) || "9999"}|${isoOf(d.createdAt) || ""}|${d.id}`

/**
 * "Shipment n of m" for a notice on an order. `n` is its place among the
 * order's deliveries, by day. `m` is said only when it is known: when the
 * notices still pending cover everything left to arrive, the order ends with
 * the last of them; otherwise more trucks will come and nobody has said how many.
 */
export function shipmentOrdinal(d: DeskDelivery, deliveries: DeskDelivery[], po: PurchaseOrder | null): { n: number; m: number | null } | null {
  if (!po) return null
  const mine = deliveries.filter((x) => x.poId === po.id).sort((a, b) => createdKey(a).localeCompare(createdKey(b)))
  const n = mine.findIndex((x) => x.id === d.id) + 1
  if (n <= 0) return null
  const pending = mine.filter((x) => x.status !== "confirmed")
  const covered = po.lines.every((l) => {
    const left = lineToArrive(l)
    if (left <= 0) return true
    const noticed = pending.reduce((s, x) => s + (x.lines || []).filter((dl) => dl.poLineId === l.id).reduce((a, dl) => a + num(dl.noticeQuantity), 0), 0)
    return noticed + 1e-9 >= left
  })
  const m = covered ? mine.length : null
  if (mine.length < 2 && m == null) return null
  if (m === 1) return null
  return { n, m }
}

/** Where the goods of an order will land: the project's warehouse, else the central one. */
export function landingWarehouseId(projectId: string | null | undefined, projects: Array<{ id: string; warehouseId?: string | null }>, orgId: string): string | null {
  const own = projectId ? projects.find((p) => p.id === projectId)?.warehouseId || null : null
  return own || (orgId ? `central_${orgId}` : null)
}

/** The receiver the register names for this place — the first person named
 * there, else whoever stands in everywhere. Null when the register is empty. */
export function suggestedReceiver(receivers: ProcReceiver[], warehouseId: string | null | undefined): ReceiverChoice | null {
  return receiversForPlace(receivers, warehouseId)[0] ?? null
}

// ---------------------------------------------------------------------------
// Where it went and who recorded it
// ---------------------------------------------------------------------------

/** `inv`: stock in a store Inventory keeps; `prj`: a project's own store,
 * consumed against items in Projects. */
export type DestKind = "inv" | "prj"

export function destKind(warehouse: { projectId?: string | null } | null | undefined, projectId?: string | null): DestKind | null {
  if (warehouse) return warehouse.projectId ? "prj" : "inv"
  return projectId ? "prj" : null
}

export type RecordedBy = "procurement" | ReceiverModule

/** Which module recorded the receipt: Procurement when it typed it (manual)
 * or its own buyer received it; otherwise the module that keeps the place. */
export function recordedBy(d: Pick<DeskDelivery, "source" | "selfReceived">, kind: DestKind | null): RecordedBy {
  if (d.source === "manual" || d.selfReceived) return "procurement"
  return kind === "prj" ? "projects" : "inventory"
}

/** What earlier receipts of the same order accepted on this line — before this one. */
export function acceptedBefore(d: DeskDelivery, deliveries: DeskDelivery[], poLineId: string): number {
  if (!d.poId) return 0
  const key = (x: DeskDelivery) => `${isoOf(x.confirmedAt) || dayOf(x.deliveryDate) || ""}|${x.docNumber || ""}`
  const mine = key(d)
  return round2(
    deliveries
      .filter((x) => x.id !== d.id && x.poId === d.poId && x.status === "confirmed" && key(x) < mine)
      .reduce((s, x) => s + (x.lines || []).filter((l) => l.poLineId === poLineId).reduce((a, l) => a + num(l.accepted ?? acceptedOf(l)), 0), 0)
  )
}

// ---------------------------------------------------------------------------
// A receipt with no order — what the receiver typed, and what it is worth
// ---------------------------------------------------------------------------

/** Σ quantity × unit price over the typed lines that carry a price; null when none does. */
export function noPoInvoiceValue(d: Pick<DeskDelivery, "items">): number | null {
  const priced = (d.items || []).filter((it) => it.unitPrice != null && Number.isFinite(Number(it.unitPrice)))
  if (!priced.length) return null
  return round2(priced.reduce((s, it) => s + num(it.quantity) * num(it.unitPrice), 0))
}

// ---------------------------------------------------------------------------
// The rejects: what was decided, with its date or price
// ---------------------------------------------------------------------------

/** The decision's terms as the write stores them beside `rejectDecision`. */
export interface RejectTerms {
  replaceBy: string | null
  discountPrice: number | null
}

export function rejectTermsOf(line: PoLine & { rejectReplaceBy?: string | null; rejectDiscountPrice?: number | null }): RejectTerms {
  const price = Number(line.rejectDiscountPrice)
  return { replaceBy: line.rejectReplaceBy ? dayOf(line.rejectReplaceBy) : null, discountPrice: Number.isFinite(price) && price > 0 ? price : null }
}

// ---------------------------------------------------------------------------
// The material's trail — seven steps from the need to Finance
// ---------------------------------------------------------------------------

export const TRAIL_STEPS = ["requested", "purchased", "notified", "forwarded", "received", "went", "finance"] as const
export type TrailStepKey = (typeof TRAIL_STEPS)[number]
export type TrailState = "ok" | "bad" | "now"

export interface TrailStep {
  key: TrailStepKey
  state: TrailState
  /** ISO or `YYYY-MM-DD`, when the step has a moment. */
  at: string | null
  /** Which sentence to say, and its facts. */
  variant: string
  params: Record<string, string | number>
}

/** Pure: the trail of a receipt on an order. Rendering is the screen's. */
export function receiptTrail(d: DeskDelivery, po: PurchaseOrder, routing: NoticeRouting = "procurement"): TrailStep[] {
  const src = po.purchaseSource?.kind || null
  const fw = d.forwardedTo || null
  const held = (d.lines || []).some((l) => num(l.held) > 0)
  const steps: TrailStep[] = [
    { key: "requested", state: "ok", at: null, variant: src ? `source_${src}` : "direct", params: {} },
    { key: "purchased", state: "ok", at: po.approvedAt || po.createdAt || null, variant: "po", params: { number: po.docNumber, supplier: po.supplierName, rfq: po.rfqTitle || "" } },
    d.noNotice
      ? { key: "notified", state: "bad", at: null, variant: "none", params: {} }
      : { key: "notified", state: "ok", at: isoOf(d.createdAt), variant: "notice", params: { day: dayOf(d.deliveryDate), note: d.paperNoteNumber || "", driver: d.deliveryPersonName || "" } },
    fw
      ? { key: "forwarded", state: "ok", at: fw.at, variant: fw.userId ? "member" : "link", params: { name: fw.name, phone: fw.phoneMasked, by: fw.byName } }
      : routing === "both" && !d.noNotice
        ? { key: "forwarded", state: "ok", at: isoOf(d.createdAt), variant: "both", params: {} }
        : { key: "forwarded", state: "bad", at: null, variant: d.noNotice ? "unannounced" : "direct", params: {} },
    { key: "received", state: "ok", at: d.confirmedAt || d.deliveryDate || null, variant: d.receiverReport ? "link" : "gate", params: { receiver: d.receivedByName || "", number: d.docNumber || "" } },
    { key: "went", state: held ? "now" : "ok", at: null, variant: held ? "held" : "landed", params: {} },
    { key: "finance", state: po.status === "closed" ? "ok" : "now", at: po.closedAt || null, variant: po.status === "closed" ? "closed" : "match", params: {} },
  ]
  return steps
}

// ---------------------------------------------------------------------------
// The receipt's own log — assembled from what the documents already say
// ---------------------------------------------------------------------------

export interface ReceiptLogEntry {
  at: string
  action: "noticed" | "forwarded" | "signed" | "recorded" | "regularised" | "expensed" | "po_raised"
  by: string
  params: Record<string, string | number>
}

/** A stored moment (ISO string or a Firestore Timestamp) as ISO. */
export function isoOf(v: unknown): string | null {
  if (!v) return null
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date; seconds?: number }
  if (typeof ts.toDate === "function") return ts.toDate().toISOString()
  if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000).toISOString()
  return null
}

export function receiptLog(d: DeskDelivery, po: PurchaseOrder | null): ReceiptLogEntry[] {
  const out: ReceiptLogEntry[] = []
  const created = isoOf(d.createdAt)
  if (created && !d.noNotice && d.source !== "manual") out.push({ at: created, action: "noticed", by: d.supplierName || "", params: { day: dayOf(d.deliveryDate) } })
  const fw = d.forwardedTo
  if (fw?.at) out.push({ at: fw.at, action: "forwarded", by: fw.byName, params: { name: fw.name } })
  const rr = d.receiverReport
  if (rr?.signedAt) out.push({ at: rr.signedAt, action: "signed", by: rr.receiverName, params: {} })
  const confirmed = isoOf(d.confirmedAt)
  if (d.status === "confirmed" && confirmed) out.push({ at: confirmed, action: "recorded", by: d.confirmedByName || d.receivedByName || "", params: { number: d.docNumber || "" } })
  for (const e of po?.log || []) {
    if (e.params?.deliveryId !== d.id || e.action !== "created") continue
    out.push({ at: e.at, action: "po_raised", by: e.byName, params: { number: po?.docNumber || "" } })
  }
  const reg = isoOf(d.regularisedAt)
  if (reg) out.push({ at: reg, action: d.regularisation === "expense" ? "expensed" : "regularised", by: d.regularisedByName || "", params: { number: d.poNumber || "" } })
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

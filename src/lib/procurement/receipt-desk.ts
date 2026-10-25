// The receipts hub, derived (PRD 2.0 §7.2 «سندات الاستلام», prototype `viewRcv`). Five segments over the same two collections: the
// notices still ON THE WAY (every one the suppliers announced and nobody has counted), the ones AWAITING YOUR FORWARD (no receiver
// told yet), the ones AWAITING COUNT (forwarded and the delivery day reached), the RECEIPTS themselves, and the receipts with NO ORDER
// (manual ones waiting to be regularised or booked as cash). Procurement forwards and follows; the receipt is the RECEIVER's, so
// nothing here confirms one. Pure: every function takes what it needs and `now`.

import { daysBetween, dayOf, lineToArrive, receiptDay, round2, todayOf } from "./po"
import { receiptState, type ReceiptState } from "./receipts"
import { acceptedOf } from "./po"
import { noticeNumberFor } from "./format"
import type { PoExtras } from "./po-extras"
import { receiversForPlace, type ProcReceiver, type ReceiverChoice, type ReceiverModule } from "./receivers"
import type { DeliveryLine, HoldReasonCode, PoLine, PurchaseOrder, ReceiptFact } from "./types"
import { matchesSearch } from "../search-text"
import { daysUncounted, needsEscalation } from "./escalation"

export const RECEIPT_SEGMENTS = ["transit", "fwd", "count", "recs", "nopo"] as const
export type ReceiptSegment = (typeof RECEIPT_SEGMENTS)[number]

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
  /** The notice's number among its order's notices (REP1, REP2) — stored by the server when it is written (NFR-07). */
  seq?: number | null
  /** How the receiver proved himself: his sign-in or the code to his mobile. */
  confirmedVia?: "login" | "sms_code" | null
  /** Who made the receipt: the receiver, or Procurement by hand (a manual receipt). */
  recordedBy?: "receiver" | "procurement_manual" | null
  receiverModule?: ReceiverModule | null
  /** `inv:GRN:<no>` or `prj:GRN:<no>` — the event of the unit that received it. */
  grnKey?: string | null
  /** A manual receipt at a main warehouse waits as a draft the storekeeper confirms; nothing has moved before. */
  manualDraft?: ManualDraft | null
  invoiceNumber?: string | null
  invoiceValue?: number | null
  /** What the buyer said happens to a manual receipt next: a later order, or a cash expense. */
  after?: "later" | "cash" | null
  /** Procurement escalated an uncounted delivery (TDY-05) — once. */
  escalation?: DeliveryEscalation | null
  reportedBy?: "supplier" | "onBehalf" | "link" | null
  deliveryDateIso?: string | null
  /** A manual receipt at a delivery site with no warehouse (RC-04): the site it names and its name then — a record, no stock. */
  deliverySiteId?: string | null
  deliverySiteName?: string | null
}

export interface ManualDraft {
  state: "draft" | "confirmed" | "declined"
  warehouseId: string
  byId: string
  byName: string
  at: string
  confirmedById?: string | null
  confirmedByName?: string | null
  confirmedAt?: string | null
  note?: string | null
}

export interface DeliveryEscalation {
  at: string
  byId: string
  byName: string
  toKind: "project_manager" | "owner"
  toUid: string | null
  toName?: string | null
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
  /** The scheduled job forwarded it after `forwardWindowDays` lapsed — nobody in Procurement did (`byName` is the system). */
  auto?: boolean
}

/** Written by the server when the receiver signs (src/lib/receipt-links.ts). */
export interface ReceiverReportFact {
  linkId: string
  receiverName: string
  receiverUserId: string | null
  phoneMasked: string
  lines: Array<{ poLineId: string; name: string; unit: string; counted: number; rejected: number; rejectReason: string | null; held?: number; holdReason?: HoldReasonCode | null; note: string | null }>
  note: string | null
  signatureData: string | null
  signedAt: string
  verifiedBy: "sms_code" | "login"
  /** Photos, the weighbridge ticket, a certificate — attached at the gate (PUR-06). */
  files?: Array<{ name: string; url: string; kind: "photo" | "ticket" | "cert" }>
}

/** Where a notice stands on the hub: nobody told yet, or forwarded to a receiver. (A signed report is no longer a state: his confirmation IS the receipt.) */
export function forwardState(d: Pick<DeskDelivery, "forwardedTo">): "none" | "forwarded" {
  return d.forwardedTo ? "forwarded" : "none"
}

/**
 * What a pending notice waits on, said as a fact (PUR-06): nobody in Procurement confirms a receipt, so the offer card and the dashboard
 * name the step instead — «وصلنا — حوّله للمستلم», or who it went to and since when he has not counted.
 */
export type NoticeWait =
  | { kind: "to_forward" }
  | { kind: "with_receiver"; name: string; days: number; auto: boolean; byLink: boolean; escalate: boolean; escalated: boolean }

export function noticeWait(d: Pick<DeskDelivery, "forwardedTo" | "deliveryDate" | "escalation" | "status" | "closedByReceipt">, now: Date, escalateAfterDays = 2): NoticeWait {
  const fw = d.forwardedTo
  if (!fw) return { kind: "to_forward" }
  const days = daysUncounted(d, now)
  return { kind: "with_receiver", name: fw.name, days, auto: Boolean(fw.auto), byLink: !fw.userId, escalate: needsEscalation(d, now, escalateAfterDays), escalated: Boolean(d.escalation) }
}

const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0)

/** A receipt with no order: manual, naming no order and no award. */
export const isNoPo = (d: Pick<DeskDelivery, "source" | "poId" | "offerId">): boolean => d.source === "manual" && !d.poId && !d.offerId

/** Which segment a delivery belongs to: an unconfirmed one is on the way, a manual one with no order is "no PO", the rest are receipts. */
export function receiptSegment(d: DeskDelivery): "transit" | "recs" | "nopo" {
  if (d.status !== "confirmed") return "transit"
  return isNoPo(d) ? "nopo" : "recs"
}

// ---------------------------------------------------------------------------
// On the way
// ---------------------------------------------------------------------------

/** A notice still open: announced, not counted, its order not cancelled. */
export interface NoticeRow {
  id: string
  delivery: DeskDelivery
  po: PurchaseOrder | null
  state: ReceiptState
  day: string
  daysFromNow: number | null
  /** `fwd`: nobody told yet · `count`: forwarded and the day reached · `transit`: forwarded, the day not yet here. */
  stage: "fwd" | "count" | "transit"
  /** Whole days since the delivery day (0 before it) — what «بانتظار عدّه منذ» says. */
  uncounted: number
  escalate: boolean
}

const noticeStage = (d: DeskDelivery, daysAway: number | null): NoticeRow["stage"] => (!d.forwardedTo ? "fwd" : daysAway != null && daysAway <= 0 ? "count" : "transit")

/** Every open notice, soonest day first (prototype: `D.ntc` without a receipt, on an order not cancelled). A notice with no order is a legacy one and stays. */
export function noticeRows(deliveries: DeskDelivery[], orders: PurchaseOrder[], now: Date, escalateAfterDays = 2): NoticeRow[] {
  const byId = new Map(orders.map((o) => [o.id, o]))
  const out: NoticeRow[] = []
  for (const d of deliveries) {
    if (d.status === "confirmed" || d.closedByReceipt) continue
    const po = d.poId ? byId.get(d.poId) || null : null
    if (po && po.status === "cancelled") continue
    const day = dayOf(d.deliveryDate)
    const away = day ? daysBetween(todayOf(now), day) : null
    out.push({ id: `n:${d.id}`, delivery: d, po, state: receiptState(d, now), day, daysFromNow: away, stage: noticeStage(d, away), uncounted: daysUncounted(d, now), escalate: needsEscalation(d, now, escalateAfterDays) })
  }
  return out.sort((a, b) => (a.day || "9999").localeCompare(b.day || "9999") || a.delivery.id.localeCompare(b.delivery.id))
}

/** The rows a segment lists: `transit` is every open notice, `fwd` those nobody has been told of, `count` the forwarded ones whose day has come. */
export function noticeRowsOf(segment: "transit" | "fwd" | "count", rows: NoticeRow[]): NoticeRow[] {
  return segment === "transit" ? rows : rows.filter((r) => (segment === "fwd" ? r.stage === "fwd" : r.stage === "count"))
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
  /** The order is complete after this receipt (nothing left to arrive). */
  complete: boolean | null
  /** What is still to arrive on the whole order, summed over its lines. */
  remaining: number | null
}

/** The lines a confirmed delivery shows: its receipt lines, else its legacy items counted in full. */
export function receiptLinesOf(d: Pick<DeskDelivery, "lines" | "items" | "source">): DeliveryLine[] {
  if (d.lines && d.lines.length) return d.lines
  // A legacy notice's items WERE the notice and a manual receipt's are what was typed — either way they are counted in full, with no figure to compare against.
  return (d.items || [])
    .map((it, i) => ({ poLineId: `i${i + 1}`, name: it.name || "", unit: it.unitOfMeasure || it.unit || "", noticeQuantity: 0, counted: num(it.quantity), accepted: num(it.quantity) }))
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
    complete: po ? !po.lines.some((l) => lineToArrive(l) > 0) : null,
    remaining: po ? round2(po.lines.reduce((s, l) => s + lineToArrive(l), 0)) : null,
  }
}

/** Confirmed receipts of a segment, newest first. */
export function receiptRows(deliveries: DeskDelivery[], orders: PurchaseOrder[], segment: "recs" | "nopo", now: Date): ReceiptRow[] {
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
  return [d.docNumber, d.poNumber, po?.docNumber, d.supplierName, po?.supplierName, d.rfqTitle, po?.rfqTitle, d.receivedByName, d.deliveryPersonName, d.paperNoteNumber, d.vehiclePlate, d.notes, d.invoiceNumber, ...receiptLinesOf(d).map((l) => l.name)]
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
  /** RC-05: one delivery site, in every package — a warehouse, a work site or (with Projects) a project's site. */
  site?: SiteFilter | null
}

/** A delivery site as the desk filter reads it: its id, the stores that are it, and its project. */
export interface SiteFilter {
  id: string
  warehouseIds: string[]
  projectId: string | null
}

/** The filter for one site: its own store, and — for a project's site — the project's stores. */
export function siteFilterOf(site: { id: string; warehouseId?: string | null; projectId?: string | null }, warehouses: ReadonlyArray<{ id: string; projectId?: string | null }>): SiteFilter {
  const ids = new Set<string>()
  if (site.warehouseId) ids.add(site.warehouseId)
  if (site.projectId) for (const w of warehouses) if (w.projectId === site.projectId) ids.add(w.id)
  return { id: site.id, warehouseIds: [...ids], projectId: site.projectId || null }
}

/** Whether a delivery went (or goes) to the site: the site its order froze, the site a manual receipt named, its store, or its project. */
export function siteMatches(d: DeskDelivery, po: PurchaseOrder | null, site: SiteFilter | null | undefined): boolean {
  if (!site) return true
  const poSite = po?.site?.id || null
  if (poSite) return poSite === site.id
  if (d.deliverySiteId) return d.deliverySiteId === site.id
  const wh = d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId || d.manualDraft?.warehouseId || null
  if (wh && site.warehouseIds.includes(wh)) return true
  const project = projectOf(d, po)
  return Boolean(site.projectId && project === site.projectId)
}

const projectOf = (d: DeskDelivery, po: PurchaseOrder | null) => d.projectId || po?.projectId || null

export const isWorkshopOrder = (po: Pick<PurchaseOrder, "purchaseSource"> | null | undefined): boolean => po?.purchaseSource?.kind === "mfg_purchase"

export function placeMatches(projectId: string | null, po: PurchaseOrder | null, filter: string | null): boolean {
  if (!filter) return true
  if (filter === PLACE_WORKSHOP) return isWorkshopOrder(po)
  if (filter === PLACE_GENERAL) return !projectId && !isWorkshopOrder(po)
  return projectId === filter
}

/** The five counts, after the search and the place filter — so the tabs say how many of what you are looking for sit behind each. */
export function segmentCounts(deliveries: DeskDelivery[], orders: PurchaseOrder[], filter: DeskFilter, now: Date, escalateAfterDays = 2): Record<ReceiptSegment, number> {
  const open = noticeRows(deliveries, orders, now, escalateAfterDays).filter((r) => noticeRowMatches(r, filter))
  const byId = new Map(orders.map((o) => [o.id, o]))
  const keep = (d: DeskDelivery) => {
    const po = d.poId ? byId.get(d.poId) || null : null
    return placeMatches(projectOf(d, po), po, filter.projectId) && siteMatches(d, po, filter.site) && deliveryMatches(filter.term, d, po)
  }
  return {
    transit: open.length,
    fwd: noticeRowsOf("fwd", open).length,
    count: noticeRowsOf("count", open).length,
    recs: deliveries.filter((d) => receiptSegment(d) === "recs" && keep(d)).length,
    nopo: deliveries.filter((d) => receiptSegment(d) === "nopo" && keep(d)).length,
  }
}

export function noticeRowMatches(r: NoticeRow, filter: DeskFilter): boolean {
  if (!placeMatches(projectOf(r.delivery, r.po), r.po, filter.projectId)) return false
  if (!siteMatches(r.delivery, r.po, filter.site)) return false
  return deliveryMatches(filter.term, r.delivery, r.po)
}

export function receiptRowMatches(r: ReceiptRow, filter: DeskFilter): boolean {
  if (!placeMatches(projectOf(r.delivery, r.po), r.po, filter.projectId)) return false
  if (!siteMatches(r.delivery, r.po, filter.site)) return false
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
// On the way — the row's pill and its shipment
// ---------------------------------------------------------------------------

export type NoticePill =
  | { kind: "to_forward"; tone: "bad" | "warn" }
  | { kind: "auto_forwarded" }
  | { kind: "escalate"; days: number }
  | { kind: "uncounted"; days: number }
  | { kind: "in_days"; days: number | null }

/** First match wins, in the prototype's order: a notice still with us is OUR task (red from its day on, amber before it); an uncounted one
 * past the policy window is red; one forwarded automatically is tagged; one whose day passed waits for the count; else how far off it is. */
export function noticePill(r: NoticeRow): NoticePill {
  const d = r.delivery
  if (r.stage === "fwd") return { kind: "to_forward", tone: r.daysFromNow != null && r.daysFromNow <= 0 ? "bad" : "warn" }
  if (r.escalate) return { kind: "escalate", days: r.uncounted }
  if (d.forwardedTo?.auto && r.stage === "transit") return { kind: "auto_forwarded" }
  if (r.stage === "count") return { kind: "uncounted", days: r.uncounted }
  return { kind: "in_days", days: r.daysFromNow }
}

const createdKey = (d: DeskDelivery) => `${dayOf(d.deliveryDate) || "9999"}|${isoOf(d.createdAt) || ""}|${d.id}`

/**
 * "Shipment n of m" for a notice on an order. `n` is its stored sequence (REP1, REP2 — NFR-07) and, for a notice written before the
 * sequence was stored, its place among the order's notices by day. `m` is said only when the order has two or more notices.
 */
export function shipmentOrdinal(d: DeskDelivery, deliveries: DeskDelivery[], po: PurchaseOrder | null): { n: number; m: number | null } | null {
  if (!po) return null
  const mine = deliveries.filter((x) => x.poId === po.id && isNotice(x)).sort((a, b) => createdKey(a).localeCompare(createdKey(b)))
  const derived = mine.findIndex((x) => x.id === d.id) + 1
  const n = Number(d.seq) > 0 ? Number(d.seq) : derived
  if (n <= 0 || mine.length < 2) return null
  return { n, m: mine.length }
}

const isNotice = (d: Pick<DeskDelivery, "source" | "noNotice">) => d.source !== "manual" && !d.noNotice
const noticeKey = (d: DeskDelivery) => `${isoOf(d.createdAt) || "9999"}|${d.id}`

/** The notice's place among its order's notices, by when each was written —
 * stable, since a notice is never re-dated. Null for a receipt with no notice. */
export function noticeOrdinal(d: DeskDelivery, deliveries: DeskDelivery[]): number | null {
  if (!d.poId || !isNotice(d)) return null
  if (Number(d.seq) > 0) return Number(d.seq)
  const mine = deliveries
    .filter((x) => x.poId === d.poId && isNotice(x) && x.id !== d.id)
    .concat(d)
    .sort((a, b) => noticeKey(a).localeCompare(noticeKey(b)))
  return mine.findIndex((x) => x.id === d.id) + 1
}

/** Our number for the supplier's notice (`ASN-2026/126-2`) — derived, see `noticeNumberFor`. */
export function noticeNumberOf(d: DeskDelivery, deliveries: DeskDelivery[], po?: Pick<PurchaseOrder, "docNumber"> | null): string | null {
  return noticeNumberFor(po?.docNumber || d.poNumber, noticeOrdinal(d, deliveries))
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

/** Which module recorded the receipt: Procurement when it typed it by hand;
 * otherwise the module that keeps the place — a buyer who received it himself
 * still recorded it in that place's module (prototype `recM`), and is flagged
 * separately (`selfReceived`). */
export function recordedBy(d: Pick<DeskDelivery, "source"> & { receiverModule?: ReceiverModule | null }, kind: DestKind | null): RecordedBy {
  if (d.source === "manual") return "procurement"
  if (d.receiverModule) return d.receiverModule
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

/** The need an order answers, as the trail names it: its reference, who asked, and for what. */
export interface TrailNeed {
  ref: string
  by: string
  for: string
}

type NeedLike = { poId: string | null; refLabel: string; requestedBy: string; projectName: string | null; context: string; source: { kind: string; workOrderId?: string; purchaseRequestId?: string } }

/** The need behind an order — the one the order was raised from (by id), else the one its source names. */
export function needForOrder(needs: NeedLike[], po: Pick<PurchaseOrder, "id" | "purchaseSource">): TrailNeed | null {
  const src = po.purchaseSource
  const n =
    needs.find((x) => x.poId === po.id) ||
    (src?.purchaseRequestId
      ? needs.find((x) => x.source.kind === src.kind && x.source.purchaseRequestId === src.purchaseRequestId && (x.source.workOrderId || null) === (src.workOrderId || null))
      : undefined)
  return n ? { ref: n.refLabel, by: n.requestedBy, for: n.projectName || n.context || "" } : null
}

export interface TrailFacts {
  /** The need the order answers, when the needs desk knows it. */
  need?: TrailNeed | null
  /** Our number for the supplier's notice (`noticeNumberOf`). */
  noticeNumber?: string | null
}

/** Pure: the trail of a receipt on an order. Rendering is the screen's. */
export function receiptTrail(d: DeskDelivery, po: PurchaseOrder & PoExtras, facts: TrailFacts = {}): TrailStep[] {
  const src = po.purchaseSource?.kind || null
  const fw = d.forwardedTo || null
  const held = (d.lines || []).some((l) => num(l.held) > 0)
  const need = facts.need || null
  const priceHold = (po.financeHolds || []).find((h) => h.state === "open" && h.reason === "price") || null
  const paid = [...(po.financePayments || [])].filter((p) => p.kind !== "adv").sort((a, b) => (b.valueDate || "").localeCompare(a.valueDate || ""))[0] || null
  const finance: TrailStep = priceHold
    ? { key: "finance", state: "bad", at: priceHold.at || null, variant: "held_price", params: {} }
    : paid
      ? { key: "finance", state: "ok", at: paid.valueDate || null, variant: "paid", params: {} }
      : po.status === "closed"
        ? { key: "finance", state: "ok", at: po.closedAt || null, variant: "closed", params: {} }
        : { key: "finance", state: "now", at: null, variant: "match", params: {} }
  const steps: TrailStep[] = [
    need
      ? { key: "requested", state: "ok", at: null, variant: "need", params: { ref: need.ref, by: need.by, for: need.for } }
      : { key: "requested", state: "ok", at: null, variant: src ? `source_${src}` : "direct", params: {} },
    { key: "purchased", state: "ok", at: po.approvedAt || po.createdAt || null, variant: "po", params: { number: po.docNumber, supplier: po.supplierName, rfq: po.rfqTitle || "" } },
    d.noNotice
      ? { key: "notified", state: "bad", at: null, variant: "none", params: {} }
      : { key: "notified", state: "ok", at: isoOf(d.createdAt), variant: "notice", params: { number: facts.noticeNumber || "", day: dayOf(d.deliveryDate), window: d.deliveryWindow || "", note: d.paperNoteNumber || "", driver: d.deliveryPersonName || "" } },
    fw
      ? { key: "forwarded", state: "ok", at: fw.at, variant: fw.auto ? "auto" : fw.userId ? "member" : "link", params: { name: fw.name, phone: fw.phoneMasked, by: fw.byName } }
      : { key: "forwarded", state: "bad", at: null, variant: d.noNotice ? "unannounced" : "direct", params: {} },
    { key: "received", state: "ok", at: d.confirmedAt || d.deliveryDate || null, variant: d.confirmedVia === "login" ? "login" : d.confirmedVia === "sms_code" || d.receiverReport ? "link" : "gate", params: { receiver: d.receivedByName || "", number: d.docNumber || "" } },
    { key: "went", state: held ? "now" : "ok", at: null, variant: held ? "held" : "landed", params: {} },
    finance,
  ]
  return steps
}

// ---------------------------------------------------------------------------
// The receipt's own log — assembled from what the documents already say
// ---------------------------------------------------------------------------

export interface ReceiptLogEntry {
  at: string
  action: "noticed" | "forwarded" | "forwarded_auto" | "escalated" | "recorded" | "regularised" | "expensed" | "po_raised" | "draft_confirmed"
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

export function receiptLog(d: DeskDelivery, po: PurchaseOrder | null, noticeNumber: string | null = null): ReceiptLogEntry[] {
  const out: ReceiptLogEntry[] = []
  const created = isoOf(d.createdAt)
  if (created && !d.noNotice && d.source !== "manual") out.push({ at: created, action: "noticed", by: d.supplierName || "", params: { day: dayOf(d.deliveryDate), notice: noticeNumber || "" } })
  const fw = d.forwardedTo
  if (fw?.at) out.push({ at: fw.at, action: fw.auto ? "forwarded_auto" : "forwarded", by: fw.byName, params: { name: fw.name } })
  if (d.escalation?.at) out.push({ at: d.escalation.at, action: "escalated", by: d.escalation.byName, params: { to: d.escalation.toName || "" } })
  const confirmed = isoOf(d.confirmedAt)
  if (d.status === "confirmed" && confirmed) out.push({ at: confirmed, action: "recorded", by: d.confirmedByName || d.receivedByName || "", params: { number: d.docNumber || "" } })
  for (const e of po?.log || []) {
    if (e.params?.deliveryId !== d.id || e.action !== "created") continue
    out.push({ at: e.at, action: "po_raised", by: e.byName, params: { number: po?.docNumber || "" } })
  }
  if (d.manualDraft?.state === "confirmed" && d.manualDraft.confirmedAt) out.push({ at: d.manualDraft.confirmedAt, action: "draft_confirmed", by: d.manualDraft.confirmedByName || "", params: { number: d.docNumber || "" } })
  const reg = isoOf(d.regularisedAt)
  if (reg) out.push({ at: reg, action: d.regularisation === "expense" ? "expensed" : "regularised", by: d.regularisedByName || "", params: { number: d.poNumber || "" } })
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

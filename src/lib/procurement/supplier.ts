// The supplier's side of a purchase order (PRD 3.0 §5.1-7, §5.2-1, §7.4) —
// pure. What the supplier portal derives from an order addressed to him:
// which segment it sits in, whether he may still accept it or announce a
// shipment, what a notice may carry (never more than is still to arrive),
// and the delivery document itself — built in EXACTLY today's `deliveries`
// shape (the contractor's confirm flow, the work queue, the money flow and
// the guest API all read that shape) with the order's optional fields laid
// over it. Nothing here writes; the page does, and the tests read this.

import { daysLate, dayOf, lineOutstanding, lineToArrive, poStatus, todayOf } from "./po"
import { noticeLinesFromPo } from "./receipts"
import type { DeliveryLine, PoLine, PoStatus, PurchaseOrder } from "./types"

const num = (n: number | null | undefined) => (Number.isFinite(Number(n)) ? Number(n) : 0)

// ---------------------------------------------------------------------------
// Segments — what the supplier's page groups by
// ---------------------------------------------------------------------------

export const SUPPLIER_SEGMENTS = ["to_accept", "in_delivery", "done", "all"] as const
export type SupplierSegment = (typeof SUPPLIER_SEGMENTS)[number]

/** Where an order sits for the supplier — or null when it is not his to see
 * yet: an order the buyer has not dispatched (awaiting approval, approved
 * but unsent, or cancelled before it ever reached him) is the buyer's draft. */
export function supplierSegmentOf(po: PurchaseOrder): Exclude<SupplierSegment, "all"> | null {
  const st = poStatus(po)
  if (st === "sent") return "to_accept"
  if (st === "in_delivery" || st === "part_received" || st === "accepted") return "in_delivery"
  if (st === "received" || st === "closed") return "done"
  if (st === "cancelled") return po.sentAt || po.log?.some((l) => l.action === "sent") ? "done" : null
  return null
}

/** The orders the supplier sees at all, newest dispatch first. */
export function visibleSupplierOrders(orders: PurchaseOrder[]): PurchaseOrder[] {
  return orders
    .filter((po) => supplierSegmentOf(po) != null)
    .sort((a, b) => (b.sentAt || b.createdAt || "").localeCompare(a.sentAt || a.createdAt || ""))
}

// ---------------------------------------------------------------------------
// The award, as the supplier may know it (22 Sep review)
// ---------------------------------------------------------------------------

/** The status Procurement's award writes. */
export const AWARDED = "مقبول"
/** What a supplier reads while the award is still internal. */
export const UNDER_REVIEW = "قيد المراجعة"
/** What a supplier reads when the award was withdrawn before its order ever
 * reached him — derived, never stored. "Under review" would have waited forever. */
export const CLOSED_UNAWARDED = "مغلق"

export interface AwardFacts {
  status?: string | null
  poId?: string | null
  /** Written with the award since 22 Sep: the award is internal until its
   * purchase order is approved by Finance and sent. */
  awaitingOrderApproval?: boolean | null
}

/**
 * Whether the supplier has been told of this award.
 *
 * Procurement's award is a decision inside the buying company; the supplier
 * learns of it only when Finance has approved the purchase order and it has
 * been SENT — Finance may still refuse, and a supplier who had already been
 * told "accepted" would be committing stock against money nobody approved.
 * So an award that carries a purchase order is disclosed exactly when that
 * order is the supplier's to see; one still waiting for its order is not.
 * An award from before the purchase-order era (neither field) was told at the
 * time, and stays told.
 */
export function awardDisclosed(offer: AwardFacts, ordersById: ReadonlyMap<string, PurchaseOrder>): boolean {
  if (offer.poId) {
    const po = ordersById.get(offer.poId)
    return po ? supplierSegmentOf(po) != null : false
  }
  return !offer.awaitingOrderApproval
}

/**
 * The offer's status as the supplier's screens should read it. Every supplier
 * surface — badges, counts, the guarantee form, the delivery button, the bell —
 * goes through this, so none of them can announce an award Finance has not
 * approved.
 */
export function supplierOfferStatus<T extends AwardFacts>(offer: T, ordersById: ReadonlyMap<string, PurchaseOrder>): string {
  const status = offer.status || ""
  if (status === AWARDED && !awardDisclosed(offer, ordersById)) {
    const po = offer.poId ? ordersById.get(offer.poId) : undefined
    return po?.status === "cancelled" ? CLOSED_UNAWARDED : UNDER_REVIEW
  }
  return status
}

/** An offer list with each status replaced by what the supplier may see. */
export function asSupplierSees<T extends AwardFacts>(offers: T[], ordersById: ReadonlyMap<string, PurchaseOrder>): T[] {
  return offers.map((o) => {
    const shown = supplierOfferStatus(o, ordersById)
    return shown === o.status ? o : { ...o, status: shown }
  })
}

export function inSupplierSegment(po: PurchaseOrder, segment: SupplierSegment): boolean {
  const s = supplierSegmentOf(po)
  if (s == null) return false
  return segment === "all" || s === segment
}

export function supplierSegmentCounts(orders: PurchaseOrder[]): Record<SupplierSegment, number> {
  const out: Record<SupplierSegment, number> = { to_accept: 0, in_delivery: 0, done: 0, all: 0 }
  for (const po of orders) {
    const s = supplierSegmentOf(po)
    if (s == null) continue
    out[s]++
    out.all++
  }
  return out
}

// ---------------------------------------------------------------------------
// What the supplier may do
// ---------------------------------------------------------------------------

/** Sent and not yet answered. */
export const supplierCanAccept = (po: PurchaseOrder): boolean => po.status === "sent"

/** Accepted, with something still to ship. Several notices per order are
 * fine — one per shipment. */
export const supplierCanNotify = (po: PurchaseOrder): boolean => po.status === "accepted" && po.lines.some((l) => lineToArrive(l) > 0)

/** The earliest date the supplier may commit to: today, in his own calendar. */
export const minPromiseDay = (now: Date): string => todayOf(now)

export function promiseDateValid(date: string | null | undefined, now: Date): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  return date >= todayOf(now)
}

/** Days the notice's date sits after the promise — what the buyer will read
 * as "arriving late" the moment the notice is sent; 0 when on or before it. */
export function noticeLatenessDays(po: Pick<PurchaseOrder, "promisedDate">, noticeDate: string): number {
  if (!po.promisedDate || !noticeDate) return 0
  const promise = Date.parse(`${dayOf(po.promisedDate)}T00:00:00Z`)
  const notice = Date.parse(`${dayOf(noticeDate)}T00:00:00Z`)
  if (!Number.isFinite(promise) || !Number.isFinite(notice)) return 0
  return Math.max(0, Math.round((notice - promise) / 86400000))
}

/** The supplier's view of a line: what the order says, what the gate said, what he still owes. */
export interface SupplierLineView {
  id: string
  name: string
  unit: string
  ordered: number
  accepted: number
  rejected: number
  held: number
  cancelled: number
  outstanding: number
  /** What may still arrive at the gate — the ceiling of a notice. */
  toArrive: number
}

export function supplierLineView(l: PoLine): SupplierLineView {
  return {
    id: l.id,
    name: l.name,
    unit: l.unit,
    ordered: num(l.quantity),
    accepted: num(l.accepted),
    rejected: num(l.rejected),
    held: num(l.held),
    cancelled: num(l.cancelled),
    outstanding: lineOutstanding(l),
    toArrive: lineToArrive(l),
  }
}

export const supplierLateDays = (po: PurchaseOrder, now: Date): number => daysLate(po, now)

export { poStatus as supplierOrderStatus }
export type { PoStatus }

// ---------------------------------------------------------------------------
// The notice — validation, codes not sentences
// ---------------------------------------------------------------------------

export const NOTICE_ERROR_CODES = ["date_missing", "date_past", "nothing_to_ship", "over_outstanding", "unknown_line", "not_accepted"] as const
export type NoticeErrorCode = (typeof NOTICE_ERROR_CODES)[number]

export interface NoticeError {
  code: NoticeErrorCode
  poLineId?: string
  params: Record<string, string | number>
}

export interface NoticeLineInput {
  poLineId: string
  quantity: number
}

/** The notice's lines as typed, against the order. A line above what may
 * still arrive is refused, not trimmed; zero lines are simply left out. */
export function noticeErrors(po: PurchaseOrder, lines: NoticeLineInput[], deliveryDate: string | null | undefined, now: Date): NoticeError[] {
  const out: NoticeError[] = []
  if (!supplierCanNotify(po)) out.push({ code: "not_accepted", params: {} })
  if (!deliveryDate) out.push({ code: "date_missing", params: {} })
  else if (deliveryDate < todayOf(now)) out.push({ code: "date_past", params: { date: deliveryDate } })
  const byId = new Map(po.lines.map((l) => [l.id, l]))
  let anything = false
  for (const l of lines) {
    const line = byId.get(l.poLineId)
    if (!line) {
      out.push({ code: "unknown_line", poLineId: l.poLineId, params: {} })
      continue
    }
    const q = num(l.quantity)
    if (q <= 0) continue
    anything = true
    const max = lineToArrive(line)
    if (q > max + 1e-9) out.push({ code: "over_outstanding", poLineId: l.poLineId, params: { line: line.name, quantity: q, max, unit: line.unit } })
  }
  if (!anything) out.push({ code: "nothing_to_ship", params: {} })
  return out
}

/** The default form: everything still to arrive, per line. */
export const defaultNoticeLines = (po: PurchaseOrder): NoticeLineInput[] => noticeLinesFromPo(po).map((l) => ({ poLineId: l.poLineId, quantity: l.noticeQuantity }))

/** The notice's `DeliveryLine[]` — only lines with a quantity. */
export function noticeDeliveryLines(po: PurchaseOrder, lines: NoticeLineInput[]): DeliveryLine[] {
  const byId = new Map(po.lines.map((l) => [l.id, l]))
  const out: DeliveryLine[] = []
  for (const l of lines) {
    const line = byId.get(l.poLineId)
    const q = num(l.quantity)
    if (!line || q <= 0) continue
    out.push({ poLineId: line.id, name: line.name, unit: line.unit, noticeQuantity: q })
  }
  return out
}

// ---------------------------------------------------------------------------
// The delivery document — today's shape, plus the order's fields
// ---------------------------------------------------------------------------

export const DELIVERY_WINDOWS = ["morning", "afternoon", "evening"] as const
export type DeliveryWindow = (typeof DELIVERY_WINDOWS)[number]

/** A legacy item row, as the contractor's confirm flow and the printable
 * receipt read it (`{name, quantity, unitOfMeasure}` — the guest API's shape). */
export interface LegacyDeliveryItem {
  name: string
  quantity: number
  unitOfMeasure: string
}

export interface NoticeInput {
  po: PurchaseOrder
  lines: NoticeLineInput[]
  /** `YYYY-MM-DD`. */
  deliveryDate: string
  deliveryWindow?: DeliveryWindow | null
  driverName?: string | null
  vehiclePlate?: string | null
  paperNoteNumber?: string | null
  notes?: string | null
  /** The uploaded note / certificates, when any. */
  fileUrl?: string | null
  supplier: { uid: string; orgId: string; name: string }
  /** The RFQ's creator — the award's `contractorId`; the preparer stands in when unknown. */
  contractorId?: string | null
  /** A `serverTimestamp()` in the page; anything in a test. */
  createdAt: unknown
}

export interface DeliveryNoticeDoc {
  // Today's shape — every reader of `deliveries` depends on these.
  rfqId: string | null
  offerId: string | null
  projectId: string | null
  contractorOrgId: string
  contractorId: string | null
  supplierOrgId: string
  supplierId: string
  supplierName: string
  deliveryPersonName: string | null
  handoverRecipientName: null
  deliveryDate: string
  notes: string | null
  rfqTitle: string
  items: LegacyDeliveryItem[]
  status: "pending_confirmation"
  createdAt: unknown
  // The order's fields (`DeliveryPoFields`).
  poId: string
  poNumber: string
  lines: DeliveryLine[]
  vehiclePlate: string | null
  paperNoteNumber: string | null
  deliveryWindow: string | null
  attachmentUrls?: string[]
}

const text = (s: string | null | undefined): string | null => {
  const t = (s || "").trim()
  return t ? t : null
}

/** `deliveryDate` is stored as an ISO timestamp, as today's supplier notice
 * stores it (`new Date("YYYY-MM-DD").toISOString()`); the receipts layer
 * reads its first ten characters either way. */
export function buildDeliveryNotice(input: NoticeInput): DeliveryNoticeDoc {
  const { po } = input
  const lines = noticeDeliveryLines(po, input.lines)
  const doc: DeliveryNoticeDoc = {
    rfqId: po.rfqId ?? null,
    offerId: po.offerId ?? null,
    projectId: po.projectId ?? null,
    contractorOrgId: po.organizationId,
    contractorId: input.contractorId || po.preparedById || null,
    supplierOrgId: input.supplier.orgId,
    supplierId: input.supplier.uid,
    supplierName: input.supplier.name,
    deliveryPersonName: text(input.driverName),
    handoverRecipientName: null,
    deliveryDate: new Date(`${dayOf(input.deliveryDate)}T00:00:00.000Z`).toISOString(),
    notes: text(input.notes),
    rfqTitle: po.rfqTitle || "",
    items: lines.map((l) => ({ name: l.name, quantity: l.noticeQuantity, unitOfMeasure: l.unit })),
    status: "pending_confirmation",
    createdAt: input.createdAt,
    poId: po.id,
    poNumber: po.docNumber,
    lines,
    vehiclePlate: text(input.vehiclePlate),
    paperNoteNumber: text(input.paperNoteNumber),
    deliveryWindow: input.deliveryWindow ?? null,
  }
  if (input.fileUrl) doc.attachmentUrls = [input.fileUrl]
  return doc
}

// ---------------------------------------------------------------------------
// Who hears of the notice — today's `delivery_notice`, addressed to the
// order's preparer as well as the RFQ's creator
// ---------------------------------------------------------------------------

export const deliveryNoticeLink = (deliveryId: string) => `/contractor/goods-received?tab=incoming&delivery=${deliveryId}`

/** The RFQ's creator and the order's preparer, once each, nobody twice. */
export function noticeRecipients(po: Pick<PurchaseOrder, "preparedById">, contractorId: string | null | undefined): string[] {
  const out: string[] = []
  for (const uid of [contractorId, po.preparedById]) {
    if (uid && !out.includes(uid)) out.push(uid)
  }
  return out
}

export interface DeliveryNoticeNotification {
  userId: string
  organizationId: string
  type: "delivery_notice"
  i18n: { title: "pn_delivery_notice_title"; message: "pn_delivery_notice"; params: { rfq: string; number: string } }
  title: string
  message: string
  offerId: string | null
  rfqId: string | null
  poId: string
  poNumber: string
  deliveryId: string
  link: string
  createdAt: string
  read: false
}

/** Exactly what `supplier/offers` writes today, with the order's number in
 * the text and a link that opens the notice on the goods-received desk. The
 * stored text is Arabic (push and the mobile app read it). */
export function buildDeliveryNoticeNotification(po: PurchaseOrder, userId: string, deliveryId: string, nowIso: string): DeliveryNoticeNotification {
  const rfq = po.rfqTitle || ""
  return {
    userId,
    organizationId: po.organizationId,
    type: "delivery_notice",
    i18n: { title: "pn_delivery_notice_title", message: "pn_delivery_notice", params: { rfq, number: po.docNumber } },
    title: "🚚 إشعار تسليم جديد",
    message: `قام المورد بإرسال إشعار تسليم لطلب عروض الأسعار: ${rfq} — أمر الشراء ${po.docNumber}`,
    offerId: po.offerId ?? null,
    rfqId: po.rfqId ?? null,
    poId: po.id,
    poNumber: po.docNumber,
    deliveryId,
    link: deliveryNoticeLink(deliveryId),
    createdAt: nowIso,
    read: false,
  }
}

// ---------------------------------------------------------------------------
// Legacy offers (no order) — bug B1: the items come from the RFQ, never from
// the offer, which has no `products`
// ---------------------------------------------------------------------------

export interface RfqProductLike {
  name?: string | null
  quantity?: number | string | null
  unitOfMeasure?: string | null
  unit?: string | null
}

/** The RFQ's products as delivery items, the way the guest route copies them. */
export function legacyItemsFromRfq(products: RfqProductLike[] | null | undefined): LegacyDeliveryItem[] {
  return (products || [])
    .filter((p) => p && (p.name || "").trim())
    .map((p) => ({
      name: (p.name || "").trim(),
      quantity: Math.max(0, Number(String(p.quantity ?? "").replace(/[,\s]/g, "")) || 0),
      unitOfMeasure: (p.unitOfMeasure || p.unit || "").trim(),
    }))
}

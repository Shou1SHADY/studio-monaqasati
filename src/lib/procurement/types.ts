// Procurement PRD 3.0 — the purchase order and what hangs off it.
//
// Until now an accepted offer WAS the order. It still is, for everything that
// already reads it (the supplier's portal, the tender lock, the project's money
// flow, the bell): awarding keeps writing the offer `مقبول` and the RFQ
// `Awarded`. The purchase order is a document laid OVER that award — number,
// approval, dispatch, the supplier's promise, line progress, close-out, rating —
// and an award made before this module existed simply has none (the legacy path:
// every screen must keep working when `poId` is absent).
//
// What is stored is only what somebody decided. Delivery progress (in delivery /
// part received / fully received), lateness, blocks, the approver, the Today
// queue and every report are DERIVED — see `po.ts`, `today.ts`, `reports.ts`.

export const PURCHASE_ORDERS = "purchaseOrders"
export const PROCUREMENT_SETTINGS = "procurementSettings"

/** Stored states — seven decisions. `in_delivery`/`part_received`/`received`
 * are derived from receipts while the stored state is `accepted`. */
export type PoStoredStatus =
  | "awaiting_approval"
  | "approved" // approved, not yet sent to the supplier
  | "sent" // sent — the supplier's acceptance clock runs
  | "accepted" // the supplier accepted and promised a date
  | "closed" // closed by Procurement: complete, or closed short
  | "cancelled"

export type PoStatus =
  | PoStoredStatus
  | "in_delivery"
  | "part_received"
  | "received"

/** How the order was born. `direct` = direct award (no competition);
 * `retroactive` = raised after the goods arrived, the owner alone approves it. */
export type PoBasis = "rfq" | "direct" | "retroactive"

export type PoSendChannel = "portal" | "whatsapp" | "email"

/** Why the award went to somebody other than the lowest price (PRD §5.1-5). */
export type AwardReasonCode =
  | "delivery_time"
  | "quality"
  | "payment_terms"
  | "past_performance"
  | "availability"
  | "other"

/** What Procurement decided about a quantity rejected at the gate (§5.2-8). */
export type RejectDecision = "replace" | "discount" | "reduce"

export type RejectReasonCode = "damaged" | "wrong_item" | "wrong_spec" | "short" | "sample" | "expired" | "excess" | "other"
export type HoldReasonCode = "certificate" | "test" | "consultant"

/** The non-blocking checklist at the gate (§6.3). */
export type ReceiptCheck = "delivery_note" | "weighbridge" | "certificate" | "photos" | "driver_signature"

export interface PoLine {
  /** Stable within the order: `l1`, `l2`, … */
  id: string
  name: string
  unit: string
  /** Ordered quantity. */
  quantity: number
  /** Unit price EXCLUDING VAT — null on a lump-sum order whose total nobody
   * broke down (a number that lies is worse than a missing one). */
  unitPrice: number | null
  /** Accepted at the gate — the sum of this line's receipts. */
  accepted: number
  /** Rejected at the gate, all receipts. */
  rejected: number
  /** Held for inspection and not yet released. */
  held: number
  /** Cancelled with the supplier ("the rest will not arrive"). */
  cancelled: number
  cancelReason?: string | null
  /** Procurement's decision on the rejected quantity, once taken. */
  rejectDecision?: RejectDecision | null
  rejectDecisionNote?: string | null
  rejectDecidedAt?: string | null
  /** Where the line came from. */
  boqItemId?: string | null
  rfqProductIndex?: number | null
  /** A piece line (PO-06): request units in one piece — 6 for «قطعة 6 م». `quantity` is then the number of pieces. */
  pk?: number | null
  /** The quantity the request asked for, in the request unit (175 for «175 م»). */
  need?: number | null
  /** The request unit, Arabic («م»); the line's `unit` is the pack's name («قطعة 6 م»). */
  base?: string | null
  /** The pack's name in both languages — the English reads «6 m bar». */
  packName?: { ar: string; en: string } | null
  /** The material's id and the specification key — the price history is by specification (R-28), never by category. */
  materialId?: string | null
  specKey?: string | null
}

export interface PoLogEntry {
  at: string // ISO
  byId: string
  byName: string
  /** A closed vocabulary rendered from `Procurement.log.*`. */
  action:
    | "created"
    | "approved"
    | "returned"
    | "resubmitted"
    | "sent"
    | "supplier_accepted"
    | "date_updated"
    | "reminded"
    | "received"
    | "remainder_cancelled"
    | "reject_decided"
    | "reject_discount_released"
    | "closed"
    | "cancelled"
    | "rated"
    | "supplier_declined"
    | "delivery_reported"
    | "delivery_reminded"
    | "invoice_uploaded"
    | "transfer_confirmed"
    | "transfer_missing"
    | "transfer_arrived_later"
    | "payment_reminded"
    | "warranty_registered"
    | "warranty_accepted"
    | "supplier_rated"
    | "message"
  note?: string | null
  /** Free parameters for the rendered sentence (channel, date, quantity…). */
  params?: Record<string, string | number> | null
}

export interface PoRating {
  /** Computed from receipts when the rating was filed — never typed. */
  onTime: boolean | null
  lateByDays: number
  inFull: boolean
  rejectPercent: number
  /** The two manual stars, 1–5. */
  conformity: number
  cooperation: number
  note?: string | null
  publishAnonymously: boolean
  byId: string
  byName: string
  at: string
}

/** The supplier's "I delivered": a date and a note, no quantity. It waits until the contractor records a receipt. */
export interface PoDeliveryReport {
  id: string
  at: string
  date: string
  note: string | null
  byId: string
  byName: string
  reminders: string[]
  closedAt?: string | null
  /** The receipt that answered it. */
  closedBy?: string | null
}

/** Where an order is delivered — frozen on the order when it is made; the supplier's link reads only this (PO-05, G-05). */
export interface PoSite {
  id: string | null
  name: string
  city?: string | null
  district?: string | null
  address?: string | null
  mapUrl?: string | null
  receiver?: { name: string; phone: string | null } | null
  access?: { unload?: "sup" | "us" | null; slot?: string | null; note?: string | null } | null
}

/** Every change of an order after it was sent is a new version with an event (PO-15). `sent` is version 1. */
export type PoVersionKind = "sent" | "cancel" | "date" | "close_short" | "decline"

export interface PoVersion {
  n: number
  at: string
  byId?: string | null
  byName: string
  kind: PoVersionKind
  note?: string | null
  params?: Record<string, string | number> | null
  /** The supplier read and accepted this version (`proc:PO:<no>:V<n>:ACC`). */
  acceptedAt?: string | null
  acceptedByName?: string | null
}

/** What the award recorded about the way the order was won (header tags). The reasons are structured, never free text alone. */
export interface PoTags {
  notLowest?: { why: string } | null
  lowComp?: { n: number; why: string } | null
  directOver?: { why: string } | null
}

/** An advance to a supplier with no supply record waits for the owner before it is asked for (PO-14). */
export interface PoAdvanceOwner {
  required: boolean
  approvedAt?: string | null
  approvedById?: string | null
  approvedByName?: string | null
}

/** The supplier's decline of an order he had not accepted yet. */
export interface PoSupplierDecline {
  at: string
  reason: "stock" | "price" | "date" | "other"
  note?: string
  byId: string
  byName: string
}

export interface PurchaseOrder {
  /** How the order ends, stamped at approval from the package of that moment (NFR-08): the goods counted, or Finance's payment. */
  closeOn?: "receipt" | "payment" | null
  id: string
  organizationId: string
  /** `PO-2026/014` — stored Latin, shown `ط.ش-2026/014` in Arabic. */
  docNumber: string
  status: PoStoredStatus
  basis: PoBasis

  // Where it came from — the award it is laid over.
  rfqId: string | null
  rfqTitle: string
  offerId: string | null
  projectId: string | null
  projectName?: string | null
  category?: string | null
  /** Carried through so a receipt can still close Manufacturing's request.
   * `kind`: mfg_purchase (a work order's shortfall) · project_request (a
   * project's internal request) · stock_gap (an item at or below its minimum). */
  purchaseSource?: { kind: string; workOrderId?: string; purchaseRequestId?: string; projectId?: string; warehouseId?: string; itemId?: string } | null
  /** An order placed ON a live price agreement (basis `direct`): its prices are
   * the agreement's, already competed, so the direct-purchase cap and the split
   * check do not apply to it. */
  agreementId?: string | null
  agreementNo?: string | null

  // The supplier, as the award knew it.
  supplierOrgId: string // "guest" for an off-platform supplier
  supplierUserId: string | null
  supplierName: string
  isGuestSupplier: boolean

  lines: PoLine[]
  /** Total EXCLUDING VAT as awarded — the offer's price. Always set, also on a
   * lump-sum order whose lines carry no unit price. */
  totalExVat: number
  vatRate: number // 0.15
  paymentTerms?: string | null
  deliveryLocation?: string | null
  deliveryDistrict?: string | null
  /** What the offer said about lead time, in days, when it said anything. */
  leadTimeDays?: number | null
  /** One order per supplier × delivery site (G-05): the key that makes the pair, and the site as it was when the order was made. */
  siteKey?: string | null
  site?: PoSite | null
  /** The supplier is not VAT-registered: the order carries no VAT (`vatRate` 0, R-18). */
  noVat?: boolean
  /** What the supplier commits to by accepting, `YYYY-MM-DD` — his offer's arrival, else approval + acceptance window + lead time. */
  dueDate?: string | null
  /** The version of the order the supplier is looking at; absent on an order made before versions. */
  ver?: number
  versions?: PoVersion[] | null
  tags?: PoTags | null
  advanceOwner?: PoAdvanceOwner | null

  // Award facts — what the Exceptions report reads.
  offersCount: number
  lowestOfferTotal: number | null
  awardReasonCode?: AwardReasonCode | null
  awardReasonText?: string | null
  shortCompetition: boolean
  noOfficialQuote: boolean

  // People and dates (ISO strings; the log keeps the full trail).
  preparedById: string
  preparedByName: string
  createdAt: string
  approverKind: "manager" | "owner"
  approvedById?: string | null
  approvedByName?: string | null
  approvedAt?: string | null
  returnedReason?: string | null
  sentAt?: string | null
  sentById?: string | null
  sentByName?: string | null
  sentChannel?: PoSendChannel | null
  supplierAcceptedAt?: string | null
  /** What we asked for at the award («مطلوب التسليم قبل»), `YYYY-MM-DD` — the
   * supplier's promise may differ; this is the need we told him. */
  requestedDeliveryDate?: string | null
  /** The supplier's committed delivery date, `YYYY-MM-DD`. */
  promisedDate?: string | null
  /** Who recorded the acceptance: the supplier in the portal or from the order link, or us for them. */
  acceptanceRecordedBy?: "supplier" | "buyer" | "link" | null
  closedAt?: string | null
  closedShort?: boolean
  closeReason?: string | null
  cancelledReason?: string | null

  rating?: PoRating | null
  /** The payment terms frozen on the order when it was issued — shares of the invoice and the days each is due after its date. */
  termsList?: { pct: number; days: number }[] | null
  supplierAcceptNote?: string | null
  supplierDecline?: PoSupplierDecline | null
  deliveryReports?: PoDeliveryReport[] | null
  log: PoLogEntry[]
  updatedAt?: unknown
}

// ---------------------------------------------------------------------------
// Receipts — `deliveries` stays the store of the supplier's notice AND the
// goods receipt. A delivery that belongs to an order carries these extra,
// optional fields; one without them is a legacy delivery and keeps its
// "confirm all" behaviour.
// ---------------------------------------------------------------------------

export interface DeliveryLine {
  poLineId: string
  name: string
  unit: string
  /** What the supplier's notice says is on the truck. */
  noticeQuantity: number
  /** The gate's count — typed blind, never prefilled from the notice. */
  counted?: number
  rejected?: number
  rejectReason?: RejectReasonCode | null
  rejectNote?: string | null
  held?: number
  holdReason?: HoldReasonCode | null
  /** counted − rejected − held: the ceiling of what may be invoiced. */
  accepted?: number
}

/** «مرفقات الجودة مع الشحنة»: a mill certificate, a conformity certificate. */
export const QUALITY_PAPERS = ["mill", "conf"] as const
export type QualityPaper = (typeof QUALITY_PAPERS)[number]

export interface DeliveryPoFields {
  poId?: string | null
  poNumber?: string | null
  /** `GRN-2026/031`, drawn when the receipt is recorded. */
  docNumber?: string | null
  lines?: DeliveryLine[]
  vehiclePlate?: string | null
  /** The driver's or rep's mobile, from the supplier's notice. */
  driverPhone?: string | null
  /** Quality papers the supplier says travel with the load. */
  qualityPapers?: QualityPaper[] | null
  paperNoteNumber?: string | null
  deliveryWindow?: string | null
  checklist?: ReceiptCheck[]
  receiverUserId?: string | null
  landedWarehouseId?: string | null
  /** Value posted to the books for this receipt, EXCLUDING VAT (null = none). */
  postedNet?: number | null
  /** The receiver is also the order's preparer — allowed, and flagged. */
  selfReceived?: boolean
  /** The truck came with no supplier notice: a contractor-born delivery
   * recorded at the gate (or by Procurement's manual form against an order). */
  noNotice?: boolean
  /** A receipt with no order, booked as a cash expense instead of regularised
   * by a retroactive order (a note-only marker: Finance still books it). */
  regularisation?: "expense" | null
  /** The receiver's signature on screen, when taken (data URL). */
  receiverSignatureData?: string | null
  /** The receiver's free note ("two wet cartons set aside"). */
  receiptNote?: string | null
  /** Set when the notice was forwarded to somebody (`receiptLinks`), and when
   * that somebody signed. The receiving desk reads the whole records; Today asks
   * only whether anyone has been told to receive this yet. */
  forwardedTo?: unknown
  receiverReport?: unknown
}

/** What the pure layer needs to know about a delivery. */
export interface ReceiptFact extends DeliveryPoFields {
  id: string
  status: "pending_confirmation" | "confirmed"
  supplierName?: string | null
  /** ISO date or `YYYY-MM-DD`. */
  deliveryDate?: string | null
  confirmedAt?: string | null
  /** Who recorded it — the exceptions report names them. Absent on receipts
   * written before 24 Sep. */
  confirmedByName?: string | null
  regularisedByName?: string | null
  source?: "manual" | null
  offerId?: string | null
  rfqId?: string | null
  projectId?: string | null
}

// ---------------------------------------------------------------------------
// Policies (§6.4) — `procurementSettings/{orgId}`; absent fields fall back to
// the PRD's reference values.
// ---------------------------------------------------------------------------

export interface ProcurementPolicies {
  /** The most a holder of `po.approve` may approve; above it, the owner. */
  managerApprovalLimit: number
  /** Direct orders to one supplier inside `splitWindowDays` may not pass this
   * without the owner. */
  directPurchaseCap: number
  competitionThreshold: number
  minOffers: number
  overReceiptTolerancePercent: number
  rfqWindowDays: number
  awardCycleDays: number
  supplierAcceptanceDays: number
  splitWindowDays: number
  /** How many days before a delivery a notice still sitting with Procurement
   * becomes somebody's task to forward (§5.2-3b). */
  forwardWindowDays: number
  /** Procurement → Finance → Supplier (customer review, 27 Sep 2026): once
   * approved, an order to a supplier registered on the portal is sent to him
   * there at once, in the approver's name — nobody has to remember to press
   * "Send". A guest supplier has no portal: his order waits for WhatsApp or
   * e-mail, and whoever may send it is told. ON by default. */
  sendOnApproval: boolean
  /** The default offers deadline of a new RFQ: today + this many days (PRD §14). */
  rfqDefaultDays: number
  /** The supplier's lead time inside «آخر يوم للطلب»: need date − this − the RFQ cycle − the award cycle. */
  supplyLeadDays: number
  /** Within this percent of the lowest complete offer still counts as the lowest — no reason needed. */
  tieBandPct: number
  /** Days after a delivery notice before an uncounted delivery is escalated (the reminder goes at 2 whatever this is). */
  escalateAfterDays: number
  /** An advance to a supplier with no record on the platform needs the owner's approval before it is asked for. */
  advanceUnknownSupplierOwner: boolean
  /** Inventory's stock check before buying, then we proceed with the whole quantity. */
  inventoryReplyDays: number
  /** The workshop's make-or-buy answer, then the decision returns to Procurement. */
  workshopReplyDays: number
}

export const DEFAULT_POLICIES: ProcurementPolicies = {
  managerApprovalLimit: 150_000,
  directPurchaseCap: 5_000,
  competitionThreshold: 20_000,
  minOffers: 3,
  overReceiptTolerancePercent: 5,
  rfqWindowDays: 3,
  awardCycleDays: 2,
  supplierAcceptanceDays: 1,
  splitWindowDays: 30,
  forwardWindowDays: 1,
  sendOnApproval: true,
  rfqDefaultDays: 3,
  supplyLeadDays: 10,
  tieBandPct: 0.5,
  escalateAfterDays: 2,
  advanceUnknownSupplierOwner: true,
  inventoryReplyDays: 1,
  workshopReplyDays: 1,
}

/** What an approval needs to know about the supplier — read from the
 * supplier's own platform profile; `null` = unknown, which never blocks a guest. */
export interface SupplierFacts {
  orgId: string
  hasVatNumber: boolean | null
  verified: boolean | null
  /** `YYYY-MM-DD`, when the profile carries one. */
  crExpiry: string | null
}

/** Who is looking — drives blocks, the queue and whether money is shown. */
export interface ProcActor {
  uid: string
  name: string
  isOwner: boolean
  canApprove: boolean // po.approve
  canPrepare: boolean // offers.accept
  canExpedite: boolean // po.expedite, or any of the above
  canReceive: boolean // deliveries.confirm
  /** An expediter sees dates and quantities, never a price. */
  seesPrices: boolean
}

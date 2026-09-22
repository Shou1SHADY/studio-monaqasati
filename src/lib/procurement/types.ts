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

export type RejectReasonCode = "damaged" | "wrong_item" | "wrong_spec" | "expired" | "excess" | "other"
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
    | "closed"
    | "cancelled"
    | "rated"
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

export interface PurchaseOrder {
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
  /** Carried through so a receipt can still close Manufacturing's request. */
  purchaseSource?: { kind: string; workOrderId?: string; purchaseRequestId?: string } | null

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
  /** What the offer said about lead time, in days, when it said anything. */
  leadTimeDays?: number | null

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
  /** The supplier's committed delivery date, `YYYY-MM-DD`. */
  promisedDate?: string | null
  /** Who recorded the acceptance: the supplier in the portal, or us for them. */
  acceptanceRecordedBy?: "supplier" | "buyer" | null
  closedAt?: string | null
  closedShort?: boolean
  closeReason?: string | null
  cancelledReason?: string | null

  rating?: PoRating | null
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

export interface DeliveryPoFields {
  poId?: string | null
  poNumber?: string | null
  /** `GRN-2026/031`, drawn when the receipt is recorded. */
  docNumber?: string | null
  lines?: DeliveryLine[]
  vehiclePlate?: string | null
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
}

/** What the pure layer needs to know about a delivery. */
export interface ReceiptFact extends DeliveryPoFields {
  id: string
  status: "pending_confirmation" | "confirmed"
  supplierName?: string | null
  /** ISO date or `YYYY-MM-DD`. */
  deliveryDate?: string | null
  confirmedAt?: string | null
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
  /** Hide offer prices until the RFQ's deadline. OFF by default here: the
   * running product shows prices as they arrive and contractors award early. */
  sealOffersUntilDeadline: boolean
}

export const DEFAULT_POLICIES: ProcurementPolicies = {
  managerApprovalLimit: 150_000,
  directPurchaseCap: 5_000,
  competitionThreshold: 20_000,
  minOffers: 3,
  overReceiptTolerancePercent: 5,
  rfqWindowDays: 3,
  awardCycleDays: 2,
  supplierAcceptanceDays: 2,
  splitWindowDays: 30,
  sealOffersUntilDeadline: false,
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

// Sales orders (أوامر البيع) — the backbone between a quotation and the cash.
//
// The module's one rule, inherited from the reference design: NO TYPED NUMBERS.
// Delivered comes from delivery notes, invoiced comes from invoices built on
// those notes, coverage comes from stock and open work orders, credit comes
// from Finance. Every figure a screen shows is derived here from documents —
// a salesperson can argue with a document, not with a formula.
//
// Ownership boundaries (deliberate, mirrored in rules):
//   • Sales owns the order, the delivery request and the billing intent.
//   • The warehouse owns the moment goods actually left (delivery confirm).
//   • Finance owns credit limits and receives; Sales reads them, never writes.
//   • Manufacturing owns readiness; Sales reads work-order progress.
//
// Lines are keyed by item NAME (trimmed, case-insensitive) — the same
// convention as splitByStock in manufacturing.ts, because inventory and
// quotation items in this codebase have no shared product-code system yet.

import { round2 } from "./accounting/journal"

export const SALES_ORDERS = "salesOrders"
export const SALES_DELIVERY_NOTES = "salesDeliveryNotes"
export const SALES_INVOICES = "salesInvoices"
export const SALES_RETURNS = "salesReturns"
export const MANUFACTURING_REQUESTS = "manufacturingRequests"

export type SalesOrderType = "standard" | "framework" | "internal"
export type SalesOrderStatus = "awaiting_deposit" | "running" | "closed" | "cancelled"
export type SalesPaymentKind = "credit" | "cash" | "deposit" | "internal"
export type DeliveryNoteStatus = "requested" | "authorized" | "delivered" | "held"

export interface SalesOrderLine {
  name: string
  unit: string
  quantity: number
  unitPrice: number
  /** Snapshotted at order time so margins survive later price-list edits.
   * Null means "we never knew" — margins exclude the line and flag it. */
  unitCost: number | null
}

export interface SalesOrderPayment {
  kind: SalesPaymentKind
  /** credit: days until an invoice falls due. */
  creditDays?: number | null
  /** deposit: the agreed percentage and whether it has been received.
   * An unpaid deposit gates the whole order — nothing ships against a promise
   * the client has not yet backed with money. */
  depositPercent?: number | null
  depositPaid?: boolean
  depositPaidAt?: string | null
}

export interface SalesOrder {
  id: string
  organizationId: string
  orderNumber: number
  type: SalesOrderType
  status: SalesOrderStatus
  contactId: string | null
  contactName?: string | null
  /** Internal sales bill one of our own projects instead of a client. */
  projectId?: string | null
  projectName?: string | null
  quotationId?: string | null
  quotationNumber?: string | null
  /** Set on a call-off; points at the framework order it draws down. */
  frameworkId?: string | null
  /** Framework only: the value cap and how long the agreed price holds. */
  frameworkCap?: number | null
  frameworkValidUntil?: string | null
  payment: SalesOrderPayment
  /** The date promised to the customer. The single most watched field. */
  promiseDate?: string | null
  vatPercent: number
  lines: SalesOrderLine[]
  /** Gate 1 — site measurement. A made-to-measure item must not enter
   * production before someone stood in the site with a tape. Null until the
   * measurement is recorded. */
  measurementRecordedAt?: string | null
  /** Gate 2 — shop-drawing approval. "awaiting" blocks cutting; chasing the
   * client for it is a Sales job, not the workshop's. */
  approvalStatus?: "not_required" | "awaiting" | "approved"
  createdByUserId: string
  createdByUserName: string
  createdAt?: unknown
  updatedAt?: unknown
  closedAt?: string | null
}

export interface SalesDeliveryNoteLine {
  name: string
  quantity: number
}

export interface SalesDeliveryNote {
  id: string
  organizationId: string
  noteNumber: string
  orderId: string
  orderNumber: number
  contactId: string | null
  contactName?: string | null
  status: DeliveryNoteStatus
  lines: SalesDeliveryNoteLine[]
  /** Where the goods were drawn from — stock leaves when the note delivers. */
  warehouseId?: string | null
  warehouseName?: string | null
  /** Who signed on the receiving side. */
  receiverName?: string | null
  /** Why Finance froze it, when status is "held". */
  holdReason?: string | null
  /** Short note when delivered ≠ requested (rejected units etc.). */
  varianceNote?: string | null
  requestedAt?: string | null
  deliveredAt?: string | null
  deliveredByUserId?: string | null
  deliveredByUserName?: string | null
  createdByUserId: string
  createdByUserName: string
  createdAt?: unknown
  updatedAt?: unknown
}

export interface SalesInvoice {
  id: string
  organizationId: string
  invoiceNumber: string
  contactId: string | null
  contactName?: string | null
  /** The delivered notes this invoice bills. Empty for advance invoices. */
  deliveryNoteIds: string[]
  /** Advance (deposit) invoice: money before goods — a liability, not revenue. */
  advance?: boolean
  orderId?: string | null
  orderNumber?: number | null
  /** Advance invoices carry their net directly; delivery invoices derive it. */
  advanceNet?: number | null
  vatPercent: number
  issueDate: string
  dueDate: string
  paid: boolean
  paidAt?: string | null
  /** ZATCA e-invoicing state. "reported" once cleared with the authority;
   * "pending" until then. A placeholder for the real integration — the field
   * exists so every screen already renders the state it will carry. */
  zatca?: "pending" | "reported"
  createdByUserId: string
  createdByUserName: string
  createdAt?: unknown
  updatedAt?: unknown
}

// ---------------------------------------------------------------------------
// Returns (المرتجعات) — Sales owns the request and its reason; Finance owns
// the credit note. The return never edits a delivery or an invoice: it is its
// own document, and the credit note reverses value the way a reversal entry
// reverses a journal — history stays legible.
// ---------------------------------------------------------------------------

export type SalesReturnStatus = "awaiting_decision" | "approved" | "credit_note_issued" | "rejected"

export interface SalesReturn {
  id: string
  organizationId: string
  returnNumber: string
  orderId: string
  orderNumber: number
  contactId: string | null
  contactName?: string | null
  /** The delivered note the goods came back against. */
  deliveryNoteId: string
  lines: SalesDeliveryNoteLine[]
  reason: string
  status: SalesReturnStatus
  decidedAt?: string | null
  decidedByUserId?: string | null
  decidedByUserName?: string | null
  creditNoteIssuedAt?: string | null
  createdByUserId: string
  createdByUserName: string
  createdAt?: unknown
  updatedAt?: unknown
}

/** Value of the returned goods at the ORDER's prices — same rule as delivery
 * notes, so a credit note can never disagree with the invoice it offsets. */
export function returnValue(ret: Pick<SalesReturn, "lines" | "orderId">, order: SalesOrder | undefined): number {
  if (!order) return 0
  return round2(
    ret.lines.reduce((sum, l) => {
      const line = order.lines.find((x) => key(x.name) === key(l.name))
      return sum + (line ? l.quantity * line.unitPrice : 0)
    }, 0)
  )
}

// ---------------------------------------------------------------------------
// Manufacturing requests (طلب تصنيع) — Sales asks, the plant answers
//
// Sales cannot put anything into production; it can only ask. The plant
// accepts (a work order appears) or rejects with a reason the salesperson can
// read to the customer. A request the plant ignores shows its age — chasing
// it is a Sales job, and the screen makes the silence visible.
// ---------------------------------------------------------------------------

export type MfgRequestStatus = "new" | "accepted" | "rejected"

export interface ManufacturingRequest {
  id: string
  organizationId: string
  requestNumber: string
  orderId: string
  orderNumber: number
  contactName?: string | null
  itemName: string
  unit: string
  quantity: number
  status: MfgRequestStatus
  /** Set on acceptance — the work order the plant opened for it. */
  workOrderId?: string | null
  workOrderNumber?: number | null
  /** The plant's reason when it says no. */
  rejectionReason?: string | null
  decidedAt?: string | null
  decidedByUserId?: string | null
  decidedByUserName?: string | null
  createdByUserId: string
  createdByUserName: string
  createdAt?: unknown
  updatedAt?: unknown
  requestedAt: string
}

export const generateReturnNumber = (): string => `SR-${randomSuffix()}`
export const generateMfgRequestNumber = (): string => `MR-${randomSuffix()}`

const key = (name: string) => name.trim().toLowerCase()

export function nextSalesOrderNumber(orders: Array<{ orderNumber?: number }>): number {
  return orders.reduce((max, o) => Math.max(max, Number(o.orderNumber) || 0), 0) + 1
}

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
function randomSuffix(): string {
  let s = ""
  for (let i = 0; i < 6; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)]
  return s
}
export const generateDeliveryNoteNumber = (): string => `SD-${randomSuffix()}`
export const generateSalesInvoiceNumber = (): string => `SI-${randomSuffix()}`

// ---------------------------------------------------------------------------
// Quantities — derived from delivery notes, never stored on the order
// ---------------------------------------------------------------------------

/** Quantity of one item that actually left, across an order's DELIVERED notes. */
export function deliveredQty(orderId: string, name: string, notes: SalesDeliveryNote[]): number {
  const k = key(name)
  return notes
    .filter((n) => n.orderId === orderId && n.status === "delivered")
    .reduce((sum, n) => sum + n.lines.filter((l) => key(l.name) === k).reduce((s, l) => s + l.quantity, 0), 0)
}

/** Quantity promised into notes that have not delivered yet (requested or
 * authorized). Held notes count too: the goods are still spoken for. */
export function inTransitQty(orderId: string, name: string, notes: SalesDeliveryNote[]): number {
  const k = key(name)
  return notes
    .filter((n) => n.orderId === orderId && (n.status === "requested" || n.status === "authorized" || n.status === "held"))
    .reduce((sum, n) => sum + n.lines.filter((l) => key(l.name) === k).reduce((s, l) => s + l.quantity, 0), 0)
}

export interface OrderLineProgress extends SalesOrderLine {
  delivered: number
  inTransit: number
  /** Not yet delivered — what the customer is still owed. */
  remaining: number
  /** Not delivered and not in any note yet — what can still be scheduled. */
  open: number
  value: number
  deliveredValue: number
  remainingValue: number
  /** (price − cost) × quantity; null while the cost is unknown. */
  margin: number | null
}

export function orderLineProgress(order: SalesOrder, notes: SalesDeliveryNote[]): OrderLineProgress[] {
  return order.lines.map((line) => {
    const delivered = deliveredQty(order.id, line.name, notes)
    const inTransit = inTransitQty(order.id, line.name, notes)
    const remaining = Math.max(0, round2(line.quantity - delivered))
    const open = Math.max(0, round2(line.quantity - delivered - inTransit))
    return {
      ...line,
      delivered: round2(delivered),
      inTransit: round2(inTransit),
      remaining,
      open,
      value: round2(line.quantity * line.unitPrice),
      deliveredValue: round2(delivered * line.unitPrice),
      remainingValue: round2(remaining * line.unitPrice),
      margin: line.unitCost == null ? null : round2((line.unitPrice - line.unitCost) * line.quantity),
    }
  })
}

// ---------------------------------------------------------------------------
// Order money
// ---------------------------------------------------------------------------

export const isExternal = (order: Pick<SalesOrder, "type">): boolean => order.type !== "internal"

export function orderNet(order: SalesOrder): number {
  return round2(order.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0))
}

/** Internal sales move value between our own pockets — no VAT arises. */
export function orderVat(order: SalesOrder): number {
  if (!isExternal(order)) return 0
  return round2((orderNet(order) * (Number(order.vatPercent) || 0)) / 100)
}

export const orderGross = (order: SalesOrder): number => round2(orderNet(order) + orderVat(order))

export function orderCost(order: SalesOrder): number {
  return round2(order.lines.reduce((sum, l) => sum + (l.unitCost == null ? 0 : l.unitCost * l.quantity), 0))
}

/** Value-weighted margin % across the lines whose cost is known; null when no
 * line has one. A missing cost is surfaced, never treated as zero — a zero
 * cost would report a flattering margin that nobody actually earned. */
export function orderMargin(order: SalesOrder): number | null {
  const priced = order.lines.filter((l) => l.unitCost != null)
  if (priced.length === 0) return null
  const value = priced.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
  const cost = priced.reduce((sum, l) => sum + l.quantity * (l.unitCost as number), 0)
  return value ? round2(((value - cost) / value) * 100) : null
}

export const hasUnknownCost = (order: SalesOrder): boolean => order.lines.some((l) => l.unitCost == null)

// ---------------------------------------------------------------------------
// Deposits (العربون) — a liability, not revenue
// ---------------------------------------------------------------------------

export function depositNet(order: SalesOrder): number {
  if (order.payment.kind !== "deposit" || !order.payment.depositPercent) return 0
  return round2((orderNet(order) * order.payment.depositPercent) / 100)
}

export const depositVat = (order: SalesOrder): number =>
  round2((depositNet(order) * (isExternal(order) ? Number(order.vatPercent) || 0 : 0)) / 100)

export const depositTotal = (order: SalesOrder): number => round2(depositNet(order) + depositVat(order))

/** Nothing ships on a deposit order until the deposit is actually in. */
export function depositSatisfied(order: SalesOrder): boolean {
  return order.payment.kind !== "deposit" || order.payment.depositPaid === true
}

// ---------------------------------------------------------------------------
// Invoices — built on delivery notes
// ---------------------------------------------------------------------------

/** Value of one delivery note at ITS ORDER's prices — the note carries
 * quantities only, so a later price edit can never re-value an old delivery. */
export function deliveryNoteValue(note: SalesDeliveryNote, order: SalesOrder | undefined): number {
  if (!order) return 0
  return round2(
    note.lines.reduce((sum, l) => {
      const line = order.lines.find((x) => key(x.name) === key(l.name))
      return sum + (line ? l.quantity * line.unitPrice : 0)
    }, 0)
  )
}

export function deliveryNoteCost(note: Pick<SalesDeliveryNote, "lines">, order: SalesOrder | undefined): number {
  if (!order) return 0
  return round2(
    note.lines.reduce((sum, l) => {
      const line = order.lines.find((x) => key(x.name) === key(l.name))
      return sum + (line && line.unitCost != null ? l.quantity * line.unitCost : 0)
    }, 0)
  )
}

export interface InvoiceComputation {
  /** Value of the deliveries billed (or the advance amount). */
  net: number
  /** Share of a paid deposit recovered on this invoice — proportional to the
   * delivered share, so the deposit unwinds as the goods go out instead of
   * swallowing one invoice whole (which would zero it or turn it negative). */
  depositRecovery: number
  billable: number
  vat: number
  total: number
}

export function computeInvoice(
  invoice: SalesInvoice,
  notes: SalesDeliveryNote[],
  orders: SalesOrder[]
): InvoiceComputation {
  const orderById = new Map(orders.map((o) => [o.id, o]))

  if (invoice.advance) {
    const order = invoice.orderId ? orderById.get(invoice.orderId) : undefined
    const net = round2(invoice.advanceNet ?? (order ? depositNet(order) : 0))
    const vat = round2((net * (Number(invoice.vatPercent) || 0)) / 100)
    return { net, depositRecovery: 0, billable: net, vat, total: round2(net + vat) }
  }

  const billedNotes = notes.filter((n) => invoice.deliveryNoteIds.includes(n.id))
  const net = round2(billedNotes.reduce((sum, n) => sum + deliveryNoteValue(n, orderById.get(n.orderId)), 0))

  let depositRecovery = 0
  const order = billedNotes.length ? orderById.get(billedNotes[0].orderId) : undefined
  if (order && order.payment.kind === "deposit" && order.payment.depositPaid) {
    const total = orderNet(order)
    const share = total ? net / total : 0
    depositRecovery = round2(depositNet(order) * share)
  }

  const billable = round2(net - depositRecovery)
  const vat = round2((billable * (Number(invoice.vatPercent) || 0)) / 100)
  return { net, depositRecovery, billable, vat, total: round2(billable + vat) }
}

/**
 * Delivered but not invoiced — the counterpart of "unbilled work" in project
 * management, and the most dangerous number on the sales side: goods the
 * customer has and the company has not yet asked to be paid for.
 * Internal deliveries are excluded — there is nobody external to bill.
 */
export function unbilledDeliveries(
  notes: SalesDeliveryNote[],
  invoices: SalesInvoice[],
  orders: SalesOrder[]
): { notes: SalesDeliveryNote[]; value: number } {
  const invoiced = new Set(invoices.flatMap((i) => i.deliveryNoteIds))
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const open = notes.filter((n) => {
    const order = orderById.get(n.orderId)
    return n.status === "delivered" && order && isExternal(order) && !invoiced.has(n.id)
  })
  return {
    notes: open,
    value: round2(open.reduce((sum, n) => sum + deliveryNoteValue(n, orderById.get(n.orderId)), 0)),
  }
}

// ---------------------------------------------------------------------------
// Frameworks (الاتفاقيات الإطارية) — agreed price, a value cap, call-offs
// ---------------------------------------------------------------------------

export function frameworkUsage(
  framework: SalesOrder,
  allOrders: SalesOrder[]
): { callOffs: SalesOrder[]; used: number; remaining: number; percentUsed: number } {
  const callOffs = allOrders.filter((o) => o.frameworkId === framework.id && o.status !== "cancelled")
  const used = round2(callOffs.reduce((sum, o) => sum + orderNet(o), 0))
  const cap = Number(framework.frameworkCap) || 0
  return {
    callOffs,
    used,
    remaining: round2(Math.max(0, cap - used)),
    percentUsed: cap ? round2(Math.min(100, (used / cap) * 100)) : 0,
  }
}

/** A call-off must fit under the cap — the cap is the whole point of a frame. */
export function callOffFits(framework: SalesOrder, allOrders: SalesOrder[], callOffNet: number): boolean {
  return frameworkUsage(framework, allOrders).remaining >= round2(callOffNet) - 0.005
}

// ---------------------------------------------------------------------------
// Coverage (التغطية) — where each promised item will come from, honestly
// ---------------------------------------------------------------------------

export interface LineCoverage {
  name: string
  needed: number
  fromStock: number
  fromManufacturing: number
  /** Nothing covers this part — buy it, make it, or renegotiate the promise. */
  gap: number
  /** Ids of the work orders this line leans on. */
  workOrderIds: string[]
}

/**
 * Allocate available stock and open manufacturing output across orders' open
 * quantities. Orders must arrive PRE-SORTED by priority (running before
 * awaiting-deposit, earliest promise first) — allocation is first-come, and
 * the sort order IS the business policy of who gets scarce stock.
 *
 * Deposit-gated orders consume nothing: stock must not be reserved against a
 * promise the customer has not funded yet.
 */
export function allocateCoverage(
  orders: Array<{ order: SalesOrder; lines: OrderLineProgress[] }>,
  stockByName: Array<{ name: string; available: number }>,
  workOrders: Array<{ id: string; outputName: string; remainingQty: number }>
): Map<string, LineCoverage> {
  const pool = new Map<string, number>()
  for (const s of stockByName) pool.set(key(s.name), (pool.get(key(s.name)) || 0) + Math.max(0, s.available))
  const woLeft = workOrders.map((w) => ({ ...w, left: Math.max(0, w.remainingQty) }))

  const result = new Map<string, LineCoverage>()
  for (const { order, lines } of orders) {
    const gated = !depositSatisfied(order)
    for (const line of lines) {
      const coverage: LineCoverage = {
        name: line.name,
        needed: line.remaining,
        fromStock: 0,
        fromManufacturing: 0,
        gap: 0,
        workOrderIds: [],
      }
      if (line.remaining > 0 && !gated) {
        let need = line.remaining
        const k = key(line.name)
        const inStock = Math.min(need, pool.get(k) || 0)
        if (inStock > 0) {
          coverage.fromStock = round2(inStock)
          pool.set(k, round2((pool.get(k) || 0) - inStock))
          need = round2(need - inStock)
        }
        for (const wo of woLeft) {
          if (need <= 0) break
          if (key(wo.outputName) !== k || wo.left <= 0) continue
          const take = Math.min(need, wo.left)
          wo.left = round2(wo.left - take)
          need = round2(need - take)
          coverage.fromManufacturing = round2(coverage.fromManufacturing + take)
          coverage.workOrderIds.push(wo.id)
        }
        coverage.gap = round2(Math.max(0, need))
      } else if (line.remaining > 0) {
        coverage.gap = line.remaining
      }
      result.set(`${order.id}|${key(line.name)}`, coverage)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Gates — the two doors Manufacturing and the site own, not the seller
// ---------------------------------------------------------------------------

export interface ItemGateFlags {
  name: string
  requiresMeasurement?: boolean | null
  requiresApproval?: boolean | null
}

export type OrderGate = "measurement" | "approval" | null

/**
 * Which gate blocks this order's path into production, if any.
 *
 * The measurement gate opens only for lines that actually NEED the plant —
 * a made-to-measure item fully coverable from stock was measured when it was
 * made. Both gates matter only while something remains undelivered.
 */
export function orderGate(
  order: SalesOrder,
  lines: OrderLineProgress[],
  flags: ItemGateFlags[],
  freeStockByName: Array<{ name: string; available: number }>
): OrderGate {
  if (order.status !== "running") return null
  const flag = (name: string) => flags.find((f) => key(f.name) === key(name))
  const freeOf = (name: string) =>
    freeStockByName.filter((s) => key(s.name) === key(name)).reduce((sum, s) => sum + Math.max(0, s.available), 0)

  const needsMeasurement =
    order.measurementRecordedAt == null &&
    lines.some((l) => flag(l.name)?.requiresMeasurement && l.remaining > 0 && freeOf(l.name) < l.remaining)
  if (needsMeasurement) return "measurement"

  const needsApproval =
    order.approvalStatus === "awaiting" && lines.some((l) => flag(l.name)?.requiresApproval && l.remaining > 0)
  if (needsApproval) return "approval"

  return null
}

// ---------------------------------------------------------------------------
// Recognition & reporting — sales happen at DELIVERY, not at the order
// ---------------------------------------------------------------------------

export function deliveredSales(
  notes: SalesDeliveryNote[],
  orders: SalesOrder[],
  from: string,
  to: string
): { external: number; internal: number; cost: number } {
  const orderById = new Map(orders.map((o) => [o.id, o]))
  let external = 0
  let internal = 0
  let cost = 0
  for (const note of notes) {
    if (note.status !== "delivered" || !note.deliveredAt) continue
    const day = note.deliveredAt.slice(0, 10)
    if (day < from || day > to) continue
    const order = orderById.get(note.orderId)
    if (!order) continue
    const value = deliveryNoteValue(note, order)
    if (isExternal(order)) {
      external = round2(external + value)
      cost = round2(cost + deliveryNoteCost(note, order))
    } else {
      internal = round2(internal + value)
    }
  }
  return { external, internal, cost }
}

/** The standing promise: value confirmed but not yet delivered, external only. */
export function committedValue(orders: SalesOrder[], notes: SalesDeliveryNote[]): number {
  return round2(
    orders
      .filter((o) => o.status === "running" && isExternal(o) && o.type !== "framework")
      .reduce((sum, o) => sum + orderLineProgress(o, notes).reduce((s, l) => s + l.remainingValue, 0), 0)
  )
}

// ---------------------------------------------------------------------------
// Price resolution — agreement beats tier beats list
// ---------------------------------------------------------------------------

export interface PriceAgreement {
  contactId: string
  itemName: string
  price: number
  /** ISO date the agreed price holds until. */
  validUntil: string
}

export interface QuantityTier {
  itemName: string
  /** Sorted descending by minQty by the caller or not — handled here. */
  tiers: Array<{ minQty: number; price: number }>
}

export function resolvePrice(
  itemName: string,
  contactId: string | null,
  quantity: number,
  today: string,
  sources: { agreements: PriceAgreement[]; tiers: QuantityTier[]; listPrice: number | null }
): { price: number | null; source: "agreement" | "tier" | "list" | null } {
  const k = key(itemName)
  if (contactId) {
    const agreement = sources.agreements.find(
      (a) => a.contactId === contactId && key(a.itemName) === k && a.validUntil >= today
    )
    if (agreement) return { price: agreement.price, source: "agreement" }
  }
  const tier = sources.tiers.find((t) => key(t.itemName) === k)
  if (tier) {
    const match = [...tier.tiers].sort((a, b) => b.minQty - a.minQty).find((t) => quantity >= t.minQty)
    if (match) return { price: match.price, source: "tier" }
  }
  if (sources.listPrice != null) return { price: sources.listPrice, source: "list" }
  return { price: null, source: null }
}

// ---------------------------------------------------------------------------
// Credit — read from Finance, never written here
// ---------------------------------------------------------------------------

export interface CreditSnapshot {
  /** SAR the org has decided to expose to this client. 0 = cash only. */
  limit: number
  /** What they owe right now, from the ledger's receivable for the party. */
  outstanding: number
  /** Days the oldest unpaid amount is past due. */
  overdueDays: number
}

export type CreditVerdict = "ok" | "near_limit" | "over_limit" | "overdue_block"

/**
 * Whether a new order fits inside the client's credit. Overdue balances block
 * outright — extending more credit to someone already late is how a receivable
 * becomes a write-off. The 85% warning gives the rep room to ask Finance
 * BEFORE the customer is standing there waiting.
 */
export function creditVerdict(credit: CreditSnapshot, newOrderGross: number): CreditVerdict {
  if (credit.overdueDays > 0) return "overdue_block"
  const exposure = round2(credit.outstanding + newOrderGross)
  if (credit.limit <= 0) return exposure > 0 ? "over_limit" : "ok"
  if (exposure > credit.limit) return "over_limit"
  if (exposure > credit.limit * 0.85) return "near_limit"
  return "ok"
}

// ---------------------------------------------------------------------------
// Order lifecycle helpers
// ---------------------------------------------------------------------------

/** An order closes itself when every line is fully delivered — closing is a
 * fact derived from the notes, not a button someone remembers to press. */
export function isFullyDelivered(order: SalesOrder, notes: SalesDeliveryNote[]): boolean {
  if (order.lines.length === 0) return false
  return orderLineProgress(order, notes).every((l) => l.remaining <= 0)
}

/** Build an order's lines from an accepted quotation's items. Costs come from
 * the price list where a name matches; unknown stays null, never zero. */
export function linesFromQuotationItems(
  items: Array<{ name: string; quantity: number; unit: string; unitPrice: number }>,
  priceItems: Array<{ name: string; cost?: number | null }>
): SalesOrderLine[] {
  const costByName = new Map(priceItems.map((p) => [key(p.name), p.cost ?? null]))
  return items.map((i) => ({
    name: i.name,
    unit: i.unit,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    unitCost: costByName.get(key(i.name)) ?? null,
  }))
}

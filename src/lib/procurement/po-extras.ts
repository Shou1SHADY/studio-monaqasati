// The purchase order's second layer (prototype `dPo`, R-20 … R-32): the
// document trail and who owns each step, the money trail Finance writes back
// (advance, payments, held invoices), the revision number, the line's context
// and in-transit share, the PM budget and sample gates, and who may act.
//
// These fields are OPTIONAL on `purchaseOrders` and deliberately not in
// `types.ts` (mirrored into the mobile app): an order without them reads
// exactly as before. Finance writes `financePayments` / `financeHolds`;
// Procurement writes the decision on a hold, `cancelFees`, `selfIssued`.
// Everything else here is derived. Pure: no I/O, the clock is passed in.

import { dayOf, lineToArrive, poCommitment, poStatus, round2 } from "./po"
import { DEFAULT_OPERATING_POLICIES, resolvePolicies } from "./policies"
import type { PoLine, ProcActor, PurchaseOrder, ReceiptFact } from "./types"

export type PaymentKind = "adv" | "part" | "inv"

export interface PoFinancePayment {
  no: string
  kind: PaymentKind
  /** Paid, VAT included, after any advance recovery. */
  amount: number
  net?: number | null
  vat?: number | null
  /** The advance recovered from this invoice. */
  recovered?: number | null
  invoiceNo?: string | null
  /** `YYYY-MM-DD` — the bank's value date. */
  valueDate: string
  bank?: string | null
  reference: string
  account?: string | null
  file?: string | null
  byName: string
  at: string
}

/** Why Finance held a payment — and whose move comes next (prototype `REJF`). */
export const HOLD_REASONS = ["price", "qty", "nogrn", "nopo", "vat", "iban", "dup", "cash"] as const
export type HoldReason = (typeof HOLD_REASONS)[number]
export type HoldOwner = "proc" | "rcv" | "sup" | "fin"
export const HOLD_OWNER: Record<HoldReason, HoldOwner> = {
  price: "proc",
  qty: "proc",
  nogrn: "rcv",
  nopo: "proc",
  vat: "sup",
  iban: "proc",
  dup: "fin",
  cash: "fin",
}

/** Procurement's answers per reason (prototype `FROPT`); anything else is acknowledged. */
export const HOLD_DECISIONS: Record<HoldReason, string[]> = {
  // The prototype's price-variance decision: the supplier honours the PO price,
  // an agreed middle price, or the invoice's price.
  price: ["po_price", "new_price", "inv_price"],
  qty: ["credit", "supply", "grn"],
  nogrn: ["ack"],
  nopo: ["ack"],
  vat: ["newinv", "cancel"],
  iban: ["letter", "fix", "stop"],
  dup: ["ack"],
  cash: ["ack"],
}

export interface PoFinanceHold {
  id: string
  invoiceNo: string
  /** The invoice amount, VAT included. */
  amount: number
  reason: HoldReason
  text: string
  need: string
  at: string
  byName: string
  state: "open" | "decided" | "released"
  decision?: string | null
  decisionNote?: string | null
  decidedByName?: string | null
  decidedAt?: string | null
  /** A price hold: the invoice's unit price, and the order line it prices (else the first). */
  price?: number | null
  lineId?: string | null
  /** A higher price asked by someone who may not accept it — waits for the order's approver. */
  pend?: HoldPricePending | null
  /** The price settled by the decision (new_price / inv_price). */
  newPrice?: number | null
}

export interface HoldPricePending {
  price: number
  why: string
  byUid: string
  byName: string
  at: string
}

/** The PO price against the invoice's, and what the difference costs on what was received. */
export function holdVariance(po: Pick<PurchaseOrder, "lines">, hold: Pick<PoFinanceHold, "reason" | "price" | "lineId">): { line: PoLine; poPrice: number; invoicePrice: number; received: number; variance: number } | null {
  if (hold.reason !== "price" || !(Number(hold.price) > 0)) return null
  const line = (hold.lineId && po.lines.find((l) => l.id === hold.lineId)) || po.lines[0]
  if (!line || line.unitPrice == null) return null
  const poPrice = round2(Number(line.unitPrice))
  const invoicePrice = round2(Number(hold.price))
  const received = round2(Number(line.accepted) || 0)
  return { line, poPrice, invoicePrice, received, variance: round2((invoicePrice - poPrice) * received) }
}

/** A higher price is accepted only by someone who approves orders and did not prepare this one (the owner excepted, as with approving the order). */
export const acceptsHoldPrice = (po: Pick<PurchaseOrder, "preparedById">, actor: Pick<ProcActor, "uid" | "isOwner" | "canApprove">): boolean =>
  actor.isOwner || (actor.canApprove && actor.uid !== po.preparedById)

export interface PoExtras {
  /** The advance share of the value, 0–100 — carried from the awarded offer. */
  advancePercent?: number | null
  /** The rest, on credit — days. */
  creditDays?: number | null
  priceBasis?: "site" | "exw" | null
  financePayments?: PoFinancePayment[] | null
  financeHolds?: PoFinanceHold[] | null
  /** A buyer issued it himself under the buyer self-issue limit (R-32). */
  selfIssued?: boolean | null
  /** What the supplier charged for cancelling a remainder. */
  cancelFees?: Array<{ lineId: string; amount: number; at: string; byName: string }> | null
  /** The agreed shipments, or call-offs by the site (R-30). */
  deliverySchedule?: Array<{ quantity: number; date: string }> | null
  callOff?: boolean | null
  requiresWarranty?: boolean | null
  /** Projects' answer when the order exceeds the item's budget (R-25). */
  pmBudget?: PmBudget | null
  /** Projects closed a material and asks to stop what has not arrived (R-29, P-19), per PO line id. */
  pmCancels?: Record<string, PmCancel> | null
  /** The line the LAST stop named — lets the rules find the one entry that changed. */
  pmCancelKey?: string | null
  /** noticeRouting `both`: the receivers the supplier's notice also reaches (stamped at approval). */
  noticeCopyTo?: string[] | null
}

/** Referred by Procurement (`pending`, with the overrun), answered by the project's manager. */
export interface PmBudget {
  state: "pending" | "accepted" | "renegotiate"
  over?: number | null
  askedByName?: string | null
  askedAt?: string | null
  byName?: string | null
  at?: string | null
  note?: string | null
}

export interface PmCancel {
  reason?: string | null
  byName?: string | null
  at?: string | null
  projectId?: string | null
  requestId?: string | null
}

export type PurchaseOrderX = PurchaseOrder & PoExtras

export type PoLineX = PoLine & { rejectReplaceBy?: string | null }

export const asX = (po: PurchaseOrder): PurchaseOrderX => po as PurchaseOrderX

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const pct = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
}

export type AdvanceState = "none" | "pending" | "requested" | "paid"

/** No advance · agreed but not approved yet · with Finance (approval IS the
 * request) · paid. The supplier's lead time starts when it is paid. */
export function advanceState(po: PurchaseOrderX): AdvanceState {
  if (!pct(po.advancePercent)) return "none"
  if ((po.financePayments || []).some((p) => p.kind === "adv")) return "paid"
  if (po.status === "cancelled") return "none"
  return po.approvedAt ? "requested" : "pending"
}

export const advanceAmount = (po: PurchaseOrderX): number => round2((poCommitment(po) * pct(po.advancePercent)) / 100)

/** The advance request's number, derived from the order's: `PO-2026/014` → `ADV-2026/014`. */
export const advanceNumber = (po: Pick<PurchaseOrder, "docNumber">): string => (po.docNumber || "").replace(/^[A-Z]+-/, "ADV-")

export const paidTotal = (po: PurchaseOrderX): number => round2((po.financePayments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0))

export const openHolds = (po: PurchaseOrderX): PoFinanceHold[] => (po.financeHolds || []).filter((h) => h.state === "open")

/** Newest payment first. */
export const paymentsNewestFirst = (po: PurchaseOrderX): PoFinancePayment[] => [...(po.financePayments || [])].sort((a, b) => (b.at || "").localeCompare(a.at || ""))

/** The one line the drawer opens with: back from Finance (a hold wins over a payment). */
export type FinanceBanner = { kind: "hold"; hold: PoFinanceHold } | { kind: "paid"; payment: PoFinancePayment } | { kind: "sent" } | null
export function financeBanner(po: PurchaseOrderX): FinanceBanner {
  const holds = openHolds(po)
  if (holds.length) return { kind: "hold", hold: holds[0] }
  const pays = paymentsNewestFirst(po)
  if (pays.length) return { kind: "paid", payment: pays[0] }
  return po.approvedAt && po.status !== "cancelled" ? { kind: "sent" } : null
}

// ---------------------------------------------------------------------------
// Revisions — the prototype's «نسخة n»: every reduction of the order sends
// Finance and Inventory a revised order under the same number
// ---------------------------------------------------------------------------

export function poRevision(po: Pick<PurchaseOrder, "log">): number {
  let v = 1
  for (const e of po.log || []) {
    if (e.action === "remainder_cancelled") v++
    else if (e.action === "reject_decided" && e.params?.decision === "reduce") v++
  }
  return v
}

// ---------------------------------------------------------------------------
// The document trail (R-20)
// ---------------------------------------------------------------------------

export type TrailState = "ok" | "now" | "bad" | "todo"
export type TrailKey = "prepared" | "approved" | "finance" | "sent" | "accepted" | "advance" | "notice" | "receipt" | "invoice"
export interface TrailStep {
  key: TrailKey
  at: string | null
  /** Who, or what: a name, a channel, document numbers. */
  who: string[]
  state: TrailState
  /** Extra facts the screen renders (self-issued, outside the system, held). */
  flags: string[]
}

export function docTrail(po: PurchaseOrderX, deliveries: Array<ReceiptFact & { poId?: string | null }>): TrailStep[] {
  const st = poStatus(po)
  const mine = deliveries.filter((d) => d.poId === po.id)
  const notices = mine.filter((d) => d.status === "pending_confirmation")
  const receipts = mine.filter((d) => d.status === "confirmed")
  const lastOf = (xs: Array<string | null | undefined>) => xs.filter(Boolean).sort().pop() ?? null
  const approved = Boolean(po.approvedAt)
  const waiting = st === "awaiting_approval"
  const steps: TrailStep[] = [
    { key: "prepared", at: po.createdAt || null, who: [po.preparedByName], state: "ok", flags: [] },
    { key: "approved", at: po.approvedAt || null, who: po.approvedByName ? [po.approvedByName] : [], state: approved ? "ok" : waiting ? "now" : "todo", flags: po.selfIssued ? ["self_issued"] : [] },
    { key: "finance", at: po.approvedAt || null, who: [], state: approved ? "ok" : "todo", flags: [] },
    {
      key: "sent",
      at: po.sentAt || null,
      who: po.sentByName ? [po.sentByName] : [],
      state: po.sentAt ? "ok" : st === "approved" ? "now" : "todo",
      flags: po.sentAt ? [po.sentChannel ? `channel:${po.sentChannel}` : "outside"] : [],
    },
    { key: "accepted", at: po.supplierAcceptedAt || null, who: [], state: po.supplierAcceptedAt ? "ok" : st === "sent" ? "now" : "todo", flags: po.acceptanceRecordedBy ? [`by:${po.acceptanceRecordedBy}`] : [] },
  ]
  const adv = advanceState(po)
  if (adv !== "none") {
    const paid = (po.financePayments || []).find((p) => p.kind === "adv")
    steps.push({ key: "advance", at: paid ? paid.valueDate : null, who: [paid ? paid.no : advanceNumber(po)], state: adv === "paid" ? "ok" : adv === "requested" ? "now" : "todo", flags: [] })
  }
  const live = st === "in_delivery" || st === "part_received"
  steps.push({
    key: "notice",
    at: lastOf(mine.map((d) => d.deliveryDate || null)),
    who: [],
    state: notices.length ? "now" : mine.length ? "ok" : live || st === "accepted" ? "now" : "todo",
    flags: [],
  })
  steps.push({
    key: "receipt",
    at: lastOf(receipts.map((d) => dayOf(d.confirmedAt) || null)),
    who: receipts.map((d) => d.docNumber || "").filter(Boolean),
    state: st === "received" || st === "closed" ? "ok" : st === "part_received" ? "now" : "todo",
    flags: [],
  })
  const holds = openHolds(po)
  const lastPay = paymentsNewestFirst(po).find((p) => p.kind !== "adv")
  steps.push({
    key: "invoice",
    at: lastPay ? lastPay.valueDate : null,
    who: [],
    state: holds.length ? "bad" : st === "closed" && !po.closedShort ? "ok" : lastPay ? "ok" : st === "received" ? "now" : "todo",
    flags: holds.length ? ["held"] : [],
  })
  return steps
}

// ---------------------------------------------------------------------------
// Lines — in transit, and what Projects asked
// ---------------------------------------------------------------------------

/** Notified by the supplier and not yet received — the bar's blue segment. */
export function lineInTransit(po: PurchaseOrder, line: PoLine, deliveries: Array<ReceiptFact & { poId?: string | null }>): number {
  const q = deliveries
    .filter((d) => d.poId === po.id && d.status === "pending_confirmation")
    .reduce((s, d) => s + (d.lines || []).filter((l) => l.poLineId === line.id).reduce((a, l) => a + (Number(l.noticeQuantity) || 0), 0), 0)
  return Math.min(round2(q), lineToArrive(line))
}

/** What Projects asked of this line, if anything. */
export const pmCancelOf = (po: Pick<PurchaseOrderX, "pmCancels">, line: Pick<PoLine, "id">): PmCancel | null => po.pmCancels?.[line.id] ?? null

/** Projects closed the material and asks to stop the rest: open while something is still to arrive. */
export const pmCancelOpen = (po: Pick<PurchaseOrderX, "pmCancels">, line: PoLine): boolean => Boolean(pmCancelOf(po, line)) && lineToArrive(line) > 0

// ---------------------------------------------------------------------------
// Who may act (R-26): the owner reads; a buyer acts on his own orders only
// ---------------------------------------------------------------------------

export interface PoActs {
  /** The owner looking at somebody else's order — he reads, and approves. */
  ownerReadOnly: boolean
  /** A buyer on an order he did not prepare. */
  notMine: boolean
  /** May the expediting and line buttons show at all. */
  acts: boolean
}

export function poActs(po: Pick<PurchaseOrder, "preparedById">, actor: ProcActor): PoActs {
  const ownerReadOnly = actor.isOwner && po.preparedById !== actor.uid
  const buyer = !actor.isOwner && !actor.canApprove && actor.canPrepare
  const notMine = buyer && po.preparedById !== actor.uid
  return { ownerReadOnly, notMine, acts: !ownerReadOnly && !notMine }
}

// ---------------------------------------------------------------------------
// A buyer issues his own small order (R-32)
// ---------------------------------------------------------------------------

export const DEFAULT_BUYER_SELF_ISSUE_LIMIT = DEFAULT_OPERATING_POLICIES.buyerSelfIssueLimit

/** The stored settings document's limit, sanitised exactly as every other policy. */
export function buyerSelfIssueLimit(settings: { buyerSelfIssueLimit?: unknown } | null | undefined): number {
  return resolvePolicies(settings as Parameters<typeof resolvePolicies>[0]).buyerSelfIssueLimit
}

export type SelfIssueRefusal = "not_awaiting" | "not_preparer" | "no_permission" | "retroactive" | "not_direct" | "returned" | "over_limit" | "blocked"

export function selfIssueRefusal(po: PurchaseOrder, actor: ProcActor, limit: number, blocks: number): SelfIssueRefusal | null {
  if (po.status !== "awaiting_approval") return "not_awaiting"
  if (!actor.canPrepare) return "no_permission"
  if (po.preparedById !== actor.uid) return "not_preparer"
  if (po.basis === "retroactive") return "retroactive"
  // The policy is the DIRECT order's (prototype `p.direct`): an RFQ award goes to an approver.
  if (po.basis !== "direct") return "not_direct"
  if (po.returnedReason) return "returned"
  if (!(Number(po.totalExVat) <= limit)) return "over_limit"
  if (blocks > 0) return "blocked"
  return null
}

// ---------------------------------------------------------------------------
// Projects' gates (R-25): the item's budget and its sample
// ---------------------------------------------------------------------------

export interface BoqGateItem {
  id: string
  quantity?: number | null
  /** The line's estimated unit cost (PM `estCost`) — its budget = quantity × estCost. */
  estCost?: number | null
  pmSample?: boolean | null
  pmSub?: string | null
  name?: string | null
  description?: string | null
}

const priced = (l: PoLine) => (l.unitPrice != null ? (Number(l.quantity) - (Number(l.cancelled) || 0)) * Number(l.unitPrice) : 0)

/** How far this order takes each BOQ item past its budget, counting the other
 * live orders on the same item. Items without an estimate never block. */
export function budgetOverrun(po: PurchaseOrder, items: BoqGateItem[], orders: PurchaseOrder[]): Array<{ itemId: string; over: number }> {
  const out: Array<{ itemId: string; over: number }> = []
  const ids = Array.from(new Set(po.lines.map((l) => l.boqItemId).filter((x): x is string => Boolean(x))))
  for (const id of ids) {
    const it = items.find((i) => i.id === id)
    const budget = it && Number(it.estCost) > 0 && Number(it.quantity) > 0 ? Number(it.estCost) * Number(it.quantity) : null
    if (budget === null) continue
    const committed = orders
      .filter((o) => o.id !== po.id && o.projectId === po.projectId && o.status !== "cancelled" && o.status !== "awaiting_approval")
      .reduce((s, o) => s + o.lines.filter((l) => l.boqItemId === id).reduce((a, l) => a + priced(l), 0), 0)
    const mine = po.lines.filter((l) => l.boqItemId === id).reduce((a, l) => a + priced(l), 0)
    const over = round2(committed + mine - budget)
    if (over > 0) out.push({ itemId: id, over })
  }
  return out
}

/** Projects' budget decision is ASKED for and not yet given — the order waits for the PM.
 * An overrun nobody referred to Projects does not wait: the approver sees it and
 * may refer it (`pmBudgetAsk`); an order must never wait on a decision nobody asked for. */
export function awaitsPmBudget(po: PurchaseOrderX): boolean {
  const state = po.pmBudget?.state
  return po.status === "awaiting_approval" && (state === "pending" || state === "renegotiate")
}

/** Over an item's budget with nothing asked of Projects yet: show it, offer to refer it. */
export function pmBudgetAsk(po: PurchaseOrderX, overrun: Array<{ over: number }>): boolean {
  return po.status === "awaiting_approval" && overrun.length > 0 && !po.pmBudget && Boolean(po.projectId)
}

export const overrunTotal = (overrun: Array<{ over: number }>): number => Math.round(overrun.reduce((s, o) => s + o.over, 0))

/** A line whose BOQ item needs an approved sample and has none yet. */
export function samplePending(po: PurchaseOrder, items: BoqGateItem[]): BoqGateItem[] {
  const ids = new Set(po.lines.map((l) => l.boqItemId).filter(Boolean))
  return items.filter((i) => ids.has(i.id) && i.pmSample && i.pmSub !== "appA" && i.pmSub !== "appB")
}

// ---------------------------------------------------------------------------
// The supplier's new date (R-31)
// ---------------------------------------------------------------------------

export const DATE_REASONS = ["stock", "transport", "payment", "other"] as const
export type DateReason = (typeof DATE_REASONS)[number]

/** The new date falls after what we told the supplier we need it by. */
export const dateMissesNeed = (po: Pick<PurchaseOrder, "requestedDeliveryDate">, date: string): boolean => Boolean(po.requestedDeliveryDate && date && date > dayOf(po.requestedDeliveryDate))

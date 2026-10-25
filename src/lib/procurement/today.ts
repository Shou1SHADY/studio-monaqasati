// "Today" in Procurement (PRD 2.0 §7, TDY-01…05) — what needs my decision now, what we are waiting on from others, the route
// strip and the supplier invitations. Everything is derived from the orders, receipts, RFQs, offers and incoming requests on every
// read; the screen owns no numbers of its own. No Firestore, no React, no sentences: every row carries i18n keys under
// `Portal.ProcToday` (or `Portal.Procurement` / `Portal.ProcOrders` for a block or an order's next-step sentence) and the
// parameters those sentences need. The screen formats. The three numbers above every page live in `./kpis`.
//
// The rule the queue embodies (R-24): RED first — late, rejected, an award that ends tomorrow, no live offer, a delivery nobody
// counted — then the nearest date. Requests whose last day to order is more than a week away fold into ONE line. A purchase order's
// row says what its next-step sentence says (PO-01: one definition, `poNextStep`) and carries the first button of that step.
//
// Roles: an expediter (may chase, may not see money) gets send / not accepted / late / forward — dates and quantities, never an
// amount. The owner gets the approvals routed to him and a read-only view of the rest.

import { competingOffers } from "./award"
import { evaluatePlanOffers, type PlanOffer } from "./award-plan"
import { type DecisionMap } from "./offer-decisions"
import { basisOf, fromHalalas, lineOf, pricedProducts, type Evaluation, type PricedRfq } from "./offer-calc"
import { noLiveOffer } from "./rfq-no-live"
import { endsOnPayment } from "./close-on"
import { advanceAmount, advanceState, asX, acceptsHoldPrice, HOLD_OWNER, holdVariance, openHolds, pmCancelOpen, type HoldOwner } from "./po-extras"
import {
  addDays,
  approvalRefusal,
  canRate,
  daysFromNow,
  daysLate,
  dayOf,
  lineOutstanding,
  poBlocks,
  poFacts,
  poLate,
  poOpenValue,
  poStatus,
  poValue,
  receiptDay,
  round2,
  supplierKey,
  supplierScore,
  todayOf,
  type BlockCode,
  type OfferLike,
} from "./po"
import { advanceOwnerWaiting, poNextStep, poState, type PoNextStep, type PoStateCtx, type PoWho } from "./po-state"
import { changeAskOpen } from "./po-messages"
import { needsEscalation } from "./escalation"
import type { DeskDelivery } from "./receipt-desk"
import type { StepNotice } from "./next-step"
import { agreementDaysLeft, agreementState, lastPaid, type PriceAgreement, type PriceHistoryEntry } from "./prices"
import { buyerRollups, categoryOf, inBuyerScope, isActionState, rollupOf, type BuyerRollup, type BuyerScope, type NeedRow } from "./need-desk"
import { cardSegment, requestCards, type DraftFact, type RequestCard } from "./incoming-requests"
import { replyClockOf, type IncomingDoc } from "./incoming-state"
import { needKeyOfMr } from "./incoming-need"
import { invitationState, type InvitationState } from "./invitations"
import { waitingLines } from "./stock-check"
import { rfqInScope } from "./rfq-view"
import type { ProcActor, ProcurementPolicies, PurchaseOrder, ReceiptFact, SupplierFacts } from "./types"

/** The viewer as Today reads him: `canSource` = rfq.manage (or offers.accept) —
 * the seeded supply-chain group runs RFQs without preparing orders, and the
 * prototype's `src` right is exactly that: sourcing. */
export type TodayActor = ProcActor & { canSource?: boolean }

// ---------------------------------------------------------------------------
// The world — minimal structural facts, not the app's types
// ---------------------------------------------------------------------------

/** What the queue needs to know about an RFQ. */
export interface RfqFact {
  id: string
  status: "Draft" | "New" | "Awarded" | string
  /** `YYYY-MM-DD`. */
  deadline?: string | null
  title?: string | null
  offersCount?: number | null
  /** What was asked, for the RFQ's estimate at the last prices paid and for pricing its offers. */
  products?: Array<{ name?: string; quantity?: number | string | null; unit?: string | null; unitOfMeasure?: string | null; category?: string | null }> | null
  organizationId?: string
  projectId?: string | null
  category?: string | null
  pricingMode?: string | null
  shipmentMode?: string | null
  /** The needs a draft RFQ was prepared from — what tells a «prepared» request from a «new» one. */
  needSources?: unknown
  purchaseSource?: unknown
  /** ISO — when it was published / awarded, when known (cycle-time report). */
  createdAt?: string | null
  awardedAt?: string | null
  /** Suppliers invited, when the RFQ was private (competition report). */
  invitedCount?: number | null
  /** Who raised it — a buyer's own RFQs are his (the prototype's `rfqMine`). */
  createdByUserId?: string | null
  contractorId?: string | null
  /** The stored `RFQ-yyyy/NNN`, when it has one. */
  number?: string | null
  /** A manager closed the round before its date — its prices are open. */
  closedEarly?: { at?: string | null } | null
}

/** What the queue needs to know about an offer. Status literals are the
 * app's Arabic ones: قيد المراجعة · مطلوب تخفيض · مقبول · مرفوض · تم التسليم. */
export interface OfferFact extends OfferLike, Pick<PlanOffer, "lines" | "lump" | "totalBatchesPrice" | "vatRegistered" | "vatRate" | "leadDays" | "executionDuration" | "executionDurationUnit" | "withdrawnAt"> {
  id: string
  rfqId: string
  status?: string | null
  supplierOrgId?: string | null
  offerPdfUrl?: string | null
  poId?: string | null
  /** `YYYY-MM-DD` — when the supplier said so (a manual offer records it). */
  validUntil?: string | null
}

/** A supplier's question on one of our RFQs. */
export interface RfqQueryFact {
  id: string
  rfqId: string
  question: string
  answered: boolean
}

/** The needs desk as Today reads it (`./need-desk`), when the screen loads it. */
export interface NeedDeskFacts {
  rows: NeedRow[]
  /** Members who prepare orders, with the categories they buy. */
  buyers: BuyerScope[]
  /** The viewer's own categories (a buyer's scope); null = all. */
  viewerCategories: string[] | null
}

/** A platform invitation as the Today strip reads it (`invitations` documents of type `supplier_invite`). */
export interface InvitationFact {
  id: string
  companyName?: string | null
  status?: string | null
  createdAt?: unknown
  renewedAt?: string | null
  openedAt?: string | null
  sentChannel?: "wa" | "email" | "sms" | null
  acceptedSupplierOrgId?: string | null
}

export interface ProcWorld {
  orders: PurchaseOrder[]
  /** Deliveries — the supplier's notices and the goods receipts. */
  receipts: ReceiptFact[]
  rfqs: RfqFact[]
  offers: OfferFact[]
  /** The buyer's decisions about offers (exclusions), by offer id — a live offer is one not excluded. */
  decisions?: DecisionMap
  /** Every need line on Procurement's desk, when the screen loads them. */
  needDesk?: NeedDeskFacts
  /** The stored incoming requests, for what waits on Inventory and the workshop. */
  incomingDocs?: IncomingDoc[]
  /** The company's platform invitations to suppliers. */
  invitations?: InvitationFact[]
  policies: ProcurementPolicies
  supplierFacts: Record<string, SupplierFacts>
  /** Price agreements, when the screen loads them (§4 `AGR`). */
  agreements?: PriceAgreement[]
  /** Our supplier records, when the screen loads them — an unverified one waits on the manager. */
  supplierRecords?: Array<{ supplierOrgId: string; supplierName: string; verified?: boolean | null; addedByName?: string | null; addedAt?: string | null }>
  /** Price history, for an RFQ's estimate. */
  history?: PriceHistoryEntry[]
  /** Suppliers' questions on our open RFQs. */
  rfqQueries?: RfqQueryFact[]
  /** The org has procurement staff besides the owner: the owner then reads, and
   * approves what is routed to him — the prototype's owner role. A one-person
   * company's owner does everything himself. */
  ownerHasTeam?: boolean
  /** By order id: how far an order awaiting approval runs past its BOQ items'
   * budgets, when the screen computed it (`budgetOverrun`). */
  budgetOverruns?: Record<string, number>
  /** By need row key: the workshop's readiness date for a line being made. */
  readyDates?: Record<string, string>
  /** By need row key: the number of the sample with the consultant (`sampleNo`). */
  sampleNos?: Record<string, string>
  /** Finance is in the company's package (undefined = it is). */
  financeOn?: boolean
  /** By delivery id: where a notice's goods land and who the register names to receive them there. */
  forwardFacts?: Record<string, { place: string | null; receiver: string | null }>
  /** Projects' boundary events Procurement reads (`pmEvents` SRET · NOPO · EQH). */
  pmEvents?: PmBoundaryFact[]
  /** The company switched Project Management off: no project events, no wait on a project's decision. Absent = on. */
  projectsOn?: boolean
  /** The company switched Manufacturing off: nothing waits on the workshop. Absent = on. */
  workshopOn?: boolean
}

/** What a PM project tells Procurement through its outbox (`pmEvents`): a
 * material going back to the supplier — non-conforming, or damage charged to
 * him (SRET) · a cash inbound on the project with no order (NOPO) · a hire in
 * place of our fleet, dated from/to (EQH). Procurement reads; the project wrote. */
export interface PmBoundaryFact {
  key: string
  kind: "SRET" | "NOPO" | "EQH"
  projectId: string
  projectNo: string
  amount: number
  params: Record<string, string | number | boolean>
  /** ISO. */
  at: string
}

export const PM_BOUNDARY_KINDS = ["SRET", "NOPO", "EQH"] as const

export const OFFER_PENDING = new Set(["قيد المراجعة", "مطلوب تخفيض"])
export const OFFER_ACCEPTED = "مقبول"

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** The chips above the list: الطلبات الواردة · العروض · الأوامر · الاستلام. */
export type TodayChip = "req" | "rfq" | "po" | "rcv"
export const TODAY_CHIPS: readonly TodayChip[] = ["req", "rfq", "po", "rcv"]
export type TaskSeverity = "red" | "amber" | "blue"
/** Red first, then the rest by date. */
export type TaskTier = "red" | "normal"
/** What an amount includes (G-18): VAT in it, VAT left out, or an order that carries none. */
export type TaskBasis = "incl" | "excl" | "none"

export type TaskKind =
  | "approve" // appr — mine to approve
  | "returned" // ret — sent back to its preparer
  | "send" // approved, not sent
  | "not_accepted" // nacc
  | "declined" // dec — the supplier declined the order
  | "late" // late
  | "confirm_before_date"
  | "reject_decide" // rej
  | "advance_owner" // adv — the owner's gate on an advance to a supplier with no record
  | "guest_due" // offp — an off-platform supplier whose day came
  | "change_ask" // the supplier asked to change the order
  | "cancel_remainder"
  | "finance_hold"
  | "close_received"
  | "advance_unpaid"
  | "rate"
  | "supplier_verify"
  | "agreement_expiring"
  | "notice_forward" // fwd
  | "count_escalated" // count past the policy window
  | "notice_late_date"
  | "delivery_reported"
  | "arrived_today"
  | "receipt_no_po"
  | "pm_supplier_return"
  | "pm_cash_inbound"
  | "pm_hire"
  | "need_request" // a request to publish or prepare
  | "need_far" // the requests whose last day is over a week away, folded
  | "need_rollup"
  | "rfq_draft"
  | "rfq_award" // closed with live offers
  | "rfq_no_live"
  | "rfq_can_award" // open, the competition limit reached
  | "rfq_query"
  | "team_approval" // a team «طلب مواد» awaiting the viewer's approval before Procurement (REQ-05, `team-approval-today.ts`)

export interface Task {
  id: string
  kind: TaskKind
  chip: TodayChip
  tier: TaskTier
  /** The colour of the row's icon. */
  severity: TaskSeverity
  /** Days from today to the date the row is due (negative = passed): the sort key inside a tier. */
  due: number
  titleKey: string
  titleParams: Record<string, string | number>
  subKey: string
  subParams: Record<string, string | number>
  /** `Portal.ProcOrders` when the subtitle is the order's next-step sentence (`step` is then set). */
  subNs: "ProcToday" | "Procurement" | "ProcOrders"
  step?: PoNextStep
  /** Null when the viewer may not see money, or when the row has none to show. */
  amount: number | null
  basis: TaskBasis | null
  href: string
  actionKey: string
  /** A second button beside the direct one («جهّزه» beside «انشره»). */
  secondary?: { actionKey: string; href: string }
  /** The button does the act on the spot instead of opening a page. */
  act?: { kind: "escalate"; deliveryId: string }
  /** A coded reason the screen may render from `Portal.Procurement` (reject / hold). */
  reasonCode?: string | null
}

export const ORDER_HREF = (id: string) => `/contractor/rfqs/orders?po=${id}`
/** «أرسِله للمورد» opens the order with its send form (the orders page reads `act=send`). */
export const SEND_HREF = (id: string) => `/contractor/rfqs/orders?po=${id}&act=send`
/** The Suppliers tab, on its agreements segment. */
export const AGREEMENTS_HREF = "/contractor/suppliers?segment=agreements"
export const SUPPLIERS_HREF = "/contractor/suppliers"
export const RECEIPT_HREF = (id: string) => `/contractor/goods-received?delivery=${id}`
export const RFQ_HREF = (id: string) => `/contractor/rfqs/${id}/offers`
export const RFQS_HREF = "/contractor/rfqs"
export const DRAFTS_HREF = "/contractor/rfqs"
/** A draft opens in the form it was left in. */
export const DRAFT_HREF = (id: string) => `/contractor/rfqs/new?edit=${encodeURIComponent(id)}`
/** The Suppliers tab, on one agreement's drawer. */
export const AGREEMENT_HREF = (id: string) => `/contractor/suppliers?segment=agreements&agreement=${encodeURIComponent(id)}`
/** The reports tab's commitments report — what Finance will be asked to pay. */
export const COMMITMENTS_HREF = "/contractor/rfqs/reports?report=commitments"
export const NEEDS_HREF = "/contractor/rfqs/requests"
export const NEED_LINE_HREF = (key: string) => `/contractor/rfqs/requests?line=${encodeURIComponent(key)}`
/** The incoming request's own panel on its publishing step (PUR-01 «انشره»). */
export const NEED_PUBLISH_HREF = (key: string) => `/contractor/rfqs/requests?publish=${encodeURIComponent(key)}`
/** «جهّزه»: the request goes into a draft RFQ in the editor. */
export const NEED_PREPARE_HREF = (key: string) => `/contractor/rfqs/new?requests=${encodeURIComponent(key)}`
/** A project's page on one of its tabs. */
export const PROJECT_HREF = (id: string, tab: string) => `/contractor/projects/${id}?tab=${tab}`

/** The goods-received desk's incoming tab, where a receipt is recorded against an order with no notice. */
export const RECEIVE_PO_HREF = "/contractor/goods-received"
/** Decision 2 (Supplier 1.0): a reported delivery with no receipt reminds the receivers after 2 days and goes to the
 * procurement manager after 5. The supplier is never late while it waits. */
export const RECEIPT_REMIND_DAYS = 2
export const RECEIPT_ESCALATE_DAYS = 5

/** The receiver's own page for a truck at the gate with no notice: he counts and confirms there. */
export const ARRIVAL_HREF = (poId: string) => `/contractor/receive/po/${encodeURIComponent(poId)}`

/** The goods-received desk opens the forward dialog for this notice. */
export const FORWARD_HREF = (id: string) => `/contractor/goods-received?delivery=${id}&forward=1`

const CHIP_OF: Record<TaskKind, TodayChip> = {
  approve: "po",
  returned: "po",
  send: "po",
  not_accepted: "po",
  declined: "po",
  late: "po",
  confirm_before_date: "po",
  reject_decide: "po",
  advance_owner: "po",
  guest_due: "po",
  change_ask: "po",
  cancel_remainder: "po",
  finance_hold: "po",
  close_received: "po",
  advance_unpaid: "po",
  rate: "po",
  supplier_verify: "po",
  agreement_expiring: "po",
  notice_forward: "rcv",
  count_escalated: "rcv",
  notice_late_date: "rcv",
  delivery_reported: "rcv",
  arrived_today: "rcv",
  receipt_no_po: "rcv",
  pm_supplier_return: "rcv",
  pm_cash_inbound: "rcv",
  pm_hire: "req",
  need_request: "req",
  need_far: "req",
  need_rollup: "req",
  rfq_draft: "rfq",
  rfq_award: "rfq",
  rfq_no_live: "rfq",
  rfq_can_award: "rfq",
  rfq_query: "rfq",
  team_approval: "req",
}

/** Below this on-time score we confirm with the supplier before his date, not after. */
export const CONFIRM_BEFORE_DATE_BELOW = 85
/** A receipt with no order stays on the desk this long, then it is a report row. */
const NO_PO_WINDOW_DAYS = 30
/** A project's boundary event stays on Today this long — it carries no state of
 * its own to close, so after that it is history on the project. */
export const PM_EVENT_WINDOW_DAYS = 30
/** Requests whose last day to order is further off than this fold into one line (TDY-02). */
export const FAR_REQUEST_DAYS = 7

export type ActorKind = "owner" | "buyer" | "expediter"

/** The owner; anyone else who sees prices (manager, buyer); the expediter who
 * does not. A one-person company's owner (`ownerHasTeam === false`) works the
 * desk himself, so he gets the working numbers, not the read-only ones. */
export function actorKind(actor: ProcActor, ownerHasTeam?: boolean): ActorKind {
  if (actor.isOwner) return ownerHasTeam === false ? "buyer" : "owner"
  return actor.seesPrices ? "buyer" : "expediter"
}

/** A buyer (prepares or sources, never approves) sees his own and his categories. */
export const sourcesOnly = (actor: TodayActor): boolean => !actor.isOwner && !actor.canApprove && (actor.canPrepare || Boolean(actor.canSource))

/** Who owns the next move on an open finance hold. */
export const holdOwnerOf = (reason: string): HoldOwner => HOLD_OWNER[reason as keyof typeof HOLD_OWNER] ?? "fin"

const num = (n: unknown): number => (Number.isFinite(Number(n)) ? Number(n) : 0)
const linesText = (po: PurchaseOrder) =>
  po.lines
    .filter((l) => lineOutstanding(l) > 0)
    .map((l) => `${l.name} ${lineOutstanding(l)} ${l.unit}`)
    .join(" · ")

/** `when` for the «بعد يومين / اليوم / منذ N» sentence: passed / today / ahead / no date. */
export function whenParams(days: number | null): Record<string, string | number> {
  if (days == null) return { when: "none", n: 0 }
  return days < 0 ? { when: "past", n: -days } : days === 0 ? { when: "today", n: 0 } : { when: "future", n: days }
}

/** The VAT an order carries — none for a supplier who is not registered. */
const vatOf = (po: PurchaseOrder): number => (po.noVat ? 0 : num(po.vatRate))
const basisOfOrder = (po: PurchaseOrder): TaskBasis => (vatOf(po) > 0 ? "incl" : "none")

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

type NewTask = Omit<Task, "chip" | "tier" | "subNs" | "basis"> & { subNs?: Task["subNs"]; basis?: TaskBasis }

/** The requests whose last day is far off, folded: the near ones stay rows, the far ones become one line. */
export function foldFarRequests<T extends { lastIn: number | null }>(items: readonly T[], days = FAR_REQUEST_DAYS): { near: T[]; far: T[]; nearest: number | null } {
  const near: T[] = []
  const far: T[] = []
  for (const i of items) (i.lastIn != null && i.lastIn <= days ? near : far).push(i)
  const known = far.map((i) => i.lastIn).filter((x): x is number => x != null)
  return { near, far, nearest: known.length ? Math.min(...known) : null }
}

/** The incoming requests with something to publish NOW (new, or the remainder of a partly handled one) — a request whose every line waits for Inventory's or the workshop's reply has nothing to publish yet. */
function newRequestCards(w: ProcWorld, rows: NeedRow[]): RequestCard[] {
  return requestCards(rows, w.rfqs as DraftFact[]).filter((c) => cardSegment(c) === "new" && c.buyLines > 0)
}

const scopedRows = (w: ProcWorld, actor: TodayActor): NeedRow[] => {
  const desk = w.needDesk
  if (!desk) return []
  return sourcesOnly(actor) ? desk.rows.filter((r) => inBuyerScope(r, desk.viewerCategories)) : desk.rows
}

export function todayTasks(w: ProcWorld, actor: TodayActor, now: Date): Task[] {
  const out: Task[] = []
  const today = todayOf(now)
  const kind = actorKind(actor)
  const expediter = kind === "expediter"
  const sees = actor.seesPrices
  const decides = actor.canPrepare || actor.canApprove || actor.isOwner
  // The prototype's `src`: the manager and the buyer source; so does a member
  // who runs RFQs (rfq.manage) without preparing orders.
  const sources = actor.canPrepare || actor.canApprove || actor.isOwner || Boolean(actor.canSource)
  const add = (t: NewTask) => out.push({ subNs: "ProcToday", ...t, chip: CHIP_OF[t.kind], tier: t.severity === "red" ? "red" : "normal", basis: t.amount == null ? null : (t.basis ?? "excl") })
  // The prototype's four roles: the owner reads (when he has a team), a buyer
  // works his own orders and categories, the manager sees everyone's.
  const ownerRO = actor.isOwner && w.ownerHasTeam === true
  const buyerOnly = sourcesOnly(actor)
  const cats = w.needDesk?.viewerCategories ?? null
  const scope = { uid: actor.uid, isOwner: actor.isOwner, canApprove: actor.canApprove, canPrepare: buyerOnly }
  // A buyer's order rows are the orders he prepared (the prototype's `p.by===USER`):
  // his categories widen the orders list, never his Today.
  const mine = (po: PurchaseOrder | undefined) => !buyerOnly || !po || po.preparedById === actor.uid
  const chases = actor.canExpedite && !ownerRO
  const look = (key: string) => (ownerRO ? "actions.view" : key)
  const financeOn = w.financeOn !== false
  const closes = actor.isOwner || actor.canApprove
  const money = (value: number | null) => (sees ? value : null)
  const orderMoney = (po: PurchaseOrder, exVat: number | null) => ({ amount: money(exVat == null ? null : round2(exVat * (1 + vatOf(po)))), basis: basisOfOrder(po) })
  const stateCtx: PoStateCtx = { notices: w.receipts as StepNotice[], financeOn, acceptanceDays: w.policies.supplierAcceptanceDays, now }
  const noticeById = new Map(w.receipts.map((r) => [r.id, r]))
  const ownerAdvance = new Set(advanceOwnerWaiting(w.orders, actor).map((p) => p.id))

  const ordersBySupplier = new Map<string, PurchaseOrder[]>()
  for (const po of w.orders) {
    const k = supplierKey(po)
    ordersBySupplier.set(k, [...(ordersBySupplier.get(k) || []), po])
  }
  const scoreOf = (po: PurchaseOrder) => supplierScore(ordersBySupplier.get(supplierKey(po)) || [], w.receipts, now)

  for (const po of w.orders) {
    const ns = poNextStep(po, stateCtx)
    const s = ns.state
    const base = { number: po.docNumber, supplier: po.supplierName }
    const value = poValue(po)
    const created = daysFromNow(dayOf(po.createdAt), now) ?? 0
    const stepRow = (rowKind: TaskKind, severity: TaskSeverity, due: number, actionKey: string, extra: Partial<NewTask> = {}) =>
      add({ id: `${rowKind}:${po.id}`, kind: rowKind, severity, due, titleKey: "task.po.title", titleParams: base, subKey: `step.${s.k}`, subParams: {}, subNs: "ProcOrders", step: ns, href: ORDER_HREF(po.id), actionKey, ...orderMoney(po, value), ...extra })

    if (po.status !== "cancelled" && po.status !== "closed" && decides && !ownerRO && mine(po)) {
      const ask = changeAskOpen(po)
      if (ask) add({ id: `change_ask:${po.id}`, kind: "change_ask", severity: "amber", due: 0, titleKey: "task.po.title", titleParams: base, subKey: "task.change_ask.sub", subParams: { text: ask.text }, amount: null, href: ORDER_HREF(po.id), actionKey: "actions.reply" })
    }

    if (s.k === "appr") {
      // Mine to approve. A blocked one says why, in place of the step sentence.
      if (!approvalRefusal(po, actor, w.policies)) {
        const first = poBlocks(po, { supplier: w.supplierFacts[po.supplierOrgId] || null, otherOrders: w.orders, policies: w.policies, now })[0]
        stepRow("approve", "blue", 0, "actions.approvePo", first ? { subKey: `blocks.${first.code as BlockCode}`, subParams: first.params, subNs: "Procurement", step: undefined } : {})
      }
      continue
    }
    if (s.k === "ret") {
      if (decides && !ownerRO && mine(po)) stepRow("returned", "amber", 0, "actions.resubmit")
      continue
    }
    if (s.k === "send") {
      if (chases && mine(po)) {
        // Approved, with Finance as a commitment, and the supplier has not heard.
        const approved = daysFromNow(dayOf(po.approvedAt), now) ?? created
        add({ id: `send:${po.id}`, kind: "send", severity: "amber", due: approved, titleKey: financeOn ? "task.send.title" : "task.send.title_nofin", titleParams: base, subKey: "task.send.sub", subParams: {}, ...orderMoney(po, value), href: SEND_HREF(po.id), actionKey: "actions.send" })
      }
      continue
    }
    if (s.k === "sent") continue
    if (s.k === "nacc") {
      // The acceptance window ran out — without an acceptance there is no date.
      if (chases && mine(po)) stepRow("not_accepted", "amber", 0, "actions.remindSupplier")
      continue
    }
    if (s.k === "dec") {
      if (decides && !ownerRO && mine(po)) stepRow("declined", "red", 0, "actions.reaward")
      continue
    }

    if (ownerAdvance.has(po.id)) {
      // The advance to a supplier with no record waits for the owner before Finance is asked.
      add({ id: `advance_owner:${po.id}`, kind: "advance_owner", severity: "amber", due: 0, titleKey: "task.po.title", titleParams: base, subKey: "step.adv_owner", subParams: { percent: Number(asX(po).advancePercent) || 0 }, subNs: "ProcOrders", step: ns, amount: money(advanceAmount(asX(po))), basis: "incl", href: ORDER_HREF(po.id), actionKey: "actions.approveAdvance" })
    }

    if (s.k === "offp" && chases && mine(po)) stepRow("guest_due", "amber", daysFromNow(po.promisedDate, now) ?? 0, "actions.logNotice")

    if (poLate(po, now, w.receipts) && chases && mine(po)) {
      // Late — the sentence names what the supplier owes; a part-received order says what is left.
      const days = daysLate(po, now, w.receipts)
      if (s.k === "late") stepRow("late", "red", -days, "actions.remindSupplier", orderMoney(po, poOpenValue(po)))
      else if (s.k === "part") add({ id: `late:${po.id}`, kind: "late", severity: "red", due: -days, titleKey: "task.po.title", titleParams: base, subKey: "task.late.sub_part", subParams: { days, lines: linesText(po) }, ...orderMoney(po, poOpenValue(po)), href: ORDER_HREF(po.id), actionKey: "actions.remindSupplier" })
    } else if (chases && sees && mine(po) && (s.k === "wait" || s.k === "transit")) {
      const promise = daysFromNow(po.promisedDate, now)
      if (promise != null && promise >= 0 && promise <= 2) {
        // A poor on-time record: confirm before his date, do not wait for the delay.
        const score = scoreOf(po)
        if (score.onTimePercent != null && score.onTimePercent < CONFIRM_BEFORE_DATE_BELOW) {
          add({ id: `confirm:${po.id}`, kind: "confirm_before_date", severity: "blue", due: promise, titleKey: "task.confirm_before_date.title", titleParams: { ...base, inDays: promise }, subKey: "task.confirm_before_date.sub", subParams: { percent: score.onTimePercent }, amount: null, href: ORDER_HREF(po.id), actionKey: "actions.open" })
        }
      }
    }

    if (s.k === "count" && s.step?.kind === "receiver_late" && chases && mine(po)) {
      // The receiver has not counted a delivery whose day passed: past the policy window it is escalated (TDY-05).
      const step = s.step
      const notice = noticeById.get(step.deliveryId)
      if (notice && needsEscalation(notice as DeskDelivery, now, w.policies.escalateAfterDays)) {
        add({
          id: `count_escalated:${step.deliveryId}`,
          kind: "count_escalated",
          severity: "red",
          due: 0,
          titleKey: "task.po.title",
          titleParams: base,
          subKey: "task.count_escalated.sub",
          subParams: { name: step.receiver, days: step.days, limit: w.policies.escalateAfterDays },
          amount: null,
          href: RECEIPT_HREF(step.deliveryId),
          actionKey: "actions.escalate",
          act: { kind: "escalate", deliveryId: step.deliveryId },
        })
      }
    }

    if (decides && po.status === "accepted" && mine(po)) {
      // Rejected at the gate, no decision yet: replace, discount or return.
      for (const l of po.lines) {
        if (!(Number(l.rejected) > 0) || l.rejectDecision) continue
        const reject = w.receipts.find((r) => r.poId === po.id && r.status === "confirmed" && (r.lines || []).some((d) => d.poLineId === l.id && Number(d.rejected) > 0))?.lines?.find((d) => d.poLineId === l.id && Number(d.rejected) > 0)
        add({
          id: `reject:${po.id}:${l.id}`,
          kind: "reject_decide",
          severity: "red",
          due: 0,
          titleKey: "task.po.title",
          titleParams: base,
          subKey: "task.reject_decide.sub",
          subParams: { qty: l.rejected, unit: l.unit, name: l.name },
          ...orderMoney(po, l.unitPrice == null ? null : round2(l.rejected * l.unitPrice)),
          href: ORDER_HREF(po.id),
          actionKey: look("actions.askReplace"),
          reasonCode: reject?.rejectReason || null,
        })
      }
    }

    if (decides && mine(po) && poStatus(po) !== "closed" && poStatus(po) !== "cancelled") {
      // Projects closed the material while the rest is still owed (`pmCancels`): tell the supplier.
      for (const l of po.lines) {
        const open = lineOutstanding(l)
        if (!pmCancelOpen(asX(po), l) || !(open > 0)) continue
        add({ id: `cancel_remainder:${po.id}:${l.id}`, kind: "cancel_remainder", severity: "amber", due: 0, titleKey: "task.cancel_remainder.title", titleParams: { qty: open, unit: l.unit, name: l.name }, subKey: "task.cancel_remainder.sub", subParams: base, ...orderMoney(po, l.unitPrice == null ? null : round2(open * l.unitPrice)), href: ORDER_HREF(po.id), actionKey: look("actions.open") })
      }
    }

    if ((poStatus(po) === "received" || poStatus(po) === "closed") && decides && sees && !ownerRO && mine(po) && canRate(po, w.receipts)) {
      // The story is whole: rate him.
      add({ id: `rate:${po.id}`, kind: "rate", severity: "blue", due: 0, titleKey: "task.rate.title", titleParams: base, subKey: "task.rate.sub", subParams: {}, amount: null, href: ORDER_HREF(po.id), actionKey: "actions.rate" })
    }

    if (!endsOnPayment(po, financeOn) && closes && mine(po) && poStatus(po) === "received") {
      // Without Finance nobody's payment closes a fully received order: closing it is ours, and the payment status never stops it.
      add({ id: `close:${po.id}`, kind: "close_received", severity: "blue", due: daysFromNow(poFacts(po, w.receipts).lastReceiptDay, now) ?? 0, titleKey: "task.close_received.title", titleParams: base, subKey: "task.close_received.sub", subParams: {}, ...orderMoney(po, value), href: ORDER_HREF(po.id), actionKey: look("actions.closeOrder") })
    }

    if (!financeOn && closes && mine(po) && po.status !== "closed" && advanceState(asX(po)) === "requested") {
      // Without Finance the advance is marked paid here, and the supplier's date counts from that day.
      const approved = daysFromNow(dayOf(po.approvedAt), now) ?? created
      add({ id: `advance:${po.id}`, kind: "advance_unpaid", severity: "amber", due: approved, titleKey: "task.advance_unpaid.title", titleParams: { ...base, percent: Number(asX(po).advancePercent) || 0 }, subKey: "task.advance_unpaid.sub", subParams: {}, amount: money(advanceAmount(asX(po))), basis: "incl", href: ORDER_HREF(po.id), actionKey: look("actions.open") })
    }

    if (sees && mine(po) && endsOnPayment(po, financeOn)) {
      // Finance held a supplier's invoice (prototype FREJ): whose move it is decides the row.
      for (const h of openHolds(asX(po))) {
        const owner = holdOwnerOf(h.reason)
        const at = daysFromNow(dayOf(h.at), now) ?? 0
        const common = { due: at, href: ORDER_HREF(po.id), reasonCode: h.reason }
        const params = { supplier: po.supplierName, invoice: h.invoiceNo, holdReason: h.reason, need: h.need || h.text || "", number: po.docNumber }
        const v = holdVariance(po, h)
        if (h.pend) {
          // A higher price someone asked for waits on the order's approver — nobody else has a move.
          if (acceptsHoldPrice(po, actor) && (h.pend.byUid !== actor.uid || actor.isOwner)) {
            const asked = v ? round2((h.pend.price - v.poPrice) * v.received) : h.amount
            add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", severity: "red", titleKey: "task.finance_hold.pend.title", titleParams: params, subKey: "task.finance_hold.pend.sub", subParams: { ...params, name: h.pend.byName, why: h.pend.why }, actionKey: "actions.review", ...common, amount: money(asked) })
          }
          continue
        }
        if (owner === "proc" && sources && !ownerRO && v) {
          // A price variance is Procurement's call, not the accountant's: the variance on what was received is the amount.
          const fig = (n: number) => n.toLocaleString("en-US")
          add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", severity: "red", titleKey: "task.finance_hold.price.title", titleParams: params, subKey: "task.finance_hold.price.sub", subParams: { ...params, inv: fig(v.invoicePrice), po: fig(v.poPrice) }, actionKey: "actions.decide", ...common, amount: money(v.variance) })
        } else if (owner === "proc" && sources && !ownerRO) {
          add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", severity: "red", titleKey: "task.finance_hold.proc.title", titleParams: params, subKey: "task.finance_hold.proc.sub", subParams: params, actionKey: "actions.decide", ...common, amount: money(h.amount) })
        } else if (owner === "rcv" && chases) {
          add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", severity: "amber", titleKey: "task.finance_hold.rcv.title", titleParams: params, subKey: "task.finance_hold.rcv.sub", subParams: { ...params, where: po.projectId && w.projectsOn !== false ? "projects" : "inventory" }, actionKey: "actions.open", ...common, amount: money(h.amount) })
        } else if (ownerRO) {
          add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", severity: "amber", titleKey: "task.finance_hold.owner.title", titleParams: params, subKey: "task.finance_hold.owner.sub", subParams: { ...params, holdOwner: owner }, actionKey: "actions.view", ...common, amount: money(h.amount) })
        } else if (owner === "sup" && sources) {
          add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", severity: "amber", titleKey: "task.finance_hold.sup.title", titleParams: params, subKey: "task.finance_hold.sup.sub", subParams: params, actionKey: "actions.decide", ...common, amount: money(h.amount) })
        }
      }
    }
  }

  const orderById = new Map(w.orders.map((o) => [o.id, o]))

  // A pending notice nobody passed on, or dated after the supplier's own promise. A forwarded notice that is simply on its way
  // is not a decision: it is counted in the route strip («في الطريق») and waits on the receiver.
  for (const r of w.receipts) {
    if (r.status !== "pending_confirmation" || (r as { closedByReceipt?: unknown }).closedByReceipt) continue
    const po = r.poId ? orderById.get(r.poId) : undefined
    if (!mine(po)) continue
    const d = daysFromNow(r.deliveryDate, now)
    const promised = po ? daysFromNow(po.promisedDate, now) : null
    const supplier = r.supplierName || po?.supplierName || ""
    const number = r.poNumber || po?.docNumber || ""
    const told = Boolean(r.forwardedTo) || Boolean(r.receiverReport)
    if (!told && chases) {
      // The receiver must know before the truck leaves: «وصل إشعار التسليم — حوّله للمستلم».
      const fwd = w.forwardFacts?.[r.id]
      const place = fwd?.place || po?.projectName || ""
      const receiver = fwd?.receiver || ""
      const due = d == null ? 9 : d - w.policies.forwardWindowDays
      add({
        id: `notice_forward:${r.id}`,
        kind: "notice_forward",
        severity: d != null && due <= 0 ? "red" : "amber",
        due,
        titleKey: "task.po.title",
        titleParams: { number, supplier },
        subKey: "task.notice_forward.sub",
        subParams: { date: dayOf(r.deliveryDate), hasDate: d == null ? 0 : 1, place, hasPlace: place ? 1 : 0, receiver, hasReceiver: receiver ? 1 : 0, noReceiver: fwd && !receiver ? 1 : 0 },
        amount: null,
        href: FORWARD_HREF(r.id),
        actionKey: "actions.forward",
      })
    } else if (sees && promised != null && d != null && d > promised) {
      // The supplier announces a date after his own promise — the delay is known before it happens.
      add({ id: `notice_late_date:${r.id}`, kind: "notice_late_date", severity: "amber", due: d, titleKey: "task.notice_late_date.title", titleParams: { supplier, days: d - promised }, subKey: "task.notice_late_date.sub", subParams: { number, date: dayOf(r.deliveryDate), promised: po?.promisedDate || "" }, amount: null, href: RECEIPT_HREF(r.id), actionKey: "actions.openNotice" })
    }
  }

  // The free supplier's "I delivered" (Supplier 1.0 WF-09) is a date and a note on the ORDER, not a notice: until a receipt
  // answers it, it is the receivers' to record. After 2 days it turns amber, after 5 red — the daily job reminds the receivers
  // and then the procurement manager on the same days (decision 2).
  if (actor.canReceive || chases) {
    const counts = actor.canReceive && !ownerRO
    for (const po of w.orders) {
      if (!mine(po) || po.status !== "accepted") continue
      for (const r of po.deliveryReports || []) {
        if (r.closedAt) continue
        const ago = Math.max(0, -(daysFromNow(r.date, now) ?? 0))
        add({
          id: `delivery_reported:${po.id}:${r.id}`,
          kind: "delivery_reported",
          severity: ago >= RECEIPT_ESCALATE_DAYS ? "red" : ago >= RECEIPT_REMIND_DAYS ? "amber" : "blue",
          due: -ago,
          titleKey: "task.delivery_reported.title",
          titleParams: { supplier: po.supplierName, number: po.docNumber },
          subKey: "task.delivery_reported.sub",
          subParams: { date: r.date, daysAgo: ago, note: r.note || "", hasNote: r.note ? 1 : 0, reminded: r.reminders.length },
          amount: null,
          // The receiver counts it himself (his own page for an order with no notice); Procurement only follows it up.
          href: counts ? ARRIVAL_HREF(po.id) : RECEIVE_PO_HREF,
          actionKey: counts ? "actions.count" : "actions.openNotice",
        })
      }
    }
  }

  if (!expediter && chases) {
    // What arrived today on our orders — one roll-up row, each receipt flagged when it carries rejects.
    const arrived = w.receipts.filter((r) => r.status === "confirmed" && r.poId && receiptDay(r) === today && mine(orderById.get(r.poId)))
    if (arrived.length) {
      const items = arrived.map((r) => ({ name: `${r.supplierName || orderById.get(r.poId as string)?.supplierName || ""} ${r.docNumber || ""}`.trim(), ...arrivedFlags(r) }))
      const list = items.map((i) => i.name).join(" · ")
      add({ id: `arrived:${today}`, kind: "arrived_today", severity: "blue", due: 0, titleKey: "task.arrived_today.title", titleParams: { count: arrived.length }, subKey: "task.arrived_today.sub_flags", subParams: { list, rejects: items.filter((i) => i.rejects).length }, amount: null, href: "/contractor/goods-received?tab=recs", actionKey: "actions.seeArrived" })
    }
  }

  if (!expediter) {
    // A receipt with no order — informational; the regularisation is a retroactive order.
    const catFacts = { orders: w.orders, rfqs: w.rfqs.map((x) => ({ category: x.category, createdAt: x.createdAt, products: (x.products || []).map((p) => ({ name: p.name, unit: p.unit ?? undefined })) })) }
    for (const r of w.receipts) {
      if (r.source !== "manual" || r.poId || r.offerId || r.status !== "confirmed") continue
      // Settled already — booked as an expense, or regularised by a retroactive order.
      if (r.regularisation === "expense" || r.regularisedByName) continue
      const day = receiptDay(r)
      const age = day ? -(daysFromNow(day, now) ?? 0) : 0
      if (!day || age > NO_PO_WINDOW_DAYS) continue
      const lines = r.lines || []
      const category = (r as { category?: string | null }).category || lines.map((l) => categoryOf(l.name, l.unit, null, catFacts)).find(Boolean) || null
      if (buyerOnly && cats?.length && !receiptInCategories({ ...r, category }, cats)) continue
      const first = lines[0]
      const qty = first ? Number(first.accepted ?? first.counted) || 0 : 0
      add({ id: `nopo:${r.id}`, kind: "receipt_no_po", severity: "amber", due: -age, titleKey: first ? "task.receipt_no_po.title_line" : "task.receipt_no_po.title", titleParams: { supplier: r.supplierName || "", hasSupplier: r.supplierName ? 1 : 0, qty, unit: first?.unit || "", material: first?.name || "", more: Math.max(0, lines.length - 1) }, subKey: "task.receipt_no_po.sub", subParams: { number: r.docNumber || "", date: day }, amount: null, href: RECEIPT_HREF(r.id), actionKey: look("actions.openReceipt") })
    }
  }

  if (sources && w.projectsOn !== false) {
    for (const e of pmBoundaryTasks(w.pmEvents || [], now)) add({ ...e, amount: money(e.amount), actionKey: look(e.actionKey) })
  }

  if (sources && !ownerRO) {
    const offersByRfq = new Map<string, OfferFact[]>()
    for (const o of w.offers) offersByRfq.set(o.rfqId, [...(offersByRfq.get(o.rfqId) || []), o])
    const decisions = w.decisions || {}

    for (const r of w.rfqs) {
      if (buyerOnly && !rfqInScope(r, scope)) continue
      const title = r.title || ""
      const ref = r.number || title
      const days = daysFromNow(r.deadline, now)
      if (r.status === "Draft") {
        // Never published: its lines are held for nothing.
        add({ id: `rfq_draft:${r.id}`, kind: "rfq_draft", severity: "blue", due: days ?? 9, titleKey: "task.rfq_draft.title", titleParams: { title }, subKey: "task.rfq_draft.sub", subParams: { number: r.number || "", hasNumber: r.number ? 1 : 0 }, amount: null, href: DRAFT_HREF(r.id), actionKey: "actions.openDraft" })
        continue
      }
      if (r.status !== "New") continue
      const offers = offersByRfq.get(r.id) || []
      const live = competingOffers(offers, decisions)
      const closed = Boolean(r.closedEarly) || (days != null && days < 0)
      if (noLiveOffer(r, offers, decisions, now)) {
        // WF-26: nothing in the running — reopen with a new date, or cancel it.
        add({ id: `rfq_no_live:${r.id}`, kind: "rfq_no_live", severity: "red", due: 0, titleKey: "task.rfq_no_live.title", titleParams: { ref }, subKey: "task.rfq_no_live.sub", subParams: { title }, amount: null, href: RFQ_HREF(r.id), actionKey: "actions.openRfq" })
      } else if (live.length) {
        const ev = evaluatePlanOffers(r as PricedRfq, offers as PlanOffer[], decisions, { today, policies: w.policies })
        const lowest = ev.lowestComplete
        const gross = sees && lowest && lowest.grossH != null ? fromHalalas(lowest.grossH) : null
        if (closed) {
          // Closed with live offers: compare and award before the award window ends.
          const base = dayOf(r.deadline) || dayOf(r.closedEarly?.at) || today
          const by = addDays(base, w.policies.awardCycleDays)
          const byIn = daysFromNow(by, now) ?? 0
          add({ id: `rfq_award:${r.id}`, kind: "rfq_award", severity: byIn <= 1 ? "red" : "amber", due: byIn, titleKey: "task.rfq_award.title", titleParams: { ref, count: live.length }, subKey: "task.rfq_award.sub", subParams: { title, date: by, ...whenParams(byIn) }, amount: gross, basis: lowest && basisOf(lowest.vatRate) === "no_vat" ? "none" : "incl", href: RFQ_HREF(r.id), actionKey: "actions.compareAward" })
        } else {
          // Open, and every item has the live offers the competition limit asks for: awarding now is possible.
          if (thinnestItem(ev, r as PricedRfq, live.length) >= w.policies.minOffers) {
            add({ id: `rfq_can_award:${r.id}`, kind: "rfq_can_award", severity: "blue", due: days ?? 0, titleKey: "task.rfq_can_award.title", titleParams: { ref, count: live.length }, subKey: "task.rfq_can_award.sub", subParams: { title, hasLowest: gross == null ? 0 : 1, lowest: gross ?? 0, vat: lowest && basisOf(lowest.vatRate) === "incl_vat" ? 1 : 0, date: dayOf(r.deadline) }, amount: null, href: RFQ_HREF(r.id), actionKey: "actions.compare" })
          }
        }
      }
      // One row per RFQ (the prototype's «RFQ-… · 3 استفسارات بلا جواب»): the first question is quoted, the rest counted — five
      // questions on one RFQ never take five of the seven visible rows.
      const asked = (w.rfqQueries || []).filter((q) => q.rfqId === r.id && !q.answered)
      if (asked.length) {
        add({ id: `rfq_query:${r.id}`, kind: "rfq_query", severity: "amber", due: closed ? 0 : (days ?? 0), titleKey: "task.rfq_query.title", titleParams: { ref, count: asked.length }, subKey: "task.rfq_query.sub", subParams: { title, closed: closed ? 1 : 0, date: dayOf(r.deadline), question: asked[0].question, more: asked.length - 1 }, amount: null, href: `${RFQ_HREF(r.id)}?tab=inquiries`, actionKey: "actions.answer" })
      }
    }
  }

  // An agreement about to end (§4 `AGR`). Informational, and only for whoever
  // could renew it: when it lapses its materials go back to the market by
  // themselves, which is correct but expensive if nobody meant it.
  if ((actor.isOwner || actor.canApprove) && !ownerRO) {
    for (const a of w.agreements || []) {
      if (agreementState(a, today) !== "expiring") continue
      const left = agreementDaysLeft(a, today)
      add({ id: `agreement_expiring:${a.id}`, kind: "agreement_expiring", severity: "blue", due: left, titleKey: "task.agreement_expiring.title", titleParams: { supplier: a.supplierName, inDays: left }, subKey: "task.agreement_expiring.sub", subParams: { number: a.docNumber, materials: (a.lines || []).length }, amount: null, href: AGREEMENT_HREF(a.id), actionKey: "actions.openAgreement" })
    }
  }

  if ((actor.isOwner || actor.canApprove) && !ownerRO) {
    for (const r of w.supplierRecords || []) {
      if (r.verified !== false) continue
      add({ id: `supplier_verify:${r.supplierOrgId}`, kind: "supplier_verify", severity: "amber", due: 0, titleKey: "task.supplier_verify.title", titleParams: { supplier: r.supplierName }, subKey: "task.supplier_verify.sub", subParams: { name: r.addedByName || "" }, amount: null, href: `${SUPPLIERS_HREF}?supplier=${encodeURIComponent(r.supplierOrgId)}`, actionKey: "actions.openSupplier" })
    }
  }

  if (w.needDesk && sources) {
    const desk = w.needDesk
    const managerView = actor.isOwner || actor.canApprove
    const rows = scopedRows(w, actor)
    const rollupTask = (u: BuyerRollup) =>
      add({
        id: `need_rollup:${u.buyer?.uid || "-"}`,
        kind: "need_rollup",
        severity: u.overdue ? "amber" : "blue",
        due: u.nearest ?? 99,
        titleKey: "task.need_rollup.title",
        titleParams: { buyer: u.buyer?.name || "", assigned: u.buyer ? 1 : 0, count: u.count, overdue: u.overdue },
        subKey: "task.need_rollup.sub",
        subParams: whenParams(u.nearest),
        amount: null,
        href: NEEDS_HREF,
        actionKey: "actions.openNeeds",
      })
    // PUR-01: the REQUEST is the row — «ط.م 04 · برج العليا التجاري: مادة واحدة · آخر يوم للطلب 22 أكتوبر · بعد يومين» — with «انشره» and «جهّزه».
    const requestRows = (list: NeedRow[]) => {
      const items = newRequestCards(w, list).map((card) => ({ card, lastIn: card.lastOrderIn }))
      const { near, far, nearest } = foldFarRequests(items)
      for (const { card, lastIn } of near) {
        add({
          id: `need:${card.key}`,
          kind: "need_request",
          severity: lastIn != null && lastIn <= 2 ? "red" : "amber",
          due: lastIn ?? 0,
          titleKey: "task.need_request.title",
          titleParams: { ref: card.need.refLabel, place: card.need.projectName || card.need.place?.label || card.need.context || "", remainder: card.remainder ? 1 : 0 },
          subKey: "task.need_request.sub",
          subParams: { count: card.buyLines, date: card.lastOrderDay || "", ...whenParams(lastIn) },
          amount: null,
          href: NEED_PUBLISH_HREF(card.key),
          actionKey: "actions.publishRequest",
          secondary: { actionKey: "actions.prepare", href: NEED_PREPARE_HREF(card.key) },
        })
      }
      if (far.length) {
        const first = far.filter((i) => i.lastIn != null).sort((a, b) => (a.lastIn as number) - (b.lastIn as number))[0]
        add({
          id: "need_far",
          kind: "need_far",
          severity: "blue",
          due: nearest ?? 99,
          titleKey: "task.need_far.title",
          titleParams: { count: far.length },
          subKey: "task.need_far.sub",
          subParams: { date: first?.card.lastOrderDay || "", ...whenParams(nearest) },
          amount: null,
          href: `${NEEDS_HREF}?seg=new`,
          actionKey: "actions.openIncoming",
        })
      }
    }
    if (managerView) {
      const { rollups, uncovered } = buyerRollups(rows, desk.buyers)
      rollups.forEach(rollupTask)
      if (ownerRO) {
        const rest = rollupOf(uncovered)
        if (rest) rollupTask(rest)
      } else requestRows(uncovered)
    } else requestRows(rows)
  }

  return out.sort((a, b) => (a.tier === "red" ? 0 : 1) - (b.tier === "red" ? 0 : 1) || a.due - b.due)
}

/** A receipt carries rejects. */
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")
const numOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0)

/** Projects' boundary events as Today rows: informational, each opening the
 * project on the tab that holds it, within the window. */
export function pmBoundaryTasks(events: PmBoundaryFact[], now: Date): Array<Omit<NewTask, "subNs">> {
  const out: Array<Omit<NewTask, "subNs">> = []
  for (const e of events) {
    const day = (e.at || "").slice(0, 10)
    const ago = day ? -(daysFromNow(day, now) ?? 0) : 0
    if (!day || ago > PM_EVENT_WINDOW_DAYS || ago < 0) continue
    const p = e.params || {}
    const project = str(p.project) || e.projectNo
    const common = { id: `pm:${e.key}`, severity: "amber" as const, due: -ago, subParams: { project, projectNo: e.projectNo, date: day } }
    if (e.kind === "SRET") {
      const nc = str(p.why) === "nc" || !str(p.why)
      out.push({ ...common, kind: "pm_supplier_return", titleKey: nc ? "task.pm_supplier_return.title_nc" : "task.pm_supplier_return.title_charged", titleParams: { qty: numOf(p.qty), unit: str(p.unit), name: str(p.material) }, subKey: "task.pm_supplier_return.sub", amount: e.amount > 0 ? e.amount : null, href: PROJECT_HREF(e.projectId, "pmStore"), actionKey: "actions.openProject" })
    } else if (e.kind === "NOPO") {
      out.push({ ...common, kind: "pm_cash_inbound", titleKey: "task.pm_cash_inbound.title", titleParams: { qty: numOf(p.qty), unit: str(p.unit), name: str(p.material) }, subKey: "task.pm_cash_inbound.sub", amount: e.amount > 0 ? e.amount : null, href: PROJECT_HREF(e.projectId, "pmStore"), actionKey: "actions.openProject" })
    } else if (e.kind === "EQH") {
      out.push({
        ...common,
        kind: "pm_hire",
        titleKey: "task.pm_hire.title",
        titleParams: { request: str(p.request), what: str(p.what), fromDay: str(p.from), toDay: str(p.to) },
        subKey: "task.pm_hire.sub",
        subParams: { ...common.subParams, qty: numOf(p.qty) || 1, operator: p.operator === true || p.operator === "true" ? 1 : 0 },
        amount: null,
        href: PROJECT_HREF(e.projectId, "pmReq"),
        actionKey: "actions.openProject",
      })
    }
  }
  return out.sort((a, b) => a.due - b.due)
}

/** G-18: the competition is counted per ITEM — the live offers that priced it, a whole-RFQ offer counting for every item. */
export function thinnestItem(ev: Evaluation, rfq: PricedRfq, liveCount: number): number {
  const products = pricedProducts(rfq)
  if (!products.length) return liveCount
  return Math.min(...products.map((p) => ev.offers.filter((o) => o.live && (o.kind === "lump" || o.kind === "total" || lineOf(o, p.rfqProductIndex)) ).length))
}

/** Rejects on a receipt — what «وصل اليوم» flags. */
export function arrivedFlags(r: ReceiptFact): { rejects: boolean } {
  return { rejects: (r.lines || []).some((l) => Number(l.rejected) > 0) }
}

/** A receipt with no order belongs to a buyer when it names one of his
 * categories; one that names none is everyone's (a hidden row is a lost one). */
export function receiptInCategories(r: ReceiptFact & { category?: string | null }, categories: string[]): boolean {
  return !r.category || categories.includes(r.category)
}

/** An RFQ's value at the last prices we paid — null while a line has none. */
export function rfqEstimate(r: RfqFact, history: PriceHistoryEntry[] | undefined): number | null {
  const products = (r.products || []).filter((p) => (p.name || "").trim() && Number(p.quantity) > 0)
  if (!history || !products.length) return null
  let sum = 0
  for (const p of products) {
    const last = lastPaid(history, p.name || "", p.unit || "")
    if (!last) return null
    sum += last.price * Number(p.quantity)
  }
  return round2(sum)
}

/** How many rows each chip holds (and «الكل»): always the five, so the screen shows a count on every chip. */
export function chipCounts(tasks: readonly Pick<Task, "chip">[]): Record<TodayChip | "all", number> {
  const out = { all: tasks.length, req: 0, rfq: 0, po: 0, rcv: 0 }
  for (const t of tasks) out[t.chip]++
  return out
}

// ---------------------------------------------------------------------------
// Waits — "the action is theirs and the state reaches us" (no button)
// ---------------------------------------------------------------------------

export type WaitKind = "stock_reply" | "workshop_ask" | "being_made" | "sample_approval" | "po_step" | "receiver_count" | "approval_wait" | "held_inspection" | "invoice_hold" | "pm_budget"
/** The tag on the row: المخزون · الورشة · المورد · المستلم · المالية · المعتمِد (· المشاريع, which is ours to show and not in the prototype). */
export type WaitModule = "supplier" | "finance" | "inventory" | "manufacturing" | "projects" | "receiver" | "approver"

export interface Wait {
  id: string
  kind: WaitKind
  module: WaitModule
  titleKey: string
  titleParams: Record<string, string | number>
  subKey: string
  subParams: Record<string, string | number>
  /** Set when the sentence is the order's next step (rendered by `PoBits.useStepSentence`). */
  step?: PoNextStep
  href: string
  reasonCode?: string | null
}

/** Projects has not yet decided an order that runs past the item's budget. */
const PM_BUDGET_WAITS = new Set(["pending", "renegotiate"])

const REFUSAL_SUB: Record<string, string> = {
  not_awaiting: "task.approval_wait.sub.other",
  no_permission: "task.approval_wait.sub.other",
  own_order: "task.approval_wait.sub.own_order",
  owner_only_retroactive: "task.approval_wait.sub.retroactive",
  above_limit: "task.approval_wait.sub.above_limit",
}

const WHO_MODULE: Partial<Record<PoWho, WaitModule>> = { sup: "supplier", rcv: "receiver", fin: "finance" }

export function todayWaits(w: ProcWorld, actor: TodayActor, now: Date): Wait[] {
  const out: Wait[] = []
  const pmOn = w.projectsOn !== false
  const workshopOn = w.workshopOn !== false
  const financeOn = w.financeOn !== false
  const buyerOnly = sourcesOnly(actor)
  const desk = w.needDesk
  const stateCtx: PoStateCtx = { notices: w.receipts as StepNotice[], financeOn, acceptanceDays: w.policies.supplierAcceptanceDays, now }

  // What waits on Inventory or the workshop first, with the day their window ends (TDY-04, INC-07/08).
  if (w.incomingDocs) {
    const byKey = new Map(w.incomingDocs.map((d) => [d.mrKey, d]))
    for (const wl of waitingLines(w.incomingDocs, replyClockOf(now, w.policies))) {
      if (wl.who === "workshop" && !workshopOn) continue
      const doc = byKey.get(wl.mrKey)
      const line = doc?.lines.find((l) => l.no === wl.line)
      if (buyerOnly && !inBuyerScope({ category: line?.category ?? null }, desk?.viewerCategories)) continue
      const place = doc?.projectName || doc?.place?.label || ""
      out.push({
        id: `w_${wl.who}:${wl.mrKey}:${wl.line}`,
        kind: wl.who === "inventory" ? "stock_reply" : "workshop_ask",
        module: wl.who === "inventory" ? "inventory" : "manufacturing",
        titleKey: "wait.request_line.title",
        titleParams: { place, hasPlace: place ? 1 : 0, ref: wl.no, name: wl.name },
        subKey: wl.who === "inventory" ? "wait.stock_reply.sub" : "wait.workshop_ask.sub",
        subParams: { date: wl.until },
        href: NEED_PUBLISH_HREF(needKeyOfMr(wl.mrKey)),
      })
    }
  }

  // The need desk's other waits reach every Procurement role, the expediter too (the prototype's `inScope` is true for
  // everyone but a buyer outside his categories).
  if (desk) {
    for (const r of desk.rows) {
      if (buyerOnly && !inBuyerScope(r, desk.viewerCategories)) continue
      const base = { name: r.name, qty: r.state === "mfg" ? r.total : r.open, unit: r.unit }
      const href = NEED_LINE_HREF(r.key)
      if (r.state === "mfg" && workshopOn) {
        const ready = w.readyDates?.[r.key] || ""
        out.push({ id: `w_mfg:${r.key}`, kind: "being_made", module: "manufacturing", titleKey: "wait.being_made.title", titleParams: base, subKey: "wait.being_made.sub_ready", subParams: { ref: r.need.refLabel, date: r.needBy || "", hasDate: r.needBy ? 1 : 0, ready, hasReady: ready ? 1 : 0 }, href })
      }
      if (pmOn && isActionState(r.state) && r.samplePending) out.push({ id: `w_sample:${r.key}`, kind: "sample_approval", module: "projects", titleKey: "wait.sample_approval.title", titleParams: { name: r.name, no: w.sampleNos?.[r.key] || "", hasNo: w.sampleNos?.[r.key] ? 1 : 0 }, subKey: "wait.sample_approval.sub", subParams: {}, href })
    }
  }

  for (const po of w.orders) {
    const ns = poNextStep(po, stateCtx)
    const s = ns.state
    const base = { number: po.docNumber, supplier: po.supplierName }
    const x = asX(po)
    const orderRow = { titleKey: "task.po.title", titleParams: base, href: ORDER_HREF(po.id) }
    if (pmOn && po.status === "awaiting_approval" && x.pmBudget && PM_BUDGET_WAITS.has(x.pmBudget.state)) {
      // The order runs past the BOQ item's balance: the project manager decides (R-25).
      const over = w.budgetOverruns?.[po.id] ?? null
      out.push({ id: `w_budget:${po.id}`, kind: "pm_budget", module: "projects", titleKey: "wait.pm_budget.title", titleParams: base, subKey: "wait.pm_budget.sub", subParams: { over: actor.seesPrices && over != null ? over : 0, hasOver: actor.seesPrices && over != null && over > 0 ? 1 : 0 }, href: ORDER_HREF(po.id) })
    }
    if (s.k === "appr") {
      // Somebody else's to approve — the preparer and the managers see it wait.
      const refusal = approvalRefusal(po, actor, w.policies)
      if (refusal && actorKind(actor) !== "expediter" && (po.preparedById === actor.uid || actor.canApprove || actor.isOwner)) {
        out.push({ id: `w_approval:${po.id}`, kind: "approval_wait", module: "approver", href: ORDER_HREF(po.id), titleKey: "task.approval_wait.title", titleParams: { ...base, approver: po.approverKind, days: Math.max(0, -(daysFromNow(dayOf(po.createdAt), now) ?? 0)) }, subKey: po.preparedById === actor.uid ? REFUSAL_SUB.own_order : REFUSAL_SUB[refusal.code], subParams: { ...base, ...refusal.params } })
      }
    } else if (s.k === "count") {
      out.push({ id: `w_count:${po.id}`, kind: "receiver_count", module: "receiver", ...orderRow, subKey: "wait.receiver_count.sub", subParams: { name: String(ns.params.name || ""), days: Number(ns.params.days) || 0 } })
    } else if (WHO_MODULE[s.who]) {
      out.push({ id: `w_po:${po.id}`, kind: "po_step", module: WHO_MODULE[s.who] as WaitModule, ...orderRow, subKey: `step.${s.k}`, subParams: {}, step: ns })
    }
    for (const h of endsOnPayment(po, financeOn) ? openHolds(x) : []) {
      const owner = holdOwnerOf(h.reason)
      if (owner !== "fin" && owner !== "rcv") continue
      // Finance's own hold (a duplicate, the cash position) or the receiver's missing receipt.
      out.push({ id: `w_hold:${po.id}:${h.id}`, kind: "invoice_hold", module: owner === "fin" ? "finance" : po.projectId && pmOn ? "projects" : "inventory", titleKey: "wait.invoice_hold.title", titleParams: { ...base, invoice: h.invoiceNo, holdReason: h.reason }, subKey: "wait.invoice_hold.sub", subParams: { need: h.need || h.text || "", number: po.docNumber }, href: ORDER_HREF(po.id), reasonCode: h.reason })
    }
    if (po.status === "accepted") {
      // Held for inspection: not issued and not paid before release.
      for (const l of po.lines) {
        if (!(Number(l.held) > 0)) continue
        const holding = w.receipts.find((r) => r.poId === po.id && (r.lines || []).some((d) => d.poLineId === l.id && Number(d.held) > 0))
        const hold = holding?.lines?.find((d) => d.poLineId === l.id && Number(d.held) > 0)
        // Held at a project's site, the project inspects it; at a store, Inventory does.
        out.push({ id: `w_held:${po.id}:${l.id}`, kind: "held_inspection", module: holding?.projectId && pmOn ? "projects" : "inventory", titleKey: "wait.held_inspection.title", titleParams: { qty: l.held, unit: l.unit, name: l.name, ...base }, subKey: "wait.held_inspection.sub", subParams: {}, href: ORDER_HREF(po.id), reasonCode: hold?.holdReason || null })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The route strip (TDY-01)
// ---------------------------------------------------------------------------

export type FlowId = "inc" | "rfq" | "po" | "rcv" | "done"

export interface FlowTile {
  id: FlowId
  count: number
  /** `flow.<id>.sub` — and the amount when the sub is the orders' value incl. VAT. */
  subKey: string
  amount: number | null
  href: string
}

/** The day an order completed — its close day, else the day of its last receipt. */
const completedDay = (po: PurchaseOrder, receipts: ReceiptFact[]): string | null => dayOf(po.closedAt) || poFacts(po, receipts).lastReceiptDay

/**
 * واردة جديدة · في عروض · في أوامر · في الطريق · اكتملت — each with its count and each opening its page. «في أوامر» carries the value
 * of the orders INCLUDING VAT (G-18) where Finance is in the package and the viewer may see money; otherwise it says «مفتوحة».
 */
export function todayFlow(w: ProcWorld, actor: TodayActor, now: Date): FlowTile[] {
  const financeOn = w.financeOn !== false
  const ctx: PoStateCtx = { notices: w.receipts as StepNotice[], financeOn, acceptanceDays: w.policies.supplierAcceptanceDays, now }
  const month = todayOf(now).slice(0, 7)
  const open = w.orders.filter((po) => {
    const k = poState(po, ctx).k
    return k !== "done" && k !== "cancel"
  })
  const done = w.orders.filter((po) => poState(po, ctx).k === "done" && (completedDay(po, w.receipts) || "").slice(0, 7) === month)
  const transit = w.receipts.filter((r) => r.status === "pending_confirmation" && !(r as { closedByReceipt?: unknown }).closedByReceipt)
  const inRfqs = w.rfqs.filter((r) => r.status === "New")
  const valued = financeOn && actor.seesPrices
  return [
    { id: "inc", count: newRequestCards(w, scopedRows(w, actor)).length, subKey: "flow.inc.sub", amount: null, href: `${NEEDS_HREF}?seg=new` },
    { id: "rfq", count: inRfqs.length, subKey: "flow.rfq.sub", amount: null, href: RFQS_HREF },
    { id: "po", count: open.length, subKey: valued ? "flow.po.sub_value" : "flow.po.sub_open", amount: valued ? round2(open.reduce((s, po) => s + poValue(po) * (1 + vatOf(po)), 0)) : null, href: "/contractor/rfqs/orders?filter=all" },
    { id: "rcv", count: transit.length, subKey: "flow.rcv.sub", amount: null, href: "/contractor/goods-received" },
    { id: "done", count: done.length, subKey: "flow.done.sub", amount: null, href: "/contractor/rfqs/orders?filter=done" },
  ]
}

// ---------------------------------------------------------------------------
// The supplier invitations strip (WF-23)
// ---------------------------------------------------------------------------

export interface InvitationRow {
  id: string
  name: string
  state: InvitationState
  /** `YYYY-MM-DD` the invitation was (last) sent. */
  sentDay: string
  channel: "wa" | "email" | "sms" | null
  /** Once joined: the supplier is already verified in our record. */
  verified: boolean
}

const isoOf = (v: unknown): string => {
  if (!v) return ""
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ""
}

/** The invitations newest first, each with its state (أُرسلت · فُتحت · انضم · انتهت); one the company cancelled is not shown. */
export function todayInvitations(invitations: readonly InvitationFact[], records: ProcWorld["supplierRecords"], now: Date): InvitationRow[] {
  const verified = new Map((records || []).map((r) => [r.supplierOrgId, r.verified !== false]))
  return invitations
    .map((inv) => ({ inv, sent: inv.renewedAt || isoOf(inv.createdAt) }))
    .filter(({ inv }) => inv.status !== "cancelled")
    .sort((a, b) => b.sent.localeCompare(a.sent))
    .map(({ inv, sent }) => ({
      id: inv.id,
      name: inv.companyName || "",
      state: invitationState(inv, now),
      sentDay: dayOf(sent),
      channel: inv.sentChannel ?? null,
      verified: inv.acceptedSupplierOrgId ? verified.get(inv.acceptedSupplierOrgId) === true : false,
    }))
}

// ---------------------------------------------------------------------------
// Money for the finance tiles that no longer exist stays available to the reports
// ---------------------------------------------------------------------------

/** What Finance will be asked for next: requested advances + received-unpaid (prototype `due7`). */
export function financeDue(orders: PurchaseOrder[]): { advances: number; received: number; total: number } {
  const advances = round2(orders.filter((po) => advanceState(asX(po)) === "requested").reduce((s, po) => s + advanceAmount(asX(po)), 0))
  const received = round2(
    orders
      .filter((po) => poStatus(po) === "received")
      .reduce((s, po) => s + (po.lines.some((l) => num(l.accepted) > 0 && l.unitPrice == null) ? num(po.totalExVat) : round2(po.lines.reduce((t, l) => t + num(l.accepted) * num(l.unitPrice), 0))), 0)
  )
  return { advances, received, total: round2(advances + received) }
}

// ---------------------------------------------------------------------------
// Every key the queue can emit — the i18n test reads this list
// ---------------------------------------------------------------------------

export const TODAY_KEYS = [
  "task.team_approval.title",
  "task.team_approval.sub",
  "actions.decideRequest",
  "page.title",
  "page.subtitle",
  "title",
  "empty.title",
  "empty.body",
  "showMore",
  "showLess",
  "groups.all",
  "groups.req",
  "groups.rfq",
  "groups.po",
  "groups.rcv",
  "waits.title",
  "waits.empty",
  "modules.supplier",
  "modules.finance",
  "modules.inventory",
  "modules.manufacturing",
  "modules.projects",
  "modules.receiver",
  "modules.approver",
  "flow.label",
  "flow.inc.label",
  "flow.inc.sub",
  "flow.rfq.label",
  "flow.rfq.sub",
  "flow.po.label",
  "flow.po.sub_value",
  "flow.po.sub_open",
  "flow.rcv.label",
  "flow.rcv.sub",
  "flow.done.label",
  "flow.done.sub",
  "invitations.title",
  "invitations.link",
  "invitations.empty",
  "invitations.state.sent",
  "invitations.state.opened",
  "invitations.state.joined",
  "invitations.state.joined_verified",
  "invitations.state.expired",
  "invitations.state.declined",
  "invitations.channel.wa",
  "invitations.channel.email",
  "invitations.channel.sms",
  "basis.incl",
  "basis.excl",
  "basis.none",
  "escalated",
  "escalate_failed",
  "actions.review",
  "actions.view",
  "actions.send",
  "actions.open",
  "actions.openRfq",
  "actions.openDraft",
  "actions.openReceipt",
  "actions.openAgreement",
  "actions.openSupplier",
  "actions.openNeeds",
  "actions.openIncoming",
  "actions.openProject",
  "actions.openNotice",
  "actions.count",
  "actions.seeArrived",
  "actions.closeOrder",
  "actions.rate",
  "actions.decide",
  "actions.answer",
  "actions.forward",
  "actions.publishRequest",
  "actions.prepare",
  "actions.compare",
  "actions.compareAward",
  "actions.approvePo",
  "actions.resubmit",
  "actions.remindSupplier",
  "actions.reaward",
  "actions.approveAdvance",
  "actions.askReplace",
  "actions.logNotice",
  "actions.escalate",
  "actions.reply",
  "task.po.title",
  "task.change_ask.sub",
  "task.send.title",
  "task.send.title_nofin",
  "task.send.sub",
  "task.late.sub_part",
  "task.confirm_before_date.title",
  "task.confirm_before_date.sub",
  "task.count_escalated.sub",
  "task.reject_decide.sub",
  "task.cancel_remainder.title",
  "task.cancel_remainder.sub",
  "task.rate.title",
  "task.rate.sub",
  "task.close_received.title",
  "task.close_received.sub",
  "task.advance_unpaid.title",
  "task.advance_unpaid.sub",
  "task.finance_hold.pend.title",
  "task.finance_hold.pend.sub",
  "task.finance_hold.price.title",
  "task.finance_hold.price.sub",
  "task.finance_hold.proc.title",
  "task.finance_hold.proc.sub",
  "task.finance_hold.rcv.title",
  "task.finance_hold.rcv.sub",
  "task.finance_hold.owner.title",
  "task.finance_hold.owner.sub",
  "task.finance_hold.sup.title",
  "task.finance_hold.sup.sub",
  "task.notice_forward.sub",
  "task.notice_late_date.title",
  "task.notice_late_date.sub",
  "task.delivery_reported.title",
  "task.delivery_reported.sub",
  "task.arrived_today.title",
  "task.arrived_today.sub_flags",
  "task.receipt_no_po.title",
  "task.receipt_no_po.title_line",
  "task.receipt_no_po.sub",
  "task.pm_supplier_return.title_nc",
  "task.pm_supplier_return.title_charged",
  "task.pm_supplier_return.sub",
  "task.pm_cash_inbound.title",
  "task.pm_cash_inbound.sub",
  "task.pm_hire.title",
  "task.pm_hire.sub",
  "task.supplier_verify.title",
  "task.supplier_verify.sub",
  "task.agreement_expiring.title",
  "task.agreement_expiring.sub",
  "task.need_request.title",
  "task.need_request.sub",
  "task.need_far.title",
  "task.need_far.sub",
  "task.need_rollup.title",
  "task.need_rollup.sub",
  "task.rfq_draft.title",
  "task.rfq_draft.sub",
  "task.rfq_award.title",
  "task.rfq_award.sub",
  "task.rfq_no_live.title",
  "task.rfq_no_live.sub",
  "task.rfq_can_award.title",
  "task.rfq_can_award.sub",
  "task.rfq_query.title",
  "task.rfq_query.sub",
  "task.approval_wait.title",
  "task.approval_wait.sub.own_order",
  "task.approval_wait.sub.above_limit",
  "task.approval_wait.sub.retroactive",
  "task.approval_wait.sub.other",
  "wait.request_line.title",
  "wait.stock_reply.sub",
  "wait.workshop_ask.sub",
  "wait.being_made.title",
  "wait.being_made.sub_ready",
  "wait.sample_approval.title",
  "wait.sample_approval.sub",
  "wait.receiver_count.sub",
  "wait.held_inspection.title",
  "wait.held_inspection.sub",
  "wait.invoice_hold.title",
  "wait.invoice_hold.sub",
  "wait.pm_budget.title",
  "wait.pm_budget.sub",
  "kpi.needs.label",
  "kpi.needs.note_overdue",
  "kpi.needs.note_none",
  "kpi.committed.label",
  "kpi.committed.note_late",
  "kpi.committed.note_none",
  "kpi.drift.label",
  "kpi.drift.note_up",
  "kpi.drift.note_none",
  "kpi.unit_lines",
  "kpi.unit_orders",
  "kpi.unit_items",
  "kpi.basis_incl",
] as const

// "Today" in Procurement (PRD 3.0 §7.2 tab 1) — what needs my decision now,
// what we are waiting on from others, and three numbers. Everything is derived
// from the orders, receipts, RFQs and offers on every read; the screen owns no
// numbers of its own. No Firestore, no React, no sentences: every row carries
// i18n keys under `Portal.ProcToday` (or `Portal.Procurement` for a block)
// and the parameters those sentences need. The screen formats.
//
// The rule the queue embodies: approvals only I can clear float to the top
// whatever their colour (priority 0), then decisions on a live order or
// receipt (1), then sourcing and chasing (2), then the informational (3).
// Within a tier, red before amber before blue, then the oldest first.
//
// Roles: an expediter (may chase, may not see money) gets send / not accepted
// / late / on the way — dates and quantities, never an amount. The owner gets
// the approvals routed to him and a read-only view of the rest.

import {
  acceptedValue,
  addDays,
  approvalRefusal,
  canRate,
  daysFromNow,
  daysLate,
  dayOf,
  lineOutstanding,
  lowestOffer,
  offerPrice,
  poBlocks,
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
  type RefusalCode,
} from "./po"
import { agreementDaysLeft, agreementState, lastPaid, type PriceAgreement, type PriceHistoryEntry } from "./prices"
import { buyerRollups, inBuyerScope, isActionState, needKpi, rollupOf, type BuyerRollup, type BuyerScope, type NeedRow } from "./need-desk"
import { forwardUrgency } from "./receivers"
import { priceDrift } from "./reports"
import { advanceAmount, advanceNumber, advanceState, asX, HOLD_OWNER, openHolds, pmCancelOpen, type HoldOwner } from "./po-extras"
import { noticeTold } from "./policy-enforce"
import { poInScope, rfqInScope } from "./rfq-view"
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
  /** What was asked, for the RFQ's estimate at the last prices paid. */
  products?: Array<{ name?: string; quantity?: number | string | null; unit?: string | null; category?: string | null }> | null
  organizationId?: string
  projectId?: string | null
  category?: string | null
  /** ISO — when it was published / awarded, when known (cycle-time report). */
  createdAt?: string | null
  awardedAt?: string | null
  /** Suppliers invited, when the RFQ was private (competition report). */
  invitedCount?: number | null
  /** Who raised it — a buyer's own RFQs are his (the prototype's `rfqMine`). */
  createdByUserId?: string | null
  contractorId?: string | null
}

/** What the queue needs to know about an offer. Status literals are the
 * app's Arabic ones: قيد المراجعة · مطلوب تخفيض · مقبول · مرفوض · تم التسليم. */
export interface OfferFact extends OfferLike {
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

export interface ProcWorld {
  orders: PurchaseOrder[]
  /** Deliveries — the supplier's notices and the goods receipts. */
  receipts: ReceiptFact[]
  rfqs: RfqFact[]
  offers: OfferFact[]
  /** Every need line on Procurement's desk, when the screen loads them. */
  needDesk?: NeedDeskFacts
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
}

export const OFFER_PENDING = new Set(["قيد المراجعة", "مطلوب تخفيض"])
export const OFFER_ACCEPTED = "مقبول"

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskGroup = "need" | "rfq" | "po" | "delivery"
export const TASK_GROUPS: TaskGroup[] = ["need", "rfq", "po", "delivery"]
export type TaskSeverity = "red" | "amber" | "blue"

export type TaskKind =
  | "approve" // T5a
  | "approval_wait" // T5b
  | "send" // T5c
  | "not_accepted" // T5d
  | "late" // T5e
  | "confirm_before_date" // T5h
  | "reject_decide" // T5i
  | "arrived_today" // T6
  | "notice_incoming" // T8/T9 — a pending notice, its date not yet passed
  | "notice_overdue" // T9a — its date passed with no receipt
  | "notice_late_date" // T9b — dated after the supplier's own promise
  | "rate" // T10
  | "receipt_no_po" // T11
  | "rfq_draft" // T3
  | "rfq_award" // T4a
  | "rfq_no_offers" // T4b
  | "rfq_closing_thin" // T4c
  | "agreement_expiring" // §4 `AGR` — renew it, or its materials go back to the market
  | "supplier_verify" // a supplier added from the directory: no order is approved before the manager vouches for him
  | "need_line" // a buyer's line to source, by its last order day
  | "need_rollup" // a manager's roll-up of one buyer's lines
  | "rfq_query" // a supplier's question nobody answered
  | "cancel_remainder" // Projects stopped a material still owed on an order
  | "notice_forward" // a supplier's notice nobody has passed to the receiver
  | "finance_hold" // Finance held a supplier's invoice — the next move is ours, the receiver's or the supplier's

export type TaskAction = "review" | "view" | "send" | "open" | "updateDate" | "decide" | "receive" | "rate" | "compare" | "openDraft" | "openRfq" | "seeArrived" | "openReceipt"

export interface Task {
  id: string
  kind: TaskKind
  group: TaskGroup
  /** 0 = only I can unblock this · 1 = a decision on a live order/receipt · 2 = sourcing and chasing · 3 = informational. */
  priority: 0 | 1 | 2 | 3
  severity: TaskSeverity
  /** Tie-breaker inside a tier: more negative = older / more overdue. */
  sortDays: number
  titleKey: string
  titleParams: Record<string, string | number>
  subKey: string
  subParams: Record<string, string | number>
  /** `Portal.Procurement` when the subtitle is a block sentence; `Portal.ProcToday` otherwise. */
  subNs: "ProcToday" | "Procurement"
  /** Null when the viewer may not see money, or when the order has none to show. */
  amount: number | null
  href: string
  actionKey: string
  /** A coded reason the screen may render from `Portal.Procurement` (reject / hold). */
  reasonCode?: string | null
}

export const ORDER_HREF = (id: string) => `/contractor/rfqs/orders?po=${id}`
/** The Suppliers tab, on its agreements segment. */
export const AGREEMENTS_HREF = "/contractor/suppliers?segment=agreements"
export const RECEIPT_HREF = (id: string) => `/contractor/goods-received?tab=incoming&delivery=${id}`
export const RFQ_HREF = (id: string) => `/contractor/rfqs/${id}/offers`
export const DRAFTS_HREF = "/contractor/rfqs"
/** A draft opens in the form it was left in. */
export const DRAFT_HREF = (id: string) => `/contractor/rfqs/new?edit=${encodeURIComponent(id)}`
/** The Suppliers tab, on one agreement's drawer. */
export const AGREEMENT_HREF = (id: string) => `/contractor/suppliers?segment=agreements&agreement=${encodeURIComponent(id)}`
/** The reports tab's commitments report — what Finance will be asked to pay. */
export const COMMITMENTS_HREF = "/contractor/rfqs/reports?report=commitments"
export const NEEDS_HREF = "/contractor/rfqs/requests"
export const NEED_LINE_HREF = (key: string) => `/contractor/rfqs/requests?line=${encodeURIComponent(key)}`
/** The goods-received desk opens the forward dialog for this notice. */
export const FORWARD_HREF = (id: string) => `/contractor/goods-received?tab=incoming&delivery=${id}&forward=1`

const GROUP_OF: Record<TaskKind, TaskGroup> = {
  approve: "po",
  approval_wait: "po",
  send: "po",
  not_accepted: "delivery",
  late: "delivery",
  confirm_before_date: "delivery",
  reject_decide: "delivery",
  arrived_today: "delivery",
  notice_incoming: "delivery",
  notice_overdue: "delivery",
  notice_late_date: "delivery",
  rate: "delivery",
  receipt_no_po: "delivery",
  rfq_draft: "rfq",
  rfq_award: "rfq",
  rfq_no_offers: "rfq",
  rfq_closing_thin: "rfq",
  agreement_expiring: "need",
  supplier_verify: "po",
  need_line: "need",
  need_rollup: "need",
  rfq_query: "rfq",
  cancel_remainder: "po",
  notice_forward: "delivery",
  finance_hold: "po",
}

const SEVERITY_RANK: Record<TaskSeverity, number> = { red: 0, amber: 1, blue: 2 }

/** Below this on-time score we confirm with the supplier before his date, not after. */
export const CONFIRM_BEFORE_DATE_BELOW = 85
/** A receipt with no order stays on the desk this long, then it is a report row. */
const NO_PO_WINDOW_DAYS = 30

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

const money = (actor: ProcActor, value: number | null) => (actor.seesPrices ? value : null)
const linesText = (po: PurchaseOrder) =>
  po.lines
    .filter((l) => lineOutstanding(l) > 0)
    .map((l) => `${l.name} ${lineOutstanding(l)} ${l.unit}`)
    .join(" · ")

const REFUSAL_SUB: Record<RefusalCode, string> = {
  not_awaiting: "task.approval_wait.sub.other",
  no_permission: "task.approval_wait.sub.other",
  own_order: "task.approval_wait.sub.own_order",
  owner_only_retroactive: "task.approval_wait.sub.retroactive",
  above_limit: "task.approval_wait.sub.above_limit",
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
  const add = (t: Omit<Task, "group" | "subNs"> & { subNs?: Task["subNs"] }) => out.push({ subNs: "ProcToday", ...t, group: GROUP_OF[t.kind] })
  // The prototype's four roles: the owner reads (when he has a team), a buyer
  // works his own orders and categories, the manager sees everyone's.
  const ownerRO = actor.isOwner && w.ownerHasTeam === true
  const buyerOnly = sourcesOnly(actor)
  const cats = w.needDesk?.viewerCategories ?? null
  const scope = { uid: actor.uid, isOwner: actor.isOwner, canApprove: actor.canApprove, canPrepare: buyerOnly }
  const mine = (po: PurchaseOrder | undefined) => !buyerOnly || !po || poInScope(po, scope, cats)
  const chases = actor.canExpedite && !ownerRO
  const look = (key: string) => (ownerRO ? "actions.view" : key)

  const ordersBySupplier = new Map<string, PurchaseOrder[]>()
  for (const po of w.orders) {
    const k = supplierKey(po)
    ordersBySupplier.set(k, [...(ordersBySupplier.get(k) || []), po])
  }
  const scoreOf = (po: PurchaseOrder) => supplierScore(ordersBySupplier.get(supplierKey(po)) || [], w.receipts, now)

  for (const po of w.orders) {
    const st = poStatus(po)
    const base = { number: po.docNumber, supplier: po.supplierName }
    const value = poValue(po)
    const created = daysFromNow(dayOf(po.createdAt), now) ?? 0

    if (st === "awaiting_approval") {
      const refusal = approvalRefusal(po, actor, w.policies)
      if (!refusal) {
        // T5a · mine to approve. A blocked one is demoted to blue: not actionable yet.
        const blocks = poBlocks(po, { supplier: w.supplierFacts[po.supplierOrgId] || null, otherOrders: w.orders, policies: w.policies, now })
        const first = blocks[0]
        add({
          id: `approve:${po.id}`,
          kind: "approve",
          priority: 0,
          severity: first ? "blue" : "amber",
          sortDays: created,
          titleKey: "task.approve.title",
          titleParams: base,
          subKey: first ? `blocks.${first.code as BlockCode}` : "task.approve.sub",
          subParams: first ? first.params : { preparer: po.preparedByName, ago: -created },
          subNs: first ? "Procurement" : "ProcToday",
          amount: money(actor, value),
          href: ORDER_HREF(po.id),
          actionKey: "actions.review",
        })
      } else if (!expediter && (po.preparedById === actor.uid || actor.canApprove || actor.isOwner)) {
        // T5b · somebody else's to approve — the preparer and the managers see it wait.
        add({
          id: `approval_wait:${po.id}`,
          kind: "approval_wait",
          priority: 3,
          severity: "blue",
          sortDays: created,
          titleKey: "task.approval_wait.title",
          titleParams: { ...base, approver: po.approverKind },
          subKey: po.preparedById === actor.uid ? REFUSAL_SUB.own_order : REFUSAL_SUB[refusal.code],
          subParams: { ...base, ...refusal.params },
          amount: money(actor, value),
          href: ORDER_HREF(po.id),
          actionKey: "actions.view",
        })
      }
      continue
    }

    if (st === "approved" && chases && mine(po)) {
      // T5c · approved, with Finance as a commitment, and the supplier has not heard.
      const approved = daysFromNow(dayOf(po.approvedAt), now) ?? created
      add({ id: `send:${po.id}`, kind: "send", priority: 1, severity: "amber", sortDays: approved, titleKey: "task.send.title", titleParams: base, subKey: "task.send.sub", subParams: {}, amount: money(actor, value), href: ORDER_HREF(po.id), actionKey: "actions.send" })
      continue
    }

    if (st === "sent" && chases && mine(po)) {
      // T5d · the acceptance window ran out — without an acceptance there is no date.
      const sent = daysFromNow(dayOf(po.sentAt), now)
      if (sent != null && -sent >= w.policies.supplierAcceptanceDays) {
        add({ id: `not_accepted:${po.id}`, kind: "not_accepted", priority: 2, severity: "amber", sortDays: sent, titleKey: "task.not_accepted.title", titleParams: { ...base, days: -sent }, subKey: "task.not_accepted.sub", subParams: {}, amount: money(actor, value), href: ORDER_HREF(po.id), actionKey: "actions.open" })
      }
      continue
    }

    if (st === "in_delivery" || st === "part_received") {
      const promise = daysFromNow(po.promisedDate, now)
      if (poLate(po, now) && chases && mine(po)) {
        // T5e · late — the subtitle lists what is still owed.
        add({ id: `late:${po.id}`, kind: "late", priority: 2, severity: "red", sortDays: promise ?? 0, titleKey: "task.late.title", titleParams: { ...base, days: daysLate(po, now) }, subKey: "task.late.sub", subParams: { lines: linesText(po) }, amount: money(actor, poOpenValue(po)), href: ORDER_HREF(po.id), actionKey: "actions.updateDate" })
      } else if (promise != null && promise >= 0 && promise <= 2 && chases && sees && mine(po)) {
        // T5h · a poor on-time record: confirm before his date, do not wait for the delay.
        const score = scoreOf(po)
        if (score.onTimePercent != null && score.onTimePercent < CONFIRM_BEFORE_DATE_BELOW) {
          add({ id: `confirm:${po.id}`, kind: "confirm_before_date", priority: 2, severity: "blue", sortDays: promise, titleKey: "task.confirm_before_date.title", titleParams: { ...base, inDays: promise }, subKey: "task.confirm_before_date.sub", subParams: { percent: score.onTimePercent }, amount: null, href: ORDER_HREF(po.id), actionKey: "actions.open" })
        }
      }
    }

    if (decides && po.status === "accepted" && mine(po)) {
      // T5i · rejected at the gate, no decision yet: replace, discount or reduce.
      for (const l of po.lines) {
        if (!(Number(l.rejected) > 0) || l.rejectDecision) continue
        const reject = w.receipts.find((r) => r.poId === po.id && r.status === "confirmed" && (r.lines || []).some((d) => d.poLineId === l.id && Number(d.rejected) > 0))?.lines?.find((d) => d.poLineId === l.id && Number(d.rejected) > 0)
        add({
          id: `reject:${po.id}:${l.id}`,
          kind: "reject_decide",
          priority: 1,
          severity: "amber",
          sortDays: -1,
          titleKey: "task.reject_decide.title",
          titleParams: { qty: l.rejected, unit: l.unit, name: l.name },
          subKey: "task.reject_decide.sub",
          subParams: base,
          amount: money(actor, l.unitPrice == null ? null : round2(l.rejected * l.unitPrice)),
          href: ORDER_HREF(po.id),
          actionKey: look("actions.decide"),
          reasonCode: reject?.rejectReason || null,
        })
      }
    }

    if (decides && mine(po) && st !== "closed" && st !== "cancelled") {
      // Projects closed the material while the rest is still owed (`pmCancels`): tell the supplier.
      for (const l of po.lines) {
        const open = lineOutstanding(l)
        if (!pmCancelOpen(asX(po), l) || !(open > 0)) continue
        add({ id: `cancel_remainder:${po.id}:${l.id}`, kind: "cancel_remainder", priority: 1, severity: "amber", sortDays: -1, titleKey: "task.cancel_remainder.title", titleParams: { qty: open, unit: l.unit, name: l.name }, subKey: "task.cancel_remainder.sub", subParams: base, amount: money(actor, l.unitPrice == null ? null : round2(open * l.unitPrice)), href: ORDER_HREF(po.id), actionKey: look("actions.open") })
      }
    }

    if ((st === "received" || st === "closed") && decides && sees && !ownerRO && mine(po) && canRate(po, w.receipts)) {
      // T10 · the story is whole: rate him.
      add({ id: `rate:${po.id}`, kind: "rate", priority: 3, severity: "blue", sortDays: 0, titleKey: "task.rate.title", titleParams: base, subKey: "task.rate.sub", subParams: {}, amount: null, href: ORDER_HREF(po.id), actionKey: "actions.rate" })
    }

    if (sees && mine(po)) {
      // Finance held a supplier's invoice (prototype FREJ): whose move it is decides the row.
      for (const h of openHolds(asX(po))) {
        const owner = holdOwnerOf(h.reason)
        const at = daysFromNow(dayOf(h.at), now) ?? 0
        const common = { sortDays: at, amount: money(actor, h.amount), href: ORDER_HREF(po.id), reasonCode: h.reason }
        const params = { supplier: po.supplierName, invoice: h.invoiceNo, holdReason: h.reason, need: h.need || h.text || "", number: po.docNumber }
        if (owner === "proc" && sources && !ownerRO) {
          add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", priority: 0, severity: "red", titleKey: "task.finance_hold.proc.title", titleParams: params, subKey: "task.finance_hold.proc.sub", subParams: params, actionKey: "actions.decide", ...common })
        } else if (owner === "rcv" && chases) {
          add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", priority: 1, severity: "amber", titleKey: "task.finance_hold.rcv.title", titleParams: params, subKey: "task.finance_hold.rcv.sub", subParams: { ...params, where: po.projectId ? "projects" : "inventory" }, actionKey: "actions.open", ...common })
        } else if (ownerRO) {
          add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", priority: 1, severity: "amber", titleKey: "task.finance_hold.owner.title", titleParams: params, subKey: "task.finance_hold.owner.sub", subParams: { ...params, holdOwner: owner }, actionKey: "actions.view", ...common })
        } else if (owner === "sup" && sources) {
          add({ id: `hold:${po.id}:${h.id}`, kind: "finance_hold", priority: 1, severity: "amber", titleKey: "task.finance_hold.sup.title", titleParams: params, subKey: "task.finance_hold.sup.sub", subParams: params, actionKey: "actions.decide", ...common })
        }
      }
    }
  }

  const orderById = new Map(w.orders.map((o) => [o.id, o]))

  // T8/T9 · a pending notice nobody passed on, or one whose date passed with
  // no receipt, or dated after his promise. A forwarded notice that is simply
  // on its way is not a decision: it waits on the receipts tab and in
  // «يصل خلال 7 أيام» (the prototype has no row for it).
  for (const r of w.receipts) {
    if (r.status !== "pending_confirmation" || (r as { closedByReceipt?: unknown }).closedByReceipt) continue
    const po = r.poId ? orderById.get(r.poId) : undefined
    if (!mine(po)) continue
    const d = daysFromNow(r.deliveryDate, now)
    const promised = po ? daysFromNow(po.promisedDate, now) : null
    const supplier = r.supplierName || po?.supplierName || ""
    const number = r.poNumber || po?.docNumber || ""
    const lines = (r.lines || []).map((l) => `${l.name} ${l.noticeQuantity} ${l.unit}`).join(" · ")
    const action = actor.canReceive && !ownerRO ? "actions.receive" : "actions.open"
    // §5.2-3b: a notice nobody has forwarded is a delivery whose receiver does
    // not know it is coming. The PRD auto-forwards once the window lapses;
    // nothing here runs on a schedule, so instead the notice says so and turns
    // amber inside the window. Receiving it centrally is a perfectly good answer
    // — which is why this colours a row and never blocks one.
    const told = noticeTold(r, w.policies)
    const chase = !told && forwardUrgency(d, w.policies.forwardWindowDays) !== "none"
    const notForwarded = told ? 0 : 1
    if (!told && chases) {
      // The prototype's forward task: the receiver must know before the truck leaves.
      const due = d != null && (d <= 0 || chase)
      const place = po?.projectName || ""
      add({ id: `notice_forward:${r.id}`, kind: "notice_forward", priority: due ? 0 : 2, severity: d != null && d <= 0 ? "red" : due ? "amber" : "blue", sortDays: d ?? 9, titleKey: "task.notice_forward.title", titleParams: { supplier, inDays: d ?? 0, hasDate: d == null ? 0 : 1, overdue: d != null && d < 0 ? 1 : 0 }, subKey: "task.notice_forward.sub_place", subParams: { number, lines, place, hasPlace: place ? 1 : 0 }, amount: null, href: FORWARD_HREF(r.id), actionKey: "actions.forward" })
    } else if (!sees) {
      continue
    } else if (d != null && d < 0) {
      add({ id: `notice_overdue:${r.id}`, kind: "notice_overdue", priority: 1, severity: "red", sortDays: d, titleKey: "task.notice_overdue.title", titleParams: { supplier }, subKey: "task.notice_overdue.sub", subParams: { number, date: dayOf(r.deliveryDate), daysAgo: -d, notForwarded }, amount: null, href: RECEIPT_HREF(r.id), actionKey: action })
    } else if (promised != null && d != null && d > promised) {
      // T9b · the supplier announces a date after his own promise — the delay is known before it happens.
      const behind = d - promised
      add({ id: `notice_late_date:${r.id}`, kind: "notice_late_date", priority: 1, severity: "amber", sortDays: d, titleKey: "task.notice_late_date.title", titleParams: { supplier, days: behind }, subKey: "task.notice_late_date.sub", subParams: { number, date: dayOf(r.deliveryDate), promised: po?.promisedDate || "" }, amount: null, href: RECEIPT_HREF(r.id), actionKey: action })
    }
  }

  if (!expediter && chases) {
    // T6 · what arrived today on our orders — one roll-up row, each receipt
    // flagged when it carries rejects or came short of the notice.
    const arrived = w.receipts.filter((r) => r.status === "confirmed" && r.poId && receiptDay(r) === today && mine(orderById.get(r.poId)))
    if (arrived.length) {
      const items = arrived.map((r) => ({ name: `${r.supplierName || orderById.get(r.poId as string)?.supplierName || ""} ${r.docNumber || ""}`.trim(), ...arrivedFlags(r) }))
      const list = items.map((i) => i.name).join(" · ")
      add({ id: `arrived:${today}`, kind: "arrived_today", priority: 2, severity: "blue", sortDays: 0, titleKey: "task.arrived_today.title", titleParams: { count: arrived.length }, subKey: "task.arrived_today.sub_flags", subParams: { list, rejects: items.filter((i) => i.rejects).length, short: items.filter((i) => i.short).length }, amount: null, href: "/contractor/goods-received?tab=log", actionKey: "actions.seeArrived" })
    }
  }

  if (!expediter) {
    // T11 · a receipt with no order — informational; the regularisation is a retroactive order.
    for (const r of w.receipts) {
      if (r.source !== "manual" || r.poId || r.offerId || r.status !== "confirmed") continue
      const day = receiptDay(r)
      const age = day ? -(daysFromNow(day, now) ?? 0) : 0
      if (!day || age > NO_PO_WINDOW_DAYS) continue
      if (buyerOnly && cats?.length && !receiptInCategories(r, cats)) continue
      add({ id: `nopo:${r.id}`, kind: "receipt_no_po", priority: 1, severity: "amber", sortDays: -age, titleKey: "task.receipt_no_po.title", titleParams: { supplier: r.supplierName || "", hasSupplier: r.supplierName ? 1 : 0 }, subKey: "task.receipt_no_po.sub", subParams: { number: r.docNumber || "", date: day }, amount: null, href: RECEIPT_HREF(r.id), actionKey: look("actions.openReceipt") })
    }
  }

  if (sources && !ownerRO) {
    const offersByRfq = new Map<string, OfferFact[]>()
    for (const o of w.offers) offersByRfq.set(o.rfqId, [...(offersByRfq.get(o.rfqId) || []), o])

    for (const r of w.rfqs) {
      if (buyerOnly && !rfqInScope(r, scope, cats)) continue
      const title = r.title || ""
      const deadline = daysFromNow(r.deadline, now)
      if (r.status === "Draft") {
        // T3 · never published: its lines are held for nothing.
        add({ id: `rfq_draft:${r.id}`, kind: "rfq_draft", priority: 2, severity: "blue", sortDays: deadline ?? 9, titleKey: "task.rfq_draft.title", titleParams: { title }, subKey: "task.rfq_draft.sub", subParams: {}, amount: null, href: DRAFT_HREF(r.id), actionKey: "actions.openDraft" })
        continue
      }
      if (r.status !== "New") continue
      const offers = offersByRfq.get(r.id) || []
      const pending = offers.filter((o) => OFFER_PENDING.has(o.status || ""))
      const count = offers.length || Number(r.offersCount) || 0
      if (deadline != null && deadline <= 0 && pending.length) {
        // T4a · the window closed and offers wait: compare and award. Red once the award cycle is overrun.
        const best = lowestOffer(pending)
        // The nearest offer validity: a price about to lapse is red whatever the cycle says.
        const valid = pending.map((o) => daysFromNow(o.validUntil, now)).filter((x): x is number => x != null)
        const nearest = valid.length ? Math.min(...valid) : null
        const lapsing = nearest != null && nearest <= 2
        const estimate = rfqEstimate(r, w.history)
        add({ id: `rfq_award:${r.id}`, kind: "rfq_award", priority: 2, severity: lapsing || -deadline > w.policies.awardCycleDays ? "red" : "amber", sortDays: lapsing ? (nearest as number) - 5 : deadline, titleKey: "task.rfq_award.title", titleParams: { title, count: pending.length }, subKey: lapsing ? "task.rfq_award.sub_validity" : "task.rfq_award.sub", subParams: lapsing ? { inDays: Math.max(0, nearest as number) } : { ago: -deadline }, amount: money(actor, estimate ?? (best ? offerPrice(best) : null)), href: RFQ_HREF(r.id), actionKey: "actions.compare" })
      } else if (deadline != null && deadline < 0 && count === 0) {
        // T4b · closed with nothing: extend, add suppliers or share the guest link.
        add({ id: `rfq_no_offers:${r.id}`, kind: "rfq_no_offers", priority: 2, severity: "red", sortDays: deadline, titleKey: "task.rfq_no_offers.title", titleParams: { title }, subKey: "task.rfq_no_offers.sub", subParams: {}, amount: null, href: RFQ_HREF(r.id), actionKey: "actions.openRfq" })
      } else if (deadline != null && deadline >= 0 && deadline <= 2 && count < w.policies.minOffers) {
        // T4c · closing soon with thin competition.
        add({ id: `rfq_closing_thin:${r.id}`, kind: "rfq_closing_thin", priority: 2, severity: "blue", sortDays: deadline, titleKey: "task.rfq_closing_thin.title", titleParams: { title, inDays: deadline, count }, subKey: "task.rfq_closing_thin.sub", subParams: {}, amount: null, href: RFQ_HREF(r.id), actionKey: "actions.openRfq" })
      }
      for (const q of w.rfqQueries || []) {
        if (q.rfqId !== r.id || q.answered) continue
        add({ id: `rfq_query:${r.id}:${q.id}`, kind: "rfq_query", priority: 2, severity: "blue", sortDays: deadline ?? 9, titleKey: "task.rfq_query.title", titleParams: { title }, subKey: "task.rfq_query.sub", subParams: { question: q.question }, amount: null, href: `${RFQ_HREF(r.id)}?tab=inquiries`, actionKey: "actions.answer" })
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
      add({
        id: `agreement_expiring:${a.id}`,
        kind: "agreement_expiring",
        priority: 3,
        severity: "blue",
        sortDays: left,
        titleKey: "task.agreement_expiring.title",
        titleParams: { supplier: a.supplierName, inDays: left },
        subKey: "task.agreement_expiring.sub",
        subParams: { number: a.docNumber, materials: (a.lines || []).length },
        amount: null,
        href: AGREEMENT_HREF(a.id),
        actionKey: "actions.openAgreement",
      })
    }
  }

  if ((actor.isOwner || actor.canApprove) && !ownerRO) {
    for (const r of w.supplierRecords || []) {
      if (r.verified !== false) continue
      add({
        id: `supplier_verify:${r.supplierOrgId}`,
        kind: "supplier_verify",
        priority: 1,
        severity: "amber",
        sortDays: 0,
        titleKey: "task.supplier_verify.title",
        titleParams: { supplier: r.supplierName },
        subKey: "task.supplier_verify.sub",
        subParams: { name: r.addedByName || "" },
        amount: null,
        href: `/contractor/suppliers?supplier=${encodeURIComponent(r.supplierOrgId)}`,
        actionKey: "actions.openSupplier",
      })
    }
  }

  if (w.needDesk && sources) {
    const desk = w.needDesk
    const managerView = actor.isOwner || actor.canApprove
    const rows = buyerOnly ? desk.rows.filter((r) => inBuyerScope(r, desk.viewerCategories)) : desk.rows
    const lineTask = (r: NeedRow) => {
      const ld = r.lastOrderIn
      add({
        id: `need:${r.key}`,
        kind: "need_line",
        priority: 2,
        severity: ld == null ? "blue" : ld < 0 ? "red" : ld <= 2 ? "amber" : "blue",
        sortDays: ld ?? 99,
        titleKey: "task.need_line.title",
        titleParams: { head: r.state === "late" || r.state === "mfgl" ? r.state : "none", path: r.path || "rfq", name: r.name, qty: r.open, unit: r.unit },
        subKey: "task.need_line.sub",
        subParams: { ref: r.need.refLabel, place: r.need.projectName || r.need.context || "", ...whenParams(ld) },
        amount: money(actor, r.estimate),
        href: NEED_LINE_HREF(r.key),
        actionKey: "actions.openLine",
      })
    }
    const rollupTask = (u: BuyerRollup) =>
      add({
        id: `need_rollup:${u.buyer?.uid || "-"}`,
        kind: "need_rollup",
        priority: 3,
        severity: u.overdue ? "amber" : "blue",
        sortDays: u.nearest ?? 99,
        titleKey: "task.need_rollup.title",
        titleParams: { buyer: u.buyer?.name || "", assigned: u.buyer ? 1 : 0, count: u.count, overdue: u.overdue },
        subKey: "task.need_rollup.sub",
        subParams: whenParams(u.nearest),
        amount: null,
        href: NEEDS_HREF,
        actionKey: look("actions.openNeeds"),
      })
    if (managerView) {
      const { rollups, uncovered } = buyerRollups(rows, desk.buyers)
      rollups.forEach(rollupTask)
      if (ownerRO) {
        const rest = rollupOf(uncovered)
        if (rest) rollupTask(rest)
      } else uncovered.forEach(lineTask)
    } else rows.filter((r) => isActionState(r.state)).forEach(lineTask)
  }

  return out.sort((a, b) => a.priority - b.priority || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.sortDays - b.sortDays)
}

/** A receipt carries rejects, or came short of what the notice announced. */
export function arrivedFlags(r: ReceiptFact): { rejects: boolean; short: boolean } {
  const lines = r.lines || []
  return {
    rejects: lines.some((l) => Number(l.rejected) > 0),
    short: lines.some((l) => l.counted != null && Number(l.counted) < Number(l.noticeQuantity)),
  }
}

/** A receipt with no order belongs to a buyer when it names one of his
 * categories; one that names none is everyone's (a hidden row is a lost one). */
export function receiptInCategories(r: ReceiptFact & { category?: string | null }, categories: string[]): boolean {
  return !r.category || categories.includes(r.category)
}

/** `when` for the last-order-day sentence: passed / today / ahead / no need date. */
function whenParams(days: number | null): Record<string, string | number> {
  if (days == null) return { when: "none", n: 0 }
  return days < 0 ? { when: "past", n: -days } : days === 0 ? { when: "today", n: 0 } : { when: "future", n: days }
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

// ---------------------------------------------------------------------------
// Waits — "the action is theirs and the state reaches us" (no button)
// ---------------------------------------------------------------------------

export type WaitKind = "supplier_acceptance" | "finance_payment" | "held_inspection" | "stock_check" | "workshop_reply" | "being_made" | "sample_approval" | "invoice_hold" | "pm_budget" | "supplier_advance"
export type WaitModule = "supplier" | "finance" | "inventory" | "manufacturing" | "projects"

export interface Wait {
  id: string
  kind: WaitKind
  module: WaitModule
  titleKey: string
  titleParams: Record<string, string | number>
  subKey: string
  subParams: Record<string, string | number>
  href: string
  reasonCode?: string | null
}

/** Projects has not yet decided an order that runs past the item's budget. */
const PM_BUDGET_WAITS = new Set(["pending", "renegotiate"])

export function todayWaits(w: ProcWorld, actor: TodayActor, now: Date): Wait[] {
  const out: Wait[] = []
  for (const po of w.orders) {
    const st = poStatus(po)
    const base = { number: po.docNumber, supplier: po.supplierName }
    const x = asX(po)
    if (po.status === "awaiting_approval" && x.pmBudget && PM_BUDGET_WAITS.has(x.pmBudget.state)) {
      // The order runs past the BOQ item's balance: the project manager decides (R-25).
      const over = w.budgetOverruns?.[po.id] ?? null
      out.push({ id: `w_budget:${po.id}`, kind: "pm_budget", module: "projects", titleKey: "wait.pm_budget.title", titleParams: base, subKey: "wait.pm_budget.sub", subParams: { over: actor.seesPrices && over != null ? over : 0, hasOver: actor.seesPrices && over != null && over > 0 ? 1 : 0 }, href: ORDER_HREF(po.id) })
    }
    if (advanceState(x) === "requested") {
      // Approval asked Finance for the advance; the supplier's lead time starts when it is paid.
      out.push({ id: `w_adv:${po.id}`, kind: "supplier_advance", module: "finance", titleKey: "wait.supplier_advance.title", titleParams: { ...base, percent: Number(x.advancePercent) || 0 }, subKey: "wait.supplier_advance.sub", subParams: { advance: advanceNumber(po) }, href: ORDER_HREF(po.id) })
    }
    for (const h of openHolds(x)) {
      const owner = holdOwnerOf(h.reason)
      if (owner !== "fin" && owner !== "rcv") continue
      // Finance's own hold (a duplicate, the cash position) or the receiver's missing receipt.
      out.push({ id: `w_hold:${po.id}:${h.id}`, kind: "invoice_hold", module: owner === "fin" ? "finance" : po.projectId ? "projects" : "inventory", titleKey: "wait.invoice_hold.title", titleParams: { ...base, invoice: h.invoiceNo, holdReason: h.reason }, subKey: "wait.invoice_hold.sub", subParams: { need: h.need || h.text || "", number: po.docNumber }, href: ORDER_HREF(po.id), reasonCode: h.reason })
    }
    if (st === "sent") {
      // W9 · inside the acceptance window it is the supplier's move.
      const sent = daysFromNow(dayOf(po.sentAt), now)
      if (sent == null || -sent < w.policies.supplierAcceptanceDays) {
        out.push({ id: `w_accept:${po.id}`, kind: "supplier_acceptance", module: "supplier", titleKey: "wait.supplier_acceptance.title", titleParams: base, subKey: "wait.supplier_acceptance.sub", subParams: { ago: sent == null ? 0 : -sent }, href: ORDER_HREF(po.id) })
      }
    }
    if (st === "received" && !openHolds(x).length) {
      // W10 · fully received: invoice, match and payment are Finance's.
      out.push({ id: `w_pay:${po.id}`, kind: "finance_payment", module: "finance", titleKey: "wait.finance_payment.title", titleParams: base, subKey: "wait.finance_payment.sub", subParams: {}, href: ORDER_HREF(po.id) })
    }
    if (po.status === "accepted") {
      // W5 · held for inspection: not issued and not paid before release.
      for (const l of po.lines) {
        if (!(Number(l.held) > 0)) continue
        const holding = w.receipts.find((r) => r.poId === po.id && (r.lines || []).some((d) => d.poLineId === l.id && Number(d.held) > 0))
        const hold = holding?.lines?.find((d) => d.poLineId === l.id && Number(d.held) > 0)
        // Held at a project's site, the project inspects it; at a store, Inventory does.
        out.push({ id: `w_held:${po.id}:${l.id}`, kind: "held_inspection", module: holding?.projectId ? "projects" : "inventory", titleKey: "wait.held_inspection.title", titleParams: { qty: l.held, unit: l.unit, name: l.name, ...base }, subKey: "wait.held_inspection.sub", subParams: {}, href: ORDER_HREF(po.id), reasonCode: hold?.holdReason || null })
      }
    }
  }
  // The need desk's waits reach every Procurement role, the expediter too (the
  // prototype's `inScope` is true for everyone but a buyer outside his categories).
  if (w.needDesk) {
    const desk = w.needDesk
    const buyerOnly = sourcesOnly(actor)
    for (const r of desk.rows) {
      if (buyerOnly && !inBuyerScope(r, desk.viewerCategories)) continue
      const base = { name: r.name, qty: r.state === "mfg" ? r.total : r.open, unit: r.unit }
      const href = NEED_LINE_HREF(r.key)
      if (r.state === "chk") out.push({ id: `w_chk:${r.key}`, kind: "stock_check", module: "inventory", titleKey: "wait.stock_check.title", titleParams: base, subKey: "wait.stock_check.sub", subParams: { ref: r.need.refLabel, cover: Math.min(r.onHand ?? 0, r.total) }, href })
      else if (r.state === "mfgw") out.push({ id: `w_mfgw:${r.key}`, kind: "workshop_reply", module: "manufacturing", titleKey: "wait.workshop_reply.title", titleParams: base, subKey: "wait.workshop_reply.sub", subParams: { ref: r.need.refLabel }, href })
      else if (r.state === "mfg") {
        const ready = w.readyDates?.[r.key] || ""
        out.push({ id: `w_mfg:${r.key}`, kind: "being_made", module: "manufacturing", titleKey: "wait.being_made.title", titleParams: base, subKey: "wait.being_made.sub_ready", subParams: { ref: r.need.refLabel, date: r.needBy || "", hasDate: r.needBy ? 1 : 0, ready, hasReady: ready ? 1 : 0 }, href })
      }
      if (isActionState(r.state) && r.samplePending) out.push({ id: `w_sample:${r.key}`, kind: "sample_approval", module: "projects", titleKey: "wait.sample_approval.title", titleParams: { name: r.name }, subKey: "wait.sample_approval.sub", subParams: {}, href })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The three numbers — different per role, each a door to the list behind it
// ---------------------------------------------------------------------------

export interface KpiTile {
  id: string
  labelKey: string
  value: number
  /** `lines` = a count the screen words «N سطراً». */
  unit: "count" | "money" | "lines"
  noteKey: string
  noteParams: Record<string, string | number>
  tone: "good" | "bad" | "warn" | "neutral"
  href: string
}

export interface ProcKpis {
  kind: ActorKind
  tiles: KpiTile[]
}

export function todayKpis(w: ProcWorld, actor: TodayActor, now: Date): ProcKpis {
  const kind = actorKind(actor, w.ownerHasTeam)
  const live = w.orders.filter((po) => ["approved", "sent", "in_delivery", "part_received"].includes(poStatus(po)))
  const lateOrders = live.filter((po) => poLate(po, now))
  const lateValue = round2(lateOrders.reduce((s, po) => s + poOpenValue(po), 0))
  const tiles: KpiTile[] = []

  if (kind === "expediter") {
    const delivering = w.orders.filter((po) => ["in_delivery", "part_received"].includes(poStatus(po))).length
    const sent = w.orders.filter((po) => poStatus(po) === "sent").length
    tiles.push({ id: "with_suppliers", labelKey: "kpi.with_suppliers.label", value: delivering, unit: "count", noteKey: "kpi.with_suppliers.note", noteParams: {}, tone: "neutral", href: "/contractor/rfqs/orders?filter=live" })
    tiles.push({ id: "late", labelKey: "kpi.late.label", value: lateOrders.length, unit: "count", noteKey: lateOrders.length ? "kpi.late.note_some" : "kpi.late.note_none", noteParams: {}, tone: lateOrders.length ? "bad" : "good", href: "/contractor/rfqs/orders?filter=late" })
    tiles.push({ id: "sent_not_accepted", labelKey: "kpi.sent_not_accepted.label", value: sent, unit: "count", noteKey: "kpi.sent_not_accepted.note", noteParams: {}, tone: sent ? "warn" : "neutral", href: "/contractor/rfqs/orders?filter=live" })
    return { kind, tiles }
  }

  const desk = w.needDesk
  const needRows = desk ? (sourcesOnly(actor) ? desk.rows.filter((r) => inBuyerScope(r, desk.viewerCategories)) : desk.rows) : null
  const nk = needRows ? needKpi(needRows) : null

  if (kind === "owner") {
    const mine = w.orders.filter((po) => po.status === "awaiting_approval" && !approvalRefusal(po, actor, w.policies))
    const mineValue = round2(mine.reduce((s, po) => s + poValue(po), 0))
    // Finance will be asked for this next: the advances approval requested, and
    // what was received in full and not yet closed.
    const due = financeDue(w.orders)
    tiles.push({ id: "my_approval", labelKey: "kpi.my_approval.label", value: mineValue, unit: "money", noteKey: mine.length ? "kpi.my_approval.note_some" : "kpi.my_approval.note_none", noteParams: { count: mine.length }, tone: mine.length ? "warn" : "good", href: "/contractor/rfqs/orders?filter=awaiting_approval" })
    tiles.push({ id: "finance_due", labelKey: "kpi.finance_due.label", value: due.total, unit: "money", noteKey: "kpi.finance_due.note_split", noteParams: { advances: due.advances, received: due.received }, tone: "neutral", href: COMMITMENTS_HREF })
    if (nk) tiles.push({ id: "overdue_lines", labelKey: "kpi.overdue_lines.label", value: nk.overdue, unit: "count", noteKey: nk.overdue ? "kpi.overdue_lines.note_some" : "kpi.overdue_lines.note_none", noteParams: { total: nk.need }, tone: nk.overdue ? "bad" : "good", href: `${NEEDS_HREF}?seg=act` })
    else tiles.push({ id: "late", labelKey: "kpi.late.label", value: lateOrders.length, unit: "count", noteKey: lateOrders.length ? "kpi.late.note_value" : "kpi.late.note_none", noteParams: { amount: lateValue }, tone: lateOrders.length ? "bad" : "good", href: "/contractor/rfqs/orders?filter=late" })
    return { kind, tiles }
  }

  // Manager / buyer.
  const requests = nk
  const needs = nk ? nk.need : w.rfqs.filter((r) => r.status === "New" && (daysFromNow(r.deadline, now) ?? 1) <= 0 && w.offers.some((o) => o.rfqId === r.id && OFFER_PENDING.has(o.status || ""))).length
  const committed = round2(live.reduce((s, po) => s + poOpenValue(po), 0))
  const drift = priceDrift(w, { from: addDays(todayOf(now), -30) })
  if (nk) tiles.push({ id: "needs", labelKey: "kpi.needs.label_requests", value: nk.need, unit: "lines", noteKey: nk.overdue ? "kpi.needs.note_overdue" : "kpi.needs.note_none", noteParams: { count: nk.overdue }, tone: nk.overdue ? "bad" : "good", href: `${NEEDS_HREF}?seg=act` })
  else tiles.push({ id: "needs", labelKey: "kpi.needs.label_rfqs", value: needs, unit: "count", noteKey: needs ? "kpi.needs.note_rfqs" : "kpi.needs.note_none", noteParams: {}, tone: needs ? "warn" : "good", href: requests ? NEEDS_HREF : "/contractor/rfqs" })
  tiles.push({ id: "committed", labelKey: "kpi.committed.label", value: committed, unit: "money", noteKey: lateOrders.length ? "kpi.committed.note_late" : "kpi.committed.note_none", noteParams: { amount: lateValue, count: lateOrders.length }, tone: lateOrders.length ? "bad" : "good", href: "/contractor/rfqs/orders?filter=live" })
  tiles.push({ id: "drift", labelKey: "kpi.drift.label", value: drift.totals.impact, unit: "money", noteKey: drift.totals.impact > 0 ? "kpi.drift.note_up" : drift.totals.impact < 0 ? "kpi.drift.note_down" : "kpi.drift.note_none", noteParams: { percent: Math.abs(drift.totals.percent ?? 0) }, tone: drift.totals.impact > 0 ? "warn" : "good", href: "/contractor/rfqs/reports?report=drift&period=30" })
  return { kind, tiles }
}

/** The owner's «ستطلبه المالية للموردين قريباً»: requested advances + received-unpaid (prototype `due7`). */
export function financeDue(orders: PurchaseOrder[]): { advances: number; received: number; total: number } {
  const advances = round2(orders.filter((po) => advanceState(asX(po)) === "requested").reduce((s, po) => s + advanceAmount(asX(po)), 0))
  const received = round2(orders.filter((po) => poStatus(po) === "received").reduce((s, po) => s + (acceptedValue(po) ?? 0), 0))
  return { advances, received, total: round2(advances + received) }
}

// ---------------------------------------------------------------------------
// Every key the queue can emit — the i18n test reads this list
// ---------------------------------------------------------------------------

export const TODAY_KEYS = [
  "title",
  "subtitle",
  "empty.title",
  "empty.body",
  "showMore",
  "groups.all",
  "groups.need",
  "groups.rfq",
  "groups.po",
  "groups.delivery",
  "waits.title",
  "waits.subtitle",
  "waits.empty",
  "waits.more",
  "waits.on",
  "modules.supplier",
  "modules.finance",
  "modules.inventory",
  "actions.review",
  "actions.view",
  "actions.send",
  "actions.open",
  "actions.updateDate",
  "actions.decide",
  "actions.receive",
  "actions.rate",
  "actions.compare",
  "actions.openDraft",
  "actions.openRfq",
  "actions.seeArrived",
  "actions.openReceipt",
  "actions.openLine",
  "actions.openNeeds",
  "actions.answer",
  "actions.forward",
  "task.need_line.title",
  "task.need_line.sub",
  "task.need_rollup.title",
  "task.need_rollup.sub",
  "task.rfq_query.title",
  "task.rfq_query.sub",
  "task.cancel_remainder.title",
  "task.cancel_remainder.sub",
  "task.notice_forward.title",
  "task.notice_forward.sub",
  "task.rfq_award.sub_validity",
  "modules.manufacturing",
  "modules.projects",
  "wait.stock_check.title",
  "wait.stock_check.sub",
  "wait.workshop_reply.title",
  "wait.workshop_reply.sub",
  "wait.being_made.title",
  "wait.being_made.sub",
  "wait.sample_approval.title",
  "wait.sample_approval.sub",
  "kpi.needs.note_overdue",
  "kpi.overdue_lines.label",
  "kpi.overdue_lines.note_some",
  "kpi.overdue_lines.note_none",
  "task.approve.title",
  "task.approve.sub",
  "task.approval_wait.title",
  "task.approval_wait.sub.own_order",
  "task.approval_wait.sub.above_limit",
  "task.approval_wait.sub.retroactive",
  "task.approval_wait.sub.other",
  "task.send.title",
  "task.send.sub",
  "task.not_accepted.title",
  "task.not_accepted.sub",
  "task.late.title",
  "task.late.sub",
  "task.confirm_before_date.title",
  "task.confirm_before_date.sub",
  "task.reject_decide.title",
  "task.reject_decide.sub",
  "task.arrived_today.title",
  "task.arrived_today.sub",
  "task.notice_incoming.title",
  "task.notice_incoming.sub",
  "task.notice_overdue.title",
  "task.notice_overdue.sub",
  "task.notice_late_date.title",
  "task.notice_late_date.sub",
  "task.rate.title",
  "task.rate.sub",
  "task.receipt_no_po.title",
  "task.receipt_no_po.sub",
  "task.rfq_draft.title",
  "task.rfq_draft.sub",
  "task.rfq_award.title",
  "task.rfq_award.sub",
  "task.rfq_no_offers.title",
  "task.rfq_no_offers.sub",
  "task.rfq_closing_thin.title",
  "task.rfq_closing_thin.sub",
  "wait.supplier_acceptance.title",
  "wait.supplier_acceptance.sub",
  "wait.finance_payment.title",
  "wait.finance_payment.sub",
  "wait.held_inspection.title",
  "wait.held_inspection.sub",
  "kpi.needs.label_requests",
  "kpi.needs.label_rfqs",
  "kpi.needs.note_requests",
  "kpi.needs.note_rfqs",
  "kpi.needs.note_none",
  "kpi.committed.label",
  "kpi.committed.note_late",
  "kpi.committed.note_none",
  "kpi.drift.label",
  "kpi.drift.note_up",
  "kpi.drift.note_down",
  "kpi.drift.note_none",
  "kpi.my_approval.label",
  "kpi.my_approval.note_some",
  "kpi.my_approval.note_none",
  "kpi.finance_due.label",
  "kpi.finance_due.note",
  "kpi.late.label",
  "kpi.late.note_some",
  "kpi.late.note_none",
  "kpi.late.note_value",
  "task.finance_hold.proc.title",
  "task.finance_hold.proc.sub",
  "task.finance_hold.rcv.title",
  "task.finance_hold.rcv.sub",
  "task.finance_hold.owner.title",
  "task.finance_hold.owner.sub",
  "task.finance_hold.sup.title",
  "task.finance_hold.sup.sub",
  "task.notice_forward.sub_place",
  "task.arrived_today.sub_flags",
  "wait.invoice_hold.title",
  "wait.invoice_hold.sub",
  "wait.pm_budget.title",
  "wait.pm_budget.sub",
  "wait.supplier_advance.title",
  "wait.supplier_advance.sub",
  "wait.being_made.sub_ready",
  "kpi.finance_due.note_split",
  "kpi.lines",
  "kpi.with_suppliers.label",
  "kpi.with_suppliers.note",
  "kpi.sent_not_accepted.label",
  "kpi.sent_not_accepted.note",
] as const

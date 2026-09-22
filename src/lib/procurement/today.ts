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
import { agreementDaysLeft, agreementState, type PriceAgreement } from "./prices"
import { priceDrift } from "./reports"
import type { ProcActor, ProcurementPolicies, PurchaseOrder, ReceiptFact, SupplierFacts } from "./types"

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
  organizationId?: string
  projectId?: string | null
  category?: string | null
  /** ISO — when it was published / awarded, when known (cycle-time report). */
  createdAt?: string | null
  awardedAt?: string | null
  /** Suppliers invited, when the RFQ was private (competition report). */
  invitedCount?: number | null
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
}

export interface MfgPurchaseRequestFact {
  id: string
  status: string
}

export interface ProcWorld {
  orders: PurchaseOrder[]
  /** Deliveries — the supplier's notices and the goods receipts. */
  receipts: ReceiptFact[]
  rfqs: RfqFact[]
  offers: OfferFact[]
  /** Manufacturing's shortfalls on Procurement's desk, when the screen loads them. */
  mfgPurchaseRequests?: MfgPurchaseRequestFact[]
  policies: ProcurementPolicies
  supplierFacts: Record<string, SupplierFacts>
  /** Price agreements, when the screen loads them (§4 `AGR`). */
  agreements?: PriceAgreement[]
}

export const OFFER_PENDING = new Set(["قيد المراجعة", "مطلوب تخفيض"])
export const OFFER_ACCEPTED = "مقبول"

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskGroup = "rfq" | "po" | "delivery"
export const TASK_GROUPS: TaskGroup[] = ["rfq", "po", "delivery"]
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
  agreement_expiring: "rfq",
}

const SEVERITY_RANK: Record<TaskSeverity, number> = { red: 0, amber: 1, blue: 2 }

/** Below this on-time score we confirm with the supplier before his date, not after. */
export const CONFIRM_BEFORE_DATE_BELOW = 85
/** A receipt with no order stays on the desk this long, then it is a report row. */
const NO_PO_WINDOW_DAYS = 30

export type ActorKind = "owner" | "buyer" | "expediter"

/** The owner; anyone else who sees prices (manager, buyer); the expediter who does not. */
export function actorKind(actor: ProcActor): ActorKind {
  if (actor.isOwner) return "owner"
  return actor.seesPrices ? "buyer" : "expediter"
}

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

export function todayTasks(w: ProcWorld, actor: ProcActor, now: Date): Task[] {
  const out: Task[] = []
  const today = todayOf(now)
  const kind = actorKind(actor)
  const expediter = kind === "expediter"
  const sees = actor.seesPrices
  const decides = actor.canPrepare || actor.canApprove || actor.isOwner
  const add = (t: Omit<Task, "group" | "subNs"> & { subNs?: Task["subNs"] }) => out.push({ subNs: "ProcToday", ...t, group: GROUP_OF[t.kind] })

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

    if (st === "approved" && actor.canExpedite) {
      // T5c · approved, with Finance as a commitment, and the supplier has not heard.
      const approved = daysFromNow(dayOf(po.approvedAt), now) ?? created
      add({ id: `send:${po.id}`, kind: "send", priority: 1, severity: "amber", sortDays: approved, titleKey: "task.send.title", titleParams: base, subKey: "task.send.sub", subParams: {}, amount: money(actor, value), href: ORDER_HREF(po.id), actionKey: "actions.send" })
      continue
    }

    if (st === "sent" && actor.canExpedite) {
      // T5d · the acceptance window ran out — without an acceptance there is no date.
      const sent = daysFromNow(dayOf(po.sentAt), now)
      if (sent != null && -sent >= w.policies.supplierAcceptanceDays) {
        add({ id: `not_accepted:${po.id}`, kind: "not_accepted", priority: 2, severity: "amber", sortDays: sent, titleKey: "task.not_accepted.title", titleParams: { ...base, days: -sent }, subKey: "task.not_accepted.sub", subParams: {}, amount: money(actor, value), href: ORDER_HREF(po.id), actionKey: "actions.open" })
      }
      continue
    }

    if (st === "in_delivery" || st === "part_received") {
      const promise = daysFromNow(po.promisedDate, now)
      if (poLate(po, now) && actor.canExpedite) {
        // T5e · late — the subtitle lists what is still owed.
        add({ id: `late:${po.id}`, kind: "late", priority: 2, severity: "red", sortDays: promise ?? 0, titleKey: "task.late.title", titleParams: { ...base, days: daysLate(po, now) }, subKey: "task.late.sub", subParams: { lines: linesText(po) }, amount: money(actor, poOpenValue(po)), href: ORDER_HREF(po.id), actionKey: "actions.updateDate" })
      } else if (promise != null && promise >= 0 && promise <= 2 && actor.canExpedite && sees) {
        // T5h · a poor on-time record: confirm before his date, do not wait for the delay.
        const score = scoreOf(po)
        if (score.onTimePercent != null && score.onTimePercent < CONFIRM_BEFORE_DATE_BELOW) {
          add({ id: `confirm:${po.id}`, kind: "confirm_before_date", priority: 2, severity: "blue", sortDays: promise, titleKey: "task.confirm_before_date.title", titleParams: { ...base, inDays: promise }, subKey: "task.confirm_before_date.sub", subParams: { percent: score.onTimePercent }, amount: null, href: ORDER_HREF(po.id), actionKey: "actions.open" })
        }
      }
    }

    if (decides && po.status === "accepted") {
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
          actionKey: "actions.decide",
          reasonCode: reject?.rejectReason || null,
        })
      }
    }

    if ((st === "received" || st === "closed") && decides && sees && canRate(po, w.receipts)) {
      // T10 · the story is whole: rate him.
      add({ id: `rate:${po.id}`, kind: "rate", priority: 3, severity: "blue", sortDays: 0, titleKey: "task.rate.title", titleParams: base, subKey: "task.rate.sub", subParams: {}, amount: null, href: ORDER_HREF(po.id), actionKey: "actions.rate" })
    }
  }

  const orderById = new Map(w.orders.map((o) => [o.id, o]))

  // T8/T9 · a pending notice — on the way, or its date passed with no receipt.
  for (const r of w.receipts) {
    if (r.status !== "pending_confirmation") continue
    const po = r.poId ? orderById.get(r.poId) : undefined
    const d = daysFromNow(r.deliveryDate, now)
    const promised = po ? daysFromNow(po.promisedDate, now) : null
    const supplier = r.supplierName || po?.supplierName || ""
    const number = r.poNumber || po?.docNumber || ""
    const lines = (r.lines || []).map((l) => `${l.name} ${l.noticeQuantity} ${l.unit}`).join(" · ")
    const action = actor.canReceive ? "actions.receive" : "actions.open"
    if (d != null && d < 0) {
      add({ id: `notice_overdue:${r.id}`, kind: "notice_overdue", priority: 1, severity: "red", sortDays: d, titleKey: "task.notice_overdue.title", titleParams: { supplier }, subKey: "task.notice_overdue.sub", subParams: { number, date: dayOf(r.deliveryDate), daysAgo: -d }, amount: null, href: RECEIPT_HREF(r.id), actionKey: action })
    } else if (promised != null && d != null && d > promised) {
      // T9b · the supplier announces a date after his own promise — the delay is known before it happens.
      const behind = d - promised
      add({ id: `notice_late_date:${r.id}`, kind: "notice_late_date", priority: 1, severity: "amber", sortDays: d, titleKey: "task.notice_late_date.title", titleParams: { supplier, days: behind }, subKey: "task.notice_late_date.sub", subParams: { number, date: dayOf(r.deliveryDate), promised: po?.promisedDate || "" }, amount: null, href: RECEIPT_HREF(r.id), actionKey: action })
    } else {
      add({ id: `notice:${r.id}`, kind: "notice_incoming", priority: d != null && d === 0 ? 1 : 2, severity: d != null && d === 0 ? "amber" : "blue", sortDays: d ?? 9, titleKey: "task.notice_incoming.title", titleParams: { supplier, inDays: d ?? 0, hasDate: d == null ? 0 : 1 }, subKey: "task.notice_incoming.sub", subParams: { number, lines }, amount: null, href: RECEIPT_HREF(r.id), actionKey: action })
    }
  }

  if (!expediter) {
    // T6 · what arrived today on our orders — one roll-up row.
    const arrived = w.receipts.filter((r) => r.status === "confirmed" && r.poId && receiptDay(r) === today)
    if (arrived.length) {
      const list = arrived.map((r) => `${r.supplierName || orderById.get(r.poId as string)?.supplierName || ""} ${r.docNumber || ""}`.trim()).join(" · ")
      add({ id: `arrived:${today}`, kind: "arrived_today", priority: 2, severity: "blue", sortDays: 0, titleKey: "task.arrived_today.title", titleParams: { count: arrived.length }, subKey: "task.arrived_today.sub", subParams: { list }, amount: null, href: "/contractor/goods-received?tab=log", actionKey: "actions.seeArrived" })
    }

    // T11 · a receipt with no order — informational; the regularisation is a retroactive order.
    for (const r of w.receipts) {
      if (r.source !== "manual" || r.poId || r.offerId || r.status !== "confirmed") continue
      const day = receiptDay(r)
      const age = day ? -(daysFromNow(day, now) ?? 0) : 0
      if (!day || age > NO_PO_WINDOW_DAYS) continue
      add({ id: `nopo:${r.id}`, kind: "receipt_no_po", priority: 3, severity: "blue", sortDays: -age, titleKey: "task.receipt_no_po.title", titleParams: { supplier: r.supplierName || "", hasSupplier: r.supplierName ? 1 : 0 }, subKey: "task.receipt_no_po.sub", subParams: { number: r.docNumber || "", date: day }, amount: null, href: RECEIPT_HREF(r.id), actionKey: "actions.openReceipt" })
    }
  }

  if (actor.canPrepare || actor.isOwner) {
    const offersByRfq = new Map<string, OfferFact[]>()
    for (const o of w.offers) offersByRfq.set(o.rfqId, [...(offersByRfq.get(o.rfqId) || []), o])

    for (const r of w.rfqs) {
      const title = r.title || ""
      const deadline = daysFromNow(r.deadline, now)
      if (r.status === "Draft") {
        // T3 · never published: its lines are held for nothing.
        add({ id: `rfq_draft:${r.id}`, kind: "rfq_draft", priority: 2, severity: "blue", sortDays: deadline ?? 9, titleKey: "task.rfq_draft.title", titleParams: { title }, subKey: "task.rfq_draft.sub", subParams: {}, amount: null, href: DRAFTS_HREF, actionKey: "actions.openDraft" })
        continue
      }
      if (r.status !== "New") continue
      const offers = offersByRfq.get(r.id) || []
      const pending = offers.filter((o) => OFFER_PENDING.has(o.status || ""))
      const count = offers.length || Number(r.offersCount) || 0
      if (deadline != null && deadline <= 0 && pending.length) {
        // T4a · the window closed and offers wait: compare and award. Red once the award cycle is overrun.
        const best = lowestOffer(pending)
        add({ id: `rfq_award:${r.id}`, kind: "rfq_award", priority: 2, severity: -deadline > w.policies.awardCycleDays ? "red" : "amber", sortDays: deadline, titleKey: "task.rfq_award.title", titleParams: { title, count: pending.length }, subKey: "task.rfq_award.sub", subParams: { ago: -deadline }, amount: money(actor, best ? offerPrice(best) : null), href: RFQ_HREF(r.id), actionKey: "actions.compare" })
      } else if (deadline != null && deadline < 0 && count === 0) {
        // T4b · closed with nothing: extend, add suppliers or share the guest link.
        add({ id: `rfq_no_offers:${r.id}`, kind: "rfq_no_offers", priority: 2, severity: "red", sortDays: deadline, titleKey: "task.rfq_no_offers.title", titleParams: { title }, subKey: "task.rfq_no_offers.sub", subParams: {}, amount: null, href: RFQ_HREF(r.id), actionKey: "actions.openRfq" })
      } else if (deadline != null && deadline >= 0 && deadline <= 2 && count < w.policies.minOffers) {
        // T4c · closing soon with thin competition.
        add({ id: `rfq_closing_thin:${r.id}`, kind: "rfq_closing_thin", priority: 2, severity: "blue", sortDays: deadline, titleKey: "task.rfq_closing_thin.title", titleParams: { title, inDays: deadline, count }, subKey: "task.rfq_closing_thin.sub", subParams: {}, amount: null, href: RFQ_HREF(r.id), actionKey: "actions.openRfq" })
      }
    }
  }

  // An agreement about to end (§4 `AGR`). Informational, and only for whoever
  // could renew it: when it lapses its materials go back to the market by
  // themselves, which is correct but expensive if nobody meant it.
  if (actor.isOwner || actor.canPrepare || actor.canApprove) {
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
        href: AGREEMENTS_HREF,
        actionKey: "actions.openAgreement",
      })
    }
  }

  return out.sort((a, b) => a.priority - b.priority || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.sortDays - b.sortDays)
}

// ---------------------------------------------------------------------------
// Waits — "the action is theirs and the state reaches us" (no button)
// ---------------------------------------------------------------------------

export type WaitKind = "supplier_acceptance" | "finance_payment" | "held_inspection"
export type WaitModule = "supplier" | "finance" | "inventory"

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

export function todayWaits(w: ProcWorld, actor: ProcActor, now: Date): Wait[] {
  const out: Wait[] = []
  for (const po of w.orders) {
    const st = poStatus(po)
    const base = { number: po.docNumber, supplier: po.supplierName }
    if (st === "sent") {
      // W9 · inside the acceptance window it is the supplier's move.
      const sent = daysFromNow(dayOf(po.sentAt), now)
      if (sent == null || -sent < w.policies.supplierAcceptanceDays) {
        out.push({ id: `w_accept:${po.id}`, kind: "supplier_acceptance", module: "supplier", titleKey: "wait.supplier_acceptance.title", titleParams: base, subKey: "wait.supplier_acceptance.sub", subParams: { ago: sent == null ? 0 : -sent }, href: ORDER_HREF(po.id) })
      }
    }
    if (st === "received" && actor.seesPrices) {
      // W10 · fully received: invoice, match and payment are Finance's.
      out.push({ id: `w_pay:${po.id}`, kind: "finance_payment", module: "finance", titleKey: "wait.finance_payment.title", titleParams: base, subKey: "wait.finance_payment.sub", subParams: {}, href: ORDER_HREF(po.id) })
    }
    if (po.status === "accepted") {
      // W5 · held for inspection: not issued and not paid before release.
      for (const l of po.lines) {
        if (!(Number(l.held) > 0)) continue
        const hold = w.receipts.find((r) => r.poId === po.id && (r.lines || []).some((d) => d.poLineId === l.id && Number(d.held) > 0))?.lines?.find((d) => d.poLineId === l.id && Number(d.held) > 0)
        out.push({ id: `w_held:${po.id}:${l.id}`, kind: "held_inspection", module: "inventory", titleKey: "wait.held_inspection.title", titleParams: { qty: l.held, unit: l.unit, name: l.name, ...base }, subKey: "wait.held_inspection.sub", subParams: {}, href: ORDER_HREF(po.id), reasonCode: hold?.holdReason || null })
      }
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
  unit: "count" | "money"
  noteKey: string
  noteParams: Record<string, string | number>
  tone: "good" | "bad" | "warn" | "neutral"
  href: string
}

export interface ProcKpis {
  kind: ActorKind
  tiles: KpiTile[]
}

export function todayKpis(w: ProcWorld, actor: ProcActor, now: Date): ProcKpis {
  const kind = actorKind(actor)
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

  if (kind === "owner") {
    const mine = w.orders.filter((po) => po.status === "awaiting_approval" && !approvalRefusal(po, actor, w.policies))
    const mineValue = round2(mine.reduce((s, po) => s + poValue(po), 0))
    // Received and not yet closed: Finance will be asked for this next.
    const due = round2(w.orders.filter((po) => poStatus(po) === "received").reduce((s, po) => s + (acceptedValue(po) ?? 0), 0))
    tiles.push({ id: "my_approval", labelKey: "kpi.my_approval.label", value: mineValue, unit: "money", noteKey: mine.length ? "kpi.my_approval.note_some" : "kpi.my_approval.note_none", noteParams: { count: mine.length }, tone: mine.length ? "warn" : "good", href: "/contractor/rfqs/orders?filter=awaiting_approval" })
    tiles.push({ id: "finance_due", labelKey: "kpi.finance_due.label", value: due, unit: "money", noteKey: "kpi.finance_due.note", noteParams: {}, tone: "neutral", href: "/contractor/rfqs/orders?filter=received" })
    tiles.push({ id: "late", labelKey: "kpi.late.label", value: lateOrders.length, unit: "count", noteKey: lateOrders.length ? "kpi.late.note_value" : "kpi.late.note_none", noteParams: { amount: lateValue }, tone: lateOrders.length ? "bad" : "good", href: "/contractor/rfqs/orders?filter=late" })
    return { kind, tiles }
  }

  // Manager / buyer.
  const requests = w.mfgPurchaseRequests
  const needs = requests ? requests.filter((r) => r.status === "sent").length : w.rfqs.filter((r) => r.status === "New" && (daysFromNow(r.deadline, now) ?? 1) <= 0 && w.offers.some((o) => o.rfqId === r.id && OFFER_PENDING.has(o.status || ""))).length
  const committed = round2(live.reduce((s, po) => s + poOpenValue(po), 0))
  const drift = priceDrift(w, { from: addDays(todayOf(now), -30) })
  tiles.push({ id: "needs", labelKey: requests ? "kpi.needs.label_requests" : "kpi.needs.label_rfqs", value: needs, unit: "count", noteKey: needs ? (requests ? "kpi.needs.note_requests" : "kpi.needs.note_rfqs") : "kpi.needs.note_none", noteParams: {}, tone: needs ? "warn" : "good", href: requests ? "/contractor/rfqs/requests" : "/contractor/rfqs" })
  tiles.push({ id: "committed", labelKey: "kpi.committed.label", value: committed, unit: "money", noteKey: lateOrders.length ? "kpi.committed.note_late" : "kpi.committed.note_none", noteParams: { amount: lateValue, count: lateOrders.length }, tone: lateOrders.length ? "bad" : "good", href: "/contractor/rfqs/orders?filter=live" })
  tiles.push({ id: "drift", labelKey: "kpi.drift.label", value: drift.totals.impact, unit: "money", noteKey: drift.totals.impact > 0 ? "kpi.drift.note_up" : drift.totals.impact < 0 ? "kpi.drift.note_down" : "kpi.drift.note_none", noteParams: { percent: Math.abs(drift.totals.percent ?? 0) }, tone: drift.totals.impact > 0 ? "warn" : "good", href: "/contractor/rfqs/reports?report=drift" })
  return { kind, tiles }
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
  "kpi.with_suppliers.label",
  "kpi.with_suppliers.note",
  "kpi.sent_not_accepted.label",
  "kpi.sent_not_accepted.note",
] as const

// The purchase order, derived (PRD 3.0 §5–§6). What is stored is what somebody
// decided — the seven states, the lines' accepted/rejected/held/cancelled
// counters, the supplier's promise. Everything else is computed here from
// those facts, on every read: value, delivery progress, lateness, who must
// approve, what blocks the approval, whether the supplier may be rated, and
// the supplier's score. Nothing here writes; every function that needs the
// clock takes `now`.
//
// Two money rules run through the whole file:
// - values are EXCLUDING VAT (the approval limit and the caps compare ex-VAT;
//   only `poCommitment` adds VAT for Finance);
// - a lump-sum order — one whose lines carry no unit price — never gets a
//   proportional number invented for it. Its value is `totalExVat`, and the
//   value of a part of it is `null` until the whole has arrived.

import type {
  AwardReasonCode,
  DeliveryLine,
  HoldReasonCode,
  PoBasis,
  PoLine,
  PoLogEntry,
  PoSendChannel,
  PoStatus,
  ProcActor,
  ProcurementPolicies,
  PurchaseOrder,
  ReceiptCheck,
  ReceiptFact,
  RejectDecision,
  RejectReasonCode,
  SupplierFacts,
} from "./types"

// ---------------------------------------------------------------------------
// The closed vocabularies, as arrays — every one has a label in
// `Portal.Procurement` (the i18n test walks them)
// ---------------------------------------------------------------------------

export const PO_STATUSES = ["awaiting_approval", "approved", "sent", "accepted", "in_delivery", "part_received", "received", "closed", "cancelled"] as const satisfies readonly PoStatus[]
export const PO_BASES = ["rfq", "direct", "retroactive"] as const satisfies readonly PoBasis[]
export const PO_SEND_CHANNELS = ["portal", "whatsapp", "email"] as const satisfies readonly PoSendChannel[]
export const AWARD_REASON_CODES = ["delivery_time", "quality", "payment_terms", "past_performance", "availability", "other"] as const satisfies readonly AwardReasonCode[]
export const REJECT_REASON_CODES = ["damaged", "wrong_item", "wrong_spec", "expired", "excess", "other"] as const satisfies readonly RejectReasonCode[]
export const HOLD_REASON_CODES = ["certificate", "test", "consultant"] as const satisfies readonly HoldReasonCode[]
export const REJECT_DECISIONS = ["replace", "discount", "reduce"] as const satisfies readonly RejectDecision[]
export const RECEIPT_CHECKS = ["delivery_note", "weighbridge", "certificate", "photos", "driver_signature"] as const satisfies readonly ReceiptCheck[]
export const PO_LOG_ACTIONS = ["created", "approved", "returned", "resubmitted", "sent", "supplier_accepted", "date_updated", "reminded", "received", "remainder_cancelled", "reject_decided", "closed", "cancelled", "rated"] as const satisfies readonly PoLogEntry["action"][]

// ---------------------------------------------------------------------------
// Days — dates are `YYYY-MM-DD` or ISO strings; offsets are calendar days
// ---------------------------------------------------------------------------

export const round2 = (n: number) => Math.round(n * 100) / 100
const EPS = 1e-9

/** The calendar day of an ISO string (its first ten characters). */
export const dayOf = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "")

/** The viewer's calendar day — not UTC's: at 1 AM in Riyadh it is already
 * "today" here while UTC still says yesterday. */
export function todayOf(now: Date): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** Calendar days from one day to another (positive when `to` is later). */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${dayOf(toDay)}T00:00:00Z`) - Date.parse(`${dayOf(fromDay)}T00:00:00Z`)) / 86400000)
}

/** Days from today to a date: 0 today, +1 tomorrow, −1 yesterday; null without a date. */
export function daysFromNow(date: string | null | undefined, now: Date): number | null {
  if (!date) return null
  const d = daysBetween(todayOf(now), date)
  return Number.isFinite(d) ? d : null
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${dayOf(day)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Lines and values
// ---------------------------------------------------------------------------

/** "Complete" is never `==`: half a percent short of the order still closes it. */
export const COMPLETE_RATIO = 0.995

const num = (n: number | null | undefined) => (Number.isFinite(Number(n)) ? Number(n) : 0)

/** Still owed by the supplier: ordered − cancelled − accepted. Rejected goods
 * stay outstanding (he owes a replacement until Procurement decides
 * otherwise); held goods are on our floor but not yet ours. */
export function lineOutstanding(l: PoLine): number {
  return Math.max(0, round2(num(l.quantity) - num(l.cancelled) - num(l.accepted)))
}

/** What may still arrive at the gate: outstanding less what is already held. */
export function lineToArrive(l: PoLine): number {
  return Math.max(0, round2(lineOutstanding(l) - num(l.held)))
}

export function lineComplete(l: PoLine): boolean {
  return num(l.accepted) + num(l.cancelled) + EPS >= num(l.quantity) * COMPLETE_RATIO
}

/** No unit prices to multiply — the offer named one figure for the lot. */
export function isLumpSum(po: PurchaseOrder): boolean {
  return po.lines.length === 0 || po.lines.some((l) => l.unitPrice == null)
}

/** Value EXCLUDING VAT, net of cancellations. */
export function poValue(po: PurchaseOrder): number {
  if (isLumpSum(po)) return round2(num(po.totalExVat))
  return round2(po.lines.reduce((s, l) => s + (num(l.quantity) - num(l.cancelled)) * num(l.unitPrice), 0))
}

export function allLinesComplete(po: PurchaseOrder): boolean {
  return po.lines.length > 0 && po.lines.every(lineComplete)
}

/** Committed and not yet delivered. A lump-sum order is open in full until it
 * is complete — the conservative reading of an unbreakable figure. */
export function poOpenValue(po: PurchaseOrder): number {
  if (isLumpSum(po)) return allLinesComplete(po) ? 0 : round2(num(po.totalExVat))
  return round2(po.lines.reduce((s, l) => s + lineOutstanding(l) * num(l.unitPrice), 0))
}

/** Value accepted at the gate — the ceiling of what may be invoiced (§6.2).
 * Null when a line with accepted goods has no unit price, unless the order is
 * complete: then the lot's own total is the honest figure. */
export function acceptedValue(po: PurchaseOrder): number | null {
  const needed = po.lines.filter((l) => num(l.accepted) > 0)
  if (needed.some((l) => l.unitPrice == null)) return allLinesComplete(po) ? round2(num(po.totalExVat)) : null
  return round2(needed.reduce((s, l) => s + num(l.accepted) * num(l.unitPrice), 0))
}

/** The commitment Finance books, INCLUDING VAT. */
export function poCommitment(po: PurchaseOrder): number {
  return round2(poValue(po) * (1 + num(po.vatRate)))
}

// ---------------------------------------------------------------------------
// Status and lateness
// ---------------------------------------------------------------------------

/** The stored state, except that `accepted` is read off the lines: everything
 * arrived → received; something arrived → part received; nothing yet → in delivery. */
export function poStatus(po: PurchaseOrder): PoStatus {
  if (po.status !== "accepted") return po.status
  if (allLinesComplete(po)) return "received"
  if (po.lines.some((l) => num(l.accepted) > 0)) return "part_received"
  return "in_delivery"
}

const DELIVERING: ReadonlySet<PoStatus> = new Set(["in_delivery", "part_received"])
const LIVE: ReadonlySet<PoStatus> = new Set(["approved", "sent", "in_delivery", "part_received"])

/** Still owed by the supplier past the day he promised. */
export function poLate(po: PurchaseOrder, now: Date): boolean {
  return daysLate(po, now) > 0
}

/** Days past the promised date while goods are still owed; 0 otherwise. */
export function daysLate(po: PurchaseOrder, now: Date): number {
  if (!DELIVERING.has(poStatus(po)) || !po.promisedDate) return 0
  if (!po.lines.some((l) => lineOutstanding(l) > 0)) return 0
  const d = daysFromNow(po.promisedDate, now)
  return d == null || d >= 0 ? 0 : -d
}

/** Approved and not yet complete — the commitment Finance is carrying. */
export function poLive(po: PurchaseOrder): boolean {
  return LIVE.has(poStatus(po))
}

export function isReceived(po: PurchaseOrder): boolean {
  return poStatus(po) === "received"
}

// ---------------------------------------------------------------------------
// Approval — who, and what stands in the way (§6.1)
// ---------------------------------------------------------------------------

/** Who the order is routed to. The owner takes anything above the manager's
 * limit and every retroactive order; a solo company's owner takes his own. */
export function requiredApprover(po: PurchaseOrder, policies: ProcurementPolicies, preparerIsOwnerSolo = false): "manager" | "owner" {
  if (po.basis === "retroactive" || preparerIsOwnerSolo) return "owner"
  return poValue(po) > policies.managerApprovalLimit ? "owner" : "manager"
}

export const BLOCK_CODES = ["split_orders", "supplier_cr_expired", "supplier_unverified", "supplier_no_vat"] as const
export type BlockCode = (typeof BLOCK_CODES)[number]

export interface PoBlock {
  code: BlockCode
  params: Record<string, string | number>
}

export interface BlockContext {
  /** The supplier's platform profile; null for a guest or when unknown. */
  supplier: SupplierFacts | null
  /** Every other order of the organisation (the split check looks around this one). */
  otherOrders: PurchaseOrder[]
  policies: ProcurementPolicies
  now: Date
}

/** One key per supplier: a guest has no org id, so his name stands in. */
export function supplierKey(po: Pick<PurchaseOrder, "supplierOrgId" | "supplierName" | "isGuestSupplier">): string {
  return po.isGuestSupplier || !po.supplierOrgId || po.supplierOrgId === "guest" ? `guest:${(po.supplierName || "").trim().toLowerCase()}` : po.supplierOrgId
}

/** Direct orders to the same supplier inside the split window, before AND
 * after this one; cancelled ones do not count, a retroactive order is exempt. */
export function splitSiblings(po: PurchaseOrder, others: PurchaseOrder[], policies: ProcurementPolicies): PurchaseOrder[] {
  if (po.basis !== "direct") return []
  const key = supplierKey(po)
  const day = dayOf(po.createdAt)
  return others.filter(
    (x) => x.id !== po.id && x.basis === "direct" && x.status !== "cancelled" && supplierKey(x) === key && Math.abs(daysBetween(day, dayOf(x.createdAt))) <= policies.splitWindowDays
  )
}

/** "Facts, not checkboxes": what stops the approval today. Unknown facts
 * (null) never block — a guest has no profile to fail. */
export function poBlocks(po: PurchaseOrder, ctx: BlockContext): PoBlock[] {
  const out: PoBlock[] = []
  const sibs = splitSiblings(po, ctx.otherOrders, ctx.policies)
  if (sibs.length) {
    const total = round2(poValue(po) + sibs.reduce((s, x) => s + poValue(x), 0))
    if (total > ctx.policies.directPurchaseCap) {
      out.push({ code: "split_orders", params: { count: sibs.length + 1, total, cap: ctx.policies.directPurchaseCap, days: ctx.policies.splitWindowDays } })
    }
  }
  const s = po.isGuestSupplier ? null : ctx.supplier
  if (s) {
    const expiry = s.crExpiry ? daysFromNow(s.crExpiry, ctx.now) : null
    if (expiry != null && expiry < 0) out.push({ code: "supplier_cr_expired", params: { date: s.crExpiry as string, daysAgo: -expiry } })
    if (s.verified === false) out.push({ code: "supplier_unverified", params: {} })
    if (s.hasVatNumber === false) out.push({ code: "supplier_no_vat", params: {} })
  }
  return out
}

export const REFUSAL_CODES = ["not_awaiting", "no_permission", "own_order", "owner_only_retroactive", "above_limit"] as const
export type RefusalCode = (typeof REFUSAL_CODES)[number]

export interface ApprovalRefusal {
  code: RefusalCode
  params: Record<string, string | number>
}

/** The preparer is the approver. Allowed for the owner alone (a company of
 * one cannot wait for a second person) — and flagged wherever it shows. */
export function isSelfApproval(po: PurchaseOrder, actor: Pick<ProcActor, "uid">): boolean {
  return po.preparedById === actor.uid
}

/** Why THIS actor may not approve — null when he may. The org owner passes
 * every check but the state. */
export function approvalRefusal(po: PurchaseOrder, actor: ProcActor, policies: ProcurementPolicies): ApprovalRefusal | null {
  if (po.status !== "awaiting_approval") return { code: "not_awaiting", params: {} }
  if (actor.isOwner) return null
  if (!actor.canApprove) return { code: "no_permission", params: {} }
  if (isSelfApproval(po, actor)) return { code: "own_order", params: {} }
  if (po.basis === "retroactive") return { code: "owner_only_retroactive", params: {} }
  const value = poValue(po)
  if (value > policies.managerApprovalLimit) return { code: "above_limit", params: { value, limit: policies.managerApprovalLimit } }
  return null
}

// ---------------------------------------------------------------------------
// What may happen next — the UI and the writes ask the same predicates
// ---------------------------------------------------------------------------

/** No dispatch before approval (§6.1-12). */
export const canSend = (po: PurchaseOrder): boolean => po.status === "approved"

/** The supplier's acceptance is recorded once the order has reached him. */
export const canRecordAcceptance = (po: PurchaseOrder): boolean => po.status === "sent"

/** A new promise from the supplier, while goods are still owed. */
export const canUpdateDate = (po: PurchaseOrder): boolean => po.status === "accepted" && po.lines.some((l) => lineOutstanding(l) > 0)

/** One reminder a day: a button pressed five times in a minute reached the
 * supplier five times (UAT, 23 Sep). */
export const REMINDER_COOLDOWN_HOURS = 24

/** When the next reminder may go, or null when it may go now. */
export function reminderCooldownUntil(po: Pick<PurchaseOrder, "log">, now: Date): Date | null {
  const last = [...(po.log || [])].reverse().find((e) => e.action === "reminded")
  if (!last) return null
  const until = new Date(new Date(last.at).getTime() + REMINDER_COOLDOWN_HOURS * 3_600_000)
  return until > now ? until : null
}

/** "The rest will not arrive" — only what is still outstanding can be cancelled. */
export const canCancelRemainder = (po: PurchaseOrder): boolean => po.status === "accepted" && po.lines.some((l) => lineOutstanding(l) > 0)

/** Complete orders close by themselves; an incomplete one closes short only
 * with Procurement's reason. */
export function canClose(po: PurchaseOrder, reason?: string | null): boolean {
  if (po.status !== "accepted") return false
  if (isReceived(po)) return true
  return Boolean(reason && reason.trim())
}

/** Closing now would be closing short. */
export const closeIsShort = (po: PurchaseOrder): boolean => !isReceived(po)

/** Rating needs the whole story: complete or closed, at least one receipt, and not yet rated. */
export function canRate(po: PurchaseOrder, receipts: ReceiptFact[]): boolean {
  const st = poStatus(po)
  if (st !== "received" && st !== "closed") return false
  if (po.rating) return false
  return receiptsOf(po, receipts).length > 0
}

export function receiptsOf(po: Pick<PurchaseOrder, "id">, receipts: ReceiptFact[]): ReceiptFact[] {
  return receipts.filter((r) => r.poId === po.id && r.status === "confirmed")
}

/** The day a receipt happened: the gate's confirmation, else the notice's date. */
export const receiptDay = (r: ReceiptFact): string => dayOf(r.confirmedAt) || dayOf(r.deliveryDate)

// ---------------------------------------------------------------------------
// The supplier's record — computed from receipts, never typed (§6.2)
// ---------------------------------------------------------------------------

export interface PoFacts {
  receipts: number
  /** Day of the LAST receipt — the delivery is judged when it is whole. */
  lastReceiptDay: string | null
  onTime: boolean | null
  lateByDays: number
  inFull: boolean
  ordered: number
  accepted: number
  /** Rejected over everything counted at the gate. */
  rejectPercent: number
  /** Receipts whose checklist ticked the signed delivery note / the certificate. */
  docs: number
  certs: number
}

export function poFacts(po: PurchaseOrder, receipts: ReceiptFact[]): PoFacts {
  const mine = receiptsOf(po, receipts)
  const days = mine.map(receiptDay).filter(Boolean).sort()
  const last = days.length ? days[days.length - 1] : null
  const ordered = round2(po.lines.reduce((s, l) => s + num(l.quantity) - num(l.cancelled), 0))
  const accepted = round2(po.lines.reduce((s, l) => s + num(l.accepted), 0))
  let rejected = 0
  let counted = 0
  for (const r of mine) {
    for (const l of r.lines || []) {
      rejected += num(l.rejected)
      counted += num(l.accepted) + num(l.rejected) + num(l.held)
    }
  }
  const judged = last != null && Boolean(po.promisedDate)
  const gap = judged ? daysBetween(po.promisedDate as string, last as string) : 0
  return {
    receipts: mine.length,
    lastReceiptDay: last,
    onTime: judged ? gap <= 0 : null,
    lateByDays: judged ? Math.max(0, gap) : 0,
    inFull: ordered > 0 && accepted + EPS >= ordered * COMPLETE_RATIO,
    ordered,
    accepted,
    rejectPercent: counted > 0 ? round2((rejected / counted) * 100) : 0,
    docs: mine.filter((r) => (r.checklist || []).includes("delivery_note")).length,
    certs: mine.filter((r) => (r.checklist || []).includes("certificate")).length,
  }
}

export interface SupplierScore {
  /** Orders the supplier accepted — the ones that can be judged. */
  orders: number
  /** Null = no record. Never 0 or 100 for want of data. */
  onTimePercent: number | null
  rejectPercent: number | null
  responsePercent: number | null
}

export interface RfqInviteFacts {
  invited: number
  responded: number
}

/** One supplier's score over his orders. An order counts once he accepted it;
 * it is late when its last receipt came after the promise, when nothing came
 * and the promise passed, or when it is late right now. On-time judges only
 * orders that have a verdict — something arrived, or the promise has passed:
 * one merely not yet due read "100% on time" for a supplier who had delivered
 * nothing (UAT, 23 Sep). */
export function supplierScore(orders: PurchaseOrder[], receipts: ReceiptFact[], now: Date, rfqInvites?: RfqInviteFacts | null): SupplierScore {
  let n = 0
  let judged = 0
  let late = 0
  let rejected = 0
  let counted = 0
  for (const po of orders) {
    if (!po.supplierAcceptedAt || po.status === "cancelled") continue
    n++
    const facts = poFacts(po, receipts)
    const promise = po.promisedDate ? daysFromNow(po.promisedDate, now) : null
    const isLate = facts.lastReceiptDay != null ? facts.lateByDays > 0 : promise != null && promise < 0 ? true : poLate(po, now)
    if (isLate) late++
    if (isLate || facts.lastReceiptDay != null || po.lines.some((l) => num(l.accepted) + num(l.rejected) > 0)) judged++
    for (const l of po.lines) {
      rejected += num(l.rejected)
      counted += num(l.accepted) + num(l.rejected)
    }
  }
  const invited = rfqInvites?.invited || 0
  return {
    orders: n,
    onTimePercent: judged ? Math.round(((judged - late) / judged) * 100) : null,
    rejectPercent: counted > 0 ? round2((rejected / counted) * 100) : null,
    responsePercent: invited > 0 ? Math.round(((rfqInvites?.responded || 0) / invited) * 100) : null,
  }
}

// ---------------------------------------------------------------------------
// Offers — what the award reads (§5.1-5, §6.3)
// ---------------------------------------------------------------------------

/** The shape of an offer the award needs; `price` is a string in Firestore. */
export interface OfferLike {
  id?: string
  price?: string | number | null
  status?: string | null
}

const OFFER_REJECTED = "مرفوض"

/** A price typed as "12,500" or stored as 12500 — or nothing usable. */
export function offerPrice(o: OfferLike): number | null {
  const raw = o.price
  if (raw == null || raw === "") return null
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s]/g, ""))
  return Number.isFinite(n) && n >= 0 ? n : null
}

const competing = (offers: OfferLike[]) => offers.filter((o) => o.status !== OFFER_REJECTED && offerPrice(o) != null)

/** The lowest priced offer still in the running (the earliest wins a tie). */
export function lowestOffer<T extends OfferLike>(offers: T[]): T | null {
  let best: T | null = null
  for (const o of competing(offers) as T[]) {
    if (best == null || (offerPrice(o) as number) < (offerPrice(best) as number)) best = o
  }
  return best
}

export function isLowest(offer: OfferLike, offers: OfferLike[]): boolean {
  const p = offerPrice(offer)
  const best = lowestOffer(offers)
  return p != null && best != null && p <= (offerPrice(best) as number)
}

/** Awarding above the lowest price needs a reason — when a lower price exists. */
export function awardNeedsReason(offer: OfferLike, offers: OfferLike[]): boolean {
  const p = offerPrice(offer)
  const best = lowestOffer(offers)
  return p != null && best != null && p > (offerPrice(best) as number)
}

/** Above the competition threshold with fewer offers than policy asks for. */
export function isShortCompetition(total: number | null | undefined, offersCount: number, policies: ProcurementPolicies): boolean {
  return num(total) > policies.competitionThreshold && offersCount < policies.minOffers
}

// ---------------------------------------------------------------------------
// Last order day (§6.2) — need date − lead time − RFQ window − award cycle
// ---------------------------------------------------------------------------

export interface DayParts {
  need: string
  lead: number
  rfq: number
  cycle: number
  lastDay: string
}

/** The breakdown, so the screen can show its work. On the RFQ route the window
 * and the award cycle both count; a direct order needs one day to raise and approve. */
export function dayParts(needDate: string, leadDays: number, route: "rfq" | "direct", policies: ProcurementPolicies): DayParts {
  const lead = Math.max(0, Math.round(num(leadDays)))
  const rfq = route === "rfq" ? policies.rfqWindowDays : 0
  const cycle = route === "rfq" ? policies.awardCycleDays : 1
  return { need: dayOf(needDate), lead, rfq, cycle, lastDay: addDays(needDate, -(lead + rfq + cycle)) }
}

export function lastOrderDay(needDate: string, leadDays: number, route: "rfq" | "direct", policies: ProcurementPolicies): string {
  return dayParts(needDate, leadDays, route, policies).lastDay
}

// ---------------------------------------------------------------------------
// Receipts against lines — pure; the write runs it inside its transaction
// ---------------------------------------------------------------------------

/** counted − rejected − held, never below zero. */
export function acceptedOf(line: Pick<DeliveryLine, "counted" | "rejected" | "held">): number {
  return Math.max(0, round2(num(line.counted) - num(line.rejected) - num(line.held)))
}

/** New lines with this receipt's accepted / rejected / held added. A delivery
 * line naming no order line is ignored — validation refuses it before here. */
export function applyReceiptToLines(lines: PoLine[], deliveryLines: DeliveryLine[]): PoLine[] {
  return lines.map((l) => {
    const mine = deliveryLines.filter((d) => d.poLineId === l.id)
    if (!mine.length) return { ...l }
    const accepted = mine.reduce((s, d) => s + acceptedOf(d), 0)
    const rejected = mine.reduce((s, d) => s + num(d.rejected), 0)
    const held = mine.reduce((s, d) => s + num(d.held), 0)
    return { ...l, accepted: round2(num(l.accepted) + accepted), rejected: round2(num(l.rejected) + rejected), held: round2(num(l.held) + held) }
  })
}

/** A held quantity leaves inspection: accepted, or rejected after all. */
export function releaseHeld(lines: PoLine[], poLineId: string, quantity: number, outcome: "accept" | "reject"): PoLine[] {
  return lines.map((l) => {
    if (l.id !== poLineId) return { ...l }
    const q = Math.min(Math.max(0, num(quantity)), num(l.held))
    return {
      ...l,
      held: round2(num(l.held) - q),
      accepted: outcome === "accept" ? round2(num(l.accepted) + q) : num(l.accepted),
      rejected: outcome === "reject" ? round2(num(l.rejected) + q) : num(l.rejected),
    }
  })
}

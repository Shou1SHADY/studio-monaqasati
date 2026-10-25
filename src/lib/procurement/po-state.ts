// The purchase order in the words of Procurement 2.0 (PRD §8, prototype `poState` / `WHO` / `nextStep` / `poSeg`): ONE state
// per order read off the facts, who it waits on and since when, the segment it sits in, the tags in its header, the versions
// of its life after sending, the piece lines and the delivery site frozen on it. Nothing here is stored but what somebody
// decided; every function takes the clock. Pure: no I/O.
//
// Order of the states (the first that holds wins, as in the prototype): cancelled → not approved → the supplier declined →
// not sent → not accepted → the owner's advance gate → the advance → rejects nobody decided → fully received → an open delivery
// notice (forward · on the way · to count) → part received → an off-platform supplier whose day came → late → waiting.

import { addDays, dayOf, daysFromNow, daysLate, isLumpSum, lineOutstanding, poStatus, poValue, round2, supplierKey } from "./po"
import { advanceNeedsOwner, advanceState, asX, closedByPayment } from "./po-extras"
import { endsOnPayment, type CloseOnFields } from "./close-on"
import { deliveryStep, receiptProgress, type DeliveryStep, type StepNotice } from "./next-step"
import type { PoLine, PoSite, PoVersion, PoVersionKind, ProcActor, ProcurementPolicies, PurchaseOrder } from "./types"

// ---------------------------------------------------------------------------
// Who the order waits on
// ---------------------------------------------------------------------------

export const PO_WHO = ["sup", "us", "rcv", "fin", "app", "inv", "mfg", "none"] as const
export type PoWho = (typeof PO_WHO)[number]

export const PO_STATE_KEYS = ["appr", "ret", "dec", "send", "sent", "nacc", "adv", "rej", "fwd", "transit", "count", "book", "part", "offp", "late", "wait", "unpaid", "done", "cancel"] as const
export type PoStateKey = (typeof PO_STATE_KEYS)[number]

export interface PoStateCtx {
  /** The company's deliveries — the order's notices are read from them. */
  notices: ReadonlyArray<StepNotice>
  financeOn: boolean
  /** The supplier's acceptance window, in days (policy `supplierAcceptanceDays`). */
  acceptanceDays: number
  now: Date
}

export interface PoState {
  k: PoStateKey
  who: PoWho
  /** ISO or `YYYY-MM-DD`: when the order began waiting on its current hands. */
  since: string | null
  /** The delivery step behind the state, when the state is a delivery one. */
  step: DeliveryStep | null
}

const lastLog = (po: Pick<PurchaseOrder, "log">, actions: readonly string[]): string | null => [...(po.log || [])].reverse().find((e) => actions.includes(e.action))?.at ?? null

/** Whole days between a moment and today (never negative). */
export const daysSince = (iso: string | null | undefined, now: Date): number => {
  const d = daysFromNow(dayOf(iso), now)
  return d == null ? 0 : Math.max(0, -d)
}

export function poState(po: PurchaseOrder, ctx: PoStateCtx): PoState {
  const px = asX(po)
  const done = (k: PoStateKey, who: PoWho, since: string | null | undefined, step: DeliveryStep | null = null): PoState => ({ k, who, since: since || null, step })
  if (po.status === "cancelled") return done("cancel", "none", lastLog(po, ["cancelled"]) || po.closedAt)
  if (po.status === "awaiting_approval") {
    const sent = lastLog(po, ["resubmitted"]) || po.createdAt
    // A returned order waits on its preparer, not on the approver.
    return po.returnedReason ? done("ret", "us", lastLog(po, ["returned"]) || sent) : done("appr", "app", sent)
  }
  // The supplier's «اعتذرتُ» keeps the order alive: the next move is the buyer's — re-award or give the items back.
  if (po.supplierDecline && po.status === "sent") return done("dec", "us", po.supplierDecline.at)
  if (po.status === "approved") return done("send", "us", po.approvedAt)
  if (po.status === "sent") return done(daysSince(po.sentAt, ctx.now) > ctx.acceptanceDays ? "nacc" : "sent", "sup", po.sentAt)
  if (po.status === "closed") return done("done", "none", po.closedAt)

  const adv = advanceState(px, ctx.financeOn)
  if (adv === "owner") return done("adv", "app", po.supplierAcceptedAt)
  if (adv === "requested") return done("adv", ctx.financeOn ? "fin" : "us", po.approvedAt)
  if (po.lines.some((l) => Number(l.rejected) > 0 && !l.rejectDecision)) return done("rej", "us", null)
  if (poStatus(po) === "received") return endsOnPayment(po as typeof po & CloseOnFields, ctx.financeOn) && !closedByPayment(px) ? done("unpaid", "fin", null) : done("done", "none", null)

  const step = deliveryStep(po, ctx.notices, ctx.now)
  switch (step?.kind) {
    case "notice_to_forward":
      return done("fwd", "us", step.noticeDay, step)
    case "in_transit":
      return done("transit", "none", step.day, step)
    case "receiver_late":
      return done("count", "rcv", step.noticeDay, step)
    case "counted":
      return done("book", "us", null, step)
    case "part_received":
      return done("part", "sup", null, step)
    case "guest_due":
      return done("offp", "us", step.day, step)
    case "supplier_late":
      return done("late", "sup", po.promisedDate, step)
    default:
      return done("wait", "sup", po.supplierAcceptedAt, step)
  }
}

// ---------------------------------------------------------------------------
// Segments — one definition of «متأخرة» (R-25)
// ---------------------------------------------------------------------------

export type PoSeg = "act" | "wait" | "late" | "done"

/** done · late · needs us · waiting on others — disjoint, and late wins over the two live ones. An order waiting on the approver, or
 * on the owner's advance approval, needs us: both are decisions inside the company. */
export function poSeg(po: PurchaseOrder, ctx: PoStateCtx): PoSeg {
  const s = poState(po, ctx)
  if (s.k === "done" || s.k === "cancel") return "done"
  if (daysLate(po, ctx.now, ctx.notices) > 0) return "late"
  // The supplier asked for a change and nobody answered: the next move is ours, whatever the order waits on (PO-13).
  if (pendingChangeAsk(po)) return "act"
  return s.who === "us" || s.who === "app" ? "act" : "wait"
}

/** The supplier's change request (from his link or his portal) while the buyer has not written back since — the conversation's
 * fields, read loosely here (they live outside `types.ts`, which is mirrored to the mobile app). */
export function pendingChangeAsk(po: PurchaseOrder): { at: string; seq: number; text: string } | null {
  const x = po as PurchaseOrder & { changeAsked?: { at: string; seq: number; text: string } | null; chat?: { usSeq?: number } | null }
  const ask = x.changeAsked
  if (!ask) return null
  return (Number(x.chat?.usSeq) || 0) > (Number(ask.seq) || 0) ? null : ask
}

// ---------------------------------------------------------------------------
// The next step — the structure the drawer and the list render (text lives in the message files)
// ---------------------------------------------------------------------------

export type PoStepButton =
  | "approve"
  | "return"
  | "remind_approver"
  | "resubmit"
  | "send"
  | "sent_outside"
  | "record_acceptance"
  | "remind_supplier"
  | "cancel"
  | "approve_advance"
  | "mark_advance_paid"
  | "remind_finance"
  | "forward"
  | "remind_receiver"
  | "reforward"
  | "book_receipt"
  | "ask_replace"
  | "ask_discount"
  | "return_items"
  | "log_notice"
  | "call"
  | "update_date"
  | "remind_rest"
  | "close_short"

export type PoTone = "info" | "warn" | "bad" | "good"

export interface PoNextStep {
  state: PoState
  tone: PoTone
  params: Record<string, string | number>
  buttons: Array<{ id: PoStepButton; primary?: boolean }>
}

const btn = (id: PoStepButton, primary?: boolean) => ({ id, ...(primary ? { primary: true } : {}) })

/** What the order needs now: the tone, the numbers the sentence names and the buttons in the order they appear. Which of them this
 * person may press is the drawer's question (the write re-asks it). */
export function poNextStep(po: PurchaseOrder, ctx: PoStateCtx): PoNextStep {
  const state = poState(po, ctx)
  const px = asX(po)
  const days = daysSince(state.since, ctx.now)
  const step = state.step
  const p = (params: Record<string, string | number> = {}): Record<string, string | number> => params
  switch (state.k) {
    case "appr":
      return { state, tone: "info", params: p({ days }), buttons: [btn("approve", true), btn("remind_approver")] }
    case "ret":
      return { state, tone: "bad", params: p({ reason: po.returnedReason || "" }), buttons: [btn("resubmit", true), btn("cancel")] }
    case "send":
      return { state, tone: "good", params: p({ days }), buttons: [btn("send", true), btn("sent_outside"), btn("cancel")] }
    case "sent":
      return { state, tone: "info", params: p({ days }), buttons: [btn("record_acceptance"), btn("remind_supplier")] }
    case "nacc":
      return { state, tone: "warn", params: p({ days, window: ctx.acceptanceDays }), buttons: [btn("remind_supplier", true), btn("record_acceptance"), btn("cancel")] }
    case "dec":
      return { state, tone: "bad", params: p({ reason: po.supplierDecline?.reason ?? "other", note: po.supplierDecline?.note || "" }), buttons: [btn("cancel", true)] }
    case "adv":
      if (state.who === "app") return { state, tone: "warn", params: p({ percent: Number(px.advancePercent) || 0 }), buttons: [btn("approve_advance", true)] }
      return { state, tone: "warn", params: p({ percent: Number(px.advancePercent) || 0, days }), buttons: [ctx.financeOn ? btn("remind_finance", true) : btn("mark_advance_paid", true)] }
    case "rej":
      return { state, tone: "bad", params: p(), buttons: [btn("ask_replace", true), btn("ask_discount"), btn("return_items")] }
    case "fwd":
      return { state, tone: "warn", params: p({ date: step?.kind === "notice_to_forward" ? step.noticeDay || "" : "" }), buttons: [btn("forward", true)] }
    case "transit":
      return { state, tone: "info", params: p({ date: step?.kind === "in_transit" ? step.day || "" : "", name: step?.kind === "in_transit" ? step.receiver : "" }), buttons: [] }
    case "count":
      return { state, tone: "warn", params: p({ days: step?.kind === "receiver_late" ? step.days : days, name: step?.kind === "receiver_late" ? step.receiver : "" }), buttons: [btn("remind_receiver", true), btn("reforward")] }
    case "book":
      return { state, tone: "good", params: p({ name: step?.kind === "counted" ? step.receiver : "" }), buttons: [btn("book_receipt", true)] }
    case "part": {
      const r = receiptProgress(po.lines)
      return { state, tone: "info", params: p({ received: r.received, ordered: r.ordered, left: r.left, unit: r.unit }), buttons: [btn("remind_rest", true), btn("close_short")] }
    }
    case "offp":
      return { state, tone: "warn", params: p({ date: po.promisedDate || "" }), buttons: [btn("log_notice", true), btn("call")] }
    case "late":
      return { state, tone: "bad", params: p({ days: daysLate(po, ctx.now, ctx.notices), date: po.promisedDate || "" }), buttons: [btn("remind_supplier", true), btn("update_date")] }
    case "wait":
      return { state, tone: "info", params: p({ date: po.promisedDate || "", accepted: dayOf(po.supplierAcceptedAt) }), buttons: [] }
    case "unpaid":
      return { state, tone: "info", params: p(), buttons: [] }
    case "done":
      return { state, tone: "good", params: p(), buttons: [] }
    case "cancel":
      return { state, tone: "bad", params: p({ reason: po.cancelledReason || "" }), buttons: [] }
  }
}

// ---------------------------------------------------------------------------
// The tags in the header (PO-15): how the order was won, and what it carries
// ---------------------------------------------------------------------------

export type PoTagId = "notLowest" | "lowComp" | "directOver" | "lump" | "noVat"

export interface PoTag {
  id: PoTagId
  /** The structured reason the award recorded; null for an order made before reasons were structured. */
  why: string | null
  /** The old award-reason code, when only that is known — rendered from `awardReason.*`. */
  whyCode: string | null
  n?: number
  of?: number
}

/** The tags, in the order the header shows them. Stored tags win; an order made before them is read off its award facts. */
export function poTags(po: PurchaseOrder, policies: Pick<ProcurementPolicies, "directPurchaseCap" | "minOffers">): PoTag[] {
  const out: PoTag[] = []
  const stored = po.tags || null
  const lowestKnown = po.lowestOfferTotal != null && Number(po.totalExVat) > Number(po.lowestOfferTotal)
  if (stored?.notLowest) out.push({ id: "notLowest", why: stored.notLowest.why || null, whyCode: null })
  else if (po.basis === "rfq" && lowestKnown) out.push({ id: "notLowest", why: po.awardReasonText?.trim() || null, whyCode: po.awardReasonCode ?? null })
  if (stored?.lowComp) out.push({ id: "lowComp", why: stored.lowComp.why || null, whyCode: null, n: stored.lowComp.n, of: policies.minOffers })
  else if (po.shortCompetition) out.push({ id: "lowComp", why: null, whyCode: null, n: po.offersCount, of: policies.minOffers })
  if (stored?.directOver) out.push({ id: "directOver", why: stored.directOver.why || null, whyCode: null })
  else if (po.basis === "direct" && !po.agreementId && !po.rfqId && poValue(po) > policies.directPurchaseCap) out.push({ id: "directOver", why: po.awardReasonText?.trim() || null, whyCode: null })
  if (isLumpSum(po) && po.lines.length > 0) out.push({ id: "lump", why: null, whyCode: null })
  if (po.noVat === true || (po.vatRate !== undefined && Number(po.vatRate) === 0)) out.push({ id: "noVat", why: null, whyCode: null })
  return out
}

// ---------------------------------------------------------------------------
// Versions (PO-15) — cancel · a new date · closing short each make one, with an event; the supplier accepts it
// ---------------------------------------------------------------------------

/** Log entries that made a version before versions were stored: a new date, a cancelled remainder, a reduce decision, a short close, a cancel. */
export function derivedVersionEntries(po: Pick<PurchaseOrder, "log">): Array<{ at: string; kind: PoVersionKind; byName: string; note: string | null }> {
  const out: Array<{ at: string; kind: PoVersionKind; byName: string; note: string | null }> = []
  for (const e of po.log || []) {
    if (e.action === "date_updated") out.push({ at: e.at, kind: "date", byName: e.byName, note: e.note ?? null })
    else if (e.action === "remainder_cancelled" || (e.action === "reject_decided" && e.params?.decision === "reduce")) out.push({ at: e.at, kind: "close_short", byName: e.byName, note: e.note ?? null })
    else if (e.action === "closed" && e.params?.short) out.push({ at: e.at, kind: "close_short", byName: e.byName, note: e.note ?? null })
    else if (e.action === "cancelled") out.push({ at: e.at, kind: "cancel", byName: e.byName, note: e.note ?? null })
  }
  return out
}

/** The version the supplier is looking at: the stored one, never lower than what the log says. */
export function poVer(po: Pick<PurchaseOrder, "ver" | "log">): number {
  return Math.max(Number(po.ver) || 1, 1 + derivedVersionEntries(po).length)
}

/** The versions as a list — stored, or rebuilt from the log for an order made before they were stored. */
export function poVersions(po: Pick<PurchaseOrder, "versions" | "ver" | "log" | "createdAt" | "preparedByName" | "sentAt" | "sentByName">): PoVersion[] {
  if (po.versions?.length) return po.versions
  const first: PoVersion = { n: 1, at: po.sentAt || po.createdAt, byName: po.sentByName || po.preparedByName, kind: "sent" }
  return [first, ...derivedVersionEntries(po).map((v, i) => ({ n: i + 2, ...v }))]
}

/** The patch that opens the next version. Pure: the route stores it in the transaction that makes the change itself. */
export function nextVersionPatch(po: Pick<PurchaseOrder, "versions" | "ver" | "log" | "createdAt" | "preparedByName" | "sentAt" | "sentByName">, kind: PoVersionKind, by: { uid: string; name: string }, at: string, extra: { note?: string | null; params?: Record<string, string | number> | null } = {}): { ver: number; versions: PoVersion[]; created: PoVersion } {
  const prior = poVersions(po)
  const n = Math.max(poVer(po), prior.length) + 1
  const created: PoVersion = { n, at, byId: by.uid, byName: by.name, kind, note: extra.note ?? null, params: extra.params ?? null }
  return { ver: n, versions: [...prior, created], created }
}

/** Versions that change what the supplier committed to — he accepts them. A cancel needs only to be read. */
export const versionNeedsAcceptance = (v: Pick<PoVersion, "kind">): boolean => v.kind === "date" || v.kind === "close_short"

/** The latest version the supplier has not accepted yet, once the order has reached him. */
export function pendingVersion(po: Pick<PurchaseOrder, "versions" | "ver" | "log" | "createdAt" | "preparedByName" | "sentAt" | "sentByName" | "status">): PoVersion | null {
  if (!po.sentAt || po.status === "cancelled") return null
  const open = poVersions(po).filter((v) => v.n > 1 && versionNeedsAcceptance(v) && !v.acceptedAt)
  return open.length ? open[open.length - 1] : null
}

// ---------------------------------------------------------------------------
// The advance to a supplier with no supply record (PO-14)
// ---------------------------------------------------------------------------

/** The supplier has delivered to this company before: an accepted or closed order of his, other than this one. A guest is known by his name. */
export function supplierHasRecord(po: PurchaseOrder, others: ReadonlyArray<PurchaseOrder>): boolean {
  const key = supplierKey(po)
  return others.some((x) => x.id !== po.id && supplierKey(x) === key && x.status !== "cancelled" && Boolean(x.supplierAcceptedAt))
}

export function advanceOwnerRequired(po: PurchaseOrder, policies: Pick<ProcurementPolicies, "advanceUnknownSupplierOwner">, hasRecord: boolean): boolean {
  return policies.advanceUnknownSupplierOwner && (Number(asX(po).advancePercent) || 0) > 0 && !hasRecord
}

/** Orders whose advance waits for the owner — what Today lists for him (the item is built by the Today module from this). */
export function advanceOwnerWaiting(orders: ReadonlyArray<PurchaseOrder>, actor: Pick<ProcActor, "isOwner">): PurchaseOrder[] {
  return actor.isOwner ? orders.filter((po) => po.status !== "cancelled" && po.status !== "closed" && advanceNeedsOwner(po) && Boolean(po.approvedAt)) : []
}

// ---------------------------------------------------------------------------
// Piece lines (PO-06) and the delivery site (G-05)
// ---------------------------------------------------------------------------

export interface PieceView {
  pieces: number
  /** The pack's name in the viewer's language: «قطعة 6 م» / «6 m bar». */
  unit: string
  /** pieces × pack length, in the request unit. */
  total: number
  base: string
  need: number | null
  /** total − need: the surplus you pay for. */
  extra: number
  packLen: number
}

export function pieceView(line: PoLine, locale: "ar" | "en"): PieceView | null {
  const packLen = Number(line.pk)
  if (!(packLen > 0)) return null
  const pieces = Math.max(0, round2((Number(line.quantity) || 0) - (Number(line.cancelled) || 0)))
  const total = round2(pieces * packLen)
  const need = Number(line.need) > 0 ? Number(line.need) : null
  const unit = (locale === "en" ? line.packName?.en : line.packName?.ar) || line.unit
  return { pieces, unit, total, base: line.base || "", need, extra: need == null ? 0 : round2(Math.max(0, total - need)), packLen }
}

/** The unit a line is told in: a piece line's pack name in the viewer's language, otherwise the unit as stored. */
export const lineUnitName = (line: PoLine, locale: "ar" | "en"): string => (Number(line.pk) > 0 ? (locale === "en" ? line.packName?.en : line.packName?.ar) || line.unit : line.unit)

/** One order per supplier × delivery site: the key two award groups share only when both are the same. */
export const orderSiteKey = (supplier: string, siteId: string | null | undefined): string => `${supplier}|${siteId || "-"}`

/** The site as the order carries it; an order made before the snapshot reads its location text. */
export function poSiteOf(po: Pick<PurchaseOrder, "site" | "deliveryLocation" | "deliveryDistrict">): PoSite | null {
  if (po.site) return po.site
  const name = (po.deliveryLocation || "").trim()
  return name ? { id: null, name, district: po.deliveryDistrict || null } : null
}

/** What the supplier commits to by accepting: his lead time counted from the end of the acceptance window. */
export function poDueDate(approvedDay: string, acceptanceDays: number, leadDays: number | null | undefined): string | null {
  return leadDays != null && leadDays >= 0 ? addDays(approvedDay, Math.max(0, acceptanceDays) + leadDays) : null
}

/** The order's open outstanding quantity — whether anything is still owed (a version asks for it). */
export const anythingOwed = (po: PurchaseOrder): boolean => po.lines.some((l) => lineOutstanding(l) > 0)

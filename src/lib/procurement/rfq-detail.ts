// One RFQ's page (PRD 3.0 §7.2 tab 3, the prototype's `dRfq`): its stored
// decisions beyond the award — an early close, a cancellation, the activity
// log — and what the page derives from them: who was invited and who offered,
// how many supplier queries still wait for an answer. Pure: no I/O.
//
// The stored status stays Draft · New · Awarded, plus "Cancelled" for an RFQ
// withdrawn before any award (its lines return to the needs). An early close
// is NOT a status: the deadline moves to yesterday and `closedEarly` records
// who did it and why, so every existing reader of the deadline (the list, the
// supplier's page, the guest link) already treats the round as closed.

import { addDays, todayOf } from "./po"
import type { ProcActor } from "./types"

export const RFQ_CANCELLED = "Cancelled"

export const RFQ_CANCEL_CODES = ["need", "spec", "reissue"] as const
export type RfqCancelCode = (typeof RFQ_CANCEL_CODES)[number]
export const isRfqCancelCode = (v: unknown): v is RfqCancelCode => typeof v === "string" && (RFQ_CANCEL_CODES as readonly string[]).includes(v)

export interface RfqCancellation {
  code: RfqCancelCode
  byId: string
  byName: string
  at: string
}

export interface RfqEarlyClose {
  at: string
  byId: string
  byName: string
  reason: string
  /** The deadline as published, before the close moved it. */
  originalDeadline: string | null
}

export const RFQ_LOG_ACTIONS = ["awarded", "closed_early", "cancelled", "offer_excluded", "query_answered", "reduction_round", "offer_recorded", "guest_registered", "extended"] as const
export type RfqLogAction = (typeof RFQ_LOG_ACTIONS)[number]

export interface RfqLogEntry {
  at: string
  byId: string
  byName: string
  action: RfqLogAction
  note?: string | null
  params?: Record<string, string | number> | null
}

export function rfqLogEntry(actor: Pick<ProcActor, "uid" | "name">, action: RfqLogAction, at: string, extra?: { note?: string | null; params?: RfqLogEntry["params"] }): RfqLogEntry {
  return { at, byId: actor.uid, byName: actor.name, action, note: extra?.note ?? null, params: extra?.params ?? null }
}

/** Newest first, whatever order the array was appended in. */
export function rfqLog(entries: RfqLogEntry[] | null | undefined): RfqLogEntry[] {
  return [...(entries || [])].filter((e) => e && e.action).sort((a, b) => (b.at || "").localeCompare(a.at || ""))
}

// ---------------------------------------------------------------------------
// Who may do what on the page
// ---------------------------------------------------------------------------

/** «أغلِق الآن وافتح الأسعار» is the manager's: po.approve or the owner. */
export const canCloseEarly = (actor: Pick<ProcActor, "isOwner" | "canApprove">): boolean => actor.isOwner || actor.canApprove

/** Cancelling, excluding, answering: whoever runs the RFQ (offers.accept) or the owner. */
export const canRunRfq = (actor: Pick<ProcActor, "isOwner" | "canPrepare">): boolean => actor.isOwner || actor.canPrepare

export interface RfqStateLike {
  status?: string | null
  deadline?: string | null
  closedEarly?: RfqEarlyClose | null
}

/** Still taking offers: published, not awarded or cancelled, deadline today or later. */
export function rfqTakingOffers(rfq: RfqStateLike | null | undefined, now: Date): boolean {
  if (!rfq || rfq.status !== "New" || rfq.closedEarly) return false
  const day = (rfq.deadline || "").slice(0, 10)
  return !day || todayOf(now) <= day
}

export const canCancelRfq = (rfq: RfqStateLike | null | undefined): boolean => rfq?.status === "New" || rfq?.status === "Draft"

/** What an early close writes on the RFQ — refused without a reason or on a
 * round that is no longer open. */
export function earlyCloseFields(rfq: RfqStateLike, actor: Pick<ProcActor, "uid" | "name">, reason: string, now: Date): { deadline: string; closedEarly: RfqEarlyClose } | null {
  const why = reason.trim()
  if (!why || !rfqTakingOffers(rfq, now)) return null
  const at = now.toISOString()
  return {
    deadline: addDays(todayOf(now), -1),
    closedEarly: { at, byId: actor.uid, byName: actor.name, reason: why, originalDeadline: (rfq.deadline || "").slice(0, 10) || null },
  }
}

// ---------------------------------------------------------------------------
// Invited suppliers and queries
// ---------------------------------------------------------------------------

export interface InviteOfferLike {
  supplierId?: string | null
  organizationId?: string | null
  supplierOrgId?: string | null
  isGuestOffer?: boolean | null
}

export interface InvitedRow {
  orgId: string
  offered: boolean
}

/** The private list, each marked «قدّم عرضاً» / «لم يقدّم بعد». A public RFQ has
 * no list — whoever offered is the list, shown with the offers. */
export function invitedRows(rfq: { allowedSupplierOrgIds?: string[] | null; invitedSupplierOrgIds?: string[] | null }, offers: InviteOfferLike[]): InvitedRow[] {
  const ids = [...new Set([...(rfq.allowedSupplierOrgIds || []), ...(rfq.invitedSupplierOrgIds || [])].filter(Boolean))]
  const offered = new Set<string>()
  for (const o of offers) {
    if (o.isGuestOffer) continue
    for (const id of [o.organizationId, o.supplierOrgId, o.supplierId]) if (id) offered.add(id)
  }
  return ids.map((orgId) => ({ orgId, offered: offered.has(orgId) })).sort((a, b) => Number(b.offered) - Number(a.offered))
}

export interface InquiryLike {
  reply?: string | null
  userId?: string | null
  organizationId?: string | null
}

export const unansweredCount = (inquiries: InquiryLike[] | null | undefined): number => (inquiries || []).filter((q) => !(q.reply || "").trim()).length

/**
 * Who hears an answer (§5.1: «الجواب يصل كل المدعوّين — لا أفضلية بمعلومة لمورد
 * دون غيره»): the invited companies, every registered supplier who offered, and
 * the one who asked — each once. A company's owner uid IS its org id, so an org
 * id addresses its owner's inbox. Guests have no inbox.
 */
export function answerRecipients(rfq: { allowedSupplierOrgIds?: string[] | null; invitedSupplierOrgIds?: string[] | null }, offers: InviteOfferLike[], asker: InquiryLike | null, selfUid: string): string[] {
  const out = new Set<string>()
  for (const id of rfq.allowedSupplierOrgIds || []) out.add(id)
  for (const id of rfq.invitedSupplierOrgIds || []) out.add(id)
  for (const o of offers) {
    if (o.isGuestOffer || !o.supplierId || o.supplierId === "guest" || o.supplierId === "mdmak-system") continue
    out.add(o.supplierId)
  }
  if (asker?.userId) out.add(asker.userId)
  out.delete(selfUid)
  out.delete("guest")
  out.delete("")
  return [...out]
}

// ---------------------------------------------------------------------------
// The reduction round (R-11): every live offer at once, once per RFQ
// ---------------------------------------------------------------------------

export interface ReductionRound {
  at: string
  byId: string
  byName: string
  /** Optional target per line — our last price as a reference, never a competitor's. */
  targets: Array<{ rfqProductIndex: number; unitPrice: number }>
  offers: number
}

export function canAskReductionRound(rfq: (RfqStateLike & { reductionRound?: ReductionRound | null }) | null | undefined, liveOffers: number, sealed: boolean): boolean {
  return Boolean(rfq && rfq.status === "New" && !rfq.reductionRound && !sealed && liveOffers > 0)
}

/** Only positive figures are targets; a blank line asks for a plain "best and final". */
export function reductionTargets(typed: Record<number, string | number | null | undefined>): ReductionRound["targets"] {
  return Object.entries(typed)
    .map(([k, v]) => ({ rfqProductIndex: Number(k), unitPrice: Math.round(Number(String(v ?? "").replace(/[,\s]/g, "")) * 100) / 100 }))
    .filter((t) => Number.isInteger(t.rfqProductIndex) && t.rfqProductIndex >= 0 && Number.isFinite(t.unitPrice) && t.unitPrice > 0)
    .sort((a, b) => a.rfqProductIndex - b.rfqProductIndex)
}

export interface PriceTrailOffer {
  price?: string | number | null
  priceHistory?: Array<{ price?: string | number | null; replacedAt?: string | null }> | null
}

/** «خُفّض من …»: the prices an offer stood at before its current one, oldest first. */
export function priceTrail(offer: PriceTrailOffer): number[] {
  return (offer.priceHistory || [])
    .slice()
    .sort((a, b) => (a.replacedAt || "").localeCompare(b.replacedAt || ""))
    .map((h) => Number(String(h.price ?? "").replace(/[,\s]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0)
}

// ---------------------------------------------------------------------------
// An offer that arrived off the platform (R-09) — keyed in by the buyer
// ---------------------------------------------------------------------------

export interface ManualOfferInput {
  rfq: { id: string; title?: string | null; organizationId?: string | null; contractorId?: string | null; projectId?: string | null }
  /** A registered invitee (his org id and name) — or an off-platform company by name. */
  supplier: { orgId: string; name: string } | { orgId: null; name: string }
  /** Per-line rates as typed; blank = not priced (never invented). */
  rates: Array<{ rfqProductIndex: number; unitPrice: number }> | null
  /** The whole request's total — total pricing only. */
  total: number | null
  leadDays: number | null
  validUntil: string | null
  priceBasis: "site" | "exw"
  creditDays: number | null
  advancePercent: number | null
  proofUrl: string | null
  /** The round was still sealed when it was keyed in — he saw the price by typing it. */
  early: boolean
}

export type ManualOfferRefusal = "supplier_missing" | "price_missing" | "basis_missing"

export function manualOfferRefusal(input: Pick<ManualOfferInput, "supplier" | "rates" | "total" | "priceBasis">): ManualOfferRefusal | null {
  if (!input.supplier.name.trim()) return "supplier_missing"
  if (input.priceBasis !== "site" && input.priceBasis !== "exw") return "basis_missing"
  const priced = input.rates ? input.rates.some((r) => r.unitPrice > 0) : (input.total ?? 0) > 0
  return priced ? null : "price_missing"
}

/** The offer document as the buyer keys it — the same fields a supplier's own
 * offer carries, plus who recorded it (`isManualOffer`, `recordedBy*`). An
 * off-platform company is a guest: its order goes by WhatsApp or e-mail. */
export function manualOfferDoc(input: ManualOfferInput, products: Array<{ rfqProductIndex: number; quantity: number }>, actor: Pick<ProcActor, "uid" | "name">, at: string): Record<string, unknown> {
  const rates = (input.rates || []).filter((r) => r.unitPrice > 0)
  const qty = new Map(products.map((p) => [p.rfqProductIndex, p.quantity]))
  const total = input.rates ? Math.round(rates.reduce((s, r) => s + r.unitPrice * (qty.get(r.rfqProductIndex) || 0), 0) * 100) / 100 : Math.round((input.total || 0) * 100) / 100
  const guest = input.supplier.orgId == null
  return {
    supplierId: guest ? "guest" : input.supplier.orgId,
    organizationId: guest ? "guest" : input.supplier.orgId,
    supplierOrgId: guest ? null : input.supplier.orgId,
    supplierName: input.supplier.name.trim(),
    companyName: input.supplier.name.trim(),
    isGuestOffer: guest,
    isManualOffer: true,
    recordedById: actor.uid,
    recordedByName: actor.name,
    recordedEarly: input.early,
    manualProofUrl: input.proofUrl,
    rfqId: input.rfq.id,
    rfqTitle: input.rfq.title || "",
    projectId: input.rfq.projectId || null,
    contractorId: input.rfq.contractorId || null,
    contractorOrgId: input.rfq.organizationId || input.rfq.contractorId || null,
    price: String(total),
    ...(input.rates ? { lines: rates } : {}),
    ...(input.leadDays ? { executionDuration: String(input.leadDays), executionDurationUnit: "أيام" } : {}),
    validUntil: input.validUntil || null,
    priceBasis: input.priceBasis,
    creditDays: input.creditDays,
    advancePercent: input.advancePercent,
    status: "قيد المراجعة",
    createdAt: at,
  }
}

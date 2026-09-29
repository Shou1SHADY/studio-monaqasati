// Purchase-order write flows (PRD 3.0 §5.1 steps 5–9, §5.2 step 8) — where a
// decision becomes a document. Every state change is ONE transaction that
// re-reads the order, re-runs the domain rule (`./po`), appends a `PoLogEntry`
// and writes — so two buyers acting on the same order at once cannot both
// win, and a screen that was stale simply gets refused. Notifications ride
// AFTER the write, best-effort (`./events`).
//
// Nothing here stores what is derived: delivery progress, lateness, blocks,
// the approver — those come from `./po` on every read. What is stored is what
// somebody decided, with their name and the time.

import { addDoc, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, type DocumentReference, type Firestore, type Transaction } from "firebase/firestore"
import { loadTeam, resolveRecipients, type Translator } from "../mfg-events"
import { emitProcEvent, procLinks, sarText } from "./events"
import { approvalGateBlocks, gateItemIds, noticeReachesReceiver } from "./policy-enforce"
import { poActs, type BoqGateItem, type PurchaseOrderX } from "./po-extras"
import { drawProcDocNumber, drawProcDocNumbers } from "./numbering"
import { rfqLogEntry, type RfqLogEntry } from "./rfq-detail"
import { PRICE_HISTORY, historyRowsForApproval, materialKey } from "./prices"
import { pricedProducts, quotedRatesReconcile } from "./offer-pricing"
import {
  acceptedValue,
  applyReceiptToLines,
  approvalRefusal,
  canCancelRemainder,
  canClose,
  canRate,
  canRecordAcceptance,
  canSend,
  canUpdateDate,
  reminderCooldownUntil,
  closeIsShort,
  isShortCompetition,
  lineToArrive,
  lowestOffer,
  offerPrice,
  poBlocks,
  poFacts,
  poValue,
  releaseHeld as releaseHeldLines,
  requiredApprover,
  round2,
  type BlockContext,
} from "./po"
import { orderTermsOf } from "./offer-terms"
import {
  PURCHASE_ORDERS,
  type AwardReasonCode,
  type DeliveryLine,
  type PoLine,
  type PoLogEntry,
  type PoRating,
  type PoSendChannel,
  type ProcActor,
  type ProcurementPolicies,
  type PurchaseOrder,
  type ReceiptFact,
  type RejectDecision,
} from "./types"

const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Errors — a closed vocabulary the screens translate (`Procurement.err_*`)
// ---------------------------------------------------------------------------

export type ProcWriteErrorCode =
  | "order_missing"
  | "offer_missing"
  | "no_permission"
  | "wrong_state"
  | "own_order"
  | "owner_only"
  | "above_limit"
  | "blocked"
  | "reason_required"
  | "date_invalid"
  | "line_missing"
  | "nothing_outstanding"
  | "nothing_rejected"
  | "nothing_held"
  | "cannot_rate"
  | "already_cancelled"
  | "has_receipts"
  | "reminded_recently"
  // A price agreement (agreement-writes.ts).
  | "supplier_missing"
  | "no_lines"
  // The receiver register (receiver-writes.ts).
  | "bad_receiver"
  // An order without an RFQ (direct-writes.ts).
  | "order_no_lines"
  | "order_supplier_missing"
  | "price_missing"
  | "over_direct_cap"
  | "agreement_not_live"
  | "agreement_line_missing"
  | "delivery_date_missing"
  // A decision on a project need (need-decision-writes.ts).
  | "need_decided"
  | "need_not_waiting"
  // Regularising a receipt with no order (receipt-writes.ts).
  | "not_no_po"
  | "no_matching_order"
  // An RFQ's own acts (the split award here, rfq-writes.ts).
  | "rfq_missing"
  | "rfq_not_open"
  | "nothing_picked"
  | "breakdown_mismatch"
  | "offer_taken"
  // Projects' gates, re-run at approval (R-25).
  | "pm_budget_pending"
  | "sample_pending"
  // Who acts on an order (R-26): the owner reads others' orders; a buyer acts on his own.
  | "owner_read_only"
  | "not_your_order"
  | "not_your_rfq"
  | "guest_unregistered"
  | "nothing_to_refer"

export class ProcWriteError extends Error {
  constructor(
    readonly code: ProcWriteErrorCode,
    readonly params: Record<string, string | number> = {}
  ) {
    super(code)
    this.name = "ProcWriteError"
  }
}

/** Options every flow accepts: the sender's translator and company name for
 * the notification text, and a clock for tests. */
export interface WriteOpts {
  copy?: Translator | null
  locale?: "ar" | "en"
  /** The buying company's name, as the supplier reads it. */
  orgName?: string | null
  now?: Date
}

const entry = (actor: Pick<ProcActor, "uid" | "name">, action: PoLogEntry["action"], at: string, extra?: { note?: string | null; params?: PoLogEntry["params"] }): PoLogEntry => ({
  at,
  byId: actor.uid,
  byName: actor.name,
  action,
  note: extra?.note ?? null,
  params: extra?.params ?? null,
})

/** R-26: the owner reads somebody else's order (he approves and returns it, nothing
 * more); a buyer acts on the orders he prepared. Everyone else as their permissions say. */
export function assertActs(po: Pick<PurchaseOrder, "preparedById">, actor: ProcActor): void {
  const a = poActs(po, actor)
  if (a.ownerReadOnly) throw new ProcWriteError("owner_read_only")
  if (a.notMine) throw new ProcWriteError("not_your_order")
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const assertDay = (d: string) => {
  if (!DAY.test(d)) throw new ProcWriteError("date_invalid")
}
const requireText = (s: string | null | undefined): string => {
  const t = (s || "").trim()
  if (!t) throw new ProcWriteError("reason_required")
  return t
}

const orderRef = (firestore: Firestore, poId: string) => doc(firestore, PURCHASE_ORDERS, poId) as DocumentReference

/** Read → check → patch → append log, in one transaction; returns the order as written. */
async function transition(
  firestore: Firestore,
  poId: string,
  apply: (po: PurchaseOrder) => { patch: Partial<PurchaseOrder>; log: PoLogEntry }
): Promise<PurchaseOrder> {
  const ref = orderRef(firestore, poId)
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ProcWriteError("order_missing")
    const po = { ...(snap.data() as Omit<PurchaseOrder, "id">), id: snap.id } as PurchaseOrder
    const { patch, log } = apply(po)
    const next: PurchaseOrder = { ...po, ...patch, log: [...(po.log || []), log] }
    tx.update(ref, { ...patch, log: next.log, updatedAt: serverTimestamp() })
    return next
  })
}

// ---------------------------------------------------------------------------
// Lines from the award — pure, tested
// ---------------------------------------------------------------------------

/** The RFQ as the award knows it. */
export interface RfqLike {
  id: string
  title?: string | null
  organizationId?: string | null
  contractorId?: string | null
  projectId?: string | null
  projectName?: string | null
  category?: string | null
  city?: string | null
  directAward?: boolean | null
  products?: Array<{ name?: string | null; quantity?: number | string | null; unitOfMeasure?: string | null; unit?: string | null; boqItemId?: string | null }> | null
  purchaseSource?: { kind: string; workOrderId?: string; purchaseRequestId?: string } | null
}

/** The offer as stored (`price` is a string, excluding VAT). Per-line prices
 * exist only when a writer set `lines[]`; today's web offers carry none. */
export interface AwardOfferLike {
  id: string
  price?: string | number | null
  totalBatchesPrice?: number | null
  status?: string | null
  supplierId?: string | null
  organizationId?: string | null
  supplierOrgId?: string | null
  supplierName?: string | null
  companyName?: string | null
  isGuestOffer?: boolean | null
  guestContact?: { name?: string | null } | null
  directAward?: boolean | null
  offerPdfUrl?: string | null
  deliveryLocation?: string | null
  paymentTerms?: string | null
  executionDuration?: string | number | null
  executionDurationUnit?: string | null
  lines?: Array<{ rfqProductIndex?: number | null; unitPrice?: number | string | null }> | null
  poId?: string | null
  poNumber?: string | null
  /** The offer's commercial terms (offer-terms.ts) — carried onto the order. */
  advancePercent?: number | string | null
  creditDays?: number | string | null
  priceBasis?: string | null
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** The offer's total EXCLUDING VAT: a multi-shipment offer sums its batches. */
export function offerTotalExVat(offer: Pick<AwardOfferLike, "price" | "totalBatchesPrice">): number {
  if (offer.totalBatchesPrice != null && Number.isFinite(Number(offer.totalBatchesPrice))) return round2(Number(offer.totalBatchesPrice))
  return round2(offerPrice(offer) ?? 0)
}

/** Lead time in days from "3 أسابيع"-style offer fields; null when unsaid. */
export function offerLeadTimeDays(offer: Pick<AwardOfferLike, "executionDuration" | "executionDurationUnit">): number | null {
  const n = parseInt(String(offer.executionDuration ?? ""), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const u = offer.executionDurationUnit || ""
  return n * (u === "أشهر" ? 30 : u === "أسابيع" ? 7 : 1)
}

/**
 * Lines from the RFQ's products, in order (`l1`, `l2`, …). A unit price is
 * set only when the offer priced that line; a lump-sum offer leaves every
 * line's price null and the order's `totalExVat` carries the figure. An RFQ
 * with no products (legacy) becomes one line of quantity 1 at the total —
 * a lot priced as a lot, not a number invented per unit.
 */
export function buildPoLines(rfq: Pick<RfqLike, "products" | "title">, offer: Pick<AwardOfferLike, "lines" | "price" | "totalBatchesPrice">): PoLine[] {
  const products = (rfq.products || []).filter((p) => p && (p.name || "").trim())
  if (!products.length) {
    return [{ id: "l1", name: (rfq.title || "").trim() || "—", unit: "", quantity: 1, unitPrice: offerTotalExVat(offer), accepted: 0, rejected: 0, held: 0, cancelled: 0, boqItemId: null, rfqProductIndex: null }]
  }
  const priced = new Map<number, number>()
  for (const l of offer.lines || []) {
    const p = l.unitPrice == null || l.unitPrice === "" ? null : num(l.unitPrice)
    if (l.rfqProductIndex != null && p != null && p >= 0) priced.set(l.rfqProductIndex, p)
  }
  // Rates that no longer add up to the offer (a total revised on its own) stay
  // off the order: it keeps the offer's real total lump-sum instead of putting
  // the pre-reduction figure in front of Finance and into price history.
  const every = products.every((_, i) => priced.has(i)) && quotedRatesReconcile(pricedProducts(rfq), offer)
  return products.map((p, i) => ({
    id: `l${i + 1}`,
    name: (p.name || "").trim(),
    unit: (p.unitOfMeasure || p.unit || "").trim(),
    quantity: Math.max(0, num(p.quantity)),
    unitPrice: every ? (priced.get(i) as number) : null,
    accepted: 0,
    rejected: 0,
    held: 0,
    cancelled: 0,
    boqItemId: p.boqItemId ?? null,
    rfqProductIndex: i,
  }))
}

/** The supplier as the award knew him; a guest has no org and no user. */
export function supplierOfOffer(offer: Pick<AwardOfferLike, "isGuestOffer" | "supplierId" | "organizationId" | "supplierOrgId" | "supplierName" | "companyName" | "guestContact">): Pick<PurchaseOrder, "supplierOrgId" | "supplierUserId" | "supplierName" | "isGuestSupplier"> {
  const name = (offer.companyName || offer.supplierName || offer.guestContact?.name || "").trim()
  if (offer.isGuestOffer || offer.supplierId === "guest") return { supplierOrgId: "guest", supplierUserId: null, supplierName: name, isGuestSupplier: true }
  const uid = offer.supplierId && offer.supplierId !== "mdmak-system" ? offer.supplierId : null
  return { supplierOrgId: offer.supplierOrgId || offer.organizationId || uid || "guest", supplierUserId: uid, supplierName: name, isGuestSupplier: false }
}

export interface CreateFromAwardInput {
  rfq: RfqLike
  offer: AwardOfferLike
  /** Every offer on the RFQ, for "lowest" and "short competition". */
  offers: AwardOfferLike[]
  awardReason?: { code: AwardReasonCode; text?: string | null } | null
  policies: ProcurementPolicies
}

/** The document, before its number — pure so the screens can preview it. */
export function draftPurchaseOrder(actor: ProcActor, input: CreateFromAwardInput, now = new Date()): Omit<PurchaseOrder, "id" | "docNumber"> {
  const { rfq, offer, offers, policies } = input
  const lines = buildPoLines(rfq, offer)
  const totalExVat = offerTotalExVat(offer)
  const lowest = lowestOffer(offers)
  const base: Omit<PurchaseOrder, "id" | "docNumber" | "approverKind"> = {
    organizationId: rfq.organizationId || rfq.contractorId || "",
    status: "awaiting_approval",
    basis: rfq.directAward || offer.directAward ? "direct" : "rfq",
    rfqId: rfq.id,
    rfqTitle: (rfq.title || "").trim(),
    offerId: offer.id,
    projectId: rfq.projectId ?? null,
    projectName: rfq.projectName ?? null,
    category: rfq.category ?? null,
    purchaseSource: rfq.purchaseSource ?? null,
    ...supplierOfOffer(offer),
    ...orderTermsOf(offer),
    lines,
    totalExVat,
    vatRate: 0.15,
    paymentTerms: offer.paymentTerms ?? null,
    deliveryLocation: offer.deliveryLocation || rfq.city || null,
    leadTimeDays: offerLeadTimeDays(offer),
    offersCount: offers.length,
    lowestOfferTotal: lowest ? offerPrice(lowest) : null,
    awardReasonCode: input.awardReason?.code ?? null,
    awardReasonText: input.awardReason?.text?.trim() || null,
    shortCompetition: isShortCompetition(totalExVat, offers.length, policies),
    noOfficialQuote: !offer.offerPdfUrl,
    preparedById: actor.uid,
    preparedByName: actor.name,
    createdAt: now.toISOString(),
    approvedById: null,
    approvedByName: null,
    approvedAt: null,
    returnedReason: null,
    sentAt: null,
    sentChannel: null,
    supplierAcceptedAt: null,
    promisedDate: null,
    acceptanceRecordedBy: null,
    rating: null,
    log: [],
  }
  const routed = { ...base, id: "", docNumber: "", approverKind: "manager" as const }
  return { ...base, approverKind: requiredApprover(routed, policies, actor.isOwner || actor.canApprove) }
}

/**
 * The award's second half: a purchase order laid over the accepted offer. The
 * offer stays the award (its status, the RFQ's "Awarded" and the supplier's
 * bell are untouched); the order gets the number, the routing and the log.
 * Idempotent: an offer that already names its order returns it.
 */
export async function createPurchaseOrderFromAward(
  firestore: Firestore,
  actor: ProcActor,
  input: CreateFromAwardInput,
  opts: WriteOpts = {}
): Promise<{ id: string; docNumber: string; created: boolean }> {
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  if (input.offer.poId) return { id: input.offer.poId, docNumber: input.offer.poNumber || "", created: false }
  const now = opts.now ?? new Date()
  const draft = draftPurchaseOrder(actor, input, now)
  const at = now.toISOString()
  const offerRef = doc(firestore, "offers", input.offer.id)
  const poRef = doc(collection(firestore, PURCHASE_ORDERS))
  const result = await runTransaction(firestore, async (tx) => {
    const offerSnap = await tx.get(offerRef)
    if (!offerSnap.exists()) throw new ProcWriteError("offer_missing")
    const existing = offerSnap.data().poId as string | undefined
    if (existing) return { id: existing, docNumber: (offerSnap.data().poNumber as string) || "", created: false }
    const docNumber = await drawProcDocNumber(firestore, tx, draft.organizationId, "PO", now.getUTCFullYear())
    const po = { ...draft, docNumber, log: [entry(actor, "created", at, { params: { basis: draft.basis, number: docNumber } })], updatedAt: serverTimestamp() }
    tx.set(poRef, po)
    tx.update(offerRef, { poId: poRef.id, poNumber: docNumber, updatedAt: serverTimestamp() })
    return { id: poRef.id, docNumber, created: true }
  })
  if (result.created) {
    await emitProcEvent(firestore, actor, {
      kind: "po_awaiting_approval",
      organizationId: draft.organizationId,
      to: [draft.approverKind === "owner" ? { owner: true } : { permission: "po.approve" }],
      params: { number: result.docNumber, supplier: draft.supplierName, amount: sarText(poValue({ ...draft, id: result.id, docNumber: result.docNumber }), opts.locale), rfq: draft.rfqTitle },
      poId: result.id,
      rfqId: draft.rfqId,
      offerId: draft.offerId,
      copy: opts.copy,
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// The split award (R-01): one order per supplier, each with its picked lines
// ---------------------------------------------------------------------------

export interface AwardGroupInput {
  offer: AwardOfferLike
  /** The picked lines with the unit price the order carries: the quoted rate,
   * or the breakdown's in total pricing. Empty on an RFQ without products. */
  lines: Array<{ rfqProductIndex: number; unitPrice: number | null }>
  total: number
  /** «مطلوب التسليم قبل», `YYYY-MM-DD`. */
  requestedDeliveryDate: string | null
  /** What the cheapest competing rates would have cost for these lines. */
  lowestForLines: number | null
  /** Some of these lines passed over a cheaper rate — the reason travels with this order. */
  offLowest: boolean
}

export interface AwardRfqInput {
  rfq: RfqLike
  /** Every competing offer on the RFQ. */
  offers: AwardOfferLike[]
  groups: AwardGroupInput[]
  /** Lines nobody was awarded — they go back to the needs. */
  unpicked: number[]
  awardReason: { code: AwardReasonCode; text?: string | null } | null
  /** Total pricing: the unit prices came from the supplier's breakdown. */
  breakdown: boolean
  policies: ProcurementPolicies
  /** The preparer ticked that a guest supplier gets this order unregistered (R-10). */
  acceptedGuest?: boolean
}

/** One supplier's order out of a split award — pure, so the dialog and the tests see the document. */
export function draftSplitOrder(actor: ProcActor, input: AwardRfqInput, group: AwardGroupInput, now = new Date()): Omit<PurchaseOrder, "id" | "docNumber"> {
  const { rfq, offers, policies } = input
  const products = rfq.products || []
  const lines: PoLine[] = products.length
    ? group.lines.map((l) => {
        const p = products[l.rfqProductIndex] || {}
        return {
          id: `l${l.rfqProductIndex + 1}`,
          name: (p.name || "").trim(),
          unit: (p.unitOfMeasure || p.unit || "").trim(),
          quantity: Math.max(0, num(p.quantity)),
          unitPrice: l.unitPrice == null ? null : round2(l.unitPrice),
          accepted: 0,
          rejected: 0,
          held: 0,
          cancelled: 0,
          boqItemId: p.boqItemId ?? null,
          rfqProductIndex: l.rfqProductIndex,
        }
      })
    : buildPoLines(rfq, group.offer)
  const totalExVat = round2(group.total)
  const reason = group.offLowest ? input.awardReason : null
  const base: Omit<PurchaseOrder, "id" | "docNumber" | "approverKind"> = {
    organizationId: rfq.organizationId || rfq.contractorId || "",
    status: "awaiting_approval",
    basis: rfq.directAward || group.offer.directAward ? "direct" : "rfq",
    rfqId: rfq.id,
    rfqTitle: (rfq.title || "").trim(),
    offerId: group.offer.id,
    ...orderTermsOf(group.offer),
    projectId: rfq.projectId ?? null,
    projectName: rfq.projectName ?? null,
    category: rfq.category ?? null,
    purchaseSource: rfq.purchaseSource ?? null,
    ...supplierOfOffer(group.offer),
    lines,
    totalExVat,
    vatRate: 0.15,
    paymentTerms: group.offer.paymentTerms ?? null,
    deliveryLocation: group.offer.deliveryLocation || rfq.city || null,
    leadTimeDays: offerLeadTimeDays(group.offer),
    offersCount: offers.length,
    lowestOfferTotal: group.lowestForLines,
    awardReasonCode: reason?.code ?? null,
    awardReasonText: reason?.text?.trim() || null,
    shortCompetition: isShortCompetition(totalExVat, offers.length, policies),
    noOfficialQuote: !group.offer.offerPdfUrl,
    requestedDeliveryDate: group.requestedDeliveryDate || null,
    preparedById: actor.uid,
    preparedByName: actor.name,
    createdAt: now.toISOString(),
    approvedById: null,
    approvedByName: null,
    approvedAt: null,
    returnedReason: null,
    sentAt: null,
    sentChannel: null,
    supplierAcceptedAt: null,
    promisedDate: null,
    acceptanceRecordedBy: null,
    rating: null,
    log: [],
  }
  const routed = { ...base, id: "", docNumber: "", approverKind: "manager" as const }
  return { ...base, approverKind: requiredApprover(routed, policies, actor.isOwner || actor.canApprove) }
}

/**
 * Award the RFQ from the comparison's picks, in ONE transaction: every picked
 * offer goes `مقبول` with the lines it won (`awardedLines`, `awardedTotal`) and
 * gets its own order awaiting approval; the RFQ goes `Awarded`, remembers the
 * lines nobody won (`unawardedLines` — back to the needs) and logs the award.
 * The supplier hears nothing yet (22 Sep review): he hears when his order is
 * approved and sent. Re-reads the RFQ and every offer, so an offer excluded or
 * awarded meanwhile refuses the whole award rather than half of it.
 */
export async function awardRfq(
  firestore: Firestore,
  actor: ProcActor,
  input: AwardRfqInput,
  opts: WriteOpts = {}
): Promise<Array<{ id: string; docNumber: string; offerId: string }>> {
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  if (!input.groups.length) throw new ProcWriteError("nothing_picked")
  if (input.groups.some((g) => g.offer.isGuestOffer) && !input.acceptedGuest) throw new ProcWriteError("guest_unregistered")
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const drafts = input.groups.map((g) => draftSplitOrder(actor, input, g, now))
  const rfqRef = doc(firestore, "rfqs", input.rfq.id)
  const offerRefs = input.groups.map((g) => doc(firestore, "offers", g.offer.id))
  const poRefs = input.groups.map(() => doc(collection(firestore, PURCHASE_ORDERS)))
  const result = await runTransaction(firestore, async (tx) => {
    const rfqSnap = await tx.get(rfqRef)
    if (!rfqSnap.exists()) throw new ProcWriteError("rfq_missing")
    const rfqData = rfqSnap.data() as { status?: string; log?: RfqLogEntry[]; createdByUserId?: string | null; contractorId?: string | null }
    if (rfqData.status !== "New") throw new ProcWriteError("rfq_not_open")
    // A buyer awards only the RFQs he raised; the manager and the owner award any.
    if (!actor.isOwner && !actor.canApprove && (rfqData.createdByUserId || rfqData.contractorId || "") !== actor.uid) throw new ProcWriteError("not_your_rfq")
    for (const ref of offerRefs) {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new ProcWriteError("offer_missing")
      const o = snap.data() as { status?: string; poId?: string }
      if (o.poId || o.status === "مرفوض" || o.status === "مقبول") throw new ProcWriteError("offer_taken")
    }
    const numbers = await drawProcDocNumbers(firestore, tx, drafts[0].organizationId, "PO", drafts.length, now.getUTCFullYear())
    drafts.forEach((draft, k) => {
      const g = input.groups[k]
      tx.set(poRefs[k], { ...draft, docNumber: numbers[k], log: [entry(actor, "created", at, { params: { basis: draft.basis, number: numbers[k] } })], updatedAt: serverTimestamp() })
      tx.update(offerRefs[k], {
        status: "مقبول",
        decidedByUserId: actor.uid,
        decidedByUserName: actor.name,
        decidedAt: at,
        readAt: null,
        awaitingOrderApproval: true,
        ...(g.offLowest && input.awardReason ? { awardReason: { code: input.awardReason.code, text: input.awardReason.text?.trim() || null, byId: actor.uid, at } } : {}),
        awardedLines: g.lines.map((l) => l.rfqProductIndex),
        awardedTotal: round2(g.total),
        ...(input.breakdown ? { breakdown: g.lines.map((l) => ({ rfqProductIndex: l.rfqProductIndex, unitPrice: l.unitPrice })) } : {}),
        requestedDeliveryDate: g.requestedDeliveryDate || null,
        poId: poRefs[k].id,
        poNumber: numbers[k],
        updatedAt: serverTimestamp(),
      })
    })
    const logEntry = rfqLogEntry(actor, "awarded", at, { params: { orders: numbers.join(" · "), suppliers: drafts.map((d) => d.supplierName).join(" · "), unawarded: input.unpicked.length } })
    tx.update(rfqRef, {
      status: "Awarded",
      awardedAt: at,
      unawardedLines: input.unpicked,
      awardSplit: drafts.length > 1,
      log: [...(rfqData.log || []), logEntry],
      updatedAt: serverTimestamp(),
    })
    return numbers.map((docNumber, k) => ({ id: poRefs[k].id, docNumber, offerId: input.groups[k].offer.id }))
  })
  await Promise.all(
    result.map((r, k) =>
      emitProcEvent(firestore, actor, {
        kind: "po_awaiting_approval",
        organizationId: drafts[k].organizationId,
        to: [drafts[k].approverKind === "owner" ? { owner: true } : { permission: "po.approve" }],
        params: { number: r.docNumber, supplier: drafts[k].supplierName, amount: sarText(poValue({ ...drafts[k], id: r.id, docNumber: r.docNumber }), opts.locale), rfq: drafts[k].rfqTitle },
        poId: r.id,
        rfqId: drafts[k].rfqId,
        offerId: drafts[k].offerId,
        copy: opts.copy,
      })
    )
  )
  return result
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/** The BOQ lines the order names, read in the approval's transaction. A line
 * that cannot be read (deleted, or its project gone) gates nothing. */
export async function readGateItems(tx: Transaction, firestore: Firestore, po: Pick<PurchaseOrder, "projectId" | "lines">): Promise<BoqGateItem[]> {
  const ids = gateItemIds(po)
  if (!ids.length || !po.projectId) return []
  const out: BoqGateItem[] = []
  for (const id of ids) {
    try {
      const snap = await tx.get(doc(firestore, "projects", po.projectId, "boqItems", id))
      if (snap.exists()) out.push({ ...(snap.data() as Omit<BoqGateItem, "id">), id })
    } catch {
      // unreadable: the gate cannot be judged from here — the screen showed it
    }
  }
  return out
}

/** With the notice routed to both, the people who receive for this order are
 * stamped on it at approval: the supplier writing the notice cannot read our
 * team, and copies them from the order. Best-effort — none = forwarded as before. */
async function noticeReceivers(firestore: Firestore, ref: DocumentReference): Promise<string[] | null> {
  try {
    const snap = await getDoc(ref)
    if (!snap.exists()) return null
    const po = snap.data() as PurchaseOrder
    const spec = po.projectId ? { projectPermission: "deliveries.confirm" as const, projectId: po.projectId } : { permission: "deliveries.confirm" as const }
    const team = await loadTeam(firestore, po.organizationId, [spec])
    return resolveRecipients(team, [spec], "")
  } catch (err) {
    console.warn("notice receivers not resolved:", (err as { code?: string })?.code || err)
    return null
  }
}

/** Approve: the approver signs in his own name, never his own order (the
 * owner excepted, flagged `selfApproved`), within the routing and the limit,
 * and only when no fact blocks it. */
export async function approvePurchaseOrder(
  firestore: Firestore,
  actor: ProcActor,
  poId: string,
  input: { policies: ProcurementPolicies; blocks?: Omit<BlockContext, "policies" | "now"> | null },
  opts: WriteOpts = {}
): Promise<PurchaseOrder> {
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const ref = orderRef(firestore, poId)
  const receivers = noticeReachesReceiver(input.policies) ? await noticeReceivers(firestore, ref) : null
  const po = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ProcWriteError("order_missing")
    const po = { ...(snap.data() as Omit<PurchaseOrder, "id">), id: snap.id } as PurchaseOrder
    const refusal = approvalRefusal(po, actor, input.policies)
    if (refusal) {
      const map: Record<string, ProcWriteErrorCode> = { not_awaiting: "wrong_state", no_permission: "no_permission", own_order: "own_order", owner_only_retroactive: "owner_only", above_limit: "above_limit" }
      throw new ProcWriteError(map[refusal.code] || "wrong_state", refusal.params)
    }
    if (input.blocks) {
      const blocks = poBlocks(po, { ...input.blocks, policies: input.policies, now })
      if (blocks.length) throw new ProcWriteError("blocked", { codes: blocks.map((b) => b.code).join(",") })
    }
    const gates = approvalGateBlocks(po as PurchaseOrderX, await readGateItems(tx, firestore, po), input.blocks?.otherOrders ?? [])
    if (gates.length) throw new ProcWriteError(gates[0].code, gates[0].params)
    const self = po.preparedById === actor.uid
    // A retroactive order regularises goods that already arrived: there is
    // nothing to send and nobody to wait for, so approval lands it where the
    // receipt left it — accepted, recorded by the buyer.
    const retro = po.basis === "retroactive"
    const patch: Partial<PurchaseOrder> & { noticeCopyTo?: string[] } = {
      status: retro ? "accepted" : "approved",
      approvedById: actor.uid,
      approvedByName: actor.name,
      approvedAt: at,
      returnedReason: null,
      ...(retro ? { supplierAcceptedAt: at, acceptanceRecordedBy: "buyer" as const } : {}),
      ...(receivers && !retro ? { noticeCopyTo: receivers } : {}),
    }
    const log = entry(actor, "approved", at, { params: self ? { selfApproved: 1 } : null })
    const next: PurchaseOrder = { ...po, ...patch, log: [...(po.log || []), log] }
    tx.update(ref, { ...patch, log: next.log, updatedAt: serverTimestamp() })
    return next
  })
  return afterApproval(firestore, actor, po, input.policies, opts, at)
}

/** What an approval sets off, whoever approved (an approver, or a buyer under
 * his self-issue limit): Finance's commitment, the receivers' heads-up, the
 * price history, and the order on its way to the supplier. */
export async function afterApproval(firestore: Firestore, actor: ProcActor, po: PurchaseOrder, policies: ProcurementPolicies, opts: WriteOpts, at: string): Promise<PurchaseOrder> {
  const amount = sarText(poValue(po), opts.locale)
  const events = [
    emitProcEvent(firestore, actor, {
      kind: "po_approved",
      organizationId: po.organizationId,
      to: [{ users: [po.preparedById] }, { permission: "invoices.manage" }],
      params: { number: po.docNumber, supplier: po.supplierName, amount },
      poId: po.id,
      rfqId: po.rfqId,
      offerId: po.offerId,
      copy: opts.copy,
    }),
  ]
  // Receivers are told to expect an arrival — unless the goods are already here.
  if (po.basis !== "retroactive") {
    events.push(
      emitProcEvent(firestore, actor, {
        kind: "po_expected_arrival",
        organizationId: po.organizationId,
        to: [{ permission: "deliveries.confirm" }],
        params: { number: po.docNumber, supplier: po.supplierName, lines: po.lines.length },
        poId: po.id,
        rfqId: po.rfqId,
        offerId: po.offerId,
        link: "/contractor/goods-received",
        copy: opts.copy,
      })
    )
  }
  await Promise.all([...events, recordApprovedPrices(firestore, po, at)])
  if (po.basis === "retroactive") return po

  // Procurement → Finance → Supplier: a registered supplier gets the order in
  // his portal the moment it is approved, sent in the approver's name. When it
  // cannot go that way (a guest, the policy off, or the send failed), whoever
  // may send it is told to — the order never sits approved and forgotten.
  if (policies.sendOnApproval && !po.isGuestSupplier && po.supplierUserId) {
    try {
      return await sendOrder(firestore, actor, po.id, "portal", opts, false)
    } catch (err) {
      console.warn("order approved but not sent on the portal:", (err as { code?: string })?.code || err)
    }
  }
  await emitProcEvent(firestore, actor, {
    kind: "po_ready_to_send",
    organizationId: po.organizationId,
    to: [{ users: [po.preparedById] }, { permission: "po.expedite" }],
    params: { number: po.docNumber, supplier: po.supplierName },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

/**
 * The approved prices enter the price history (PRD §4 `PH`).
 *
 * At approval, because that is when a price becomes one we committed to — a
 * prepared order is still a proposal. Best-effort like every other post-commit
 * effect: the order is approved either way, and a row that failed to write
 * costs a future comparison, not a transition.
 *
 * Each row's id is the order's own line, so a retried approval overwrites its
 * row instead of adding a second point to the material's series.
 */
async function recordApprovedPrices(firestore: Firestore, po: PurchaseOrder, at: string): Promise<void> {
  const rows = historyRowsForApproval(po, at)
  if (!rows.length) return
  await Promise.all([
    ...rows.map(({ id, ...row }) =>
      setDoc(doc(firestore, PRICE_HISTORY, id), row).catch((err) => console.warn("price history not recorded:", (err as { code?: string })?.code || err))
    ),
    shareReferencePrices(firestore, po, rows, at),
  ])
}

/** «سعر مرجعي يقرؤه التصنيع»: a product our workshop makes and we just bought
 * takes the approved price as its make-or-buy yardstick (same name and unit). */
async function shareReferencePrices(firestore: Firestore, po: PurchaseOrder, rows: Array<{ materialKey: string; price: number }>, at: string): Promise<void> {
  try {
    const snap = await getDocs(query(collection(firestore, "mfgProducts"), where("organizationId", "==", po.organizationId)))
    const byKey = new Map(rows.map((r) => [r.materialKey, r.price]))
    await Promise.all(
      snap.docs.map((d) => {
        const p = d.data() as { name?: string; unit?: string; archived?: boolean }
        const price = p.archived ? undefined : byKey.get(materialKey(p.name || "", p.unit || ""))
        return price ? updateDoc(d.ref, { referenceBuyPrice: price, referenceBuyAt: at, referenceBuyPo: po.docNumber, updatedAt: serverTimestamp() }) : Promise.resolve()
      })
    )
  } catch (err) {
    console.warn("reference price not shared:", (err as { code?: string })?.code || err)
  }
}

/** Return to the preparer with a reason: the order stays awaiting approval
 * and carries `returnedReason` until it is resubmitted. */
export async function returnPurchaseOrder(firestore: Firestore, actor: ProcActor, poId: string, reason: string, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  if (!actor.isOwner && !actor.canApprove) throw new ProcWriteError("no_permission")
  const text = requireText(reason)
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
    if (po.status !== "awaiting_approval") throw new ProcWriteError("wrong_state")
    return { patch: { returnedReason: text }, log: entry(actor, "returned", at, { note: text }) }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_returned",
    organizationId: po.organizationId,
    to: [{ users: [po.preparedById] }],
    params: { number: po.docNumber, reason: text },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

/** The preparer resubmits a returned order — the approvers are asked again. */
export async function resubmitPurchaseOrder(firestore: Firestore, actor: ProcActor, poId: string, note: string | null, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
    if (po.status !== "awaiting_approval" || !po.returnedReason) throw new ProcWriteError("wrong_state")
    return { patch: { returnedReason: null }, log: entry(actor, "resubmitted", at, { note: note?.trim() || null }) }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_awaiting_approval",
    organizationId: po.organizationId,
    to: [po.approverKind === "owner" ? { owner: true } : { permission: "po.approve" }],
    params: { number: po.docNumber, supplier: po.supplierName, amount: sarText(poValue(po), opts.locale), rfq: po.rfqTitle },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

// ---------------------------------------------------------------------------
// Dispatch and the supplier's answer
// ---------------------------------------------------------------------------

const canExpedite = (actor: ProcActor) => actor.isOwner || actor.canExpedite || actor.canPrepare || actor.canApprove

/** Send to the supplier. The portal channel notifies his user; for WhatsApp
 * and e-mail the screen opens the message and this only RECORDS the fact
 * (channel, time, sender) — PRD §10.7. The acceptance clock starts here. */
export async function sendPurchaseOrder(firestore: Firestore, actor: ProcActor, poId: string, channel: PoSendChannel, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  return sendOrder(firestore, actor, poId, channel, opts, true)
}

/** `checkActs` is off only for the send that rides the approval (policy
 * sendOnApproval): the approver sends it in his name whoever prepared it. */
async function sendOrder(firestore: Firestore, actor: ProcActor, poId: string, channel: PoSendChannel, opts: WriteOpts, checkActs: boolean): Promise<PurchaseOrder> {
  if (!canExpedite(actor)) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
    if (checkActs) assertActs(po, actor)
    if (!canSend(po)) throw new ProcWriteError("wrong_state")
    return { patch: { status: "sent", sentAt: at, sentById: actor.uid, sentByName: actor.name, sentChannel: channel }, log: entry(actor, "sent", at, { params: { channel } }) }
  })
  if (po.supplierUserId) {
    // The supplier's user and his company's owner — the order may be handled by
    // either, and the owner's uid is the supplier org id (never "guest" here).
    const supplierSide = [...new Set([po.supplierUserId, po.supplierOrgId].filter((u): u is string => Boolean(u) && u !== "guest"))]
    await emitProcEvent(firestore, actor, {
      kind: "po_sent",
      organizationId: po.organizationId,
      to: [{ users: supplierSide }],
      supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
      params: { number: po.docNumber, company: opts.orgName || actor.name },
      poId: po.id,
      rfqId: po.rfqId,
      offerId: po.offerId,
      copy: opts.copy,
    })
  }
  return po
}

const acceptedEvent = (po: PurchaseOrder, opts: WriteOpts) => ({
  kind: "po_supplier_accepted" as const,
  organizationId: po.organizationId,
  to: [{ users: [po.preparedById, po.sentById] }, { permission: "po.expedite" as const }],
  params: { number: po.docNumber, supplier: po.supplierName, date: po.promisedDate || "" },
  poId: po.id,
  rfqId: po.rfqId,
  offerId: po.offerId,
  copy: opts.copy,
})

/** We record the supplier's acceptance for him (he answered by phone or
 * WhatsApp) — or note that he did it in the portal. */
export async function recordSupplierAcceptance(
  firestore: Firestore,
  actor: ProcActor,
  poId: string,
  input: { promisedDate: string; by: "buyer" | "supplier" },
  opts: WriteOpts = {}
): Promise<PurchaseOrder> {
  if (!canExpedite(actor)) throw new ProcWriteError("no_permission")
  assertDay(input.promisedDate)
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
    assertActs(po, actor)
    if (!canRecordAcceptance(po)) throw new ProcWriteError("wrong_state")
    return {
      patch: { status: "accepted", supplierAcceptedAt: at, promisedDate: input.promisedDate, acceptanceRecordedBy: input.by },
      log: entry(actor, "supplier_accepted", at, { params: { date: input.promisedDate, recordedBy: input.by } }),
    }
  })
  await emitProcEvent(firestore, actor, acceptedEvent(po, opts))
  return po
}

/** The supplier's own act in his portal: sent → accepted with the date he
 * commits to. He cannot read the buyer's team, so only named users are told
 * (the preparer and whoever sent it). */
export async function supplierAcceptPurchaseOrder(
  firestore: Firestore,
  supplier: { uid: string; name: string },
  poId: string,
  promisedDate: string,
  opts: Pick<WriteOpts, "copy" | "now"> = {}
): Promise<PurchaseOrder> {
  assertDay(promisedDate)
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
    if (!canRecordAcceptance(po)) throw new ProcWriteError("wrong_state")
    return {
      patch: { status: "accepted", supplierAcceptedAt: at, promisedDate, acceptanceRecordedBy: "supplier" },
      log: entry(supplier, "supplier_accepted", at, { params: { date: promisedDate, recordedBy: "supplier" } }),
    }
  })
  await emitProcEvent(firestore, supplier, {
    kind: "po_supplier_accepted",
    organizationId: po.organizationId,
    to: [{ users: [po.preparedById, po.sentById] }],
    params: { number: po.docNumber, supplier: po.supplierName, date: promisedDate },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

/** A new promise while goods are still owed; the old date stays in the log. */
export async function updatePromisedDate(firestore: Firestore, actor: ProcActor, poId: string, input: { date: string; note?: string | null }, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  if (!canExpedite(actor)) throw new ProcWriteError("no_permission")
  assertDay(input.date)
  const at = (opts.now ?? new Date()).toISOString()
  const note = input.note?.trim() || null
  const po = await transition(firestore, poId, (po) => {
    assertActs(po, actor)
    if (!canUpdateDate(po)) throw new ProcWriteError("wrong_state")
    return { patch: { promisedDate: input.date }, log: entry(actor, "date_updated", at, { note, params: { from: po.promisedDate || "", date: input.date } }) }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_date_updated",
    organizationId: po.organizationId,
    to: [{ users: [po.preparedById] }, { permission: "deliveries.confirm" }],
    params: { number: po.docNumber, supplier: po.supplierName, date: input.date, note: note || "" },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

/** Nudge the supplier: to accept (sent) or to deliver (accepted, still owed). */
export async function remindSupplier(firestore: Firestore, actor: ProcActor, poId: string, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  if (!canExpedite(actor)) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
    assertActs(po, actor)
    if (po.status !== "sent" && !canUpdateDate(po)) throw new ProcWriteError("wrong_state")
    const until = reminderCooldownUntil(po, opts.now ?? new Date())
    if (until) throw new ProcWriteError("reminded_recently")
    return { patch: {}, log: entry(actor, "reminded", at, { params: { about: po.status === "sent" ? "acceptance" : "delivery" } }) }
  })
  if (po.supplierUserId) {
    await emitProcEvent(firestore, actor, {
      kind: "po_reminder",
      organizationId: po.organizationId,
      to: [{ users: [po.supplierUserId] }],
      supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
      params: { number: po.docNumber, company: opts.orgName || actor.name, ask: po.status === "sent" ? "@pn_po_reminder_ask_accept" : "@pn_po_reminder_ask_deliver" },
      poId: po.id,
      rfqId: po.rfqId,
      offerId: po.offerId,
      copy: opts.copy,
    })
  }
  return po
}

// ---------------------------------------------------------------------------
// Lines: the rest will not arrive, rejects, held goods
// ---------------------------------------------------------------------------

const canDecideLines = (actor: ProcActor) => actor.isOwner || actor.canPrepare || actor.canApprove

/** "The rest will not arrive": what is still to arrive on the line is cancelled with a reason. */
export async function cancelRemainder(firestore: Firestore, actor: ProcActor, poId: string, input: { lineId: string; reason: string }, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  if (!canDecideLines(actor)) throw new ProcWriteError("no_permission")
  const reason = requireText(input.reason)
  const at = (opts.now ?? new Date()).toISOString()
  let cancelled = 0
  let line: PoLine | undefined
  const po = await transition(firestore, poId, (po) => {
    assertActs(po, actor)
    if (!canCancelRemainder(po)) throw new ProcWriteError("wrong_state")
    line = po.lines.find((l) => l.id === input.lineId)
    if (!line) throw new ProcWriteError("line_missing")
    cancelled = lineToArrive(line)
    if (cancelled <= 0) throw new ProcWriteError("nothing_outstanding")
    const lines = po.lines.map((l) => (l.id === input.lineId ? { ...l, cancelled: round2(l.cancelled + cancelled), cancelReason: reason } : l))
    return { patch: { lines }, log: entry(actor, "remainder_cancelled", at, { note: reason, params: { line: line.name, qty: cancelled, unit: line.unit } }) }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_remainder_cancelled",
    organizationId: po.organizationId,
    to: [{ users: [po.supplierUserId] }, { permission: "invoices.manage" }],
    supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
    params: { number: po.docNumber, company: opts.orgName || actor.name, line: line?.name || "", qty: cancelled, unit: line?.unit || "", reason },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

/** A decided line carries the terms beside the decision: the replacement's
 * date the supplier committed to, or the discounted unit price. Optional
 * fields on the stored line — `PoLine` (mirrored into the mobile app) is not
 * widened for them; `rejectTermsOf` in receipt-desk.ts reads them back. */
export type RejectTermsLine = PoLine & {
  rejectReplaceBy?: string | null
  rejectDiscountPrice?: number | null
  /** A discount keeps the goods on hold until Inventory releases them, once the requester accepted them technically. */
  rejectDiscountState?: "wait" | "released" | null
}

export interface RejectDecisionTerms {
  /** `YYYY-MM-DD` — on `replace`, optional ("until the replacement arrives" with no date helps nobody, but it is not refused). */
  replaceBy?: string | null
  /** Unit price EXCLUDING VAT — required on `discount`. */
  discountPrice?: number | null
}

/**
 * Pure: Procurement's decision on a line's rejected quantity. `replace` keeps
 * it owed by the supplier; `reduce` cancels it (the order shrinks); `discount`
 * keeps the goods on hold — they count as accepted only when Inventory releases
 * them after the requester's technical acceptance (`releaseDiscounted`), at a
 * price Finance will settle — while `rejected` stays as the gate's record.
 */
export function applyRejectDecision(lines: PoLine[], lineId: string, decision: RejectDecision, note: string | null, at: string, terms: RejectDecisionTerms = {}): PoLine[] {
  return lines.map((l) => {
    if (l.id !== lineId) return l
    const q = round2(Math.max(0, l.rejected))
    const next: RejectTermsLine = {
      ...l,
      rejectDecision: decision,
      rejectDecisionNote: note,
      rejectDecidedAt: at,
      rejectReplaceBy: decision === "replace" ? terms.replaceBy || null : null,
      rejectDiscountPrice: decision === "discount" ? round2(Number(terms.discountPrice) || 0) : null,
      rejectDiscountState: decision === "discount" ? "wait" : null,
    }
    if (decision === "reduce") next.cancelled = round2(l.cancelled + q)
    return next
  })
}

/** Pure: Inventory releases the discounted rejects of a line — they join what
 * was accepted (the invoicing ceiling) at the discounted price. */
export function applyDiscountRelease(lines: PoLine[], lineId: string): PoLine[] {
  return lines.map((l) => {
    const x = l as RejectTermsLine
    if (l.id !== lineId || x.rejectDecision !== "discount" || x.rejectDiscountState !== "wait") return l
    return { ...x, accepted: round2(l.accepted + Math.max(0, l.rejected)), rejectDiscountState: "released" as const }
  })
}

/** «فكّ الإيقاف»: whoever receives (Inventory, or the site) releases the goods
 * Procurement kept at a discount, once the requester has accepted them. */
export async function releaseDiscounted(firestore: Firestore, actor: ProcActor, poId: string, lineId: string, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  if (!actor.isOwner && !actor.canReceive) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  let line: RejectTermsLine | undefined
  return transition(firestore, poId, (po) => {
    if (po.status !== "accepted") throw new ProcWriteError("wrong_state")
    line = po.lines.find((l) => l.id === lineId) as RejectTermsLine | undefined
    if (!line) throw new ProcWriteError("line_missing")
    if (line.rejectDecision !== "discount" || line.rejectDiscountState !== "wait") throw new ProcWriteError("wrong_state")
    return {
      patch: { lines: applyDiscountRelease(po.lines, lineId) },
      log: entry(actor, "reject_discount_released", at, { params: { line: line.name, lineId, qty: line.rejected, price: line.rejectDiscountPrice ?? 0 } }),
    }
  })
}

export async function decideReject(
  firestore: Firestore,
  actor: ProcActor,
  poId: string,
  input: { lineId: string; decision: RejectDecision; note?: string | null } & RejectDecisionTerms,
  opts: WriteOpts = {}
): Promise<PurchaseOrder> {
  if (!canDecideLines(actor)) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const note = input.note?.trim() || null
  const replaceBy = input.decision === "replace" && input.replaceBy ? input.replaceBy : null
  if (replaceBy) assertDay(replaceBy)
  const discountPrice = input.decision === "discount" ? Number(input.discountPrice) : null
  if (input.decision === "discount" && !(Number.isFinite(discountPrice) && (discountPrice as number) > 0)) throw new ProcWriteError("price_missing")
  let line: PoLine | undefined
  const po = await transition(firestore, poId, (po) => {
    assertActs(po, actor)
    if (po.status !== "accepted") throw new ProcWriteError("wrong_state")
    line = po.lines.find((l) => l.id === input.lineId)
    if (!line) throw new ProcWriteError("line_missing")
    if (!(line.rejected > 0)) throw new ProcWriteError("nothing_rejected")
    const params: Record<string, string | number> = { line: line.name, lineId: line.id, qty: line.rejected, decision: input.decision }
    if (replaceBy) params.replaceBy = replaceBy
    if (discountPrice != null) params.price = discountPrice
    return {
      patch: { lines: applyRejectDecision(po.lines, input.lineId, input.decision, note, at, { replaceBy, discountPrice }) },
      log: entry(actor, "reject_decided", at, { note, params }),
    }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_rejects_decided",
    organizationId: po.organizationId,
    // A discount waits on Inventory's release (after the requester accepts): they hear of it too.
    to: [{ users: [po.supplierUserId] }, { permission: "invoices.manage" }, ...(input.decision === "discount" ? [{ permission: "warehouses.manage" as const }, { permission: "deliveries.confirm" as const }] : [])],
    supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
    params: { number: po.docNumber, company: opts.orgName || actor.name, line: line?.name || "", qty: line?.rejected || 0, decision: `@pn_po_decision_${input.decision}`, note: [replaceBy, note].filter(Boolean).join(" — ") },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

/** Held goods leave inspection — accepted, or rejected after all. The
 * inspector's act: whoever may confirm deliveries. */
export async function releaseHeld(
  firestore: Firestore,
  actor: ProcActor,
  poId: string,
  input: { lineId: string; quantity: number; outcome: "accept" | "reject" },
  opts: WriteOpts = {}
): Promise<PurchaseOrder> {
  if (!actor.isOwner && !actor.canReceive) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  return transition(firestore, poId, (po) => {
    if (po.status !== "accepted") throw new ProcWriteError("wrong_state")
    const line = po.lines.find((l) => l.id === input.lineId)
    if (!line) throw new ProcWriteError("line_missing")
    const q = Math.min(Math.max(0, Number(input.quantity) || 0), line.held)
    if (!(q > 0)) throw new ProcWriteError("nothing_held")
    return {
      patch: { lines: releaseHeldLines(po.lines, input.lineId, q, input.outcome) },
      log: entry(actor, "received", at, { params: { number: `${line.name} × ${q}`, line: line.name, released: q, outcome: input.outcome } }),
    }
  })
}

// ---------------------------------------------------------------------------
// Receipts — inside the RECEIPTS agent's transaction
// ---------------------------------------------------------------------------

/**
 * Apply one receipt's lines to the order, inside the caller's transaction (the
 * caller has already `tx.get` the order and passes it). Returns the new lines
 * so the caller can decide close-out. An arrival on an order the supplier
 * never acknowledged records his acceptance for him ("buyer", no date) —
 * goods on our floor are the strongest acceptance there is.
 */
export function applyReceipt(
  tx: Transaction,
  poRef: DocumentReference,
  po: PurchaseOrder,
  deliveryLines: DeliveryLine[],
  actor: Pick<ProcActor, "uid" | "name">,
  receipt: { deliveryId: string; docNumber?: string | null; at?: string }
): PoLine[] {
  if (po.status !== "sent" && po.status !== "accepted") throw new ProcWriteError("wrong_state")
  const at = receipt.at ?? nowIso()
  const lines = applyReceiptToLines(po.lines, deliveryLines)
  const accepted = round2(deliveryLines.reduce((s, d) => s + Math.max(0, (d.counted ?? 0) - (d.rejected ?? 0) - (d.held ?? 0)), 0))
  const log = [...(po.log || []), entry(actor, "received", at, { params: { number: receipt.docNumber || receipt.deliveryId, deliveryId: receipt.deliveryId, accepted } })]
  const acceptance = po.status === "sent" ? { status: "accepted" as const, supplierAcceptedAt: at, acceptanceRecordedBy: "buyer" as const } : {}
  tx.update(poRef, { lines, log, ...acceptance, updatedAt: serverTimestamp() })
  return lines
}

/** After the receipt's transaction committed: the preparer and Finance hear
 * what was accepted and what may now be invoiced. */
export async function emitReceiptRecorded(
  firestore: Firestore,
  actor: ProcActor,
  po: PurchaseOrder,
  receipt: { deliveryId: string; docNumber?: string | null },
  opts: WriteOpts = {}
): Promise<number> {
  const ceiling = acceptedValue(po)
  const ordered = round2(po.lines.reduce((s, l) => s + l.quantity - l.cancelled, 0))
  const accepted = round2(po.lines.reduce((s, l) => s + l.accepted, 0))
  return emitProcEvent(firestore, actor, {
    kind: "po_receipt_recorded",
    organizationId: po.organizationId,
    to: [{ users: [po.preparedById] }, { permission: "invoices.manage" }],
    params: { number: po.docNumber, receipt: receipt.docNumber || receipt.deliveryId, accepted, ordered, ceiling: ceiling == null ? "@pn_po_ceiling_unknown" : sarText(ceiling, opts.locale) },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    link: procLinks.receipt(receipt.deliveryId),
    copy: opts.copy,
  })
}

// ---------------------------------------------------------------------------
// Close-out, cancellation, rating
// ---------------------------------------------------------------------------

/** Complete orders close as they are; an incomplete one closes short with a reason. */
export async function closePurchaseOrder(firestore: Firestore, actor: ProcActor, poId: string, input: { reason?: string | null } = {}, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  if (!canDecideLines(actor)) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const reason = input.reason?.trim() || null
  const po = await transition(firestore, poId, (po) => {
    assertActs(po, actor)
    if (po.status !== "accepted") throw new ProcWriteError("wrong_state")
    if (!canClose(po, reason)) throw new ProcWriteError("reason_required")
    const short = closeIsShort(po)
    return { patch: { status: "closed", closedAt: at, closedShort: short, closeReason: short ? reason : null }, log: entry(actor, "closed", at, { note: short ? reason : null, params: { short: short ? 1 : 0 } }) }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_closed",
    organizationId: po.organizationId,
    to: [{ users: [po.preparedById] }, { permission: "invoices.manage" }],
    params: { number: po.docNumber, outcome: po.closedShort ? "@pn_po_closed_short_flag" : "@pn_po_closed_complete", reason: po.closeReason || "" },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

/** Cancel the whole order — before anything was received. */
export async function cancelPurchaseOrder(firestore: Firestore, actor: ProcActor, poId: string, reason: string, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  if (!canDecideLines(actor)) throw new ProcWriteError("no_permission")
  const text = requireText(reason)
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
    assertActs(po, actor)
    if (po.status === "cancelled") throw new ProcWriteError("already_cancelled")
    if (po.status === "closed") throw new ProcWriteError("wrong_state")
    if (po.lines.some((l) => l.accepted > 0 || l.held > 0)) throw new ProcWriteError("has_receipts")
    return { patch: { status: "cancelled", cancelledReason: text }, log: entry(actor, "cancelled", at, { note: text, params: { from: po.status } }) }
  })
  // The supplier hears of it only if the order had reached him; Finance only if it was a commitment.
  const wasWithSupplier = po.log.some((l) => l.action === "sent")
  await emitProcEvent(firestore, actor, {
    kind: "po_cancelled",
    organizationId: po.organizationId,
    to: [{ users: [po.preparedById, wasWithSupplier ? po.supplierUserId : null] }, ...(po.approvedById ? [{ permission: "invoices.manage" as const }] : [])],
    supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
    params: { number: po.docNumber, supplier: po.supplierName, reason: text },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return po
}

export interface RatingInput {
  conformity: number
  cooperation: number
  note?: string | null
  publishAnonymously: boolean
}

/** Pure: the rating as stored — the three receipt-derived aspects computed,
 * the two stars as typed. */
export function buildRating(po: PurchaseOrder, receipts: ReceiptFact[], input: RatingInput, actor: Pick<ProcActor, "uid" | "name">, at: string): PoRating {
  const star = (n: number) => Math.min(5, Math.max(1, Math.round(Number(n) || 1)))
  const facts = poFacts(po, receipts)
  return {
    onTime: facts.onTime,
    lateByDays: facts.lateByDays,
    inFull: facts.inFull,
    rejectPercent: facts.rejectPercent,
    conformity: star(input.conformity),
    cooperation: star(input.cooperation),
    note: input.note?.trim() || null,
    publishAnonymously: Boolean(input.publishAnonymously),
    byId: actor.uid,
    byName: actor.name,
    at,
  }
}

/**
 * Rate the supplier once the story is whole. When published, a platform
 * review is written the way `ReviewDialog` writes one (and the supplier's
 * average refreshed) — anonymously: the review names no reviewer.
 */
export async function ratePurchaseOrder(firestore: Firestore, actor: ProcActor, poId: string, input: RatingInput & { receipts: ReceiptFact[] }, opts: WriteOpts = {}): Promise<PurchaseOrder> {
  if (!actor.isOwner && !actor.canPrepare && !actor.canApprove) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
    assertActs(po, actor)
    if (!canRate(po, input.receipts)) throw new ProcWriteError("cannot_rate")
    const rating = buildRating(po, input.receipts, input, actor, at)
    return { patch: { rating }, log: entry(actor, "rated", at, { params: { conformity: rating.conformity, cooperation: rating.cooperation, published: rating.publishAnonymously ? 1 : 0 } }) }
  })
  const rating = po.rating as PoRating
  if (rating.publishAnonymously && po.supplierUserId) {
    const stars = Math.round((rating.conformity + rating.cooperation) / 2)
    try {
      await addDoc(collection(firestore, "reviews"), {
        offerId: po.offerId,
        rfqId: po.rfqId,
        poId: po.id,
        reviewerId: actor.uid,
        reviewerName: "",
        anonymous: true,
        reviewerRole: "Contractor",
        revieweeId: po.supplierUserId,
        revieweeName: po.supplierName,
        revieweeRole: "Supplier",
        rating: stars,
        comment: rating.note || "",
        createdAt: at,
      })
      const others = await getDocs(query(collection(firestore, "reviews"), where("revieweeId", "==", po.supplierUserId)))
      const list = others.docs.map((d) => d.data() as { rating?: number })
      const count = list.length
      const sum = list.reduce((s, r) => s + (Number(r.rating) || 0), 0)
      await updateDoc(doc(firestore, "users", po.supplierUserId), { rating: count ? Math.round((sum / count) * 10) / 10 : stars, reviewsCount: count || 1 })
    } catch (err) {
      console.warn("published rating not recorded:", (err as { code?: string })?.code || err)
    }
    if (po.offerId) await updateDoc(doc(firestore, "offers", po.offerId), { contractorRated: true }).catch(() => undefined)
    await emitProcEvent(firestore, actor, {
      kind: "po_rated",
      organizationId: po.organizationId,
      to: [{ users: [po.supplierUserId] }],
      supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
      params: { number: po.docNumber, company: opts.orgName || actor.name, stars },
      poId: po.id,
      rfqId: po.rfqId,
      offerId: po.offerId,
      copy: opts.copy,
    })
  }
  return po
}

// ---------------------------------------------------------------------------
// Retroactive — regularising a receipt that had no order (§6.1-11)
// ---------------------------------------------------------------------------

export interface RetroactiveInput {
  organizationId: string
  rfqTitle: string
  supplierName: string
  /** The supplier's platform org/user when known; absent = off-platform. */
  supplierOrgId?: string | null
  supplierUserId?: string | null
  projectId?: string | null
  projectName?: string | null
  /** What was received: the receipt's counted lines. */
  lines: Array<{ name: string; unit: string; quantity: number; unitPrice?: number | null; accepted?: number }>
  totalExVat: number
  /** The manual receipt this order regularises; it gets `poId`/`poNumber`. */
  deliveryId?: string | null
  reason: string
}

/** A purchase order raised AFTER the goods arrived — basis `retroactive`,
 * routed to the owner alone. Its lines are born with what was accepted. */
export async function retroactivePurchaseOrder(firestore: Firestore, actor: ProcActor, input: RetroactiveInput, opts: WriteOpts = {}): Promise<{ id: string; docNumber: string; deliveryLinked: boolean }> {
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  // Regularising is Procurement's act (the prototype's `regul`): whoever
  // prepares orders stamps the no-PO receipt with the order it now belongs to.
  const linkDelivery = Boolean(input.deliveryId)
  const reason = requireText(input.reason)
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const lines: PoLine[] = input.lines.map((l, i) => ({
    id: `l${i + 1}`,
    name: l.name.trim(),
    unit: (l.unit || "").trim(),
    quantity: Math.max(0, Number(l.quantity) || 0),
    unitPrice: l.unitPrice == null ? null : Number(l.unitPrice),
    accepted: Math.max(0, Number(l.accepted ?? l.quantity) || 0),
    rejected: 0,
    held: 0,
    cancelled: 0,
    boqItemId: null,
    rfqProductIndex: null,
  }))
  const poRef = doc(collection(firestore, PURCHASE_ORDERS))
  const supplierOrgId = input.supplierOrgId || "guest"
  const docNumber = await runTransaction(firestore, async (tx) => {
    const number = await drawProcDocNumber(firestore, tx, input.organizationId, "PO", now.getUTCFullYear())
    const po: Omit<PurchaseOrder, "id"> = {
      organizationId: input.organizationId,
      docNumber: number,
      status: "awaiting_approval",
      basis: "retroactive",
      rfqId: null,
      rfqTitle: input.rfqTitle.trim(),
      offerId: null,
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
      purchaseSource: null,
      supplierOrgId,
      supplierUserId: input.supplierUserId ?? null,
      supplierName: input.supplierName.trim(),
      isGuestSupplier: supplierOrgId === "guest",
      lines,
      totalExVat: round2(Number(input.totalExVat) || 0),
      vatRate: 0.15,
      offersCount: 0,
      lowestOfferTotal: null,
      awardReasonCode: "other",
      awardReasonText: reason,
      shortCompetition: false,
      noOfficialQuote: true,
      preparedById: actor.uid,
      preparedByName: actor.name,
      createdAt: at,
      approverKind: "owner",
      approvedById: null,
      approvedAt: null,
      returnedReason: null,
      rating: null,
      log: [entry(actor, "created", at, { note: reason, params: { basis: "retroactive", number, deliveryId: input.deliveryId || "" } })],
      updatedAt: serverTimestamp(),
    }
    tx.set(poRef, po)
    if (linkDelivery) tx.update(doc(firestore, "deliveries", input.deliveryId as string), { poId: poRef.id, poNumber: number, regularisedAt: at, regularisedById: actor.uid, regularisedByName: actor.name })
    return number
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_awaiting_approval",
    organizationId: input.organizationId,
    to: [{ owner: true }],
    params: { number: docNumber, supplier: input.supplierName, amount: sarText(input.totalExVat, opts.locale), rfq: input.rfqTitle },
    poId: poRef.id,
    copy: opts.copy,
  })
  return { id: poRef.id, docNumber, deliveryLinked: linkDelivery }
}

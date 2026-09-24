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

import { addDoc, collection, doc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, type DocumentReference, type Firestore, type Transaction } from "firebase/firestore"
import type { Translator } from "../mfg-events"
import { emitProcEvent, procLinks, sarText } from "./events"
import { drawProcDocNumber } from "./numbering"
import { PRICE_HISTORY, historyRowsForApproval } from "./prices"
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
  // A price agreement (agreement-writes.ts).
  | "supplier_missing"
  | "no_lines"
  // The receiver register (receiver-writes.ts).
  | "bad_receiver"

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
  return { ...base, approverKind: requiredApprover(routed, policies) }
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
// Approval
// ---------------------------------------------------------------------------

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
  const po = await transition(firestore, poId, (po) => {
    const refusal = approvalRefusal(po, actor, input.policies)
    if (refusal) {
      const map: Record<string, ProcWriteErrorCode> = { not_awaiting: "wrong_state", no_permission: "no_permission", own_order: "own_order", owner_only_retroactive: "owner_only", above_limit: "above_limit" }
      throw new ProcWriteError(map[refusal.code] || "wrong_state", refusal.params)
    }
    if (input.blocks) {
      const blocks = poBlocks(po, { ...input.blocks, policies: input.policies, now })
      if (blocks.length) throw new ProcWriteError("blocked", { codes: blocks.map((b) => b.code).join(",") })
    }
    const self = po.preparedById === actor.uid
    // A retroactive order regularises goods that already arrived: there is
    // nothing to send and nobody to wait for, so approval lands it where the
    // receipt left it — accepted, recorded by the buyer.
    const retro = po.basis === "retroactive"
    return {
      patch: {
        status: retro ? "accepted" : "approved",
        approvedById: actor.uid,
        approvedByName: actor.name,
        approvedAt: at,
        returnedReason: null,
        ...(retro ? { supplierAcceptedAt: at, acceptanceRecordedBy: "buyer" as const } : {}),
      },
      log: entry(actor, "approved", at, { params: self ? { selfApproved: 1 } : null }),
    }
  })
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
  await Promise.all(
    rows.map(({ id, ...row }) =>
      setDoc(doc(firestore, PRICE_HISTORY, id), row).catch((err) => console.warn("price history not recorded:", (err as { code?: string })?.code || err))
    )
  )
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
  if (!canExpedite(actor)) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
    if (!canSend(po)) throw new ProcWriteError("wrong_state")
    return { patch: { status: "sent", sentAt: at, sentById: actor.uid, sentByName: actor.name, sentChannel: channel }, log: entry(actor, "sent", at, { params: { channel } }) }
  })
  if (po.supplierUserId) {
    await emitProcEvent(firestore, actor, {
      kind: "po_sent",
      organizationId: po.organizationId,
      to: [{ users: [po.supplierUserId] }],
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
    if (po.status !== "sent" && !canUpdateDate(po)) throw new ProcWriteError("wrong_state")
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

/**
 * Pure: Procurement's decision on a line's rejected quantity. `replace` keeps
 * it owed by the supplier; `reduce` cancels it (the order shrinks); `discount`
 * keeps the goods — they count as accepted at a price Finance will settle —
 * while `rejected` stays as the gate's record.
 */
export function applyRejectDecision(lines: PoLine[], lineId: string, decision: RejectDecision, note: string | null, at: string): PoLine[] {
  return lines.map((l) => {
    if (l.id !== lineId) return l
    const q = round2(Math.max(0, l.rejected))
    const next: PoLine = { ...l, rejectDecision: decision, rejectDecisionNote: note, rejectDecidedAt: at }
    if (decision === "reduce") next.cancelled = round2(l.cancelled + q)
    if (decision === "discount") next.accepted = round2(l.accepted + q)
    return next
  })
}

export async function decideReject(
  firestore: Firestore,
  actor: ProcActor,
  poId: string,
  input: { lineId: string; decision: RejectDecision; note?: string | null },
  opts: WriteOpts = {}
): Promise<PurchaseOrder> {
  if (!canDecideLines(actor)) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const note = input.note?.trim() || null
  let line: PoLine | undefined
  const po = await transition(firestore, poId, (po) => {
    if (po.status !== "accepted") throw new ProcWriteError("wrong_state")
    line = po.lines.find((l) => l.id === input.lineId)
    if (!line) throw new ProcWriteError("line_missing")
    if (!(line.rejected > 0)) throw new ProcWriteError("nothing_rejected")
    return {
      patch: { lines: applyRejectDecision(po.lines, input.lineId, input.decision, note, at) },
      log: entry(actor, "reject_decided", at, { note, params: { line: line.name, qty: line.rejected, decision: input.decision } }),
    }
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_rejects_decided",
    organizationId: po.organizationId,
    to: [{ users: [po.supplierUserId] }, { permission: "invoices.manage" }],
    supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
    params: { number: po.docNumber, company: opts.orgName || actor.name, line: line?.name || "", qty: line?.rejected || 0, decision: `@pn_po_decision_${input.decision}`, note: note || "" },
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
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  const po = await transition(firestore, poId, (po) => {
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
  // Stamping the receipt is a `deliveries` write, which needs `deliveries.confirm`;
  // a preparer without it still raises the order — the receipt is linked later.
  const linkDelivery = Boolean(input.deliveryId) && (actor.isOwner || actor.canReceive)
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
    if (linkDelivery) tx.update(doc(firestore, "deliveries", input.deliveryId as string), { poId: poRef.id, poNumber: number })
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

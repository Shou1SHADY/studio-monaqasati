// TEST FIXTURE ONLY. The browser no longer raises an order without an RFQ (Procurement 2.0, NFR-01 / G-16, WP-S1-11): that is the server's
// `POST /api/procurement/po/{direct,service,retroactive}` (`po-direct-server.ts`). These are the former client writers, kept so tests that
// need an order to exist (approval, receipt, terms) can create one over the fake client Firestore the way they always did. Never import from the app.

import { collection, doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { directLinePrices, directOrderRefusal, directPoLines, directTotal, isSingleSource, type DirectLineInput, type DirectMode, type SingleSourceReason } from "@/lib/procurement/direct"
import { emitProcEvent, sarText } from "@/lib/procurement/events"
import { drawProcDocNumber } from "@/lib/procurement/numbering"
import { requiredApprover, round2 } from "@/lib/procurement/po"
import { PRICE_AGREEMENTS, type PriceAgreement } from "@/lib/procurement/prices"
import { serviceOrderLine, serviceOrderRefusal, serviceOrderValue } from "@/lib/procurement/service-order"
import { frozenTermsOf } from "@/lib/procurement/terms-freeze"
import { PURCHASE_ORDERS, type PoLine, type PoLogEntry, type ProcActor, type ProcurementPolicies, type PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError, type WriteOpts } from "@/lib/procurement/writes"

const entry = (actor: Pick<ProcActor, "uid" | "name">, action: PoLogEntry["action"], at: string, extra?: { note?: string | null; params?: PoLogEntry["params"] }): PoLogEntry => ({
  at,
  byId: actor.uid,
  byName: actor.name,
  action,
  note: extra?.note ?? null,
  params: extra?.params ?? null,
})

const requireText = (s: string | null | undefined): string => {
  const t = (s ?? "").trim()
  if (!t) throw new ProcWriteError("reason_required")
  return t
}

export interface DirectOrderInput {
  mode: DirectMode
  organizationId: string
  /** What the order is for, as its title reads ("Rebar 12mm" or the request's title). */
  title: string
  lines: DirectLineInput[]
  /** Agreement mode: the agreement to order on (its supplier and prices win). */
  agreementId?: string | null
  /** Direct mode: the supplier. A registered one carries its org and user. */
  supplier?: { orgId?: string | null; userId?: string | null; name: string } | null
  /** Above the cap: why one supplier (its code, and its sentence for the approver). */
  reason?: string | null
  reasonCode?: SingleSourceReason | null
  /** «مطلوب التسليم قبل», `YYYY-MM-DD`. */
  deliverBy?: string | null
  /** An agreement order the site calls off in parts, not one delivery. */
  callOffs?: boolean
  projectId?: string | null
  projectName?: string | null
  purchaseSource?: PurchaseOrder["purchaseSource"]
  policies: ProcurementPolicies
}

export async function createOrderWithoutRfq(firestore: Firestore, actor: ProcActor, input: DirectOrderInput, opts: WriteOpts = {}): Promise<{ id: string; docNumber: string }> {
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const today = at.slice(0, 10)
  const poRef = doc(collection(firestore, PURCHASE_ORDERS))

  const po = await runTransaction(firestore, async (tx) => {
    let agreement: PriceAgreement | null = null
    if (input.mode === "agreement") {
      if (!input.agreementId) throw new ProcWriteError("agreement_not_live")
      const snap = await tx.get(doc(firestore, PRICE_AGREEMENTS, input.agreementId))
      agreement = snap.exists() ? ({ id: snap.id, ...snap.data() } as PriceAgreement) : null
    }
    const supplierName = agreement ? agreement.supplierName : (input.supplier?.name || "").trim()
    const check = { mode: input.mode, lines: input.lines, supplierName, reason: input.reason || "", agreement, policies: input.policies, today, deliverBy: input.deliverBy ?? null, requireDeliverBy: input.deliverBy !== undefined }
    const refusal = directOrderRefusal(check)
    if (refusal) throw new ProcWriteError(refusal.code, refusal.params)
    const priced = directLinePrices(check)
    const supplierOrgId = agreement ? agreement.supplierOrgId : input.supplier?.orgId || "guest"
    const number = await drawProcDocNumber(firestore, tx, input.organizationId, "PO", now.getUTCFullYear())
    const singleSource = isSingleSource(check)
    const reason = singleSource ? (input.reason || "").trim() : null
    const order: Omit<PurchaseOrder, "id"> = {
      organizationId: input.organizationId,
      docNumber: number,
      status: "awaiting_approval",
      basis: "direct",
      rfqId: null,
      rfqTitle: input.title.trim(),
      offerId: null,
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
      purchaseSource: input.purchaseSource ?? null,
      agreementId: agreement?.id ?? null,
      agreementNo: agreement?.docNumber ?? null,
      supplierOrgId,
      // A registered company's id IS its owner's uid, so an agreement's supplier
      // can receive the order on its portal.
      supplierUserId: agreement ? agreement.supplierOrgId : (input.supplier?.userId ?? null),
      supplierName,
      isGuestSupplier: supplierOrgId === "guest",
      lines: directPoLines(priced),
      totalExVat: directTotal(priced),
      vatRate: 0.15,
      offersCount: 0,
      lowestOfferTotal: null,
      awardReasonCode: reason ? "other" : null,
      awardReasonText: reason,
      shortCompetition: singleSource,
      noOfficialQuote: !agreement,
      // Every order carries its frozen terms (G-08): no RFQ and no offer, so the default, written out.
      ...frozenTermsOf({}, null),
      preparedById: actor.uid,
      preparedByName: actor.name,
      createdAt: at,
      requestedDeliveryDate: input.deliverBy || null,
      approverKind: "manager",
      approvedById: null,
      approvedAt: null,
      returnedReason: null,
      rating: null,
      log: [
        {
          at,
          byId: actor.uid,
          byName: actor.name,
          action: "created",
          note: reason,
          params: { basis: "direct", number, agreement: agreement?.docNumber ?? "" },
        },
      ],
      updatedAt: serverTimestamp(),
    }
    const routed = { ...order, id: poRef.id } as PurchaseOrder
    order.approverKind = requiredApprover(routed, input.policies, actor.isOwner || actor.canApprove)
    // Optional facts the order type does not carry yet (read by the exceptions
    // report and the PO drawer when present): the single-source reason code and
    // how an agreement order is delivered.
    tx.set(poRef, { ...order, ...(singleSource && input.reasonCode ? { singleSourceReason: input.reasonCode } : {}), ...(input.mode === "agreement" ? { deliveryMode: input.callOffs ? "calloff" : "once" } : {}) })
    return order
  })

  await emitProcEvent(firestore, actor, {
    kind: "po_awaiting_approval",
    organizationId: input.organizationId,
    to: [po.approverKind === "owner" ? { owner: true } : { permission: "po.approve" }],
    params: { number: po.docNumber, supplier: po.supplierName, amount: sarText(po.totalExVat, opts.locale), rfq: po.rfqTitle },
    poId: poRef.id,
    copy: opts.copy,
  })
  return { id: poRef.id, docNumber: po.docNumber }
}

const SERVICE_REFUSAL_CODE = { description_missing: "order_no_lines", supplier_missing: "order_supplier_missing", value_missing: "price_missing", due_past: "date_invalid" } as const

export interface ServiceOrderWriteInput {
  organizationId: string
  description: string
  supplier: { orgId?: string | null; userId?: string | null; name: string }
  value: number | string
  dueBy?: string | null
  /** Charged to a project, or null = a general expense. */
  projectId?: string | null
  projectName?: string | null
  policies: ProcurementPolicies
}

/** «أمر مباشر لخدمة أو مقطوعية»: one lump-sum line, awaiting approval like any direct order. */
export async function createServiceOrder(firestore: Firestore, actor: ProcActor, input: ServiceOrderWriteInput, opts: WriteOpts = {}): Promise<{ id: string; docNumber: string }> {
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const refusal = serviceOrderRefusal({ description: input.description, supplierName: input.supplier.name, value: input.value, dueBy: input.dueBy ?? null }, at.slice(0, 10))
  if (refusal) throw new ProcWriteError(SERVICE_REFUSAL_CODE[refusal], { item: input.description.trim() })
  const value = serviceOrderValue(input.value)
  const poRef = doc(collection(firestore, PURCHASE_ORDERS))
  const po = await runTransaction(firestore, async (tx) => {
    const number = await drawProcDocNumber(firestore, tx, input.organizationId, "PO", now.getUTCFullYear())
    const supplierOrgId = input.supplier.orgId || "guest"
    const order: Omit<PurchaseOrder, "id"> = {
      organizationId: input.organizationId,
      docNumber: number,
      status: "awaiting_approval",
      basis: "direct",
      rfqId: null,
      rfqTitle: input.description.trim(),
      offerId: null,
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
      purchaseSource: null,
      agreementId: null,
      agreementNo: null,
      supplierOrgId,
      supplierUserId: input.supplier.userId ?? null,
      supplierName: input.supplier.name.trim(),
      isGuestSupplier: supplierOrgId === "guest",
      lines: [serviceOrderLine(input.description, value)],
      totalExVat: value,
      vatRate: 0.15,
      offersCount: 0,
      lowestOfferTotal: null,
      awardReasonCode: null,
      awardReasonText: null,
      shortCompetition: false,
      noOfficialQuote: true,
      ...frozenTermsOf({}, null),
      preparedById: actor.uid,
      preparedByName: actor.name,
      createdAt: at,
      requestedDeliveryDate: input.dueBy || null,
      approverKind: "manager",
      approvedById: null,
      approvedAt: null,
      returnedReason: null,
      rating: null,
      log: [{ at, byId: actor.uid, byName: actor.name, action: "created", note: null, params: { basis: "direct", number, agreement: "", kind: "service" } }],
      updatedAt: serverTimestamp(),
    }
    order.approverKind = requiredApprover({ ...order, id: poRef.id } as PurchaseOrder, input.policies, actor.isOwner || actor.canApprove)
    tx.set(poRef, { ...order, orderKind: "service" })
    return order
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_awaiting_approval",
    organizationId: input.organizationId,
    to: [po.approverKind === "owner" ? { owner: true } : { permission: "po.approve" }],
    params: { number: po.docNumber, supplier: po.supplierName, amount: sarText(po.totalExVat, opts.locale), rfq: po.rfqTitle },
    poId: poRef.id,
    copy: opts.copy,
  })
  return { id: poRef.id, docNumber: po.docNumber }
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
      // Every order carries its frozen terms (G-08): no RFQ and no offer here, so the default, written out.
      ...frozenTermsOf({}, null),
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

// Placing an order without an RFQ — on a price agreement, or as a direct
// purchase under the cap (`./direct`). ONE transaction: the agreement is read
// again (it may have ended since the screen opened), the refusal re-run, the
// PO number drawn, the order written awaiting approval. Approval, sending and
// receipt then follow the order's ordinary path (`./writes`).

import { collection, doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { directLinePrices, directOrderRefusal, directPoLines, directTotal, isSingleSource, type DirectLineInput, type DirectMode, type SingleSourceReason } from "./direct"
import { emitProcEvent, sarText } from "./events"
import { drawProcDocNumber } from "./numbering"
import { requiredApprover } from "./po"
import { PRICE_AGREEMENTS, type PriceAgreement } from "./prices"
import { serviceOrderLine, serviceOrderRefusal, serviceOrderValue } from "./service-order"
import { PURCHASE_ORDERS, type ProcActor, type ProcurementPolicies, type PurchaseOrder } from "./types"
import { ProcWriteError, type WriteOpts } from "./writes"

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

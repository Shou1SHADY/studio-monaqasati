// The orders raised WITHOUT an RFQ, on the server (Procurement 2.0, NFR-01 / G-16, WP-S1-11): a direct purchase from one supplier, an
// order on a live price agreement, a lump-sum service order, and an order raised after the goods arrived (retroactive). Each is ONE
// Admin transaction that re-runs the rules the screen showed — the lines, the agreement (still in force, the company's own), the
// supplier (a registered one must exist and be verified), the project (the company's own), the direct-purchase cap with its reason,
// who approves it (the limit INCLUDING VAT, the owner alone above it, for a direct order over the cap and for a retroactive one) —
// and writes the order born `awaiting_approval`, with the approver class STORED by the server, never taken from the browser. The
// ruleset has no create rule for orders any more: this is the only door.

import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore"
import { z } from "zod"
import { riyadhDay } from "@/lib/hr/format"
import { formatYearlyDocNumber } from "@/lib/sales-numbering"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { directLinePrices, directOrderRefusal, directPoLines, directTotal, isSingleSource, SINGLE_SOURCE_REASONS, type DirectOrderCheck } from "./direct"
import { sarText, type ProcEventKind } from "./events"
import { MAX_UNIT_PRICE } from "./input-limits"
import { requiredApprover, round2 } from "./po"
import { PRICE_AGREEMENTS, type PriceAgreement } from "./prices"
import { supplierFactsOf, type PoCtx } from "./po-server"
import { serviceOrderLine, serviceOrderRefusal, serviceOrderValue } from "./service-order"
import { frozenTermsOf } from "./terms-freeze"
import { PURCHASE_ORDERS, type PoLine, type PoLogEntry, type ProcActor, type PurchaseOrder } from "./types"

type Rec = Record<string, unknown>

export type PoDirectReason =
  | "no_permission"
  | "order_no_lines"
  | "order_supplier_missing"
  | "supplier_unverified"
  | "price_missing"
  | "reason_required"
  | "agreement_not_live"
  | "agreement_line_missing"
  | "delivery_date_missing"
  | "date_invalid"
  | "not_no_po"

const STATUS: Partial<Record<PoDirectReason, number>> = { no_permission: 403, order_supplier_missing: 400, order_no_lines: 400, price_missing: 400, reason_required: 400, date_invalid: 400, delivery_date_missing: 400 }

export class PoDirectError extends Error {
  readonly status: number
  constructor(
    readonly reason: PoDirectReason,
    readonly params: Record<string, string | number> = {}
  ) {
    super(reason)
    this.name = "PoDirectError"
    this.status = STATUS[reason] ?? 409
  }
}

// ---------------------------------------------------------------------------
// What each route accepts — the company, the approver class and the totals are never in it
// ---------------------------------------------------------------------------

const name = z.string().trim().min(1).max(200)
const unit = z.string().trim().max(40)
const id = z.string().trim().min(1).max(128)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const money = z.number().finite().min(0).max(MAX_UNIT_PRICE * 1000)
const locale = z.enum(["ar", "en"]).optional()

const supplierInput = z.object({ orgId: id.nullish(), name })

const purchaseSource = z
  .object({
    kind: z.string().trim().max(40),
    workOrderId: id.optional(),
    purchaseRequestId: id.optional(),
    projectId: id.optional(),
    warehouseId: id.optional(),
    itemId: id.optional(),
  })
  .nullish()

export const directBody = z.object({
  mode: z.enum(["agreement", "direct"]),
  title: z.string().trim().max(200),
  lines: z
    .array(z.object({ name, unit, quantity: z.number().finite().positive().max(10_000_000), unitPrice: z.number().finite().min(0).max(MAX_UNIT_PRICE).nullable(), spec: z.string().trim().max(300).nullish(), path: z.string().trim().max(200).nullish() }))
    .min(1)
    .max(100),
  agreementId: id.nullish(),
  supplier: supplierInput.nullish(),
  reason: z.string().trim().max(500).nullish(),
  reasonCode: z.enum(SINGLE_SOURCE_REASONS as [string, ...string[]]).nullish(),
  deliverBy: day.nullish(),
  callOffs: z.boolean().optional(),
  projectId: id.nullish(),
  purchaseSource,
  locale,
})
export type DirectBody = z.infer<typeof directBody>

export const serviceBody = z.object({
  description: z.string().trim().min(1).max(300),
  supplier: supplierInput,
  value: z.union([z.number().finite(), z.string().trim().max(30)]),
  dueBy: day.nullish(),
  projectId: id.nullish(),
  reason: z.string().trim().max(500).nullish(),
  locale,
})
export type ServiceBody = z.infer<typeof serviceBody>

export const retroactiveBody = z.object({
  rfqTitle: z.string().trim().max(200),
  supplier: z.object({ orgId: id.nullish(), name }),
  projectId: id.nullish(),
  lines: z.array(z.object({ name, unit, quantity: z.number().finite().min(0).max(10_000_000), unitPrice: z.number().finite().min(0).max(MAX_UNIT_PRICE).nullish(), accepted: z.number().finite().min(0).max(10_000_000).optional() })).min(1).max(200),
  totalExVat: money,
  deliveryId: id.nullish(),
  reason: z.string().trim().max(500),
  locale,
})
export type RetroactiveBody = z.infer<typeof retroactiveBody>

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const mayPrepare = (actor: ProcActor): void => {
  if (!actor.isOwner && !actor.canPrepare) throw new PoDirectError("no_permission")
}

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

interface SupplierOnFile {
  orgId: string | null
  userId: string | null
  name: string
}

/** The supplier the order is addressed to. A registered one must exist as a supplier company and not be unverified; his user is derived here, never taken from the browser. */
async function supplierOnFile(ctx: PoCtx, input: { orgId?: string | null; name: string } | null | undefined, fallbackName = ""): Promise<SupplierOnFile> {
  const orgId = text(input?.orgId)
  const given = text(input?.name) || fallbackName
  if (!orgId || orgId === "guest") {
    if (!given) throw new PoDirectError("order_supplier_missing")
    return { orgId: null, userId: null, name: given }
  }
  if (orgId === ctx.orgId) throw new PoDirectError("order_supplier_missing")
  let snap = await ctx.db.collection("users").doc(orgId).get()
  let userId: string | null = orgId
  if (!snap.exists) {
    snap = await ctx.db.collection("organizations").doc(orgId).get()
    userId = snap.exists ? text((snap.data() as Rec).ownerUserId) || null : null
  }
  const data = (snap.exists ? snap.data() : undefined) as Rec | undefined
  if (!data || data.role !== "Supplier") throw new PoDirectError("order_supplier_missing")
  const facts = await supplierFactsOf(ctx.db, ctx.orgId, { supplierOrgId: orgId, isGuestSupplier: false })
  if (facts?.verified === false) throw new PoDirectError("supplier_unverified")
  return { orgId, userId, name: given || text(data.companyName) || text(data.name) }
}

async function projectOf(ctx: PoCtx, projectId: string | null | undefined): Promise<{ id: string; name: string } | null> {
  const id = text(projectId)
  if (!id) return null
  const data = (await ctx.db.collection("projects").doc(id).get()).data() as Rec | undefined
  if (!data || data.organizationId !== ctx.orgId) throw new PoDirectError("no_permission")
  return { id, name: text(data.name) || text(data.title) }
}

/** The next order number of the year, drawn inside the transaction (`mfgCounters`, the same sequence the award draws from). */
async function drawPoNumber(db: Firestore, tx: Transaction, orgId: string, year: number): Promise<{ number: string; write: () => void }> {
  const ref = db.collection("mfgCounters").doc(`${orgId}__PO__${year}`)
  const snap = await tx.get(ref)
  const last = snap.exists ? Number(snap.data()?.last) || 0 : 0
  return {
    number: formatYearlyDocNumber("PO", year, last + 1),
    write: () => void tx.set(ref, { organizationId: orgId, type: "PO", year, last: last + 1, updatedAt: FieldValue.serverTimestamp() }),
  }
}

type Draft = Omit<PurchaseOrder, "id" | "docNumber"> & Rec

const baseOrder = (ctx: PoCtx, at: string, over: Partial<Draft> & Pick<Draft, "basis" | "rfqTitle" | "supplierOrgId" | "supplierUserId" | "supplierName" | "isGuestSupplier" | "lines" | "totalExVat" | "shortCompetition" | "noOfficialQuote">): Draft =>
  ({
    organizationId: ctx.orgId,
    status: "awaiting_approval",
    rfqId: null,
    offerId: null,
    projectId: null,
    projectName: null,
    purchaseSource: null,
    vatRate: 0.15,
    offersCount: 0,
    lowestOfferTotal: null,
    awardReasonCode: null,
    awardReasonText: null,
    ...frozenTermsOf({}, null),
    preparedById: ctx.actor.uid,
    preparedByName: ctx.actor.name,
    createdAt: at,
    approverKind: "manager",
    approvedById: null,
    approvedAt: null,
    returnedReason: null,
    rating: null,
    log: [],
    ...over,
  }) as Draft

const logCreated = (ctx: PoCtx, at: string, note: string | null, params: Record<string, string | number>): PoLogEntry => ({ at, byId: ctx.actor.uid, byName: ctx.actor.name, action: "created", note, params })

async function announce(ctx: PoCtx, order: { id: string; docNumber: string; supplierName: string; totalExVat: number; vatRate: number; rfqTitle: string; approverKind: "manager" | "owner" }): Promise<void> {
  try {
    await notifyNamed(
      ctx.db,
      { uid: ctx.actor.uid, name: ctx.actor.name },
      {
        kind: "po_awaiting_approval" as ProcEventKind,
        organizationId: ctx.orgId,
        params: { number: order.docNumber, supplier: order.supplierName, amount: sarText(order.totalExVat * (1 + order.vatRate), ctx.locale), rfq: order.rfqTitle },
        poId: order.id,
      },
      [],
      order.approverKind === "owner" ? { owner: true } : { owner: false, permissions: ["po.approve"] }
    )
  } catch (err) {
    console.warn("approval notice failed:", (err as { code?: string })?.code || err)
  }
}

export interface RaisedOrder {
  id: string
  docNumber: string
  approverKind: "manager" | "owner"
}

// ---------------------------------------------------------------------------
// A direct purchase, or an order on a live price agreement
// ---------------------------------------------------------------------------

export async function createDirectOrder(ctx: PoCtx, input: DirectBody): Promise<RaisedOrder> {
  mayPrepare(ctx.actor)
  const { db, actor, policies, now } = ctx
  const at = now.toISOString()
  const today = riyadhDay(now)
  const project = await projectOf(ctx, input.projectId)
  const registered = input.mode === "direct" ? await supplierOnFile(ctx, input.supplier) : null
  const ref = db.collection(PURCHASE_ORDERS).doc()

  const order = await db.runTransaction(async (tx) => {
    let agreement: PriceAgreement | null = null
    if (input.mode === "agreement") {
      if (!input.agreementId) throw new PoDirectError("agreement_not_live")
      const snap = await tx.get(db.collection(PRICE_AGREEMENTS).doc(input.agreementId))
      const data = snap.exists ? (snap.data() as Omit<PriceAgreement, "id">) : null
      agreement = data && data.organizationId === ctx.orgId ? { ...data, id: snap.id } : null
    }
    const supplier: SupplierOnFile = agreement ? await supplierOnFile(ctx, { orgId: agreement.supplierOrgId, name: agreement.supplierName }) : (registered ?? { orgId: null, userId: null, name: "" })
    const check: DirectOrderCheck = { mode: input.mode, lines: input.lines, supplierName: supplier.name, reason: input.reason || "", reasonCode: input.reasonCode ?? null, agreement, policies, today, deliverBy: input.deliverBy ?? null, requireDeliverBy: input.deliverBy !== undefined }
    const refusal = directOrderRefusal(check)
    if (refusal) throw new PoDirectError(refusal.code as PoDirectReason, refusal.params)
    const priced = directLinePrices(check)
    const singleSource = isSingleSource(check)
    const reason = singleSource ? (input.reason || "").trim() : null
    const drawn = await drawPoNumber(db, tx, ctx.orgId, Number(today.slice(0, 4)))
    const draft = baseOrder(ctx, at, {
      basis: "direct",
      rfqTitle: input.title.trim() || priced[0]?.name || "",
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      purchaseSource: (input.purchaseSource as PurchaseOrder["purchaseSource"]) ?? null,
      agreementId: agreement?.id ?? null,
      agreementNo: agreement?.docNumber ?? null,
      supplierOrgId: supplier.orgId || "guest",
      supplierUserId: supplier.userId,
      supplierName: supplier.name,
      isGuestSupplier: !supplier.orgId,
      lines: directPoLines(priced),
      totalExVat: directTotal(priced),
      awardReasonCode: reason ? "other" : null,
      awardReasonText: reason,
      shortCompetition: singleSource,
      noOfficialQuote: !agreement,
      requestedDeliveryDate: input.deliverBy || null,
      ...(singleSource ? { tags: { directOver: { why: reason || "" } } } : {}),
    })
    const routed = { ...draft, id: ref.id, docNumber: drawn.number } as PurchaseOrder
    draft.approverKind = singleSource ? "owner" : requiredApprover(routed, policies, actor.isOwner || actor.canApprove)
    draft.log = [logCreated(ctx, at, reason, { basis: "direct", number: drawn.number, agreement: agreement?.docNumber ?? "" })]
    drawn.write()
    tx.set(ref, { ...clean({ ...draft, docNumber: drawn.number, ...(singleSource && input.reasonCode ? { singleSourceReason: input.reasonCode } : {}), ...(input.mode === "agreement" ? { deliveryMode: input.callOffs ? "calloff" : "once" } : {}) }), updatedAt: FieldValue.serverTimestamp() })
    return { id: ref.id, docNumber: drawn.number, approverKind: draft.approverKind, supplierName: draft.supplierName, totalExVat: draft.totalExVat, vatRate: draft.vatRate, rfqTitle: draft.rfqTitle }
  })
  await announce(ctx, order)
  return { id: order.id, docNumber: order.docNumber, approverKind: order.approverKind }
}

// ---------------------------------------------------------------------------
// «أمر مباشر لخدمة أو مقطوعية»
// ---------------------------------------------------------------------------

const SERVICE_REFUSAL: Record<NonNullable<ReturnType<typeof serviceOrderRefusal>>, PoDirectReason> = {
  description_missing: "order_no_lines",
  supplier_missing: "order_supplier_missing",
  value_missing: "price_missing",
  due_past: "date_invalid",
}

export async function createServiceOrder(ctx: PoCtx, input: ServiceBody): Promise<RaisedOrder> {
  mayPrepare(ctx.actor)
  const { db, actor, policies, now } = ctx
  const at = now.toISOString()
  const today = riyadhDay(now)
  const refusal = serviceOrderRefusal({ description: input.description, supplierName: input.supplier.name, value: input.value, dueBy: input.dueBy ?? null }, today)
  if (refusal) throw new PoDirectError(SERVICE_REFUSAL[refusal], { item: input.description.trim() })
  const value = serviceOrderValue(input.value)
  const overCap = value > policies.directPurchaseCap
  const reason = (input.reason || "").trim()
  if (overCap && !reason) throw new PoDirectError("reason_required")
  const [project, supplier] = await Promise.all([projectOf(ctx, input.projectId), supplierOnFile(ctx, input.supplier)])
  const ref = db.collection(PURCHASE_ORDERS).doc()

  const order = await db.runTransaction(async (tx) => {
    const drawn = await drawPoNumber(db, tx, ctx.orgId, Number(today.slice(0, 4)))
    const draft = baseOrder(ctx, at, {
      basis: "direct",
      rfqTitle: input.description.trim(),
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      supplierOrgId: supplier.orgId || "guest",
      supplierUserId: supplier.userId,
      supplierName: supplier.name,
      isGuestSupplier: !supplier.orgId,
      lines: [serviceOrderLine(input.description, value)],
      totalExVat: value,
      awardReasonCode: overCap ? "other" : null,
      awardReasonText: overCap ? reason : null,
      shortCompetition: overCap,
      noOfficialQuote: true,
      requestedDeliveryDate: input.dueBy || null,
      agreementId: null,
      agreementNo: null,
      ...(overCap ? { tags: { directOver: { why: reason } } } : {}),
    })
    const routed = { ...draft, id: ref.id, docNumber: drawn.number } as PurchaseOrder
    draft.approverKind = overCap ? "owner" : requiredApprover(routed, policies, actor.isOwner || actor.canApprove)
    draft.log = [logCreated(ctx, at, overCap ? reason : null, { basis: "direct", number: drawn.number, agreement: "", kind: "service" })]
    drawn.write()
    tx.set(ref, { ...clean({ ...draft, docNumber: drawn.number, orderKind: "service" }), updatedAt: FieldValue.serverTimestamp() })
    return { id: ref.id, docNumber: drawn.number, approverKind: draft.approverKind, supplierName: draft.supplierName, totalExVat: draft.totalExVat, vatRate: draft.vatRate, rfqTitle: draft.rfqTitle }
  })
  await announce(ctx, order)
  return { id: order.id, docNumber: order.docNumber, approverKind: order.approverKind }
}

// ---------------------------------------------------------------------------
// Retroactive — an order for goods that already arrived (§6.1-11): the OWNER's alone, born with what was accepted
// ---------------------------------------------------------------------------

export async function createRetroactiveOrder(ctx: PoCtx, input: RetroactiveBody): Promise<RaisedOrder & { deliveryLinked: boolean }> {
  mayPrepare(ctx.actor)
  const { db, actor, now } = ctx
  const at = now.toISOString()
  const reason = input.reason.trim()
  if (!reason) throw new PoDirectError("reason_required")
  const [project, supplier] = await Promise.all([projectOf(ctx, input.projectId), supplierOnFile(ctx, input.supplier)])
  const lines: PoLine[] = input.lines.map((l, i) => ({
    id: `l${i + 1}`,
    name: l.name.trim(),
    unit: (l.unit || "").trim(),
    quantity: l.quantity,
    unitPrice: l.unitPrice == null ? null : l.unitPrice,
    accepted: l.accepted ?? l.quantity,
    rejected: 0,
    held: 0,
    cancelled: 0,
    boqItemId: null,
    rfqProductIndex: null,
  }))
  const priced = lines.every((l) => l.unitPrice != null)
  const totalExVat = round2(priced ? lines.reduce((s, l) => s + l.quantity * (l.unitPrice ?? 0), 0) : input.totalExVat)
  const ref = db.collection(PURCHASE_ORDERS).doc()
  const deliveryRef = input.deliveryId ? db.collection("deliveries").doc(input.deliveryId) : null

  const order = await db.runTransaction(async (tx) => {
    if (deliveryRef) {
      const snap = await tx.get(deliveryRef)
      const d = (snap.exists ? snap.data() : undefined) as Rec | undefined
      if (!d || d.contractorOrgId !== ctx.orgId || d.poId || d.regularisation) throw new PoDirectError("not_no_po")
    }
    const drawn = await drawPoNumber(db, tx, ctx.orgId, Number(riyadhDay(now).slice(0, 4)))
    const draft = baseOrder(ctx, at, {
      basis: "retroactive",
      rfqTitle: input.rfqTitle.trim() || supplier.name,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      supplierOrgId: supplier.orgId || "guest",
      supplierUserId: supplier.userId,
      supplierName: supplier.name,
      isGuestSupplier: !supplier.orgId,
      lines,
      totalExVat,
      awardReasonCode: "other",
      awardReasonText: reason,
      shortCompetition: false,
      noOfficialQuote: true,
      approverKind: "owner",
    })
    draft.log = [logCreated(ctx, at, reason, { basis: "retroactive", number: drawn.number, deliveryId: input.deliveryId || "" })]
    drawn.write()
    tx.set(ref, { ...clean({ ...draft, docNumber: drawn.number }), updatedAt: FieldValue.serverTimestamp() })
    if (deliveryRef) tx.update(deliveryRef, { poId: ref.id, poNumber: drawn.number, regularisedAt: at, regularisedById: actor.uid, regularisedByName: actor.name })
    return { id: ref.id, docNumber: drawn.number, supplierName: draft.supplierName, totalExVat, vatRate: 0.15, rfqTitle: draft.rfqTitle }
  })
  await announce(ctx, { ...order, approverKind: "owner" })
  return { id: order.id, docNumber: order.docNumber, approverKind: "owner", deliveryLinked: Boolean(deliveryRef) }
}

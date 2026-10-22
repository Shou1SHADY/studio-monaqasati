// What a receipt does AFTER its transaction committed, written with the Admin SDK (G-09, WP-S5-01). The receiver's confirmation is
// the receipt; these are its consequences and each rides on its own, best-effort: stock into the store the goods landed in, the
// books when Finance is on, Manufacturing's purchase request, the outbox event of the unit that received them (`inv:GRN` or
// `prj:GRN`), the people who must know. A receipt that landed no stock is still a receipt — the result says which of its
// consequences did not happen, so the screen can.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { ACCOUNTING_SETTINGS, ACCOUNTING_PERIODS, JOURNAL_ENTRIES, buildEntry, entryDocId, isPeriodClosed, type AccountingPeriod } from "@/lib/accounting/journal"
import { STANDARD_VAT_PERCENT, postGoodsReceipt } from "@/lib/accounting/posting-rules"
import { buildNotification, mfgLinks } from "@/lib/mfg-events"
import { notifyNamed, permissionHolders } from "@/lib/supplier-free/server-notify"
import { itemMergeKey } from "@/lib/warehouse-transfer"
import { projectReceiptKey, warehouseReceiptKey } from "./event-keys"
import { bareDocNumber } from "./events"
import { sendProcEvent } from "./proc-event-server"
import { stockItemsOf, type StockItem } from "./receipt-count"
import type { DeliveryLine, PurchaseOrder } from "./types"

export type ReceiverModule = "inventory" | "projects"

export interface LandingPlace {
  warehouseId: string
  module: ReceiverModule
}

const CENTRAL_AR = { name: "المستودع المركزي", location: "المقر الرئيسي", description: "المخزون الرئيسي للشركة — مستودعات المشاريع تسحب منه وتُرجع إليه" }

export const centralWarehouseId = (orgId: string): string => `central_${orgId}`

/**
 * Where the accepted goods go: the store named on the delivery, else the order's project's own store (charged to the site), else the
 * store the receiver is registered at, else the company's central store (made on the fly with the same id everyone uses). The module
 * that keeps the place is the one that received them.
 */
export async function resolveLanding(
  db: Firestore,
  orgId: string,
  input: { warehouseId?: string | null; projectId?: string | null; receiverUserId?: string | null },
  /** A page that only SHOWS where the goods will go must not make the central store as a side effect. */
  create = true
): Promise<LandingPlace> {
  let id = input.warehouseId || null
  if (!id && input.projectId) id = ((await db.collection("projects").doc(input.projectId).get()).data()?.warehouseId as string | undefined) || null
  if (!id && input.receiverUserId) {
    const mine = await db.collection("procurementReceivers").where("organizationId", "==", orgId).where("userId", "==", input.receiverUserId).get()
    const placed = mine.docs.map((d) => d.data() as { active?: boolean; warehouseIds?: string[] }).find((r) => r.active !== false && (r.warehouseIds || []).length > 0)
    id = placed?.warehouseIds?.[0] || null
  }
  if (!id) id = centralWarehouseId(orgId)
  const ref = db.collection("warehouses").doc(id)
  const snap = await ref.get()
  if (!snap.exists && id === centralWarehouseId(orgId)) {
    if (create) await ref.set({ ...CENTRAL_AR, organizationId: orgId, isCentral: true, projectId: null, projectName: null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { warehouseId: id, module: "inventory" }
  }
  const projectId = (snap.data()?.projectId as string | null | undefined) || null
  return { warehouseId: id, module: projectId ? "projects" : "inventory" }
}

/** The Admin twin of `receiveDelivery`: stock is added by name and unit; a new row only when nothing matches; the unit cost of a row that
 * already holds stock becomes the quantity-weighted average. */
export async function landStock(db: Firestore, input: { orgId: string; warehouseId: string; items: StockItem[] }): Promise<void> {
  if (!input.items.length) return
  const col = db.collection("warehouses").doc(input.warehouseId).collection("inventoryItems")
  const existing = await col.get()
  const byKey = new Map<string, string>()
  for (const d of existing.docs) {
    const row = d.data() as { name?: string; unit?: string; trackingMode?: string | null; lot?: string | null; remnant?: boolean | null }
    if (row.name && row.unit && row.trackingMode !== "unit") byKey.set(itemMergeKey({ name: row.name, unit: row.unit, lot: row.lot, remnant: row.remnant }), d.id)
  }
  for (const item of input.items) {
    const name = item.name?.trim()
    const unit = item.unit?.trim()
    const quantity = Number(item.quantity)
    if (!name || !unit || !Number.isFinite(quantity) || quantity <= 0) continue
    const matchId = byKey.get(itemMergeKey({ name, unit }))
    const ref = matchId ? col.doc(matchId) : col.doc()
    const unitCost = item.unitCost != null && Number.isFinite(item.unitCost) && item.unitCost >= 0 ? item.unitCost : null
    await db.runTransaction(async (tx) => {
      const snap = matchId ? await tx.get(ref) : null
      if (snap?.exists) {
        const cur = snap.data() as { quantity?: number; unitCost?: number | null }
        const onHand = Math.max(0, Number(cur.quantity) || 0)
        const oldCost = cur.unitCost != null && Number.isFinite(cur.unitCost) ? cur.unitCost : null
        const averaged = unitCost == null ? undefined : oldCost == null || onHand === 0 ? unitCost : Math.round(((onHand * oldCost + quantity * unitCost) / (onHand + quantity)) * 100) / 100
        tx.update(ref, { quantity: onHand + quantity, ...(averaged !== undefined ? { unitCost: averaged } : {}), updatedAt: FieldValue.serverTimestamp() })
      } else {
        tx.set(ref, { name, sku: null, quantity, unit, unitCost, minStockLevel: null, trackingMode: null, organizationId: input.orgId, warehouseId: input.warehouseId, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      }
    })
    if (!matchId) byKey.set(itemMergeKey({ name, unit }), ref.id)
  }
}

export interface PostingFacts {
  orgId: string
  deliveryId: string
  net: number
  by: { uid: string; name: string }
  supplierId: string | null
  supplierName: string | null
  rfqTitle: string | null
  projectId: string | null
  projectName: string | null
  /** `YYYY-MM-DD`. */
  date: string
}

/** The Admin twin of `onGoodsReceived`: nothing when Accounting is off, a closed period refuses, the entry sits at its deterministic id so a retry cannot post twice. */
export async function postBooks(db: Firestore, f: PostingFacts): Promise<boolean> {
  const settings = await db.collection(ACCOUNTING_SETTINGS).where("organizationId", "==", f.orgId).limit(1).get()
  if (settings.empty || settings.docs[0].data().enabled !== true) return false
  const vat = Math.round(f.net * STANDARD_VAT_PERCENT) / 100
  const result = postGoodsReceipt({ deliveryId: f.deliveryId, net: f.net, vat, supplierId: f.supplierId, supplierName: f.supplierName, rfqTitle: f.rfqTitle, projectId: f.projectId, projectName: f.projectName, date: f.date })
  if (result.empty) return false
  const periods = (await db.collection(ACCOUNTING_PERIODS).where("organizationId", "==", f.orgId).get()).docs.map((d) => d.data() as AccountingPeriod)
  if (isPeriodClosed(periods, result.date)) return false
  const entries = await db.collection(JOURNAL_ENTRIES).where("organizationId", "==", f.orgId).get()
  let max = 0
  for (const d of entries.docs) max = Math.max(max, Number((d.data() as { entryNumber?: number }).entryNumber) || 0)
  const entry = buildEntry({ organizationId: f.orgId, date: result.date, kind: "auto", sourceType: result.sourceType, sourceId: result.sourceId, description: result.description, lines: result.lines, entryNumber: max + 1, status: "posted", userId: f.by.uid, userName: f.by.name, defaultCostCenter: result.costCenter })
  await db.collection(JOURNAL_ENTRIES).doc(entryDocId(f.orgId, entry.sourceType, entry.sourceId)).set({ ...entry, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  return true
}

/** The Admin twin of `markPurchaseArrived`: the workshop's purchase request this order answered is «وصل». */
export async function closePurchaseRequest(db: Firestore, input: { workOrderId: string; purchaseRequestId: string; actorName: string; at: string }): Promise<{ closed: boolean; request: { quantity?: number; unit?: string; itemName?: string; byId?: string } | null; order: { docNumber?: string } | null }> {
  const ref = db.collection("workOrders").doc(input.workOrderId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.data() as { purchaseRequests?: Array<{ id: string; state?: string; quantity?: number; unit?: string; itemName?: string; byId?: string }>; docNumber?: string } | undefined
    if (!snap.exists || !data) return { closed: false, request: null, order: null }
    let found: { quantity?: number; unit?: string; itemName?: string; byId?: string } | null = null
    const rows = (data.purchaseRequests || []).map((p) => {
      if (p.id !== input.purchaseRequestId) return p
      found = p
      return p.state === "sent" || p.state === "ordered" ? { ...p, state: "arrived", arrivedAt: input.at, arrivedBy: input.actorName } : p
    })
    if (!found) return { closed: false, request: null, order: { docNumber: data.docNumber } }
    tx.update(ref, { purchaseRequests: rows, updatedAt: FieldValue.serverTimestamp() })
    return { closed: true, request: found, order: { docNumber: data.docNumber } }
  })
}

export interface ReceiptEffectsInput {
  orgId: string
  deliveryId: string
  docNumber: string
  /** The party who counted — a person with or without an account. */
  receiver: { uid: string; name: string }
  place: LandingPlace
  po: PurchaseOrder | null
  lines: DeliveryLine[]
  net: number | null
  legacyNet: number | null
  supplierName: string | null
  supplierUserId: string | null
  supplierOrgId: string | null
  isGuestDelivery: boolean
  rfqTitle: string | null
  projectId: string | null
  projectName: string | null
  purchaseSource: { kind: string; workOrderId?: string; purchaseRequestId?: string } | null | undefined
  /** Who forwarded the notice, to tell him it is counted. */
  forwardedById: string | null
  noticeSeq: number | null
  at: string
}

export interface ReceiptEffects {
  stockLanded: boolean
  posted: boolean
  mfgClosed: boolean
  eventSent: boolean
}

const quiet = async <T,>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await run()
  } catch (err) {
    console.warn(`receipt effect «${label}» failed:`, (err as { code?: string })?.code || err)
    return fallback
  }
}

/** Everything a committed receipt sets in motion — each on its own, none stopping the next. */
export async function runReceiptEffects(db: Firestore, e: ReceiptEffectsInput): Promise<ReceiptEffects> {
  const out: ReceiptEffects = { stockLanded: false, posted: false, mfgClosed: false, eventSent: false }
  const items = stockItemsOf(e.lines, e.po, e.legacyNet)

  out.stockLanded = await quiet(
    "stock",
    async () => {
      if (!items.length) return false
      await landStock(db, { orgId: e.orgId, warehouseId: e.place.warehouseId, items })
      return true
    },
    false
  )
  if (!out.stockLanded) await quiet("landed marker", () => db.collection("deliveries").doc(e.deliveryId).update({ landedWarehouseId: null, postedNet: null }), undefined)

  if (out.stockLanded && e.net != null && e.net > 0) {
    out.posted = await quiet(
      "books",
      () =>
        postBooks(db, {
          orgId: e.orgId,
          deliveryId: e.deliveryId,
          net: e.net as number,
          by: e.receiver,
          supplierId: e.po ? (e.po.isGuestSupplier ? null : e.po.supplierOrgId) : e.supplierOrgId && e.supplierOrgId !== "guest" ? e.supplierOrgId : null,
          supplierName: e.po?.supplierName || e.supplierName,
          rfqTitle: e.po?.rfqTitle || e.rfqTitle,
          projectId: e.po?.projectId ?? e.projectId,
          projectName: e.projectName ?? e.po?.projectName ?? null,
          date: e.at.slice(0, 10),
        }),
      false
    )
  }

  const src = e.purchaseSource
  if (out.stockLanded && src?.kind === "mfg_purchase" && src.workOrderId && src.purchaseRequestId) {
    const arrived = await quiet("workshop request", () => closePurchaseRequest(db, { workOrderId: src.workOrderId as string, purchaseRequestId: src.purchaseRequestId as string, actorName: e.receiver.name, at: e.at }), null)
    out.mfgClosed = Boolean(arrived?.closed)
    if (arrived?.closed && arrived.request) {
      const request = arrived.request
      await quiet(
        "workshop notice",
        async () => {
          const holders = await permissionHolders(db, e.orgId, ["manufacturing.manage"])
          const to = [...new Set([...holders, request.byId || ""].filter(Boolean))].filter((uid) => uid !== e.receiver.uid)
          const ref = `${arrived.order?.docNumber || src.workOrderId}`
          await Promise.all(
            to.map((uid) =>
              db
                .collection("users")
                .doc(uid)
                .collection("notifications")
                .add(
                  buildNotification(
                    {
                      kind: "purchase_arrived",
                      organizationId: e.orgId,
                      actor: { id: e.receiver.uid, name: e.receiver.name },
                      to: [],
                      params: { ref, qty: String(request.quantity ?? ""), unit: request.unit || "", item: request.itemName || "", block: "" },
                      workOrderId: src.workOrderId,
                      link: mfgLinks.order(src.workOrderId as string),
                      fallback: { title: "وصل ما طلبتَه من المشتريات", message: `وصل ${request.quantity ?? ""} ${request.unit || ""} ${request.itemName || ""} للأمر ${ref}.`.replace(/\s+/g, " ").trim() },
                    },
                    uid,
                    e.at
                  )
                )
            )
          )
        },
        undefined
      )
    }
  }

  if (e.po) {
    const po = e.po
    const accepted = Math.round(po.lines.reduce((s, l) => s + l.accepted, 0) * 100) / 100
    const ordered = Math.round(po.lines.reduce((s, l) => s + l.quantity - l.cancelled, 0) * 100) / 100
    const actor = e.receiver
    await quiet(
      "preparer and Finance",
      () =>
        notifyNamed(
          db,
          actor,
          {
            kind: "po_receipt_recorded",
            organizationId: e.orgId,
            params: { number: po.docNumber, receipt: e.docNumber, accepted, ordered, ceiling: "@pn_po_ceiling_unknown" },
            poId: po.id,
            rfqId: po.rfqId,
            offerId: po.offerId,
            link: `/contractor/goods-received?delivery=${e.deliveryId}`,
          },
          [po.preparedById, e.forwardedById],
          { permissions: ["invoices.manage"], owner: false }
        ),
      0
    )
    if (e.supplierUserId && e.supplierUserId !== "guest" && !e.isGuestDelivery && po.supplierOrgId && po.supplierOrgId !== "guest") {
      const differs = e.lines.some((l) => (Number(l.rejected) || 0) > 0)
      await quiet(
        "supplier",
        async () => {
          const contractor = ((await db.collection("users").doc(e.orgId).get()).data() as { companyName?: string } | undefined)?.companyName || actor.name
          return notifyNamed(
            db,
            actor,
            {
              kind: "po_receipt_for_supplier",
              organizationId: e.orgId,
              supplier: { userId: e.supplierUserId, orgId: po.supplierOrgId },
              params: { contractor, receipt: bareDocNumber(e.docNumber), number: bareDocNumber(po.docNumber), diff: differs ? "@pn_po_receipt_with_diff" : "" },
              poId: po.id,
              rfqId: po.rfqId,
              offerId: po.offerId,
            },
            [e.supplierUserId, po.supplierOrgId],
            { owner: false }
          )
        },
        0
      )
    }
  }

  const key = e.place.module === "projects" ? projectReceiptKey(e.docNumber) : warehouseReceiptKey(e.docNumber)
  const counted = e.lines.reduce((s, l) => s + (Number(l.counted) || 0), 0)
  const rejected = e.lines.reduce((s, l) => s + (Number(l.rejected) || 0), 0)
  const accepted = e.lines.reduce((s, l) => s + (l.accepted ?? Math.max(0, (Number(l.counted) || 0) - (Number(l.rejected) || 0) - (Number(l.held) || 0))), 0)
  const sent = await sendProcEvent(db, {
    id: e.place.module === "projects" ? "pm_receipt" : "inv_receipt",
    key,
    organizationId: e.orgId,
    by: e.receiver.uid,
    at: e.at,
    refs: { grn: e.docNumber, po: e.po?.docNumber ?? null, warehouse: e.place.warehouseId, notice: e.noticeSeq },
    payload: { counted, accepted, rejected, receiver: e.receiver.name, lines: e.lines.map((l) => ({ line: l.poLineId, counted: l.counted ?? 0, accepted: l.accepted ?? 0, rejected: l.rejected ?? 0, reason: l.rejectReason ?? null })) },
  })
  out.eventSent = sent === "sent" || sent === "duplicate"
  return out
}

// The supplier journey's acts that change a document the OTHER company owns, run on the server (Admin SDK) so the
// rule is enforced where it cannot be skipped (NFR-08) and the ruleset stays small: the supplier's decline of an order,
// his "I delivered" report and reminder, his answer to a transfer, his warranty; and the contractor's side — Finance
// telling him about a transfer, the buyer accepting a warranty. Each re-reads the documents, checks who is asking and
// the state, writes, then tells the other company (best-effort).

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { z } from "zod"
import { riyadhDay } from "@/lib/hr/format"
import { sarText } from "@/lib/procurement/events"
import { lineOutstanding, poStatus } from "@/lib/procurement/po"
import type { PoDeliveryReport, PoLogEntry, PurchaseOrder } from "@/lib/procurement/types"
import { callerOf } from "@/lib/receipt-links"
import { notifyNamed } from "./server-notify"
import { warrantyEligible } from "./warranty"

export type ActErrorCode =
  | "order_missing"
  | "not_yours"
  | "wrong_state"
  | "date_missing"
  | "date_future"
  | "reason_missing"
  | "already_reported"
  | "nothing_left"
  | "no_report"
  | "reminded_today"
  | "no_permission"
  | "not_found"
  | "invalid"

export class ActError extends Error {
  constructor(readonly code: ActErrorCode) {
    super(code)
    this.name = "ActError"
  }
}

const id = z.string().trim().min(1).max(128)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const actSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("po.decline"), poId: id, reason: z.enum(["stock", "price", "date", "other"]), reasonText: z.string().trim().min(1).max(200), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("po.report"), poId: id, date: day, note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("po.remind"), poId: id }),
  z.object({ action: z.literal("transfer.answer"), transferId: id, answer: z.enum(["ok", "miss", "later"]), note: z.string().trim().max(500).optional() }),
  z.object({
    action: z.literal("warranty.register"),
    poId: id,
    itemId: id,
    itemName: z.string().trim().min(1).max(200),
    category: z.string().trim().max(100),
    until: day,
    file: z.object({ name: z.string().trim().min(1).max(200), url: z.string().url().max(2000) }),
  }),
  z.object({ action: z.literal("transfer.report"), poId: id, amount: z.number().positive().max(1e9), bank: z.string().trim().max(120), reference: z.string().trim().min(1).max(120), valueDate: day }),
  z.object({ action: z.literal("warranty.accept"), warrantyId: id }),
])
export type Act = z.infer<typeof actSchema>

interface Supplier {
  uid: string
  name: string
  orgId: string
  company: string
}

const dayOf = (iso: string) => iso.slice(0, 10)
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

async function loadPo(db: Firestore, poId: string): Promise<PurchaseOrder> {
  const snap = await db.collection("purchaseOrders").doc(poId).get()
  if (!snap.exists) throw new ActError("order_missing")
  return { ...(snap.data() as Omit<PurchaseOrder, "id">), id: snap.id } as PurchaseOrder
}

async function transition(db: Firestore, poId: string, s: Supplier, apply: (po: PurchaseOrder) => { patch: Record<string, unknown>; log: PoLogEntry }): Promise<PurchaseOrder> {
  const ref = db.collection("purchaseOrders").doc(poId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new ActError("order_missing")
    const po = { ...(snap.data() as Omit<PurchaseOrder, "id">), id: snap.id } as PurchaseOrder
    if (po.supplierOrgId !== s.orgId || po.supplierOrgId === "guest") throw new ActError("not_yours")
    const { patch, log } = apply(po)
    const nextLog = [...(po.log || []), log]
    tx.update(ref, { ...patch, log: nextLog, updatedAt: FieldValue.serverTimestamp() })
    return { ...po, ...patch, log: nextLog } as PurchaseOrder
  })
}

const logEntry = (s: Supplier, action: PoLogEntry["action"], at: string, extra?: { note?: string | null; params?: Record<string, string | number> }): PoLogEntry => ({
  at,
  byId: s.uid,
  byName: s.name,
  action,
  note: extra?.note ?? null,
  params: extra?.params ?? null,
})

const tellBuyer = (db: Firestore, s: Supplier, po: PurchaseOrder, kind: Parameters<typeof notifyNamed>[2]["kind"], params: Record<string, string | number>) =>
  notifyNamed(db, { uid: s.uid, name: s.name }, { kind, organizationId: po.organizationId, params: { supplier: s.company, number: po.docNumber, ...params }, poId: po.id, rfqId: po.rfqId, offerId: po.offerId }, [po.preparedById, po.approvedById, po.sentById])

const pending = (po: PurchaseOrder) => (po.deliveryReports || []).filter((r) => !r.closedAt)

export async function runSupplierAct(db: Firestore, s: Supplier, act: Act, now: Date = new Date()): Promise<Record<string, unknown>> {
  const at = now.toISOString()
  switch (act.action) {
    case "po.decline": {
      const note = act.note || ""
      const po = await transition(db, act.poId, s, (p) => {
        if (poStatus(p) !== "sent") throw new ActError("wrong_state")
        return {
          patch: { status: "cancelled", cancelledReason: act.reasonText, closedAt: at, supplierDecline: { at, reason: act.reason, note, byId: s.uid, byName: s.name } },
          log: logEntry(s, "supplier_declined", at, { note: note || act.reasonText, params: { reason: act.reason } }),
        }
      })
      await tellBuyer(db, s, po, "po_supplier_declined", { reason: act.reasonText, note })
      return {}
    }
    case "po.report": {
      if (act.date > riyadhDay(now)) throw new ActError("date_future")
      const note = act.note || ""
      const po = await transition(db, act.poId, s, (p) => {
        const st = poStatus(p)
        if (st !== "in_delivery" && st !== "part_received") throw new ActError("wrong_state")
        if (pending(p).length) throw new ActError("already_reported")
        if (!p.lines.some((l) => lineOutstanding(l) > 0)) throw new ActError("nothing_left")
        const report: PoDeliveryReport = { id: `r${(p.deliveryReports || []).length + 1}`, at, date: act.date, note: note || null, byId: s.uid, byName: s.name, reminders: [], closedAt: null }
        return { patch: { deliveryReports: [...(p.deliveryReports || []), report] }, log: logEntry(s, "delivery_reported", at, { note: note || null, params: { date: act.date } }) }
      })
      await tellBuyer(db, s, po, "po_delivery_reported", { date: act.date, note })
      return {}
    }
    case "po.remind": {
      let date = ""
      const po = await transition(db, act.poId, s, (p) => {
        const open = pending(p)
        if (!open.length) throw new ActError("no_report")
        const last = open[open.length - 1]
        if (last.reminders.some((r) => dayOf(r) === dayOf(at))) throw new ActError("reminded_today")
        date = last.date
        const reports = (p.deliveryReports || []).map((r) => (r.id === last.id ? { ...r, reminders: [...r.reminders, at] } : r))
        return { patch: { deliveryReports: reports }, log: logEntry(s, "delivery_reminded", at, { params: { date: last.date } }) }
      })
      await tellBuyer(db, s, po, "po_delivery_reminder", { date })
      return {}
    }
    case "transfer.answer": {
      const ref = db.collection("supplierTransfers").doc(act.transferId)
      const snap = await ref.get()
      const t = snap.data() as { poId?: string; supplierOrgId?: string; state?: string; amount?: number; bank?: string; ref?: string } | undefined
      if (!t) throw new ActError("not_found")
      if (t.supplierOrgId !== s.orgId) throw new ActError("not_yours")
      const next = act.answer === "miss" ? "miss" : "ok"
      const allowed = act.answer === "later" ? t.state === "miss" : t.state === "sent"
      if (!allowed) throw new ActError("wrong_state")
      const note = (act.note || "").trim()
      if (act.answer === "miss" && !note) throw new ActError("invalid")
      await ref.update({
        state: next,
        confirmedAt: at,
        confirmedById: s.uid,
        ...(act.answer === "miss" ? { note } : {}),
        ...(act.answer === "later" ? { arrivedLater: true } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      })
      const po = await loadPo(db, String(t.poId))
      const amount = sarText(Number(t.amount) || 0, "ar")
      if (act.answer === "ok") await tellBuyer(db, s, po, "po_payment_confirmed", { amount, bank: String(t.bank || ""), ref: String(t.ref || "") })
      else if (act.answer === "miss") await tellBuyer(db, s, po, "po_payment_missing", { amount, ref: String(t.ref || ""), note })
      else await tellBuyer(db, s, po, "po_payment_later", { amount, ref: String(t.ref || "") })
      return {}
    }
    case "warranty.register": {
      const po = await loadPo(db, act.poId)
      if (po.supplierOrgId !== s.orgId || po.supplierOrgId === "guest") throw new ActError("not_yours")
      if (act.until <= riyadhDay(now) || !warrantyEligible(act.category)) throw new ActError("invalid")
      const existing = await db.collection("supplierWarranties").where("poId", "==", po.id).limit(1).get()
      if (!existing.empty) throw new ActError("wrong_state")
      const ref = await db.collection("supplierWarranties").add({
        poId: po.id,
        rfqId: po.rfqId,
        supplierOrgId: s.orgId,
        buyerOrgId: po.organizationId,
        itemId: act.itemId,
        itemName: act.itemName,
        category: act.category,
        until: act.until,
        file: act.file,
        state: "wait",
        createdAt: at,
        createdById: s.uid,
        createdByName: s.name,
      })
      await tellBuyer(db, s, po, "po_warranty_registered", { item: act.itemName, until: act.until })
      return { id: ref.id }
    }
    default:
      throw new ActError("invalid")
  }
}

/** The contractor's side: Finance reports a transfer to the supplier; the buyer accepts a warranty. */
export async function runBuyerAct(db: Firestore, uid: string, act: Act, now: Date = new Date()): Promise<Record<string, unknown>> {
  const caller = await callerOf(db, uid)
  if (!caller) throw new ActError("no_permission")
  const at = now.toISOString()
  const toSupplier = (po: PurchaseOrder, kind: Parameters<typeof notifyNamed>[2]["kind"], params: Record<string, string | number>) =>
    notifyNamed(
      db,
      { uid, name: caller.name },
      { kind, organizationId: po.organizationId, supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId }, params: { contractor: caller.name, number: po.docNumber, ...params }, poId: po.id, rfqId: po.rfqId, offerId: po.offerId },
      [po.supplierUserId, po.supplierOrgId],
      { owner: false }
    )
  if (act.action === "transfer.report") {
    if (!(caller.can("invoices.manage") || caller.can("accounting.post"))) throw new ActError("no_permission")
    const po = await loadPo(db, act.poId)
    if (po.organizationId !== caller.orgId) throw new ActError("not_found")
    if (!po.supplierOrgId || po.supplierOrgId === "guest") throw new ActError("wrong_state")
    const ref = await db.collection("supplierTransfers").add({
      poId: po.id,
      rfqId: po.rfqId,
      supplierOrgId: po.supplierOrgId,
      buyerOrgId: po.organizationId,
      amount: round2(act.amount),
      bank: act.bank,
      ref: act.reference,
      valueDate: act.valueDate,
      state: "sent",
      reportedAt: at,
      reportedById: uid,
      reportedByName: caller.name,
      createdTs: FieldValue.serverTimestamp(),
    })
    await toSupplier(po, "po_payment_reported", { amount: sarText(act.amount, "ar"), bank: act.bank, ref: act.reference })
    return { id: ref.id }
  }
  if (act.action === "warranty.accept") {
    if (!(caller.can("offers.accept") || caller.can("po.approve"))) throw new ActError("no_permission")
    const ref = db.collection("supplierWarranties").doc(act.warrantyId)
    const w = (await ref.get()).data() as { buyerOrgId?: string; state?: string; poId?: string; itemName?: string } | undefined
    if (!w || w.buyerOrgId !== caller.orgId) throw new ActError("not_found")
    if (w.state !== "wait") throw new ActError("wrong_state")
    await ref.update({ state: "ok", acceptedAt: at, acceptedById: uid, updatedAt: FieldValue.serverTimestamp() })
    await toSupplier(await loadPo(db, String(w.poId)), "po_warranty_accepted", { item: String(w.itemName || "") })
    return {}
  }
  throw new ActError("invalid")
}

export const isBuyerAct = (act: Act): boolean => act.action === "transfer.report" || act.action === "warranty.accept"

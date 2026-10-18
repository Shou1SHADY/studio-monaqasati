// The supplier journey's acts that change a document the OTHER company owns, run on the server (Admin SDK) so the
// rule is enforced where it cannot be skipped (NFR-08) and the ruleset stays small: the supplier's acceptance and
// decline of an order, his "I delivered" report and reminder, his answer to a transfer, his warranty and his rating of
// the contractor; and the contractor's side — Finance telling him about a transfer, the buyer accepting a warranty.
// Each re-reads the documents inside a transaction, checks who is asking and the state, writes, appends who/when/what
// to the order's log (NFR-06), then tells the other company (best-effort).

import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore"
import { z } from "zod"
import { riyadhDay } from "@/lib/hr/format"
import { sarParam } from "@/lib/procurement/events"
import { OFFER_ORDER_DECLINED } from "@/lib/procurement/award"
import { canRecordAcceptance, lineOutstanding } from "@/lib/procurement/po"
import { reopenAwardRefusal, type ReopenAwardRefusal } from "@/lib/procurement/reopen-award"
import { rfqLogEntry } from "@/lib/procurement/rfq-detail"
import type { PoDeliveryReport, PoLogEntry, PurchaseOrder } from "@/lib/procurement/types"
import { callerOf } from "@/lib/receipt-links"
import { paidInFull, storedReceiptAccepts } from "./deal-logic"
import { notifyNamed } from "./server-notify"
import { warrantyEligible } from "./warranty"

export type ActErrorCode =
  | "order_missing"
  | "not_yours"
  | "wrong_state"
  | "date_missing"
  | "date_past"
  | "date_future"
  | "reason_missing"
  | "already_reported"
  | "nothing_left"
  | "no_report"
  | "reminded_today"
  | "no_receipt"
  | "not_paid"
  | "already_rated"
  | "no_permission"
  | "not_found"
  | "invalid"
  | ReopenAwardRefusal

export class ActError extends Error {
  constructor(readonly code: ActErrorCode) {
    super(code)
    this.name = "ActError"
  }
}

const id = z.string().trim().min(1).max(128)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/** What the supplier's screen wrote in his own language for the deal's conversation (the report, the reminder, the decline). */
const message = z.string().trim().max(1000).optional()

export const actSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("po.accept"), poId: id, promisedDate: day, note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("po.decline"), poId: id, reason: z.enum(["stock", "price", "date", "other"]), reasonText: z.string().trim().min(1).max(200), note: z.string().trim().max(500).optional(), message }),
  z.object({ action: z.literal("po.report"), poId: id, date: day, note: z.string().trim().max(500).optional(), message }),
  z.object({ action: z.literal("po.remind"), poId: id, message }),
  // "Remind about the payment" (WF-14): the invoice whose instalment is due, the amount and date his screen computed.
  z.object({ action: z.literal("po.payremind"), poId: id, invoiceId: id, amount: z.number().positive().max(1e9), due: day, message }),
  z.object({ action: z.literal("po.rate"), poId: id, stars: z.number().int().min(1).max(5), text: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("transfer.answer"), transferId: id, answer: z.enum(["ok", "miss", "later"]), note: z.string().trim().max(500).optional() }),
  z.object({
    action: z.literal("warranty.register"),
    poId: id,
    itemId: id,
    // Sent by older screens; the server reads the item's name from the order and the category from the request.
    itemName: z.string().trim().max(200).optional(),
    category: z.string().trim().max(100).optional(),
    until: day,
    file: z.object({ name: z.string().trim().min(1).max(200), url: z.string().url().max(2000) }),
  }),
  z.object({ action: z.literal("transfer.report"), poId: id, amount: z.number().positive().max(1e9), bank: z.string().trim().max(120), reference: z.string().trim().min(1).max(120), valueDate: day, paymentNo: z.string().trim().max(60).optional() }),
  z.object({ action: z.literal("warranty.accept"), warrantyId: id }),
  // The buyer reopens an award whose order the supplier declined (DEC).
  z.object({ action: z.literal("award.reopen"), poId: id }),
])
export type Act = z.infer<typeof actSchema>

export interface Supplier {
  uid: string
  name: string
  orgId: string
  company: string
}

type Rec = Record<string, unknown>

const dayOf = (iso: string) => iso.slice(0, 10)
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0)

const poRefOf = (db: Firestore, poId: string) => db.collection("purchaseOrders").doc(poId)
const asPo = (snap: { id: string; data: () => unknown }): PurchaseOrder => ({ ...(snap.data() as Omit<PurchaseOrder, "id">), id: snap.id }) as PurchaseOrder

async function loadPo(db: Firestore, poId: string): Promise<PurchaseOrder> {
  const snap = await poRefOf(db, poId).get()
  if (!snap.exists) throw new ActError("order_missing")
  return asPo(snap)
}

const mine = (po: PurchaseOrder, s: Supplier) => po.supplierOrgId === s.orgId && po.supplierOrgId !== "guest"

async function transition(db: Firestore, poId: string, s: Supplier, apply: (po: PurchaseOrder) => { patch: Rec; log: PoLogEntry }): Promise<PurchaseOrder> {
  const ref = poRefOf(db, poId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new ActError("order_missing")
    const po = asPo(snap)
    if (!mine(po, s)) throw new ActError("not_yours")
    const { patch, log } = apply(po)
    const nextLog = [...(po.log || []), log]
    tx.update(ref, { ...patch, log: nextLog, updatedAt: FieldValue.serverTimestamp() })
    return { ...po, ...patch, log: nextLog } as PurchaseOrder
  })
}

/** Appends one entry to an order's log inside a transaction that already read it (reads come before writes). */
function appendLog(tx: Transaction, db: Firestore, po: PurchaseOrder, log: PoLogEntry) {
  tx.update(poRefOf(db, po.id), { log: [...(po.log || []), log], updatedAt: FieldValue.serverTimestamp() })
}

const logEntry = (who: { uid: string; name: string }, action: PoLogEntry["action"], at: string, extra?: { note?: string | null; params?: Record<string, string | number> }): PoLogEntry => ({
  at,
  byId: who.uid,
  byName: who.name,
  action,
  note: extra?.note ?? null,
  params: extra?.params ?? null,
})

type Kind = Parameters<typeof notifyNamed>[2]["kind"]
type Perm = NonNullable<Parameters<typeof notifyNamed>[4]>["permissions"]

const tellBuyer = (db: Firestore, s: Supplier, po: PurchaseOrder, kind: Kind, params: Record<string, string | number>, extra: { users?: (string | null | undefined)[]; permissions?: Perm } = {}) =>
  notifyNamed(
    db,
    { uid: s.uid, name: s.name },
    { kind, organizationId: po.organizationId, params: { supplier: s.company, number: po.docNumber, ...params }, poId: po.id, rfqId: po.rfqId, offerId: po.offerId },
    [po.preparedById, po.approvedById, po.sentById, ...(extra.users || [])],
    extra.permissions ? { permissions: extra.permissions } : undefined
  )

const pending = (po: PurchaseOrder) => (po.deliveryReports || []).filter((r) => !r.closedAt)

/** A line of the order as the deal names its item: `i{n}` from the request's product index, else the line's own id. */
const lineOfItem = (po: PurchaseOrder, itemId: string) => po.lines.find((l) => l.id === itemId || (l.rfqProductIndex != null && `i${l.rfqProductIndex + 1}` === itemId)) || null

/** A message in the deal's conversation, written by the server the way the chat page writes one (best-effort). */
export async function postDealMessage(db: Firestore, po: PurchaseOrder, s: Supplier, text: string | undefined, at: string): Promise<void> {
  const body = (text || "").trim()
  if (!body || !po.offerId) return
  try {
    const offer = ((await db.collection("offers").doc(po.offerId).get()).data() || {}) as Rec
    const chatRef = db.collection("chats").doc(po.offerId)
    const chat = await chatRef.get()
    if (!chat.exists) {
      await chatRef.set({
        offerId: po.offerId,
        rfqId: String(offer.rfqId || po.rfqId || ""),
        rfqTitle: String(offer.rfqTitle || po.rfqTitle || ""),
        contractorId: String(offer.contractorId || po.organizationId || ""),
        contractorOrgId: String(offer.contractorOrgId || po.organizationId || ""),
        supplierId: String(offer.supplierId || s.uid),
        supplierOrgId: String(offer.organizationId || s.orgId),
        createdAt: at,
      })
    }
    await chatRef.collection("messages").add({ senderId: s.uid, text: body, createdAt: at })
    const other = String(offer.contractorId || po.organizationId || "")
    await chatRef.update({ lastMessage: body, lastMessageAt: at, ...(other ? { unreadFor: [other], [`unreadCounts.${other}`]: FieldValue.increment(1) } : {}) })
    if (other)
      await db
        .collection("users")
        .doc(other)
        .collection("notifications")
        .add({ type: "new_chat_message", message: body.length > 80 ? `${body.slice(0, 80)}...` : body, chatId: po.offerId, rfqTitle: String(offer.rfqTitle || ""), createdAt: at, read: false })
  } catch (err) {
    console.warn("deal message not posted:", (err as { code?: string })?.code || err)
  }
}

/** The order is received, every receipt invoiced and paid in full — what the rating waits for (B-09). */
async function paidFacts(db: Firestore, po: PurchaseOrder): Promise<boolean> {
  const [rcpt, inv, tr] = await Promise.all([
    db.collection("deliveries").where("poId", "==", po.id).get(),
    db.collection("supplierInvoices").where("poId", "==", po.id).get(),
    db.collection("supplierTransfers").where("poId", "==", po.id).get(),
  ])
  // A receipt that accepted nothing cannot be invoiced, so it never holds "paid in full" back.
  const receipts = rcpt.docs
    .map((d): Rec & { id: string } => ({ ...(d.data() as Rec), id: d.id }))
    .filter((d) => d.status === "confirmed" && storedReceiptAccepts(d.lines))
    .map((d) => String(d.docNumber || d.id))
  const invoices = inv.docs.map((d) => d.data() as Rec).map((i) => ({ amt: num(i.amountNet), vat: typeof i.vat === "number" ? i.vat : null, grns: Array.isArray(i.grns) ? (i.grns as unknown[]).map(String) : [] }))
  const paidOk = round2(tr.docs.map((d) => d.data() as Rec).filter((t) => t.state === "ok").reduce((s, t) => s + num(t.amount), 0))
  return paidInFull({ lines: po.lines.map((l) => ({ qty: num(l.quantity), got: num(l.accepted), can: num(l.cancelled) })), receipts, invoices, paidOk })
}

export async function runSupplierAct(db: Firestore, s: Supplier, act: Act, now: Date = new Date()): Promise<Record<string, unknown>> {
  const at = now.toISOString()
  const me = { uid: s.uid, name: s.name }
  switch (act.action) {
    case "po.accept": {
      // WF-07: the date he commits to — a real day, not before today (Riyadh). A date after the contractor's is only warned on screen.
      if (act.promisedDate < riyadhDay(now)) throw new ActError("date_past")
      const note = (act.note || "").trim()
      const po = await transition(db, act.poId, s, (p) => {
        if (!canRecordAcceptance(p)) throw new ActError("wrong_state")
        return {
          patch: { status: "accepted", supplierAcceptedAt: at, promisedDate: act.promisedDate, acceptanceRecordedBy: "supplier", ...(note ? { supplierAcceptNote: note } : {}) },
          log: logEntry(me, "supplier_accepted", at, { params: { date: act.promisedDate, recordedBy: "supplier" } }),
        }
      })
      await notifyNamed(db, me, { kind: "po_supplier_accepted", organizationId: po.organizationId, params: { number: po.docNumber, supplier: s.company, date: act.promisedDate }, poId: po.id, rfqId: po.rfqId, offerId: po.offerId }, [po.preparedById, po.sentById])
      return {}
    }
    case "po.decline": {
      const note = act.note || ""
      const po = await transition(db, act.poId, s, (p) => {
        if (p.status !== "sent") throw new ActError("wrong_state")
        return {
          patch: { status: "cancelled", cancelledReason: act.reasonText, closedAt: at, supplierDecline: { at, reason: act.reason, note, byId: s.uid, byName: s.name } },
          log: logEntry(me, "supplier_declined", at, { note: note || act.reasonText, params: { reason: act.reason } }),
        }
      })
      await postDealMessage(db, po, s, act.message, at)
      await tellBuyer(db, s, po, "po_supplier_declined", { reason: act.reasonText, note })
      return {}
    }
    case "po.report": {
      if (act.date > riyadhDay(now)) throw new ActError("date_future")
      const note = act.note || ""
      const po = await transition(db, act.poId, s, (p) => {
        // What is left is measured line by line, exactly as his screen shows it — never the 99.5% "received" of poStatus (ORD-07).
        if (p.status !== "accepted") throw new ActError("wrong_state")
        if (pending(p).length) throw new ActError("already_reported")
        if (!p.lines.some((l) => lineOutstanding(l) > 0)) throw new ActError("nothing_left")
        const report: PoDeliveryReport = { id: `r${(p.deliveryReports || []).length + 1}`, at, date: act.date, note: note || null, byId: s.uid, byName: s.name, reminders: [], closedAt: null }
        return { patch: { deliveryReports: [...(p.deliveryReports || []), report] }, log: logEntry(me, "delivery_reported", at, { note: note || null, params: { date: act.date } }) }
      })
      await postDealMessage(db, po, s, act.message, at)
      // The receivers record the receipt (deliveries.confirm), not only whoever prepared the order.
      await tellBuyer(db, s, po, "po_delivery_reported", { date: act.date, note }, { permissions: ["deliveries.confirm"] })
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
        return { patch: { deliveryReports: reports }, log: logEntry(me, "delivery_reminded", at, { params: { date: last.date } }) }
      })
      // ORD-09: «تذكير: سلّمت {date}، وأرجو تسجيل الاستلام» in the conversation, then the notice to the receivers.
      await postDealMessage(db, po, s, act.message, at)
      await tellBuyer(db, s, po, "po_delivery_reminder", { date }, { permissions: ["deliveries.confirm"] })
      return {}
    }
    case "po.payremind": {
      // Once a day per invoice; the reminder is written on the invoice (read-only to clients) and in the order's log,
      // posted in the deal's conversation, and Finance (invoices.manage) and the owner hear it.
      const today = riyadhDay(now)
      const invRef = db.collection("supplierInvoices").doc(act.invoiceId)
      const { po, number, amount } = await db.runTransaction(async (tx) => {
        const [poSnap, invSnap] = await Promise.all([tx.get(poRefOf(db, act.poId)), tx.get(invRef)])
        if (!poSnap.exists) throw new ActError("order_missing")
        const p = asPo(poSnap)
        if (!mine(p, s)) throw new ActError("not_yours")
        const inv = invSnap.exists ? (invSnap.data() as Rec) : null
        if (!inv || inv.poId !== p.id || inv.supplierOrgId !== s.orgId) throw new ActError("not_found")
        const reminders = Array.isArray(inv.reminders) ? (inv.reminders as unknown[]).map(String) : []
        if (reminders.some((r) => riyadhDay(new Date(r)) === today)) throw new ActError("reminded_today")
        // Never more than the invoice itself comes to (its own VAT).
        const gross = round2(num(inv.amountNet) * (1 + (typeof inv.vat === "number" ? inv.vat : 0.15)))
        const amt = Math.min(round2(act.amount), gross)
        const no = String(inv.number || "")
        tx.update(invRef, { reminders: [...reminders, at], updatedAt: FieldValue.serverTimestamp() })
        appendLog(tx, db, p, logEntry(me, "payment_reminded", at, { params: { invoice: no, amount: amt, date: act.due } }))
        return { po: p, number: no, amount: amt }
      })
      await postDealMessage(db, po, s, act.message, at)
      await tellBuyer(db, s, po, "po_payment_reminder", { amount: sarParam(amount), date: act.due, invoice: number }, { permissions: ["invoices.manage"] })
      return {}
    }
    case "transfer.answer": {
      const ref = db.collection("supplierTransfers").doc(act.transferId)
      const note = (act.note || "").trim()
      if (act.answer === "miss" && !note) throw new ActError("invalid")
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        const t = snap.data() as (Rec & { poId?: string; supplierOrgId?: string; state?: string; answers?: Rec[] }) | undefined
        if (!t) throw new ActError("not_found")
        if (t.supplierOrgId !== s.orgId) throw new ActError("not_yours")
        const allowed = act.answer === "later" ? t.state === "miss" : t.state === "sent"
        if (!allowed) throw new ActError("wrong_state")
        const poSnap = t.poId ? await tx.get(poRefOf(db, String(t.poId))) : null
        const po = poSnap && poSnap.exists ? asPo(poSnap) : null
        // Every answer is kept, in order, with who and when (NFR-06): "arrived later" never erases who said "not received".
        const answers = [...(Array.isArray(t.answers) ? t.answers : []), { answer: act.answer, at, byId: s.uid, byName: s.name, note: note || null }]
        const patch: Rec =
          act.answer === "ok"
            ? { state: "ok", confirmedAt: at, confirmedById: s.uid }
            : act.answer === "miss"
              ? { state: "miss", note, missedAt: at, missedById: s.uid }
              : { state: "ok", arrivedLater: true, confirmedAt: at, confirmedById: s.uid }
        tx.update(ref, { ...patch, answers, updatedAt: FieldValue.serverTimestamp() })
        const action = act.answer === "ok" ? "transfer_confirmed" : act.answer === "miss" ? "transfer_missing" : "transfer_arrived_later"
        if (po) appendLog(tx, db, po, logEntry(me, action, at, { note: note || null, params: { ref: String(t.ref || ""), amount: num(t.amount) } }))
        return { t, po }
      })
      const { t } = result
      const po = result.po || (await loadPo(db, String(t.poId)))
      // The amount is a fact each reader formats in his own language (NFR-01); Finance — who reported it and who pays — hears it.
      const params = { amount: sarParam(num(t.amount)), ref: String(t.ref || "") }
      const extra = { users: [t.reportedById as string | undefined], permissions: ["invoices.manage"] as Perm }
      if (act.answer === "ok") await tellBuyer(db, s, po, "po_payment_confirmed", { ...params, bank: String(t.bank || "") }, extra)
      else if (act.answer === "miss") await tellBuyer(db, s, po, "po_payment_missing", { ...params, note }, extra)
      else await tellBuyer(db, s, po, "po_payment_later", params, extra)
      return {}
    }
    case "warranty.register": {
      const po = await loadPo(db, act.poId)
      if (!mine(po, s)) throw new ActError("not_yours")
      if (act.until <= riyadhDay(now)) throw new ActError("invalid")
      // The category is the request's own, never the screen's word for it (ORD-14).
      const rfq = po.rfqId ? ((await db.collection("rfqs").doc(po.rfqId).get()).data() as Rec | undefined) : undefined
      if (!warrantyEligible(String(rfq?.category || ""))) throw new ActError("invalid")
      const line = lineOfItem(po, act.itemId)
      if (!line) throw new ActError("invalid")
      // After receipt only: a receipt the contractor recorded accepted some of THIS item.
      const rc = await db.collection("deliveries").where("poId", "==", po.id).get()
      const received = rc.docs
        .map((d) => d.data() as Rec)
        .filter((d) => d.status === "confirmed")
        .some((d) => (Array.isArray(d.lines) ? (d.lines as Rec[]) : []).some((l) => l.poLineId === line.id && num(l.accepted) > 0))
      if (!received) throw new ActError("no_receipt")
      const ref = db.collection("supplierWarranties").doc(po.id)
      const existing = db.collection("supplierWarranties").where("poId", "==", po.id)
      await db.runTransaction(async (tx) => {
        const [prior, fresh] = await Promise.all([tx.get(existing), tx.get(poRefOf(db, po.id))])
        if (!prior.empty) throw new ActError("wrong_state")
        tx.create(ref, {
          poId: po.id,
          rfqId: po.rfqId,
          supplierOrgId: s.orgId,
          buyerOrgId: po.organizationId,
          itemId: act.itemId,
          itemName: line.name,
          category: String(rfq?.category || ""),
          until: act.until,
          file: act.file,
          state: "wait",
          createdAt: at,
          createdById: s.uid,
          createdByName: s.name,
        })
        appendLog(tx, db, asPo(fresh), logEntry(me, "warranty_registered", at, { params: { item: line.name, date: act.until } }))
      })
      await tellBuyer(db, s, po, "po_warranty_registered", { item: line.name, until: act.until })
      return { id: ref.id }
    }
    case "po.rate": {
      const po = await loadPo(db, act.poId)
      if (!mine(po, s)) throw new ActError("not_yours")
      if (!(await paidFacts(db, po))) throw new ActError("not_paid")
      const text = (act.text || "").trim()
      // One rating per order, tied to the delivery it judges (ACC-07): the review's id is the order's.
      const reviewRef = db.collection("reviews").doc(`po_${po.id}_supplier`)
      const offerRef = po.offerId ? db.collection("offers").doc(po.offerId) : null
      const contractor = ((await db.collection("users").doc(po.organizationId).get()).data() || {}) as Rec
      const material = po.lines.map((l) => l.name).filter(Boolean).join("، ")
      await db.runTransaction(async (tx) => {
        const [prior, offer, fresh] = await Promise.all([tx.get(reviewRef), offerRef ? tx.get(offerRef) : Promise.resolve(null), tx.get(poRefOf(db, po.id))])
        if (prior.exists || (offer && offer.exists && (offer.data() as Rec).supplierRated)) throw new ActError("already_rated")
        tx.create(reviewRef, {
          offerId: po.offerId || null,
          rfqId: po.rfqId || null,
          poId: po.id,
          poNumber: po.docNumber,
          material,
          reviewerId: s.uid,
          reviewerOrgId: s.orgId,
          reviewerName: s.company,
          reviewerRole: "Supplier",
          revieweeId: po.organizationId,
          revieweeName: String(contractor.companyName || contractor.name || ""),
          revieweeRole: "Contractor",
          rating: act.stars,
          comment: text,
          createdAt: at,
        })
        if (offerRef && offer && offer.exists) tx.update(offerRef, { supplierRated: true, supplierRatedAt: at, supplierRating: { stars: act.stars, text, at } })
        appendLog(tx, db, asPo(fresh), logEntry(me, "supplier_rated", at, { params: { stars: act.stars } }))
      })
      await tellBuyer(db, s, po, "po_supplier_rated", { stars: act.stars })
      return {}
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
  const toSupplier = async (po: PurchaseOrder, kind: Kind, params: Record<string, string | number>) => {
    // The supplier reads the contractor's company first, not the name of whoever pressed the button.
    const company = ((await db.collection("users").doc(po.organizationId).get().catch(() => null))?.data() || {}) as Rec
    return notifyNamed(
      db,
      { uid, name: caller.name },
      {
        kind,
        organizationId: po.organizationId,
        supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
        params: { contractor: String(company.companyName || caller.name), number: po.docNumber, ...params },
        poId: po.id,
        rfqId: po.rfqId,
        offerId: po.offerId,
      },
      [po.supplierUserId, po.supplierOrgId],
      { owner: false }
    )
  }
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
      // Finance's payment number on the order — the supplier reads it beside the bank reference.
      paymentNo: act.paymentNo || null,
      valueDate: act.valueDate,
      state: "sent",
      answers: [],
      reportedAt: at,
      reportedById: uid,
      reportedByName: caller.name,
      createdTs: FieldValue.serverTimestamp(),
    })
    await toSupplier(po, "po_payment_reported", { amount: sarParam(act.amount), bank: act.bank, ref: act.reference })
    return { id: ref.id }
  }
  if (act.action === "warranty.accept") {
    if (!(caller.can("offers.accept") || caller.can("po.approve"))) throw new ActError("no_permission")
    const ref = db.collection("supplierWarranties").doc(act.warrantyId)
    const w = await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() as { buyerOrgId?: string; state?: string; poId?: string; itemName?: string } | undefined
      if (!data || data.buyerOrgId !== caller.orgId) throw new ActError("not_found")
      if (data.state !== "wait") throw new ActError("wrong_state")
      const poSnap = data.poId ? await tx.get(poRefOf(db, data.poId)) : null
      tx.update(ref, { state: "ok", acceptedAt: at, acceptedById: uid, acceptedByName: caller.name, updatedAt: FieldValue.serverTimestamp() })
      if (poSnap && poSnap.exists) appendLog(tx, db, asPo(poSnap), logEntry({ uid, name: caller.name }, "warranty_accepted", at, { params: { item: String(data.itemName || "") } }))
      return data
    })
    await toSupplier(await loadPo(db, String(w.poId)), "po_warranty_accepted", { item: String(w.itemName || "") })
    return {}
  }
  if (act.action === "award.reopen") return reopenAward(db, caller, act.poId, at)
  throw new ActError("invalid")
}

/**
 * «أعد الترسية» in ONE transaction: the RFQ goes back to `New` (logged), the declined quote closes as «اعتذر عن الأمر»
 * with `declinedOrder` (it keeps its `poId`, so the supplier's deal still reads «declined the order», and it leaves the
 * comparison), and every quote told «awarded to another» loses that outcome. A split award whose other orders still
 * run is refused: reopening would let their lines be awarded twice.
 */
async function reopenAward(db: Firestore, caller: NonNullable<Awaited<ReturnType<typeof callerOf>>>, poId: string, at: string): Promise<{ rfqId: string }> {
  const actor = { uid: caller.uid, isOwner: false, canPrepare: caller.can("offers.accept"), canApprove: caller.can("po.approve") }
  return db.runTransaction(async (tx) => {
    const poSnap = await tx.get(poRefOf(db, poId))
    const po = poSnap.exists ? asPo(poSnap) : null
    if (!po || po.organizationId !== caller.orgId) throw new ActError("not_found")
    const rfqRef = db.collection("rfqs").doc(String(po.rfqId || "_"))
    const rSnap = await tx.get(rfqRef)
    const rfq = rSnap.exists ? (rSnap.data() as { status?: string; createdByUserId?: string; contractorId?: string; log?: unknown[] }) : null
    const refusal = reopenAwardRefusal(po, rfq, actor)
    if (refusal || !rfq) throw new ActError(refusal || "not_declined")
    const offers = (await tx.get(db.collection("offers").where("rfqId", "==", po.rfqId))).docs.map((d) => ({ id: d.id, data: (d.data() || {}) as { poId?: string | null; outcome?: { k?: string } | null; declinedOrder?: unknown } }))
    for (const o of offers) {
      if (o.id === po.offerId || !o.data.poId || o.data.declinedOrder) continue
      const other = await tx.get(poRefOf(db, o.data.poId))
      if (other.exists && (other.data() as { status?: string }).status !== "cancelled") throw new ActError("award_split_live")
    }
    const decline = po.supplierDecline as NonNullable<PurchaseOrder["supplierDecline"]>
    tx.update(db.collection("offers").doc(String(po.offerId)), {
      status: OFFER_ORDER_DECLINED,
      declinedOrder: { poId: po.id, poNumber: po.docNumber, at: decline.at, reason: decline.reason },
      awaitingOrderApproval: false,
      updatedAt: FieldValue.serverTimestamp(),
    })
    for (const o of offers) {
      if (o.id === po.offerId || o.data.outcome?.k !== "lost") continue
      tx.update(db.collection("offers").doc(o.id), { outcome: null, updatedAt: FieldValue.serverTimestamp() })
    }
    tx.update(rfqRef, {
      status: "New",
      awardReopened: { poId: po.id, poNumber: po.docNumber, at, byId: caller.uid, byName: caller.name },
      log: [...(Array.isArray(rfq.log) ? rfq.log : []), rfqLogEntry({ uid: caller.uid, name: caller.name }, "award_reopened", at, { params: { number: po.docNumber, supplier: po.supplierName } })],
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { rfqId: String(po.rfqId) }
  })
}

export const isBuyerAct = (act: Act): boolean => act.action === "transfer.report" || act.action === "warranty.accept" || act.action === "award.reopen"

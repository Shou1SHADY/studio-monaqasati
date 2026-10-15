// What the free supplier does to a purchase order (PRD §10, WF-07…10): accept it with a date he commits to,
// decline it with a reason, report "I delivered" with a date and a note, remind the contractor to record the receipt.
// Each is ONE transaction that re-reads the order, re-runs the rule and appends a log entry (NFR-06, NFR-08) — the same
// shape as every other order transition — and tells the contractor afterwards, best-effort.
//
// A report carries a date and a note and nothing else: no quantity, number, driver or plate (G-03). It changes no
// quantity; only the contractor's receipt does, and that receipt closes the report.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { PURCHASE_ORDERS, type PoDeliveryReport, type PoLogEntry, type PurchaseOrder } from "@/lib/procurement/types"
import { lineOutstanding, poStatus } from "@/lib/procurement/po"
import { canRecordAcceptance } from "@/lib/procurement/po"
import { promiseDateValid } from "@/lib/procurement/supplier"
import { tellAboutPo, type SupplierSide } from "./events"
import type { DeclineReason } from "./types"

export type SupplierPoErrorCode = "order_missing" | "not_yours" | "wrong_state" | "date_missing" | "date_past" | "date_future" | "reason_missing" | "already_reported" | "nothing_left" | "no_report" | "reminded_today"

export class SupplierPoError extends Error {
  constructor(readonly code: SupplierPoErrorCode) {
    super(code)
    this.name = "SupplierPoError"
  }
}

export const DECLINE_REASONS: readonly DeclineReason[] = ["stock", "price", "date", "other"]

type OrderDoc = PurchaseOrder

const day = (iso: string) => iso.slice(0, 10)

async function transition(
  firestore: Firestore,
  poId: string,
  supplier: { uid: string; orgId: string },
  apply: (po: OrderDoc) => { patch: Record<string, unknown>; log: PoLogEntry }
): Promise<OrderDoc> {
  const ref = doc(firestore, PURCHASE_ORDERS, poId)
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new SupplierPoError("order_missing")
    const po = { ...(snap.data() as Omit<OrderDoc, "id">), id: snap.id } as OrderDoc
    if (po.supplierOrgId !== supplier.orgId) throw new SupplierPoError("not_yours")
    const { patch, log } = apply(po)
    tx.update(ref, { ...patch, log: [...(po.log || []), log], updatedAt: serverTimestamp() })
    return { ...po, ...patch, log: [...(po.log || []), log] } as OrderDoc
  })
}

const entry = (s: SupplierSide, action: PoLogEntry["action"], at: string, extra?: { note?: string | null; params?: Record<string, string | number> }): PoLogEntry => ({
  at,
  byId: s.actor.uid,
  byName: s.actor.name,
  action,
  note: extra?.note ?? null,
  params: extra?.params ?? null,
})

/** Accept the order with the date he commits to (WF-07): not before today; the warning for a date after the contractor's is the screen's. */
export async function acceptOrder(firestore: Firestore, s: SupplierSide, orgId: string, poId: string, input: { promisedDate: string; note?: string; today: string }, now: Date = new Date()): Promise<OrderDoc> {
  if (!input.promisedDate) throw new SupplierPoError("date_missing")
  if (!promiseDateValid(input.promisedDate, now)) throw new SupplierPoError("date_past")
  const at = now.toISOString()
  const po = await transition(firestore, poId, { uid: s.actor.uid, orgId }, (p) => {
    if (!canRecordAcceptance(p)) throw new SupplierPoError("wrong_state")
    const note = (input.note || "").trim().slice(0, 500)
    return {
      patch: { status: "accepted", supplierAcceptedAt: at, promisedDate: input.promisedDate, acceptanceRecordedBy: "supplier", ...(note ? { supplierAcceptNote: note } : {}) },
      log: entry(s, "supplier_accepted", at, { params: { date: input.promisedDate, recordedBy: "supplier" } }),
    }
  })
  await tellAboutPo(firestore, s, po, "po_supplier_accepted", { date: input.promisedDate })
  return po
}

/** Decline the order with a reason (WF-08). Only before he has accepted it; the order closes as cancelled and the contractor is told why. */
export async function declineOrder(firestore: Firestore, s: SupplierSide, orgId: string, poId: string, input: { reason: DeclineReason; reasonText: string; note?: string }, now: Date = new Date()): Promise<OrderDoc> {
  if (!DECLINE_REASONS.includes(input.reason)) throw new SupplierPoError("reason_missing")
  const at = now.toISOString()
  const note = (input.note || "").trim().slice(0, 500)
  const po = await transition(firestore, poId, { uid: s.actor.uid, orgId }, (p) => {
    if (poStatus(p) !== "sent") throw new SupplierPoError("wrong_state")
    return {
      patch: {
        status: "cancelled",
        cancelledReason: input.reasonText,
        closedAt: at,
        supplierDecline: { at, reason: input.reason, note, byId: s.actor.uid, byName: s.actor.name },
      },
      log: entry(s, "supplier_declined", at, { note: note || input.reasonText, params: { reason: input.reason } }),
    }
  })
  await tellAboutPo(firestore, s, po, "po_supplier_declined", { reason: input.reasonText, note })
  return po
}

const pending = (po: OrderDoc) => (po.deliveryReports || []).filter((r) => !r.closedAt)

/** "I delivered" (WF-09): a date, never in the future, and a note. Not while one is waiting for the contractor, nor when nothing is left. */
export async function reportDelivery(firestore: Firestore, s: SupplierSide, orgId: string, poId: string, input: { date: string; note?: string }, now: Date = new Date()): Promise<OrderDoc> {
  if (!input.date) throw new SupplierPoError("date_missing")
  const todayIso = new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
  if (input.date > todayIso) throw new SupplierPoError("date_future")
  const at = now.toISOString()
  const po = await transition(firestore, poId, { uid: s.actor.uid, orgId }, (p) => {
    const st = poStatus(p)
    if (st !== "in_delivery" && st !== "part_received") throw new SupplierPoError("wrong_state")
    if (pending(p).length) throw new SupplierPoError("already_reported")
    if (!p.lines.some((l) => lineOutstanding(l) > 0)) throw new SupplierPoError("nothing_left")
    const note = (input.note || "").trim().slice(0, 500)
    const report: PoDeliveryReport = { id: `r${(p.deliveryReports || []).length + 1}`, at, date: input.date, note: note || null, byId: s.actor.uid, byName: s.actor.name, reminders: [], closedAt: null }
    return { patch: { deliveryReports: [...(p.deliveryReports || []), report] }, log: entry(s, "delivery_reported", at, { note: note || null, params: { date: input.date } }) }
  })
  await tellAboutPo(firestore, s, po, "po_delivery_reported", { date: input.date, note: (input.note || "").trim() })
  return po
}

/** Remind the contractor to record the receipt (ORD-09): once a day per report. */
export async function remindReceipt(firestore: Firestore, s: SupplierSide, orgId: string, poId: string, now: Date = new Date()): Promise<OrderDoc> {
  const at = now.toISOString()
  let date = ""
  const po = await transition(firestore, poId, { uid: s.actor.uid, orgId }, (p) => {
    const open = pending(p)
    if (!open.length) throw new SupplierPoError("no_report")
    const last = open[open.length - 1]
    if (last.reminders.some((r) => day(r) === day(at))) throw new SupplierPoError("reminded_today")
    date = last.date
    const reports = (p.deliveryReports || []).map((r) => (r.id === last.id ? { ...r, reminders: [...r.reminders, at] } : r))
    return { patch: { deliveryReports: reports }, log: entry(s, "delivery_reminded", at, { params: { date: last.date } }) }
  })
  await tellAboutPo(firestore, s, po, "po_delivery_reminder", { date })
  return po
}

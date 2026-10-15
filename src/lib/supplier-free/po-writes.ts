// What the free supplier does to a purchase order (PRD §10, WF-07…10): accept it with a date he commits to,
// decline it with a reason, report "I delivered" with a date and a note, remind the contractor to record the receipt.
// Each is ONE transaction that re-reads the order, re-runs the rule and appends a log entry (NFR-06, NFR-08) — the same
// shape as every other order transition — and tells the contractor afterwards, best-effort.
//
// A report carries a date and a note and nothing else: no quantity, number, driver or plate (G-03). It changes no
// quantity; only the contractor's receipt does, and that receipt closes the report.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { PURCHASE_ORDERS, type PoLogEntry, type PurchaseOrder } from "@/lib/procurement/types"
import { canRecordAcceptance } from "@/lib/procurement/po"
import { ActRefused, callAct } from "./act-client"
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

const CODES: readonly SupplierPoErrorCode[] = ["order_missing", "not_yours", "wrong_state", "date_missing", "date_past", "date_future", "reason_missing", "already_reported", "nothing_left", "no_report", "reminded_today"]

/** Runs an act on the server and says its refusal the way the screens already do. */
async function act(body: Record<string, unknown>): Promise<void> {
  try {
    await callAct(body)
  } catch (err) {
    if (err instanceof ActRefused && (CODES as readonly string[]).includes(err.code)) throw new SupplierPoError(err.code as SupplierPoErrorCode)
    throw err
  }
}

/** Decline the order with a reason (WF-08). Only before he has accepted it; the order closes as cancelled and the contractor is told why. The server runs it. */
export async function declineOrder(_firestore: Firestore, _s: SupplierSide, _orgId: string, poId: string, input: { reason: DeclineReason; reasonText: string; note?: string }): Promise<void> {
  if (!DECLINE_REASONS.includes(input.reason)) throw new SupplierPoError("reason_missing")
  await act({ action: "po.decline", poId, reason: input.reason, reasonText: input.reasonText, note: (input.note || "").trim().slice(0, 500) })
}

/** "I delivered" (WF-09): a date, never in the future, and a note. Not while one is waiting for the contractor, nor when nothing is left. The server runs it. */
export async function reportDelivery(_firestore: Firestore, _s: SupplierSide, _orgId: string, poId: string, input: { date: string; note?: string }, now: Date = new Date()): Promise<void> {
  if (!input.date) throw new SupplierPoError("date_missing")
  const todayIso = new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
  if (input.date > todayIso) throw new SupplierPoError("date_future")
  await act({ action: "po.report", poId, date: input.date, note: (input.note || "").trim().slice(0, 500) })
}

/** Remind the contractor to record the receipt (ORD-09): once a day per report. The server runs it. */
export async function remindReceipt(_firestore: Firestore, _s: SupplierSide, _orgId: string, poId: string): Promise<void> {
  await act({ action: "po.remind", poId })
}

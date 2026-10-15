// What the supplier does to a purchase order (PRD §10, WF-07…10): accept it with a date he commits to, decline it with
// a reason, report "I delivered" with a date and a note, remind the contractor to record the receipt. Each runs on the
// server (/api/supplier-free/act) as ONE transaction that re-reads the order, re-runs the rule and appends a log entry
// (NFR-06, NFR-08), and tells the contractor afterwards, best-effort. The rules let no supplier write an order.
//
// A report carries a date and a note and nothing else: no quantity, number, driver or plate (G-03). It changes no
// quantity; only the contractor's receipt does, and that receipt closes the report.

import { ActRefused, callAct } from "./act-client"
import { promiseDateValid } from "@/lib/procurement/supplier"
import type { DeclineReason } from "./types"

export type SupplierPoErrorCode = "order_missing" | "not_yours" | "wrong_state" | "date_missing" | "date_past" | "date_future" | "reason_missing" | "already_reported" | "nothing_left" | "no_report" | "reminded_today"

export class SupplierPoError extends Error {
  constructor(readonly code: SupplierPoErrorCode) {
    super(code)
    this.name = "SupplierPoError"
  }
}

export const DECLINE_REASONS: readonly DeclineReason[] = ["stock", "price", "date", "other"]

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

const withMessage = (message?: string) => (message && message.trim() ? { message: message.trim().slice(0, 1000) } : {})

/** Accept the order with the date he commits to (WF-07): not before today; the warning for a date after the contractor's
 * is the screen's. The free account and the full portal both come here. */
export async function acceptOrder(poId: string, input: { promisedDate: string; note?: string }, now: Date = new Date()): Promise<void> {
  if (!input.promisedDate) throw new SupplierPoError("date_missing")
  if (!promiseDateValid(input.promisedDate, now)) throw new SupplierPoError("date_past")
  await act({ action: "po.accept", poId, promisedDate: input.promisedDate, note: (input.note || "").trim().slice(0, 500) })
}

/** Decline the order with a reason (WF-08). Only before he has accepted it; the order closes as cancelled and the
 * contractor is told why — in the deal's conversation too (`message`, in the supplier's words). */
export async function declineOrder(poId: string, input: { reason: DeclineReason; reasonText: string; note?: string; message?: string }): Promise<void> {
  if (!DECLINE_REASONS.includes(input.reason)) throw new SupplierPoError("reason_missing")
  await act({ action: "po.decline", poId, reason: input.reason, reasonText: input.reasonText, note: (input.note || "").trim().slice(0, 500), ...withMessage(input.message) })
}

/** "I delivered" (WF-09): a date, never in the future, and a note. Not while one is waiting for the contractor, nor when nothing is left. */
export async function reportDelivery(poId: string, input: { date: string; note?: string; message?: string }, now: Date = new Date()): Promise<void> {
  if (!input.date) throw new SupplierPoError("date_missing")
  const todayIso = new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
  if (input.date > todayIso) throw new SupplierPoError("date_future")
  await act({ action: "po.report", poId, date: input.date, note: (input.note || "").trim().slice(0, 500), ...withMessage(input.message) })
}

/** Remind the contractor to record the receipt (ORD-09): once a day per report, with «تذكير: سلّمت …، وأرجو تسجيل الاستلام»
 * posted in the deal's conversation. */
export async function remindReceipt(poId: string, message?: string): Promise<void> {
  await act({ action: "po.remind", poId, ...withMessage(message) })
}

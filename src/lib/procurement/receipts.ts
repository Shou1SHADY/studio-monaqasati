// The goods receipt, derived (PRD 3.0 §5.2, §6.1-6). The gate counts blind —
// the quantity field is never prefilled from the supplier's notice — then
// rejects with a coded reason, holds for inspection with a reason, and the
// variance against the notice appears only after the count. What may be
// invoiced is what was ACCEPTED: counted − rejected − held. A receipt beyond
// the outstanding quantity plus the tolerance is refused, not trimmed.
//
// `deliveries` stays the store of the notice and the receipt; a delivery
// without PO fields is a legacy one and reads as plain "received".

import { acceptedOf, allLinesComplete, applyReceiptToLines, daysFromNow, lineOutstanding, lineToArrive, round2 } from "./po"
import type { DeliveryLine, PoLine, ProcurementPolicies, PurchaseOrder, ReceiptFact } from "./types"

export { acceptedOf }

const num = (n: number | null | undefined) => (Number.isFinite(Number(n)) ? Number(n) : 0)

// ---------------------------------------------------------------------------
// Lines — what the gate counts against
// ---------------------------------------------------------------------------

/** A quantity as a person or an old document may have written it. */
const looseNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** Where a delivery's lines come from: the notice's own lines, or a legacy
 * notice's items. */
export interface ReceiptLineSource {
  lines?: DeliveryLine[] | null
  items?: Array<{ name?: string | null; quantity?: number | string | null; unit?: string | null; unitOfMeasure?: string | null }> | null
}

/** A legacy delivery's items as lines, counted in full (today's "confirm all"). */
export function legacyLinesOf(delivery: Pick<ReceiptLineSource, "items">): DeliveryLine[] {
  return (delivery.items || [])
    .map((it, i) => ({ poLineId: `i${i + 1}`, name: (it.name || "").trim(), unit: (it.unitOfMeasure || it.unit || "").trim(), noticeQuantity: Math.max(0, looseNum(it.quantity)) }))
    .filter((l) => l.name && l.noticeQuantity > 0)
    .map((l) => ({ ...l, counted: l.noticeQuantity }))
}

/** The lines the gate's form starts from: the notice's own lines; on an order
 * whose notice named none, the order's open lines with no notice figure to
 * compare against (the screen says "no notice to compare"). */
export function linesForReceipt(delivery: ReceiptLineSource, po: PurchaseOrder | null): DeliveryLine[] {
  if (delivery.lines && delivery.lines.length) return delivery.lines.map((l) => ({ poLineId: l.poLineId, name: l.name, unit: l.unit, noticeQuantity: looseNum(l.noticeQuantity) }))
  if (po) return po.lines.filter((l) => lineToArrive(l) > 0).map((l) => ({ poLineId: l.id, name: l.name, unit: l.unit, noticeQuantity: 0 }))
  return legacyLinesOf(delivery).map((l) => ({ poLineId: l.poLineId, name: l.name, unit: l.unit, noticeQuantity: l.noticeQuantity }))
}

// ---------------------------------------------------------------------------
// Validation — codes, never sentences
// ---------------------------------------------------------------------------

export const RECEIPT_ERROR_CODES = ["count_missing", "negative_quantity", "over_deducted", "reject_reason_missing", "hold_reason_missing", "unknown_line", "over_receipt", "nothing_counted"] as const
export type ReceiptErrorCode = (typeof RECEIPT_ERROR_CODES)[number]

export interface ReceiptError {
  code: ReceiptErrorCode
  poLineId?: string
  params: Record<string, string | number>
}

/** One line of the gate's form, checked on its own. */
export function receiptLineErrors(line: DeliveryLine): ReceiptError[] {
  const out: ReceiptError[] = []
  const id = line.poLineId
  const counted = line.counted
  if (counted == null || !Number.isFinite(Number(counted))) {
    out.push({ code: "count_missing", poLineId: id, params: {} })
    return out
  }
  const rejected = num(line.rejected)
  const held = num(line.held)
  if (Number(counted) < 0 || rejected < 0 || held < 0) {
    out.push({ code: "negative_quantity", poLineId: id, params: {} })
    return out
  }
  if (rejected + held > Number(counted) + 1e-9) out.push({ code: "over_deducted", poLineId: id, params: { counted: Number(counted), rejected, held } })
  if (rejected > 0 && !line.rejectReason) out.push({ code: "reject_reason_missing", poLineId: id, params: {} })
  if (held > 0 && !line.holdReason) out.push({ code: "hold_reason_missing", poLineId: id, params: {} })
  return out
}

/** No receipt beyond what may still arrive, plus the tolerance (§6.1-6):
 * accept up to the limit and send the rest back with the driver. */
export function overReceiptRefusal(poLine: PoLine, counted: number, policies: ProcurementPolicies): ReceiptError | null {
  const expected = lineToArrive(poLine)
  const limit = round2(expected * (1 + num(policies.overReceiptTolerancePercent) / 100))
  if (num(counted) <= limit + 1e-9) return null
  return { code: "over_receipt", poLineId: poLine.id, params: { counted: num(counted), limit, outstanding: lineOutstanding(poLine), tolerance: num(policies.overReceiptTolerancePercent) } }
}

/** The whole form against the order — what the write refuses on. */
export function receiptErrors(po: PurchaseOrder, deliveryLines: DeliveryLine[], policies: ProcurementPolicies): ReceiptError[] {
  const out: ReceiptError[] = []
  const byId = new Map(po.lines.map((l) => [l.id, l]))
  let anything = false
  for (const d of deliveryLines) {
    const line = byId.get(d.poLineId)
    if (!line) {
      out.push({ code: "unknown_line", poLineId: d.poLineId, params: {} })
      continue
    }
    const errs = receiptLineErrors(d)
    out.push(...errs)
    if (errs.length) continue
    if (num(d.counted) > 0) anything = true
    const over = overReceiptRefusal(line, num(d.counted), policies)
    if (over) out.push(over)
  }
  if (!anything && !out.length) out.push({ code: "nothing_counted", params: {} })
  return out
}

// ---------------------------------------------------------------------------
// Variance and state
// ---------------------------------------------------------------------------

/** counted − notice: negative = short of what the supplier announced; null before the count. */
export function varianceVsNotice(line: DeliveryLine): number | null {
  if (line.counted == null) return null
  return round2(num(line.counted) - num(line.noticeQuantity))
}

/** Short against the supplier's own notice — only computable when a notice quantity exists. */
export function shortVsNotice(line: DeliveryLine): number {
  if (line.counted == null || !(num(line.noticeQuantity) > 0)) return 0
  return Math.max(0, round2(num(line.noticeQuantity) - num(line.counted)))
}

export const RECEIPT_STATES = ["on_the_way", "late_notice", "received", "received_with_rejects", "received_held", "received_short", "manual_no_po"] as const
export type ReceiptState = (typeof RECEIPT_STATES)[number]

/** First match wins: a receipt with no order is a regularisation case
 * whatever else it says; a pending notice is on the way until its date
 * passes; at the gate, rejects outrank a hold, a hold outranks a shortfall. */
export function receiptState(delivery: ReceiptFact, now: Date): ReceiptState {
  if (delivery.source === "manual" && !delivery.poId) return "manual_no_po"
  if (delivery.status !== "confirmed") {
    const d = daysFromNow(delivery.deliveryDate, now)
    return d != null && d < 0 ? "late_notice" : "on_the_way"
  }
  const lines = delivery.lines || []
  if (lines.some((l) => num(l.rejected) > 0)) return "received_with_rejects"
  if (lines.some((l) => num(l.held) > 0)) return "received_held"
  if (lines.some((l) => shortVsNotice(l) > 0)) return "received_short"
  return "received"
}

// ---------------------------------------------------------------------------
// Money — what this receipt is worth to the books
// ---------------------------------------------------------------------------

/** Σ accepted × unit price, ex-VAT. On a lump-sum order there is no unit
 * price to multiply: null until THIS receipt completes the order, then the
 * lot's total less what earlier receipts already posted. */
export function receiptNetValue(po: PurchaseOrder, deliveryLines: DeliveryLine[], alreadyPostedNet = 0): number | null {
  const byId = new Map(po.lines.map((l) => [l.id, l]))
  const used = deliveryLines.filter((d) => byId.has(d.poLineId) && acceptedOf(d) > 0)
  if (used.every((d) => byId.get(d.poLineId)?.unitPrice != null)) {
    return round2(used.reduce((s, d) => s + acceptedOf(d) * num(byId.get(d.poLineId)?.unitPrice), 0))
  }
  const after = { ...po, lines: applyReceiptToLines(po.lines, deliveryLines) }
  if (!allLinesComplete(after)) return null
  return round2(num(po.totalExVat) - num(alreadyPostedNet))
}

/** Default lines for the supplier's notice form: what may still arrive, per line. */
export function noticeLinesFromPo(po: PurchaseOrder): DeliveryLine[] {
  return po.lines
    .map((l) => ({ poLineId: l.id, name: l.name, unit: l.unit, noticeQuantity: lineToArrive(l) }))
    .filter((l) => l.noticeQuantity > 0)
}

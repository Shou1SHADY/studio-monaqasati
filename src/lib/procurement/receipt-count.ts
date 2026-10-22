// What the receiver counted, as pure rules (PRD 2.0 RCV-03): the lines a count becomes, the form's errors against the order,
// what enters the warehouse, and what a receipt closes of the notices that announced it. No Firestore here — the browser's
// receiver page and the server's confirmation both read the same rules, so the button and the transaction cannot disagree.

import { acceptedOf, round2 } from "./po"
import { receiptErrors, receiptLineErrors, type ReceiptError } from "./receipts"
import type { DeliveryLine, ProcurementPolicies, PurchaseOrder } from "./types"

/** The four reasons the receiver picks from when he does not accept part of what arrived (PRD 2.0 RCV-03): damaged, off spec, short in the
 * pack, other. Older reasons stay readable on receipts already recorded. */
export const RECEIVER_REJECT_REASONS = ["damaged", "wrong_spec", "short", "other"] as const
export type ReceiverRejectReason = (typeof RECEIVER_REJECT_REASONS)[number]

/** The goods that enter a store: name, unit, quantity and (net of VAT) what one unit cost, when the receipt knows. */
export interface StockItem {
  name: string
  unit: string
  quantity: number
  unitCost?: number | null
}

/** Thrown when a count fails the domain's validation — codes, never sentences. */
export class ReceiptValidationError extends Error {
  constructor(readonly errors: ReceiptError[]) {
    super(errors.map((e) => e.code).join(","))
    this.name = "ReceiptValidationError"
  }
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** Lines the receiver filled in (a blank line is skipped — a partial receipt of a multi-line shipment is allowed), with
 * `accepted` computed and the rest normalised. */
export function countedLines(lines: DeliveryLine[]): DeliveryLine[] {
  return lines
    .filter((l) => l.counted != null && String(l.counted) !== "")
    .map((l) => {
      const rejected = Math.max(0, num(l.rejected))
      const held = Math.max(0, num(l.held))
      return {
        poLineId: l.poLineId,
        name: l.name,
        unit: l.unit,
        noticeQuantity: Math.max(0, num(l.noticeQuantity)),
        counted: num(l.counted),
        rejected,
        rejectReason: rejected > 0 ? l.rejectReason ?? null : null,
        rejectNote: rejected > 0 ? l.rejectNote?.trim() || null : null,
        held,
        holdReason: held > 0 ? l.holdReason ?? null : null,
        accepted: acceptedOf({ counted: num(l.counted), rejected, held }),
      }
    })
}

/** The count's errors: against the order when there is one, per line otherwise. */
export function validateReceiptLines(po: PurchaseOrder | null, lines: DeliveryLine[], policies: ProcurementPolicies): ReceiptError[] {
  const counted = countedLines(lines)
  if (po) return receiptErrors(po, counted, policies)
  const out = counted.flatMap(receiptLineErrors)
  if (!out.length && !counted.some((l) => num(l.counted) > 0)) out.push({ code: "nothing_counted", params: {} })
  return out
}

/** What enters the warehouse: the accepted quantity per line, at the order's unit price when it has one. A legacy delivery of
 * ONE line priced as a lot gets that lot's price per unit — never a total split across lines. */
export function stockItemsOf(lines: DeliveryLine[], po: PurchaseOrder | null, legacyNet?: number | null): StockItem[] {
  const priced = new Map(po ? po.lines.map((l) => [l.id, l.unitPrice]) : [])
  const items = lines.map((l) => ({ name: l.name, unit: l.unit, quantity: acceptedOf(l), unitCost: po ? (priced.get(l.poLineId) ?? null) : null })).filter((it) => it.name && it.unit && it.quantity > 0)
  if (!po && items.length === 1 && legacyNet != null && legacyNet > 0) items[0].unitCost = round2(legacyNet / items[0].quantity)
  return items
}

/**
 * Pure: what the receipt's counted quantities leave of the notices, oldest first. A notice announces a DATE and a note, so one
 * with no quantity lines is closed by the first receipt that counts anything; a legacy notice that still carries quantities is
 * trimmed per order line and closes when nothing is left of it.
 */
export function trimNotices(notices: Array<{ lines: DeliveryLine[] }>, received: DeliveryLine[]): Array<{ lines: DeliveryLine[]; closed: boolean; changed: boolean }> {
  const left = new Map<string, number>()
  for (const l of received) left.set(l.poLineId, round2((left.get(l.poLineId) || 0) + Math.max(0, num(l.counted))))
  let countedAny = received.some((l) => num(l.counted) > 0)
  return notices.map((n) => {
    let changed = false
    if (countedAny && n.lines.every((l) => !(num(l.noticeQuantity) > 0))) {
      countedAny = false
      return { lines: n.lines, changed: true, closed: true }
    }
    const lines = n.lines.map((l) => {
      const take = Math.min(left.get(l.poLineId) || 0, Math.max(0, num(l.noticeQuantity)))
      if (!(take > 0)) return l
      left.set(l.poLineId, round2((left.get(l.poLineId) || 0) - take))
      changed = true
      return { ...l, noticeQuantity: round2(num(l.noticeQuantity) - take) }
    })
    return { lines, changed, closed: changed && lines.every((l) => !(num(l.noticeQuantity) > 0)) }
  })
}

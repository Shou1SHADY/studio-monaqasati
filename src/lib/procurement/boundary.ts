// «سجل ما عبر الحدود» — what crossed Procurement's boundary, newest first
// (PRD 3.0 §7.2, settings → not built · conflicts · log). Nothing is stored for
// it: every entry is read back from what the other side can already see — an
// order's own log (approved → Finance's commitment, sent / accepted / new date
// with the supplier, a remainder cancelled → Inventory stops waiting) and the
// goods receipts Inventory recorded. The key is the idempotency key the event
// travels under (`proc:PO:<no>`, `inv:GRN:<no>`), with the stored Latin number.
// Pure: no I/O.

import { dayOf, receiptDay } from "./po"
import type { PurchaseOrder, ReceiptFact } from "./types"

export type BoundaryParty = "pm" | "mfg" | "inv" | "fin" | "sup"
export const LINK_PARTIES: readonly BoundaryParty[] = ["pm", "mfg", "inv", "fin", "sup"]

export type BoundaryEventKind = "po_approved" | "po_sent" | "supplier_accepted" | "date_updated" | "remainder_cancelled" | "receipt" | "receipt_no_po"

export interface BoundaryEvent {
  at: string
  day: string
  dir: "in" | "out"
  party: BoundaryParty
  kind: BoundaryEventKind
  key: string
  params: Record<string, string | number>
  orderId: string | null
  receiptId: string | null
}

const FROM_LOG: Partial<Record<PurchaseOrder["log"][number]["action"], { kind: BoundaryEventKind; dir: "in" | "out"; party: BoundaryParty; prefix: string }>> = {
  approved: { kind: "po_approved", dir: "out", party: "fin", prefix: "proc:PO" },
  sent: { kind: "po_sent", dir: "out", party: "sup", prefix: "proc:PO" },
  supplier_accepted: { kind: "supplier_accepted", dir: "in", party: "sup", prefix: "sup:ACC" },
  date_updated: { kind: "date_updated", dir: "in", party: "sup", prefix: "sup:DATE" },
  remainder_cancelled: { kind: "remainder_cancelled", dir: "out", party: "inv", prefix: "proc:CXL" },
}

export function boundaryLog(orders: PurchaseOrder[], receipts: ReceiptFact[]): BoundaryEvent[] {
  const out: BoundaryEvent[] = []
  const docOf = new Map(orders.map((o) => [o.id, o.docNumber]))
  for (const po of orders) {
    for (const e of po.log || []) {
      const m = FROM_LOG[e.action]
      if (!m || !e.at) continue
      const params: Record<string, string | number> = { doc: po.docNumber, supplier: po.supplierName }
      if (e.action === "supplier_accepted" || e.action === "date_updated") params.date = String(e.params?.date ?? po.promisedDate ?? "")
      if (e.action === "remainder_cancelled") {
        params.line = String(e.params?.line ?? "")
        params.qty = Number(e.params?.qty ?? 0)
        params.unit = String(e.params?.unit ?? "")
      }
      out.push({ at: e.at, day: dayOf(e.at), dir: m.dir, party: m.party, kind: m.kind, key: `${m.prefix}:${po.docNumber}`, params, orderId: po.id, receiptId: null })
    }
  }
  for (const r of receipts) {
    if (r.status !== "confirmed") continue
    const at = r.confirmedAt || r.deliveryDate || ""
    if (!at) continue
    const grn = r.docNumber || ""
    const doc = (r.poId && docOf.get(r.poId)) || r.poNumber || ""
    out.push({ at, day: receiptDay(r), dir: "in", party: "inv", kind: doc ? "receipt" : "receipt_no_po", key: `inv:GRN:${grn || r.id}`, params: { grn, doc, supplier: r.supplierName || "" }, orderId: r.poId || null, receiptId: r.id })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key))
}

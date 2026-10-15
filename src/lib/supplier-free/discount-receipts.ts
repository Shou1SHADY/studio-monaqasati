// A rejected quantity the contractor keeps at a discount joins what was accepted when it is released (decision 3), but no
// receipt document is written for it — so the supplier could never bill it. It is read as a receipt of its own: one per
// released line, at the discounted price, dated the day it was released. Derive (the screens) and the invoice route (the
// rule) read it the same way, so what the form offers is what the server accepts.

import type { PurchaseOrder } from "@/lib/procurement/types"

export interface DiscountReceipt {
  /** The key an invoice names it by. */
  id: string
  day: string
  lineId: string
  qty: number
  price: number
  /** qty x discounted price, before VAT. */
  net: number
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const riyadh = (iso: unknown) => (typeof iso === "string" && iso ? new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10) : "")

export const discountReceiptId = (lineId: string) => `DISC-${lineId}`

export function discountReceipts(po: Pick<PurchaseOrder, "lines" | "log">): DiscountReceipt[] {
  const out: DiscountReceipt[] = []
  for (const l of po.lines) {
    const x = l as typeof l & { rejectDecision?: unknown; rejectDiscountState?: unknown; rejectDiscountPrice?: unknown }
    if (x.rejectDecision !== "discount" || x.rejectDiscountState !== "released") continue
    const price = Number(x.rejectDiscountPrice)
    const qty = Math.max(0, Number(l.rejected) || 0)
    if (!(price > 0) || !(qty > 0)) continue
    const released = [...(po.log || [])].reverse().find((e) => e.action === "reject_discount_released" && (e.params as { lineId?: string } | null)?.lineId === l.id)
    out.push({ id: discountReceiptId(l.id), day: riyadh(released?.at), lineId: l.id, qty, price, net: r2(qty * price) })
  }
  return out
}

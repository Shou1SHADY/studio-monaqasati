// An order placed without an RFQ (PRD 3.0 §7.2, the requests tab's computed
// route): ON a live price agreement, at the agreement's prices, or as a DIRECT
// purchase from one supplier (the prototype's poDir): under the direct-purchase
// cap no reason is asked; above it the order is a single-source exception and
// says why (sole agent · must match a previous supply · urgent). Both are basis
// `direct`; an agreement order carries `agreementId`. Pure: the write
// (`direct-writes.ts`) runs the same refusal again inside its transaction.

import { round2 } from "./po"
import { agreementIsLive, materialKey, type PriceAgreement } from "./prices"
import type { PoLine, ProcurementPolicies } from "./types"

export type DirectMode = "agreement" | "direct"

export interface DirectLineInput {
  name: string
  unit: string
  quantity: number
  /** Ex-VAT. Ignored on an agreement order: the agreement sets the price. */
  unitPrice: number | null
}

export type DirectRefusalCode = "order_no_lines" | "order_supplier_missing" | "reason_required" | "price_missing" | "over_direct_cap" | "agreement_not_live" | "agreement_line_missing" | "delivery_date_missing"

/** Why one supplier above the cap. */
export type SingleSourceReason = "sole" | "match" | "urgent"
export const SINGLE_SOURCE_REASONS: SingleSourceReason[] = ["sole", "match", "urgent"]

export interface DirectRefusal {
  code: DirectRefusalCode
  params: Record<string, string | number>
}

export interface DirectOrderCheck {
  mode: DirectMode
  lines: DirectLineInput[]
  supplierName: string
  /** A single-source reason code (or any text) — required only above the cap. */
  reason: string
  agreement?: PriceAgreement | null
  /** «مطلوب التسليم قبل» — checked only when the caller asks for it. */
  deliverBy?: string | null
  requireDeliverBy?: boolean
  policies: ProcurementPolicies
  today: string
}

const cleanLines = (lines: DirectLineInput[]) => lines.filter((l) => l.name.trim() && Number(l.quantity) > 0)

/** The priced lines the order would carry: the agreement's price on each line
 * of an agreement order, the entered price on a direct one (null = not priced). */
export function directLinePrices(c: Pick<DirectOrderCheck, "mode" | "lines" | "agreement">): Array<DirectLineInput & { unitPrice: number | null }> {
  return cleanLines(c.lines).map((l) => {
    if (c.mode === "direct") return { ...l, unitPrice: l.unitPrice != null && Number(l.unitPrice) > 0 ? Number(l.unitPrice) : null }
    const key = materialKey(l.name, l.unit)
    const match = (c.agreement?.lines || []).find((a) => materialKey(a.name, a.unit) === key && Number(a.price) > 0)
    return { ...l, unitPrice: match ? Number(match.price) : null }
  })
}

export const directTotal = (lines: Array<{ quantity: number; unitPrice: number | null }>) => round2(lines.reduce((s, l) => s + Number(l.quantity) * (l.unitPrice ?? 0), 0))

/** Why this order cannot be placed, or null. The first reason wins. */
export function directOrderRefusal(c: DirectOrderCheck): DirectRefusal | null {
  const lines = directLinePrices(c)
  if (!lines.length) return { code: "order_no_lines", params: {} }
  if (c.mode === "agreement") {
    if (!c.agreement || !agreementIsLive(c.agreement, c.today)) return { code: "agreement_not_live", params: {} }
    const missing = lines.find((l) => l.unitPrice == null)
    if (missing) return { code: "agreement_line_missing", params: { item: missing.name } }
    return deliverByRefusal(c)
  }
  if (!c.supplierName.trim()) return { code: "order_supplier_missing", params: {} }
  const unpriced = lines.find((l) => l.unitPrice == null)
  if (unpriced) return { code: "price_missing", params: { item: unpriced.name } }
  if (isSingleSource(c) && !c.reason.trim()) return { code: "reason_required", params: {} }
  return deliverByRefusal(c)
}

/** Above the cap a direct order skips competition: it needs its reason. */
export function isSingleSource(c: Pick<DirectOrderCheck, "mode" | "lines" | "agreement" | "policies">): boolean {
  return c.mode === "direct" && directTotal(directLinePrices(c)) > c.policies.directPurchaseCap
}

function deliverByRefusal(c: DirectOrderCheck): DirectRefusal | null {
  if (c.requireDeliverBy && !(c.deliverBy && c.deliverBy >= c.today)) return { code: "delivery_date_missing", params: {} }
  return null
}

export function directPoLines(lines: Array<DirectLineInput & { unitPrice: number | null }>): PoLine[] {
  return lines.map((l, i) => ({
    id: `l${i + 1}`,
    name: l.name.trim(),
    unit: (l.unit || "").trim(),
    quantity: Number(l.quantity),
    unitPrice: l.unitPrice,
    accepted: 0,
    rejected: 0,
    held: 0,
    cancelled: 0,
    boqItemId: null,
    rfqProductIndex: null,
  }))
}

// A supplier's quotation from the full portal, the AI assistant or the mobile app, written by the SERVER (onboarding,
// 18 Oct 2026). The `offers` rule used to take it straight from the browser, which no approval could reach — a team
// member's own doc does not carry his company's approval, and the ruleset has no room left to look it up. So the rule no
// longer lets a supplier create a quote, and this one door does what it checked and what it could not:
//  - the company is approved by the platform admin (supplier-approval.ts), and a free company is within its month;
//  - the request exists and is open (`New`);
//  - the quote is born under review, in HIS company's name, carrying none of the keys the buying side owns;
//  - who it belongs to and what it answers come from the server's own reads, never from the body.
// The free journey's quote acts stay where they are (`/api/supplier-free/act`), with the same two checks.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { UNDER_REVIEW } from "@/lib/procurement/supplier"
import { priceOffer, pricedProducts, pricingFault, pricingModeOf, toAmount, type PricedRfq } from "@/lib/procurement/offer-pricing"
import { QUOTE_COUNTS, quoteCountId, riyadhMonth } from "@/lib/supplier-approval"
import type { SupplierCompany } from "@/lib/supplier-free/supplier-company"

/** Keys only the buying side writes — the same list as `buyerOfferKeys()` in firestore.rules. */
export const BUYER_OFFER_KEYS = [
  "outcome", "poId", "poNumber", "awardedLines", "awardedTotal", "awardReason", "awaitingOrderApproval", "decidedAt",
  "decidedByUserId", "exclusion", "targetPrice", "reductionAt", "reductionBy", "reductionNote", "reductionTargets",
  "reductionRound", "sampleWhat", "samplePlace", "sampleBy", "sampleRequestedAt", "breakdown", "requestedDeliveryDate",
  "withdrawnAt", "versions", "directAward", "isManualOffer", "contractorRated",
] as const

/** Set by the server from its own reads — a body's value is dropped. */
const SERVER_KEYS = ["supplierId", "organizationId", "supplierOrgId", "submittedByUserId", "submittedByUserName", "rfqId", "rfqTitle", "projectId", "contractorId", "contractorOrgId", "status", "createdAt", "updatedAt", "isFromMdmak", "recordedById"] as const

export type OfferRefusal = "not_approved" | "quota" | "rfq_missing" | "rfq_closed" | "too_large" | "line_prices_incomplete" | "line_contradictory" | "no_line_priced"

export class SupplierOfferError extends Error {
  constructor(
    readonly code: OfferRefusal,
    readonly detail?: string
  ) {
    super(code)
    this.name = "SupplierOfferError"
  }
}

/** A stored offer may not exceed this many bytes of JSON — far above any real quotation. */
export const MAX_OFFER_BYTES = 200_000

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

/** The body with the server's and the buyer's keys removed. */
export function supplierOfferFields(body: Rec): Rec {
  const out: Rec = { ...body }
  for (const k of [...BUYER_OFFER_KEYS, ...SERVER_KEYS]) delete out[k]
  return out
}

const FAULT_CODE = { LINE_PRICES_INCOMPLETE: "line_prices_incomplete", LINE_CONTRADICTORY: "line_contradictory", NO_LINE_PRICED: "no_line_priced" } as const

/**
 * A per-material quote is checked and totalled HERE, never believed (Procurement 1.5, PUR-03): each line is priced or
 * marked «not supplied» (`skippedItems`), at least one is priced, none is both, and `price` is Σ rate × quantity.
 * A total-priced request has no partial offers, so a stray `skippedItems` is dropped. A body with no `lines` is a
 * lump sum (the assistant, an older app) and is left exactly as it came.
 */
export function normalizeOfferPricing(rfq: PricedRfq, fields: Rec): Rec {
  const rest: Rec = { ...fields }
  delete rest.skippedItems
  if (pricingModeOf(rfq) !== "line") return rest
  if (!Array.isArray(fields.lines) || !fields.lines.length) return rest
  const rates: Record<number, number> = {}
  for (const l of fields.lines as Rec[]) rates[Number(l.rfqProductIndex)] = toAmount(l.unitPrice)
  const skipped = Array.isArray(fields.skippedItems) ? (fields.skippedItems as unknown[]).map(Number).filter((i) => Number.isInteger(i) && i >= 0) : []
  const pricing = priceOffer(pricedProducts(rfq), rates, skipped)
  const fault = pricingFault(pricing)
  if (fault) throw new SupplierOfferError(FAULT_CODE[fault.code], fault.indexes.join(","))
  const price = String(pricing.total)
  const batches = Array.isArray(rest.deliveryBatches) ? (rest.deliveryBatches as Rec[]) : null
  return {
    ...rest,
    lines: pricing.lines,
    price,
    ...(batches?.length === 1 ? { deliveryBatches: [{ ...batches[0], price }] } : {}),
    ...(pricing.skipped.length ? { skippedItems: pricing.skipped } : {}),
  }
}

export async function createSupplierOffer(
  db: Firestore,
  s: Pick<SupplierCompany, "uid" | "name" | "orgId" | "company" | "approved">,
  rfqId: string,
  body: Rec,
  opts: { monthlyLimit?: number | null; now?: Date } = {}
): Promise<{ id: string }> {
  if (!s.approved) throw new SupplierOfferError("not_approved")
  const fields = supplierOfferFields(body)
  if (JSON.stringify(fields).length > MAX_OFFER_BYTES) throw new SupplierOfferError("too_large")
  const now = opts.now || new Date()
  const at = now.toISOString()
  const limit = opts.monthlyLimit || null
  const rfqRef = db.collection("rfqs").doc(rfqId)
  const ref = db.collection("offers").doc()
  const countRef = limit ? db.collection(QUOTE_COUNTS).doc(quoteCountId(s.orgId, riyadhMonth(now))) : null

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rfqRef)
    if (!snap.exists) throw new SupplierOfferError("rfq_missing")
    const used = countRef ? Number((await tx.get(countRef)).data()?.count) || 0 : 0
    if (countRef && limit && used >= limit) throw new SupplierOfferError("quota", String(limit))
    const rfq = snap.data() as Rec
    if (str(rfq.status) !== "New") throw new SupplierOfferError("rfq_closed")
    const priced = normalizeOfferPricing(rfq as PricedRfq, fields)
    tx.set(ref, {
      ...priced,
      supplierId: s.uid,
      organizationId: s.orgId,
      supplierName: str(fields.supplierName) || s.company || "—",
      companyName: str(fields.companyName) || s.company || "",
      submittedByUserId: s.uid,
      submittedByUserName: s.name || s.company,
      rfqId,
      rfqTitle: str(rfq.title),
      projectId: str(rfq.projectId) || null,
      contractorId: str(rfq.contractorId) || null,
      contractorOrgId: str(rfq.organizationId) || str(rfq.contractorId) || null,
      status: UNDER_REVIEW,
      createdAt: at,
    })
    tx.update(rfqRef, { offersCount: FieldValue.increment(1) })
    if (countRef) tx.set(countRef, { orgId: s.orgId, month: riyadhMonth(now), count: used + 1, updatedAt: at }, { merge: true })
  })
  return { id: ref.id }
}

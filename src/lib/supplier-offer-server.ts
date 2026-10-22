// A supplier's quotation from the full portal, the AI assistant or the mobile app, written by the SERVER (onboarding,
// 18 Oct 2026). The `offers` rule used to take it straight from the browser, which no approval could reach — a team
// member's own doc does not carry his company's approval, and the ruleset has no room left to look it up. So the rule no
// longer lets a supplier create a quote, and this one door does what it checked and what it could not:
//  - the company is approved by the platform admin (supplier-approval.ts), and a free company is within its month;
//  - the request exists, is open (`New`), its deadline's day has not passed and it reaches him (G-07, the same rule as
//    the free journey's door and the visitor link's);
//  - the quote is born under review, in HIS company's name, carrying none of the keys the buying side owns;
//  - the prices are checked and totalled here (per request unit or per sale unit, NFR-07), and the quote is born as
//    version 1 — every later edit, from any door, is the next version (G-15);
//  - who it belongs to and what it answers come from the server's own reads, never from the body.
// The free journey's quote acts stay where they are (`/api/supplier-free/act`), with the same checks.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { riyadhDay } from "@/lib/hr/format"
import { isWithdrawnOffer } from "@/lib/procurement/award"
import { rfqOfferKey } from "@/lib/procurement/event-keys"
import { UNDER_REVIEW } from "@/lib/procurement/supplier"
import { pricingModeOf, type PricedRfq } from "@/lib/procurement/offer-pricing"
import { buildQuote, leadDaysFrom, leadDaysRefusal, quotingGate, versionFromQuote, type BuiltQuote, type QuoteRefusalCode, type QuoteRfq } from "@/lib/procurement/offer-versions"
import { rfqKeyPart, sendProcEvent } from "@/lib/procurement/proc-event-server"
import { rfqLogEntry, type RfqLogEntry } from "@/lib/procurement/rfq-detail"
import { QUOTE_COUNTS, quoteCountId, riyadhMonth } from "@/lib/supplier-approval"
import { requestReaches } from "@/lib/supplier-free/quote-rules"
import type { SupplierCompany } from "@/lib/supplier-free/supplier-company"

/** Keys only the buying side writes — the same list as `buyerOfferKeys()` in firestore.rules. */
export const BUYER_OFFER_KEYS = [
  "outcome", "poId", "poNumber", "awardedLines", "awardedTotal", "awardReason", "awaitingOrderApproval", "decidedAt",
  "decidedByUserId", "exclusion", "targetPrice", "reductionAt", "reductionBy", "reductionNote", "reductionTargets",
  "reductionRound", "sampleWhat", "samplePlace", "sampleBy", "sampleRequestedAt", "breakdown", "requestedDeliveryDate",
  "withdrawnAt", "versions", "directAward", "isManualOffer", "contractorRated", "rev", "bafo", "reval",
] as const

/** Set by the server from its own reads — a body's value is dropped. */
const SERVER_KEYS = ["supplierId", "organizationId", "supplierOrgId", "submittedByUserId", "submittedByUserName", "rfqId", "rfqTitle", "projectId", "contractorId", "contractorOrgId", "status", "createdAt", "updatedAt", "isFromMdmak", "recordedById", "vatRegistered", "vatRate", "lump", "leadDays"] as const

export type OfferRefusal = "not_approved" | "quota" | "rfq_missing" | "rfq_closed" | "deadline" | "not_reached" | "already_quoted" | "too_large" | "duration_invalid" | QuoteRefusalCode

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

/**
 * A quote is checked and totalled HERE, never believed (Procurement 1.5 PUR-03, 2.0 NFR-07): each line is priced —
 * per request unit, or per sale unit the line offers — or marked «not supplied» (`skippedItems`), at least one is
 * priced, none is both, every price is positive, finite and under the ceiling, and `price` is the sum offer-calc
 * gives. A total-priced request has no partial offers, so a stray `skippedItems` is dropped. A body with no `lines`
 * is a lump sum (the assistant, an older app): its one figure is checked and otherwise left exactly as it came.
 */
export function priceBody(rfq: PricedRfq, fields: Rec, vat: { registered: boolean }): { fields: Rec; quote: BuiltQuote } {
  const rest: Rec = { ...fields }
  delete rest.skippedItems
  const whole = fields.whole === true
  const refuse = (r: { code: QuoteRefusalCode; indexes: number[] }) => new SupplierOfferError(r.code, r.indexes.join(","))
  const lines = Array.isArray(fields.lines) ? (fields.lines as Rec[]) : []
  if (pricingModeOf(rfq) === "line" && lines.length) {
    const skipped = Array.isArray(fields.skippedItems) ? (fields.skippedItems as unknown[]).map(Number).filter((i) => Number.isInteger(i) && i >= 0) : []
    const built = buildQuote(rfq as QuoteRfq, { lines: lines.map((l) => ({ rfqProductIndex: Number(l.rfqProductIndex), unitPrice: l.unitPrice, packLen: l.packLen, warrantyMonths: l.warrantyMonths })), skipped, whole }, vat)
    if (!built.ok) throw refuse(built.refusal)
    const q = built.quote
    const price = String(q.total)
    const batches = Array.isArray(rest.deliveryBatches) ? (rest.deliveryBatches as Rec[]) : null
    return {
      quote: q,
      fields: {
        ...rest,
        lines: q.lines,
        price,
        ...(batches?.length === 1 ? { deliveryBatches: [{ ...batches[0], price }] } : {}),
        ...(q.skipped.length ? { skippedItems: q.skipped } : {}),
      },
    }
  }
  const built = buildQuote({ ...(rfq as QuoteRfq), pricingMode: "total" }, { total: fields.price, whole }, vat)
  if (!built.ok) throw refuse(built.refusal)
  return { quote: built.quote, fields: rest }
}

export function normalizeOfferPricing(rfq: PricedRfq, fields: Rec): Rec {
  return priceBody(rfq, fields, { registered: true }).fields
}

export type OfferingCompany = Pick<SupplierCompany, "uid" | "name" | "orgId" | "company" | "approved" | "hasVat" | "field">

export async function createSupplierOffer(db: Firestore, s: OfferingCompany, rfqId: string, body: Rec, opts: { monthlyLimit?: number | null; now?: Date } = {}): Promise<{ id: string }> {
  if (!s.approved) throw new SupplierOfferError("not_approved")
  const fields = supplierOfferFields(body)
  if (JSON.stringify(fields).length > MAX_OFFER_BYTES) throw new SupplierOfferError("too_large")
  const now = opts.now || new Date()
  const at = now.toISOString()
  const today = riyadhDay(now)
  const limit = opts.monthlyLimit || null
  const rfqRef = db.collection("rfqs").doc(rfqId)
  const ref = db.collection("offers").doc()
  const countRef = limit ? db.collection(QUOTE_COUNTS).doc(quoteCountId(s.orgId, riyadhMonth(now))) : null
  const lead = leadDaysFrom(fields.executionDuration, fields.executionDurationUnit)
  if (leadDaysRefusal(lead)) throw new SupplierOfferError("duration_invalid")

  const rfq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rfqRef)
    if (!snap.exists) throw new SupplierOfferError("rfq_missing")
    const used = countRef ? Number((await tx.get(countRef)).data()?.count) || 0 : 0
    if (countRef && limit && used >= limit) throw new SupplierOfferError("quota", String(limit))
    const rfq = snap.data() as Rec
    // G-07, the same rule on every door: the request is open AND its deadline's day has not passed.
    const gate = quotingGate(rfq, today)
    if (gate) throw new SupplierOfferError(gate)
    if (!requestReaches(rfq, s.orgId, s.field)) throw new SupplierOfferError("not_reached")
    // One live quote per company per request: a second one is an edit — a new version of the first (WF-03).
    const mine = await tx.get(db.collection("offers").where("rfqId", "==", rfqId).where("organizationId", "==", s.orgId))
    if (mine.docs.some((d) => !isWithdrawnOffer(d.data() as Rec))) throw new SupplierOfferError("already_quoted")
    const { fields: priced, quote } = priceBody(rfq as PricedRfq, fields, { registered: s.hasVat })
    const batches = Array.isArray(priced.deliveryBatches) ? (priced.deliveryBatches as Rec[]) : []
    const version = versionFromQuote(quote, { at: today, arrive: str(batches[0]?.deliveryDate) || null, valid: str(priced.validUntil), note: str(priced.supplierNote), fileUrl: str(priced.offerPdfUrl) || null, leadDays: lead, by: "supplier", n: 1 })
    tx.set(ref, {
      ...priced,
      ...(quote.lump != null ? { lump: quote.lump } : {}),
      whole: quote.whole,
      vatRegistered: quote.vatRegistered,
      vatRate: quote.vatRate,
      ...(lead != null ? { leadDays: lead } : {}),
      versions: [version],
      rev: 1,
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
    tx.update(rfqRef, { offersCount: FieldValue.increment(1), log: [...((Array.isArray(rfq.log) ? rfq.log : []) as RfqLogEntry[]), rfqLogEntry({ uid: s.uid, name: s.name || s.company }, "offer_versioned", at, { params: { supplier: s.company, version: 1 } })] })
    if (countRef) tx.set(countRef, { orgId: s.orgId, month: riyadhMonth(now), count: used + 1, updatedAt: at }, { merge: true })
    return rfq
  })
  const no = rfqKeyPart(rfq, rfqId)
  await sendProcEvent(db, { id: "rfq_offer", key: rfqOfferKey(no, s.orgId, 1), organizationId: str(rfq.organizationId) || str(rfq.contractorId), by: s.uid, at, refs: { rfq: no, offer: ref.id }, payload: { version: 1 } })
  return { id: ref.id }
}

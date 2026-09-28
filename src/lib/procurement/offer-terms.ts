// An offer's commercial terms (R-16, prototype offer form): where the price is
// quoted (delivered to site / ex-works), how long it holds, the advance it
// asks and the credit on the rest. All optional — an offer without them reads
// as before; the comparison's notes (rfq-notes.ts) and the order read them.
// One parser for the supplier dialog, the guest link and the API route, so the
// three write the same shape. Pure.

export type PriceBasis = "site" | "exw"
export const PRICE_BASES: PriceBasis[] = ["site", "exw"]

export interface OfferTermsInput {
  priceBasis?: string | null
  validUntil?: string | null
  advancePercent?: string | number | null
  creditDays?: string | number | null
}

export interface OfferTerms {
  priceBasis?: PriceBasis
  validUntil?: string
  advancePercent?: number
  creditDays?: number
}

export type OfferTermsError = "valid_past" | "advance_range" | "credit_range"

const DAY = /^\d{4}-\d{2}-\d{2}$/
const numOf = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null
  const n = Number(String(v).replace(/,/g, ""))
  return Number.isFinite(n) ? n : NaN
}

/** The fields to write, or the first thing wrong with them. `today` is `YYYY-MM-DD`. */
export function parseOfferTerms(input: OfferTermsInput, today: string): { terms: OfferTerms; error: OfferTermsError | null } {
  const terms: OfferTerms = {}
  if (input.priceBasis === "site" || input.priceBasis === "exw") terms.priceBasis = input.priceBasis
  const valid = (input.validUntil || "").trim()
  if (valid) {
    if (!DAY.test(valid) || valid < today) return { terms, error: "valid_past" }
    terms.validUntil = valid
  }
  const adv = numOf(input.advancePercent)
  if (adv !== null) {
    if (!(adv >= 0 && adv <= 100)) return { terms, error: "advance_range" }
    if (adv > 0) terms.advancePercent = Math.round(adv * 100) / 100
  }
  const credit = numOf(input.creditDays)
  if (credit !== null) {
    if (!(credit >= 0 && credit <= 365 && Number.isInteger(credit))) return { terms, error: "credit_range" }
    if (credit > 0) terms.creditDays = credit
  }
  return { terms, error: null }
}

/** What the award carries onto the order. */
export function orderTermsOf(offer: { advancePercent?: unknown; creditDays?: unknown; priceBasis?: unknown }): { advancePercent?: number; creditDays?: number; priceBasis?: PriceBasis } {
  const out: { advancePercent?: number; creditDays?: number; priceBasis?: PriceBasis } = {}
  const adv = Number(offer.advancePercent)
  if (Number.isFinite(adv) && adv > 0 && adv <= 100) out.advancePercent = adv
  const credit = Number(offer.creditDays)
  if (Number.isFinite(credit) && credit > 0) out.creditDays = credit
  if (offer.priceBasis === "site" || offer.priceBasis === "exw") out.priceBasis = offer.priceBasis
  return out
}

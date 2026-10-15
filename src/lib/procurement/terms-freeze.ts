// The payment terms an order is placed on, frozen at the award so the supplier reads the same schedule the buyer
// accepted (Supplier 1.0 G-08, decision 6). EVERY order carries them: the RFQ's own terms (the buyer's picker, RFQ-11)
// when it has them, else what the offer states (an advance, a credit period), else the explicit default — 100% at
// 30 days — written out, so no order is ever left without `termsList` and nothing downstream has to guess.

export interface FrozenTerm {
  pct: number
  days: number
}

/** What an order gets when neither the RFQ nor the offer names terms. */
export const DEFAULT_TERMS: readonly FrozenTerm[] = [{ pct: 100, days: 30 }]

/** The longest credit the picker offers, in days. */
export const MAX_TERM_DAYS = 365

const r2 = (n: number) => Math.round(n * 100) / 100

/** A terms list as stored on an RFQ — rows of a positive share and whole days, summing to 100 — or null. */
export function termsListOf(v: unknown): FrozenTerm[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 6) return null
  const rows: FrozenTerm[] = []
  for (const x of v) {
    const pct = Number((x as { pct?: unknown } | null)?.pct)
    const days = Number((x as { days?: unknown } | null)?.days)
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null
    if (!Number.isInteger(days) || days < 0 || days > MAX_TERM_DAYS) return null
    rows.push({ pct: r2(pct), days })
  }
  return Math.abs(rows.reduce((s, x) => s + x.pct, 0) - 100) <= 0.01 ? rows : null
}

/** Why a picker's rows cannot be saved: `sum` (not 100%), `row` (a share or a day count out of range), or null. */
export function termsRefusal(rows: Array<{ pct: string | number; days: string | number }>): "sum" | "row" | null {
  const parsed = rows.map((x) => ({ pct: Number(x.pct), days: Number(x.days) }))
  if (!parsed.length || parsed.some((x) => !Number.isFinite(x.pct) || x.pct <= 0 || x.pct > 100 || !Number.isInteger(x.days) || x.days < 0 || x.days > MAX_TERM_DAYS)) return "row"
  return termsListOf(parsed) ? null : "sum"
}

/** The offer's own terms, when it states an advance or a credit period. */
export function offerTermsList(offer: { advancePercent?: unknown; creditDays?: unknown }): FrozenTerm[] | null {
  const adv = Number(offer.advancePercent)
  const credit = Number(offer.creditDays)
  const hasAdv = Number.isFinite(adv) && adv > 0 && adv < 100
  const hasCredit = Number.isFinite(credit) && credit > 0
  if (!hasAdv && !hasCredit) return null
  const days = hasCredit ? Math.round(credit) : 30
  return hasAdv ? [{ pct: adv, days: 0 }, { pct: r2(100 - adv), days }] : [{ pct: 100, days }]
}

/** The terms frozen on an order at the award: the RFQ's › the offer's › the default. Always a list. */
export function frozenTermsOf(offer: { advancePercent?: unknown; creditDays?: unknown }, rfq?: { paymentTermsList?: unknown } | null): { termsList: FrozenTerm[] } {
  return { termsList: termsListOf(rfq?.paymentTermsList) || offerTermsList(offer) || DEFAULT_TERMS.map((x) => ({ ...x })) }
}

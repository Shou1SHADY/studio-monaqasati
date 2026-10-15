// The payment terms an order is placed on, frozen at the award so the supplier reads the same schedule the buyer
// accepted (Supplier 1.0, decision 6). Stated only when the offer states them: an advance, or a credit period.

export interface FrozenTerm {
  pct: number
  days: number
}

export function frozenTermsOf(offer: { advancePercent?: unknown; creditDays?: unknown }): { termsList?: FrozenTerm[] } {
  const adv = Number(offer.advancePercent)
  const credit = Number(offer.creditDays)
  const hasAdv = Number.isFinite(adv) && adv > 0 && adv < 100
  const hasCredit = Number.isFinite(credit) && credit > 0
  if (!hasAdv && !hasCredit) return {}
  const days = hasCredit ? Math.round(credit) : 30
  return { termsList: hasAdv ? [{ pct: adv, days: 0 }, { pct: Math.round((100 - adv) * 100) / 100, days }] : [{ pct: 100, days }] }
}

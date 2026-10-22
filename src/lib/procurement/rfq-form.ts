// The new-RFQ form's rules that decide what is asked and stored (prototype
// FORMS.rfq, R-01/R-17/R-37). Per-line pricing is the default — it is the only
// way a multi-line RFQ can be split across suppliers; the choice is offered
// only when there is a choice (more than one line). A direct award is an OPEN
// RFQ to one supplier (Procurement 2.0, ED-06): it has a deadline and a pricing
// like any other. A deadline is today or later (R-32).
// Pure: no I/O.

export type RfqAudience = "public" | "private" | "direct"
export type RfqPricing = "line" | "total"

export const DEFAULT_RFQ_PRICING: RfqPricing = "line"

export const showsPricingChoice = (lines: number, _audience: RfqAudience): boolean => lines > 1

/** What is stored: a rate needs a quantity to multiply by, so without every
 * quantity the RFQ asks for one total; one line or a direct award is priced per line. */
export function effectivePricing(chosen: RfqPricing, lines: number, everyLineHasQuantity: boolean, audience: RfqAudience): RfqPricing {
  if (!everyLineHasQuantity) return "total"
  if (!showsPricingChoice(lines, audience)) return "line"
  return chosen
}

/** Every audience has an offer round: a direct award is an OPEN RFQ to one supplier (Procurement 2.0, ED-06). */
export const asksForOffers = (_audience: RfqAudience): boolean => true

export type Step3Field = "city" | "deadline" | "deadline_past"

export function step3Refusals(input: { city: string; deadline: string; audience: RfqAudience; today: string }): Step3Field[] {
  const out: Step3Field[] = []
  if (!input.city) out.push("city")
  if (asksForOffers(input.audience)) {
    if (!input.deadline) out.push("deadline")
    else if (input.deadline < input.today) out.push("deadline_past")
  }
  return out
}

/** The earliest deadline the date picker offers: today (R-32 «اختر اليوم أو بعده»). */
export const firstDeadline = (today: string): string => today

/** A Saudi VAT registration number: 15 digits, starting and ending with 3. */
export const SAUDI_VAT_RE = /^3\d{13}3$/
export const isSaudiVat = (v: string | null | undefined): boolean => SAUDI_VAT_RE.test((v || "").trim())

// The new-RFQ form's rules that decide what is asked and stored (prototype
// FORMS.rfq, R-01/R-17/R-37). Per-line pricing is the default — it is the only
// way a multi-line RFQ can be split across suppliers; the choice is offered
// only when there is a choice (more than one line, not a direct award). A
// direct award has no offer round, so no deadline and no budget are asked. A
// deadline is a day AFTER today: a round that closes today reaches nobody.
// Pure: no I/O.

export type RfqAudience = "public" | "private" | "direct"
export type RfqPricing = "line" | "total"

export const DEFAULT_RFQ_PRICING: RfqPricing = "line"

export const showsPricingChoice = (lines: number, audience: RfqAudience): boolean => lines > 1 && audience !== "direct"

/** What is stored: a rate needs a quantity to multiply by, so without every
 * quantity the RFQ asks for one total; one line or a direct award is priced per line. */
export function effectivePricing(chosen: RfqPricing, lines: number, everyLineHasQuantity: boolean, audience: RfqAudience): RfqPricing {
  if (!everyLineHasQuantity) return "total"
  if (!showsPricingChoice(lines, audience)) return "line"
  return chosen
}

/** The offer round's fields: none for a direct award. */
export const asksForOffers = (audience: RfqAudience): boolean => audience !== "direct"

export type Step3Field = "city" | "deadline" | "deadline_past"

export function step3Refusals(input: { city: string; deadline: string; audience: RfqAudience; today: string }): Step3Field[] {
  const out: Step3Field[] = []
  if (!input.city) out.push("city")
  if (asksForOffers(input.audience)) {
    if (!input.deadline) out.push("deadline")
    else if (input.deadline <= input.today) out.push("deadline_past")
  }
  return out
}

/** The earliest deadline the date picker offers: tomorrow. */
export function firstDeadline(today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** A Saudi VAT registration number: 15 digits, starting and ending with 3. */
export const SAUDI_VAT_RE = /^3\d{13}3$/
export const isSaudiVat = (v: string | null | undefined): boolean => SAUDI_VAT_RE.test((v || "").trim())

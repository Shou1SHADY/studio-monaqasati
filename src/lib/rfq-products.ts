import { toAmount } from "@/lib/procurement/offer-pricing"

export interface RfqProductDraft {
  category?: string
  subCategory?: string
  otherSubCategory?: string
  quantity: string
  unit: string
  description: string
}

/**
 * A product row ready to go on an RFQ. One rule for validating AND submitting:
 * the submit used to drop an incomplete row without a word, so an RFQ could go
 * out missing a material the buyer had half-entered and never know it.
 */
export function productComplete(p: RfqProductDraft): boolean {
  return (
    toAmount(p.quantity) > 0 &&
    Boolean(p.unit.trim()) &&
    Boolean(p.category) &&
    Boolean(p.subCategory === "أخرى" ? p.otherSubCategory?.trim() : p.subCategory)
  )
}

/** Something was typed or picked — a wholly blank row is simply ignored. */
export function productStarted(p: RfqProductDraft): boolean {
  return Boolean(p.category || p.quantity.trim() || p.unit.trim() || p.description.trim())
}

/** Rows begun but not finished: each must be completed or removed. */
export function incompleteProducts<T extends RfqProductDraft>(products: T[]): T[] {
  return products.filter((p) => productStarted(p) && !productComplete(p))
}

/**
 * The unit after a sub-category is picked (PUR-02): the sub-category's default
 * fills an EMPTY unit only. A unit that arrived with the line (a project's
 * «200 كيس») is what the supplier quotes on — swapping it for the default
 * («طن») turned 10 tonnes of cement into 200 without a word.
 */
export function unitOnPick(current: string, defaultUnit: string | undefined): string {
  return current.trim() ? current : defaultUnit || current
}

/** The rows the RFQ is made of: a wholly blank row neither counts nor changes the pricing mode (PUR-03). */
export function startedProducts<T extends RfqProductDraft>(products: T[]): T[] {
  return products.filter(productStarted)
}

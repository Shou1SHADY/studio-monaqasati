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

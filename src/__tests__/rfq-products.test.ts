/**
 * Which RFQ product rows are ready. UAT, 23 Sep: step 1 let a product through
 * with its quantity blank, and the submit then dropped it silently — the RFQ
 * would have gone out without a material the buyer had entered.
 */

import { incompleteProducts, productComplete, productStarted } from "@/lib/rfq-products"

const row = (over: Partial<Parameters<typeof productComplete>[0]> = {}) => ({ category: "حديد ومعادن", subCategory: "حديد تسليح", quantity: "10", unit: "طن", description: "", ...over })

describe("productComplete", () => {
  it("wants a category, a subcategory, a positive quantity and a unit", () => {
    expect(productComplete(row())).toBe(true)
    expect(productComplete(row({ quantity: "" }))).toBe(false)
    expect(productComplete(row({ quantity: "0" }))).toBe(false)
    expect(productComplete(row({ unit: " " }))).toBe(false)
    expect(productComplete(row({ subCategory: "" }))).toBe(false)
  })

  it("takes the typed name when the subcategory is Other", () => {
    expect(productComplete(row({ subCategory: "أخرى", otherSubCategory: "" }))).toBe(false)
    expect(productComplete(row({ subCategory: "أخرى", otherSubCategory: "زوايا" }))).toBe(true)
  })

  it("reads Arabic-Indic digits in the quantity", () => {
    expect(productComplete(row({ quantity: "٤٠" }))).toBe(true)
  })
})

describe("incompleteProducts — a started row must be finished or removed", () => {
  it("names the half-entered row, the UAT case", () => {
    const mesh = row({ subCategory: "شبك حديد (مش)", quantity: "", unit: "لوح" })
    expect(incompleteProducts([row(), mesh])).toEqual([mesh])
  })

  it("ignores a wholly blank row", () => {
    const blank = { category: "", subCategory: "", quantity: "", unit: "", description: "" }
    expect(productStarted(blank)).toBe(false)
    expect(incompleteProducts([row(), blank])).toEqual([])
  })
})

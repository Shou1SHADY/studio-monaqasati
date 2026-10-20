// PUR-03/04: one RFQ, every category it was written with; matched by sub-category id.
import { choseFromTree, fieldCovers, rfqMaterialFields, slices, supplierSubIds } from "@/lib/materials/reach"
import { requestReaches } from "@/lib/supplier-free/quote-rules"
import type { MaterialPick } from "@/lib/materials/types"

const pick = (rootId: string, root: string, subId: string, sub: string, leaf?: string): MaterialPick => ({
  nodeId: leaf ? `${subId}-leaf` : subId,
  subId,
  rootId,
  path: [{ ar: root, en: root }, { ar: sub, en: sub }, ...(leaf ? [{ ar: leaf, en: leaf }] : [])],
  specs: [],
})

const rebar = pick("iron", "الحديد", "rebar", "حديد التسليح", "اسياخ حديد التسليح")
const cement = pick("cement", "الاسمنت", "plain", "الاسمنت العادي")

describe("an RFQ written on the tree", () => {
  const f = rfqMaterialFields([{ material: rebar }, { material: cement }, { material: rebar }])
  it("carries every sub-category once, and words for older readers", () => {
    expect(f.subCategoryIds).toEqual(["rebar", "plain"])
    expect(f.categoryIds).toEqual(["iron", "cement"])
    expect(f.categories).toEqual(["الحديد", "الاسمنت"])
    expect(f.category).toBe("الحديد")
    expect(f.subCategory).toBe("متعدد")
  })
  it("reaches a supplier of ANY of its sub-categories — not one RFQ per category", () => {
    const rfq = { ...f, visibility: "public", city: "" }
    expect(fieldCovers({ subIds: ["plain"], specs: [] }, rfq)).toBe(true)
    expect(fieldCovers({ subIds: ["tiles"], specs: ["الحديد"] }, rfq)).toBe(false)
    expect(requestReaches(rfq, "s1", { specs: [], cities: [], subIds: ["rebar"] })).toBe(true)
    expect(requestReaches({ ...rfq, visibility: "private" }, "s1", { specs: [], cities: [], subIds: ["rebar"] })).toBe(false)
  })
})

it("an RFQ written before the tree still meets the suppliers of its category name", () => {
  const old = { category: "حديد ومعادن", visibility: "public" }
  expect(fieldCovers({ subIds: [], specs: ["حديد ومعادن"] }, old)).toBe(true)
  expect(fieldCovers({ subIds: ["rebar"], specs: [] }, old)).toBe(false)
})

it("a secondary company's specialties win over its owner's; nothing chosen means he is asked", () => {
  expect(supplierSubIds({ specialtyIds: ["a"] }, { specialtyIds: ["b"] })).toEqual(["b"])
  expect(supplierSubIds({ specialtyIds: ["a"] }, {})).toEqual(["a"])
  expect(choseFromTree({ specializations: ["حديد"] })).toBe(false)
})

it("reads more than 30 sub-categories in slices", () => {
  expect(slices(Array.from({ length: 65 }, (_, i) => i)).map((s) => s.length)).toEqual([30, 30, 5])
})

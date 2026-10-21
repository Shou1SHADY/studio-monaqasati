// PUR-04: the sub-categories every picker and filter reads, the older category names that still match,
// the platform directory's listing, and heavy-equipment rental.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { indexTree } from "@/lib/materials/tree"
import { keyLabel, legacyNameToSubIds, specialtyKeys, subLabel, subOptions } from "@/lib/materials/subs"
import { isHeavyEquipmentRental, otherEquipmentSub } from "@/lib/materials/equipment"
import { directoryEntries, listedInDirectory } from "@/lib/procurement/directory-listing"
import { directoryCounts, filterDirectory } from "@/lib/procurement/supplier-file"
import { passesFilters, type RfqListLike } from "@/lib/procurement/rfq-view"
import { rfqReviewHref } from "@/lib/procurement/rfq-routes"
import type { MaterialTreeFile } from "@/lib/materials/types"

const index = indexTree((JSON.parse(readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")) as MaterialTreeFile).roots)
const sub = (ar: string) => index.subs.find((s) => s.ar === ar)!

describe("one list of sub-categories", () => {
  it("offers every sub-category (106 + the first-level leaves) with its category before it", () => {
    const options = subOptions(index, "ar")
    expect(options).toHaveLength(index.subs.length)
    expect(options.find((o) => o.value === sub("حديد التسليح").id)?.label).toBe("الحديد › حديد التسليح")
    expect(subLabel(index, sub("حديد التسليح").id, "ar", false)).toBe("حديد التسليح")
    expect(subLabel(index, sub("حديد التسليح").id, "en")).toContain("›")
  })

  it("keeps an older category name as a key of its own, and folds one the tree spells exactly", () => {
    const rebar = sub("حديد التسليح").id
    expect(legacyNameToSubIds(index, "حديد ومعادن")).toEqual([])
    expect(legacyNameToSubIds(index, "حديد التسليح")).toEqual([rebar])
    expect(legacyNameToSubIds(index, "الحديد")).toContain(rebar)
    expect(specialtyKeys(index, [rebar], ["حديد ومعادن"])).toEqual([rebar, "حديد ومعادن"])
    expect(specialtyKeys(index, [], ["حديد التسليح"])).toEqual([rebar])
    expect(keyLabel(index, rebar, "ar", (n) => `legacy:${n}`)).toBe("حديد التسليح")
    expect(keyLabel(index, "حديد ومعادن", "ar", (n) => `legacy:${n}`)).toBe("legacy:حديد ومعادن")
  })
})

describe("«دليل موردي المنصة» (PUR-05)", () => {
  const rebar = sub("حديد التسليح").id
  const mk = (orgId: string, over: Partial<{ platformVerified: boolean; subIds: string[]; categories: string[] }> = {}) => ({
    orgId,
    name: orgId,
    city: "الرياض",
    platformVerified: true,
    subIds: [] as string[],
    categories: [] as string[],
    ...over,
  })

  it("lists only suppliers the platform verified — an invited one stays in his buyer's own list until then", () => {
    const all = [mk("a"), mk("b", { platformVerified: false }), mk("c")]
    expect(listedInDirectory(all).map((s) => s.orgId)).toEqual(["a", "c"])
  })

  it("filters and counts by the tree's sub-category, and an older category name still filters", () => {
    const entries = directoryEntries(index, [mk("a", { subIds: [rebar] }), mk("b", { categories: ["حديد ومعادن"] }), mk("c", { subIds: [rebar], categories: ["حديد ومعادن"] })])
    const counts = directoryCounts(entries)
    expect(counts.categories).toEqual(expect.arrayContaining([[rebar, 2], ["حديد ومعادن", 2]]))
    const label = (k: string) => keyLabel(index, k, "ar", (n) => n)
    expect(filterDirectory(entries, { q: "", category: rebar, city: "" }, label).map((s) => s.orgId)).toEqual(["a", "c"])
    expect(filterDirectory(entries, { q: "", category: "حديد ومعادن", city: "" }, label).map((s) => s.orgId)).toEqual(["b", "c"])
    expect(filterDirectory(entries, { q: "التسليح", category: "", city: "" }, label).map((s) => s.orgId)).toEqual(["a", "c"])
  })
})

describe("the RFQ list's category filter", () => {
  const rebar = sub("حديد التسليح").id
  const now = new Date("2026-10-21T00:00:00Z")
  const written = { id: "r1", status: "New", category: "الحديد", subCategoryIds: [rebar], products: [{ category: "الحديد" }] } as unknown as RfqListLike
  const old = { id: "r2", status: "New", category: "حديد ومعادن", products: [{ category: "حديد ومعادن" }] } as unknown as RfqListLike
  it("matches a sub-category by id, and an RFQ written before the tree by its category name", () => {
    expect(passesFilters(written, { category: rebar }, now)).toBe(true)
    expect(passesFilters(old, { category: rebar }, now)).toBe(false)
    expect(passesFilters(old, { category: "حديد ومعادن" }, now)).toBe(true)
  })
})

describe("a draft is published from its review step", () => {
  it("links to the editor on the review step", () => {
    expect(rfqReviewHref("abc 1")).toBe("/contractor/rfqs/new?edit=abc%201&step=review")
  })
})

describe("heavy-equipment rental (PUR-04)", () => {
  it("is recognised by a rental word and a piece of heavy equipment", () => {
    expect(isHeavyEquipmentRental("إيجار حفار")).toBe(true)
    expect(isHeavyEquipmentRental("تأجير رافعة 50 طن")).toBe(true)
    expect(isHeavyEquipmentRental("excavator rental 20t")).toBe(true)
    expect(isHeavyEquipmentRental("حفار")).toBe(false)
    expect(isHeavyEquipmentRental("إيجار سقالات")).toBe(false)
    expect(isHeavyEquipmentRental("current loader")).toBe(false)
  })
  it("is written as it is under «المعدات › معدات أخرى»", () => {
    const other = otherEquipmentSub(index)
    expect(other?.ar).toBe("معدات أخرى")
    expect(subLabel(index, other!.id, "ar")).toBe("المعدات › معدات أخرى")
    expect(otherEquipmentSub(null)).toBeNull()
  })
})

// PUR-04: Watad's tree, adopted as it is, read the same way by every picker.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { indexTree, pathLabel, pathOf, searchMaterials, shortSpecName, specsOf, subIdOf, unitConversion, unitIsTheMaterials, unitsOf, pickOf } from "@/lib/materials/tree"
import type { MaterialTreeFile } from "@/lib/materials/types"

const file = JSON.parse(readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")) as MaterialTreeFile
const index = indexTree(file.roots)
const find = (ar: string) => index.materials.find((m) => m.ar === ar) || [...index.byId.values()].find((m) => m.ar === ar)!

describe("the tree as Watad gives it", () => {
  it("has its 20 categories, 250 materials and 106 sub-categories (+ the first-level leaves)", () => {
    expect(index.roots).toHaveLength(20)
    expect(index.materials).toHaveLength(250)
    expect(index.subs.filter((s) => s.level === 2)).toHaveLength(106)
  })

  it("matches a third-level material on its sub-category, by id", () => {
    const bar = find("اسياخ حديد التسليح")
    expect(bar.level).toBe(3)
    const sub = index.byId.get(subIdOf(index, bar.id)!)!
    expect(sub.ar).toBe("حديد التسليح")
    expect(pathLabel(pathOf(index, bar.id), "ar")).toBe("الحديد › حديد التسليح")
  })

  it("lets a material inherit the specs and units above it", () => {
    const bar = find("اسياخ حديد التسليح")
    const names = specsOf(index, bar.id).map((s) => shortSpecName(s).ar)
    expect(names).toEqual(expect.arrayContaining(["الدرجة", "المقاس"]))
    const size = specsOf(index, bar.id).find((s) => shortSpecName(s).ar === "المقاس")!
    expect(size.options.map((o) => o.en).slice(0, 3)).toEqual(["8 mm", "10 mm", "12 mm"])
    expect(new Set(size.options.map((o) => o.en)).size).toBe(size.options.length)
    expect(unitsOf(index, bar.id).map((u) => u.key)).toEqual(["ton"])
  })
})

describe("typing a material in the row's empty cell", () => {
  it("«حديد 16» finds rebar and presets the size", () => {
    const hits = searchMaterials(index, "حديد 16")
    const rebar = hits.find((h) => h.node.ar === "اسياخ حديد التسليح")!
    expect(rebar).toBeDefined()
    expect(rebar.preset.map((p) => p.value.en)).toEqual(["16 mm"])
  })
  it("folds Arabic letter forms and finds nothing for nonsense", () => {
    expect(searchMaterials(index, "اسمنت").length).toBeGreaterThan(0)
    expect(searchMaterials(index, "zzqx")).toEqual([])
  })
})

describe("units (PUR-02: the incoming unit is never overwritten)", () => {
  it("knows whether a line's unit is the material's", () => {
    const units = unitsOf(index, find("اسياخ حديد التسليح").id)
    expect(unitIsTheMaterials("طن", units)).toBe(true)
    expect(unitIsTheMaterials("كيس", units)).toBe(false)
  })
  it("shows 200 bags × 50 kg = 10 tonnes for information", () => {
    expect(unitConversion(200, "كيس", { key: "ton", ar: "طن", en: "ton" }, [{ ar: "50كجم", en: "50kg" }])).toEqual({ quantity: 10, unit: { key: "ton", ar: "طن", en: "ton" }, per: 50 })
    expect(unitConversion(200, "متر", { key: "ton", ar: "طن", en: "ton" }, [{ ar: "50كجم", en: "50kg" }])).toBeNull()
  })
})

it("a pick carries its path and sub-category, so readers need not load the tree", () => {
  const p = pickOf(index, find("اسياخ حديد التسليح").id)!
  expect(p.path.map((x) => x.ar)).toEqual(["الحديد", "حديد التسليح", "اسياخ حديد التسليح"])
  expect(index.byId.get(p.subId)!.ar).toBe("حديد التسليح")
})

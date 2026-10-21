// PUR-04: Watad's tree, adopted as it is, read the same way by every picker.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { indexTree, pathLabel, pathOf, searchMaterials, shortSpecName, specsOf, subIdOf, unitConversion, unitIsTheMaterials, unitsOf, pickOf } from "@/lib/materials/tree"
import type { MaterialNode, MaterialTreeFile } from "@/lib/materials/types"

const file = JSON.parse(readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")) as MaterialTreeFile
const index = indexTree(file.roots)
const find = (ar: string) => index.materials.find((m) => m.ar === ar) || [...index.byId.values()].find((m) => m.ar === ar)!

describe("the tree as Watad gives it", () => {
  const source = JSON.parse(readFileSync(join(process.cwd(), "data/watad-catalog.json"), "utf8")) as { tree: Array<{ id: string; level: number; specs?: Array<{ ar: string; options?: Array<{ ar: string; en: string }> }>; brands?: Array<{ ar: string }>; children?: unknown[] }> }
  const walk = <T extends { children?: unknown[] }>(roots: T[], f: (n: T) => void) => {
    const go = (n: T) => {
      f(n)
      ;(n.children as T[] | undefined)?.forEach(go)
    }
    roots.forEach(go)
  }

  it("keeps every node, specification, option and brand — 20/106/168 levels, 687 specs, 3,368 options, 41 brands", () => {
    const levels: Record<number, number> = {}
    let specs = 0
    let options = 0
    const brands = new Set<string>()
    walk(file.roots as MaterialNode[], (n) => {
      levels[n.level] = (levels[n.level] || 0) + 1
      specs += n.specs.length
      options += n.specs.reduce((a, s) => a + s.options.length, 0)
      n.brands.forEach((b) => brands.add(b.ar))
    })
    expect(levels).toEqual({ 1: 20, 2: 106, 3: 168 })
    expect(specs).toBe(687)
    expect(options).toBe(3368)
    expect(brands.size).toBe(41)
  })

  it("adopts the options as they are: none dropped, none re-ordered, the Arabic-only twins both kept", () => {
    const want = new Map<string, string[]>()
    walk(source.tree, (n) => n.specs?.forEach((s) => want.set(`${n.id}|${s.ar}`, (s.options || []).map((o) => `${o.ar.replace(/\s+/g, " ").trim()}|${o.en.replace(/\s+/g, " ").trim()}`))))
    let checked = 0
    walk(file.roots as MaterialNode[], (n) =>
      n.specs.forEach((s) => {
        const expected = want.get(`${n.id}|${s.ar}`)
        if (!expected) return
        checked++
        expect(s.options.map((o) => `${o.ar}|${o.en}`)).toEqual(expected)
      })
    )
    expect(checked).toBe(687)
    let sameWordsOtherEnglish = 0
    let exactTwins = 0
    walk(file.roots as MaterialNode[], (n) =>
      n.specs.forEach((sp) =>
        sp.options.forEach((o, i) => {
          const earlier = sp.options.slice(0, i).filter((x) => x.ar.replace(/\s+/g, "") === o.ar.replace(/\s+/g, ""))
          if (!earlier.length) return
          if (earlier.some((x) => x.en === o.en)) exactTwins++
          else sameWordsOtherEnglish++
        })
      )
    )
    expect({ exactTwins, sameWordsOtherEnglish }).toEqual({ exactTwins: 24, sameWordsOtherEnglish: 12 })
  })

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
    expect(size.options.map((o) => o.en)).toEqual([...size.options.map((o) => o.en)])
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

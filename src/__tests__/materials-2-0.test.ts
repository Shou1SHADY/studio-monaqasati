// Procurement 2.0 (CAT-01, CAT-06, R-27): the material tree is the customer's package — Watad's tree after its six
// cleaning rules, plus the sale units — node by node, and the live `categories` collection can be brought onto it
// without touching what the platform team did in Admin → Materials.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { addChild, findIn, renameNode, setHidden, setSaleUnits } from "@/lib/materials/admin-edit"
import { categoryTree, treeScope, treeSupplier } from "@/lib/materials/category-tree"
import { mergeMaterialsPackage, type MaterialsPackageReport } from "@/lib/materials/merge-shipped"
import { indexTree, pickOf, saleUnitsOf, unitsOf } from "@/lib/materials/tree"
import type { MaterialNode, MaterialTreeFile } from "@/lib/materials/types"

interface PkgNode {
  id: number
  level: number
  name_ar: string
  name_en: string
  units: Array<{ ar: string; en: string }>
  specs: Array<{ ar: string; en: string; options: Array<{ ar: string; en: string }> }>
  brands: Array<{ ar: string; en: string }>
  sale_units: Array<{ name_ar: string; name_en: string; length_m: number; from: string }>
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")
const pkg = (JSON.parse(read("data/materials-2.0/watad-materials-2.0.json")) as { nodes: PkgNode[] }).nodes
const file = JSON.parse(read("public/data/material-tree.json")) as MaterialTreeFile
const report = JSON.parse(read("data/materials-2.0/diff-report.json")) as MaterialsPackageReport

const flat: MaterialNode[] = []
const walk = (n: MaterialNode) => {
  flat.push(n)
  n.children.forEach(walk)
}
file.roots.forEach(walk)
const index = indexTree(file.roots)
const find = (ar: string) => flat.find((n) => n.ar === ar)!

describe("the tree is the package, node by node (294/294)", () => {
  it("has the package's counts: 294 nodes (20/106/168), 250 materials, 211 with specs, 3,368 options, 30 with brands (146), 6 with sale units", () => {
    expect(flat).toHaveLength(294)
    expect(flat.filter((n) => n.level === 1)).toHaveLength(20)
    expect(flat.filter((n) => n.level === 2)).toHaveLength(106)
    expect(flat.filter((n) => n.level === 3)).toHaveLength(168)
    expect(index.materials).toHaveLength(250)
    expect(flat.filter((n) => n.specs.length)).toHaveLength(211)
    expect(flat.reduce((a, n) => a + n.specs.reduce((b, s) => b + s.options.length, 0), 0)).toBe(3368)
    expect(flat.filter((n) => n.brands.length)).toHaveLength(30)
    expect(flat.reduce((a, n) => a + n.brands.length, 0)).toBe(146)
    expect(flat.filter((n) => n.saleUnits?.length)).toHaveLength(6)
    expect(flat.reduce((a, n) => a + (n.saleUnits?.length ?? 0), 0)).toBe(10)
  })

  it("every node's name, units, specs, options and brands read as the package says, in both languages", () => {
    expect(flat.length).toBe(pkg.length)
    flat.forEach((n, i) => {
      const p = pkg[i]
      expect({ at: i, ar: n.ar, en: n.en, level: n.level }).toEqual({ at: i, ar: p.name_ar, en: p.name_en, level: p.level })
      expect(n.units.map((u) => [u.ar, u.en])).toEqual(p.units.map((u) => [u.ar, u.en]))
      expect(n.specs.map((s) => [s.ar, s.en, s.options.map((o) => [o.ar, o.en])])).toEqual(p.specs.map((s) => [s.ar, s.en, s.options.map((o) => [o.ar, o.en])]))
      expect(n.brands.map((b) => [b.ar, b.en])).toEqual(p.brands.map((b) => [b.ar, b.en]))
      expect((n.saleUnits || []).map((u) => [u.ar, u.en, u.lengthM, u.from])).toEqual(p.sale_units.map((u) => [u.name_ar, u.name_en, u.length_m, u.from]))
    })
  })

  it("keeps Watad's ids, the units' keys and every spec's `mandatory` — only words changed", () => {
    const old = JSON.parse(read("data/watad-catalog.json")) as { tree: Array<{ id: string; children?: unknown[] }> }
    const ids: string[] = []
    const go = (n: { id: string; children?: unknown[] }) => {
      ids.push(n.id)
      ;(n.children as Array<{ id: string; children?: unknown[] }> | undefined)?.forEach(go)
    }
    old.tree.forEach(go)
    expect(flat.map((n) => n.id)).toEqual(ids)
    expect(flat.flatMap((n) => n.units.map((u) => u.key)).filter((k) => !k)).toEqual([])
  })
})

describe("the six cleaning rules, as the customer wrote them", () => {
  it("no spacing before a «و» that joins, and no typos in a node's name", () => {
    expect(flat.filter((n) => /(^|\s)و\s/.test(n.ar) || /معدنبة|الاصقة/.test(n.ar))).toEqual([])
    expect(find("بلك ومنتجات اسمنتية")).toBeDefined()
    expect(find("أبواب معدنية")).toBeDefined()
    expect(find("الاسمنت والمواد اللاصقة")).toBeDefined()
  })

  it("no Arabic spec option carries a Latin unit (mm · cm · kg) and a size is written 20×40", () => {
    const bad = flat.flatMap((n) => n.specs.flatMap((s) => s.options.filter((o) => /\d\s?(mm|cm|kg)\b/i.test(o.ar) || /\d\s+[xX]\s+\d/.test(o.ar)).map((o) => `${n.ar} · ${s.ar} · ${o.ar}`)))
    expect(bad).toEqual([])
    const sizes = find("البلك الاسمنتي").specs.find((s) => s.ar === "القياس")!
    expect(sizes.options.map((o) => o.ar)).toContain("20×20×40 سم")
  })

  it("no spec label has a bracket, and the long names are the short ones", () => {
    const labels = flat.flatMap((n) => n.specs.map((s) => s.ar))
    expect(labels.filter((l) => /[()]/.test(l))).toEqual([])
    expect(labels.filter((l) => ["نوع المادة", "القياسات", "المقاسات"].includes(l))).toEqual([])
    expect(flat.flatMap((n) => n.specs.map((s) => s.en)).filter((l) => /[()]/.test(l) || ["Type of Material", "Grade Level"].includes(l))).toEqual([])
  })

  it("what is sold by weight is a bag, not a piece: the eight (R-27)", () => {
    const bags = flat.filter((n) => n.units.some((u) => u.key === "bag" && u.ar === "كيس"))
    for (const name of ["الاسمنت العادي", "الاسمنت البورزلاني", "الاسمنت المقاوم", "الاسمنت الأبيض", "مواد ربط", "المعجون الأسمنتي المخلوط مسبقاً", "غراء بلاط", "ترويبة بلاط"]) {
      expect(bags.map((n) => n.ar)).toContain(name)
    }
    expect(flat.filter((n) => n.specs.some((s) => /^(الوزن)$/.test(s.ar)) && n.units.some((u) => u.ar === "حبة"))).toEqual([])
    const cement = find("الاسمنت العادي")
    expect(unitsOf(index, cement.id)[0]).toMatchObject({ ar: "كيس", en: "bag", key: "bag" })
  })

  it("the tree stays as it is: nothing merged, nothing dropped, nothing mapped to the live categories", () => {
    expect(flat.map((n) => n.id)).toHaveLength(294)
    expect(new Set(flat.map((n) => n.id)).size).toBe(294)
  })
})

describe("sale units (CAT-06)", () => {
  it("six materials, ten units: pipes' rolls, angles' bars, wires' and fences' rolls, timber's lengths", () => {
    const all = flat.filter((n) => n.saleUnits?.length).map((n) => [n.ar, n.saleUnits!.map((u) => u.ar)])
    expect(all).toEqual([
      ["مواسير التكييف", ["لفة 15 م"]],
      ["زوايا", ["قطعة 6 م", "قطعة 12 م"]],
      ["سلك شائك", ["لفة 25 م", "لفة 50 م"]],
      ["شبك اسوار", ["لفة 25 م"]],
      ["سلك شد", ["لفة 100 م"]],
      ["خشب الواح", ["قطعة 3 م", "قطعة 4 م", "قطعة 6 م"]],
    ])
    expect(saleUnitsOf(index, find("سلك شائك").id).map((u) => u.lengthM)).toEqual([25, 50])
  })

  it("timber's lengths come from its «الطول» spec — 3, 4 and 6 m — even before a live tree carries them", () => {
    const bare = JSON.parse(JSON.stringify(file.roots)) as MaterialNode[]
    const strip = (n: MaterialNode) => {
      delete n.saleUnits
      n.children.forEach(strip)
    }
    bare.forEach(strip)
    const i = indexTree(bare)
    const wood = i.materials.find((m) => m.ar === "خشب الواح")!
    expect(saleUnitsOf(i, wood.id)).toEqual([
      { ar: "قطعة 3 م", en: "3 meter piece", lengthM: 3, from: "spec" },
      { ar: "قطعة 4 م", en: "4 meter piece", lengthM: 4, from: "spec" },
      { ar: "قطعة 6 م", en: "6 meter piece", lengthM: 6, from: "spec" },
    ])
    for (const m of i.materials.filter((x) => x.ar !== "خشب الواح" && !x.saleUnits)) expect(saleUnitsOf(i, m.id)).toEqual([])
  })

  it("pipes stay «حبة» with no length (decision 04), and a material without any has none", () => {
    expect(saleUnitsOf(index, find("اسياخ حديد التسليح").id)).toEqual([])
  })

  it("a pick carries what the material is sold in, so a line and its offer can price per piece", () => {
    const wire = find("سلك شائك")
    const pick = pickOf(index, wire.id)!
    expect(pick.saleUnits?.map((u) => u.ar)).toEqual(["لفة 25 م", "لفة 50 م"])
    expect(pickOf(index, find("اسياخ حديد التسليح").id)!.saleUnits).toBeUndefined()
    expect(pickOf(index, wire.id, [], null, true)!.saleUnits).toBeUndefined()
  })

  it("Admin → Materials sets and clears a material's sale units without touching its neighbours", () => {
    const root = file.roots.find((r) => r.ar === "الحديد")!
    const bar = find("اسياخ حديد التسليح")
    const unit = { ar: "قطعة 12 م", en: "12 m bar", lengthM: 12, from: "list" as const }
    const set = setSaleUnits(root, bar.id, [unit])
    expect(findIn(set, bar.id)?.saleUnits).toEqual([unit])
    expect(findIn(root, bar.id)?.saleUnits).toBeUndefined()
    expect(findIn(set, find("زوايا").id)?.saleUnits).toEqual(find("زوايا").saleUnits)
    const cleared = setSaleUnits(set, bar.id, [])
    expect("saleUnits" in findIn(cleared, bar.id)!).toBe(false)
  })
})

describe("the buyer's categories and the platform's reach read the tree, not a list of their own", () => {
  const i = index
  const rebarSub = i.subs.find((s) => s.ar === "حديد التسليح")!
  it("a sub-category id, its name and a material under it resolve to the top-level category", () => {
    const tree = categoryTree(i)
    expect(Object.keys(tree)).toHaveLength(20)
    expect(tree["الحديد"]).toEqual(expect.arrayContaining([rebarSub.id, "حديد التسليح", "اسياخ حديد التسليح"]))
  })
  it("a supplier is read by his sub-category ids, and an older name the tree spells is translated", () => {
    const s = treeSupplier({ categories: ["حديد التسليح", "اسم قديم لا وجود له"], subIds: [] as string[] }, i)
    expect(s.categories).toContain(rebarSub.id)
    expect(s.categories).toContain("اسم قديم لا وجود له")
  })
  it("a buyer whose saved categories name nothing in the tree is read as having none, so no need hides", () => {
    expect(treeScope(i, ["حديد ومعادن"])).toBeNull()
    expect(treeScope(i, ["حديد ومعادن", "الحديد"])).toEqual(["الحديد"])
    expect(treeScope(i, [])).toBeNull()
    expect(treeScope(null, ["x"])).toEqual(["x"])
  })
})

describe("the live `categories` come onto the package without losing the team's edits", () => {
  const revert = (roots: MaterialNode[]): MaterialNode[] => {
    const copy = JSON.parse(JSON.stringify(roots)) as MaterialNode[]
    const byId = new Map<string, MaterialNode>()
    const w = (n: MaterialNode) => {
      byId.set(n.id, n)
      n.children.forEach(w)
    }
    copy.forEach(w)
    const put = (n: MaterialNode, at: string, value: string) => {
      const parts = at.split(".")
      let cur = n as unknown as Record<string, unknown>
      for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>
      cur[parts[parts.length - 1]] = value
    }
    for (const c of report.changes) put(byId.get(c.id)!, c.at, c.from)
    for (const s of report.saleUnits) delete byId.get(s.id)!.saleUnits
    return copy
  }
  const old = () => revert(file.roots)

  it("a database holding the 1.5 tree becomes exactly the package", () => {
    const out = mergeMaterialsPackage(old(), report)
    expect(out.conflicts).toEqual([])
    expect(out.missing).toEqual([])
    expect(out.applied).toBe(report.changes.length)
    expect(out.saleUnitsSet).toBe(6)
    expect(out.roots).toEqual(file.roots)
    expect(out.changedRootIds.length).toBeGreaterThan(0)
  })

  it("runs twice without a second effect", () => {
    const once = mergeMaterialsPackage(old(), report)
    const twice = mergeMaterialsPackage(once.roots, report)
    expect(twice.applied).toBe(0)
    expect(twice.alreadyDone).toBe(report.changes.length)
    expect(twice.changedRootIds).toEqual([])
    expect(twice.roots).toEqual(once.roots)
  })

  it("leaves a node the team renamed, a unit it re-picked, a child it added and a node it hid exactly as they are", () => {
    let roots = old()
    const target = roots.find((r) => r.ar === "الاسمنت و المواد الاصقة")!
    const renamed = renameNode(target, target.id, { ar: "الأسمنت واللواصق", en: "Cement" })
    const added = addChild(renamed, renamed.id, { ar: "مادة جديدة", en: "New material" }, "added-1")
    const hiddenId = flat.find((n) => n.ar === "الاسمنت العادي")!.id
    const hidden = setHidden(added, hiddenId, true)
    roots = roots.map((r) => (r.id === target.id ? hidden : r))
    const out = mergeMaterialsPackage(roots, report)
    const after = out.roots.find((r) => r.id === target.id)!
    expect(after.ar).toBe("الأسمنت واللواصق")
    expect(out.conflicts.some((c) => c.id === target.id && c.at === "ar")).toBe(true)
    expect(after.children.some((c) => c.id === "added-1" && c.ar === "مادة جديدة")).toBe(true)
    const cement = (function find(n: MaterialNode): MaterialNode | null {
      return n.id === hiddenId ? n : n.children.reduce<MaterialNode | null>((h, c) => h || find(c), null)
    })(after)!
    expect(cement.hidden).toBe(true)
    expect(cement.units[0]).toMatchObject({ ar: "كيس", key: "bag" })
    expect(out.applied).toBe(report.changes.length - out.conflicts.length)
  })

  it("keeps sale units the team already set, and reports ids a database does not have", () => {
    const roots = old()
    const wire = flat.find((n) => n.ar === "سلك شائك")!
    const patched = roots.map((r) => setSaleUnits(r, wire.id, [{ ar: "لفة 10 م", en: "10 m roll", lengthM: 10, from: "list" }]))
    const out = mergeMaterialsPackage(patched, report)
    expect(out.saleUnitsKept).toBe(1)
    expect(out.saleUnitsSet).toBe(5)
    const lost = mergeMaterialsPackage(roots.filter((r) => r.ar !== "الاسمنت و المواد الاصقة"), report)
    expect(lost.missing.length).toBeGreaterThan(0)
  })

  it("never touches the input", () => {
    const input = old()
    const before = JSON.stringify(input)
    mergeMaterialsPackage(input, report)
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe("the script that wrote the files", () => {
  it("finds both shipped copies up to date and identical", () => {
    expect(() => execFileSync(process.execPath, [join(process.cwd(), "scripts/apply-materials-2.0.mjs"), "--check"], { stdio: "pipe" })).not.toThrow()
    expect(read("public/data/material-tree.json")).toBe(read("src/lib/materials/shipped-tree.json"))
  })
})

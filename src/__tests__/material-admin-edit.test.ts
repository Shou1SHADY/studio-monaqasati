import { addChild, addSuggestion, findIn, renameNode, setHidden } from "@/lib/materials/admin-edit"
import { indexTree } from "@/lib/materials/tree"
import type { MaterialNode } from "@/lib/materials/types"

const node = (id: string, level: 1 | 2 | 3, children: MaterialNode[] = []): MaterialNode => ({ id, ar: id, en: id, level, units: [], specs: [], brands: [], keywords: [], installation: false, children })
const root = node("iron", 1, [node("rebar", 2, [node("bars", 3)])])

describe("Admin → Materials edits (PUR-04)", () => {
  it("renames, and refuses an empty name", () => {
    expect(findIn(renameNode(root, "bars", { ar: "أسياخ", en: "" }), "bars")).toMatchObject({ ar: "أسياخ", en: "أسياخ" })
    expect(renameNode(root, "bars", { ar: " ", en: "x" })).toBe(root)
  })
  it("hides a material from the pickers without deleting it", () => {
    const hidden = setHidden(root, "bars", true)
    expect(findIn(hidden, "bars")?.hidden).toBe(true)
    const idx = indexTree([hidden])
    expect(idx.byId.has("bars")).toBe(true)
    expect(idx.materials.map((m) => m.id)).toEqual(["rebar"])
  })
  it("adds a level below, never past the third", () => {
    expect(findIn(addChild(root, "rebar", { ar: "شبك", en: "Mesh" }, "mesh"), "mesh")?.level).toBe(3)
    expect(addChild(root, "bars", { ar: "x", en: "x" }, "x")).toBe(root)
  })
  it("counts the same outside material once per mention", () => {
    const a = addSuggestion([], { name: " حديد  مجلفن ", subId: "rebar", sub: "حديد التسليح" }, "2026-10-20")
    const b = addSuggestion(a, { name: "حديد مجلفن", subId: "rebar", sub: "حديد التسليح" }, "2026-10-21")
    expect(b).toEqual([{ name: "حديد مجلفن", subId: "rebar", sub: "حديد التسليح", count: 2, firstAt: "2026-10-20", lastAt: "2026-10-21" }])
  })
})

// PUR-02/03: rows not cards, one RFQ as written, the incoming unit never overwritten.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { indexTree, pickOf } from "@/lib/materials/tree"
import type { MaterialTreeFile } from "@/lib/materials/types"
import {
  addRequests,
  blankLine,
  lineFromPick,
  linesFromNames,
  materialsProblems,
  newGroup,
  numberedLines,
  repeatLine,
  requestKeysIn,
  reviewFacts,
  rfqLinesDoc,
  rfqPlace,
  suggestTitle,
  unitNote,
  type EditorGroup,
  type IncomingRequest,
} from "@/lib/procurement/rfq-editor"

const file = JSON.parse(readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")) as MaterialTreeFile
const index = indexTree(file.roots)
const node = (ar: string) => [...index.byId.values()].find((n) => n.ar === ar)!
const rebar = pickOf(index, node("اسياخ حديد التسليح").id)!
const cement = pickOf(index, node("الاسمنت العادي").id)!

const tm03: IncomingRequest = {
  key: "project:p1:03",
  ref: "ط.م 03",
  source: { kind: "project", projectId: "p1", requestId: "03" } as unknown as IncomingRequest["source"],
  projectId: "p1",
  label: "مجمع الياسمين السكني",
  siteId: "prj_p1",
  city: "الرياض",
  district: "حي الياسمين",
  needBy: "2026-11-10",
  lines: [
    { name: "بلوك أسمنتي مفرغ 20 سم", quantity: 2000, unit: "قطعة" },
    { name: "أسمنت بورتلاندي عادي", quantity: 200, unit: "كيس" },
  ],
}

describe("the incoming request on the editor", () => {
  const groups = addRequests([newGroup()], [tm03])
  it("lands as ONE group with its place, date and number; the blank start group goes", () => {
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ projectId: "p1", city: "الرياض", needBy: "2026-11-10", requestRefs: ["ط.م 03"] })
    expect(numberedLines(groups).map((r) => [r.no, r.line.name])).toEqual([[1, "بلوك أسمنتي مفرغ 20 سم"], [2, "أسمنت بورتلاندي عادي"]])
    expect(requestKeysIn(groups).has("project:p1:03")).toBe(true)
  })
  it("keeps the name, quantity and unit that arrived when the material is picked (200 كيس stays 200 كيس)", () => {
    const line = groups[0].lines[1]
    const filled = lineFromPick(line, cement, "طن", "ar")
    expect(filled).toMatchObject({ name: "أسمنت بورتلاندي عادي", quantity: "200", unit: "كيس" })
    expect(filled.material?.subId).toBe(cement.subId)
    // 2.0 (R-27): cement is sold by the bag, so «كيس» is the material's own unit and nothing is said…
    expect(unitNote(filled, index)).toBeNull()
    // …while a unit the material does not have is still kept and flagged.
    expect(unitNote({ ...filled, unit: "حبة" }, index)).toMatchObject({ kind: "differs", units: ["كيس", "طن"] })
  })
  it("refuses at step 1 on the row, naming what is missing — not at publish", () => {
    const p = materialsProblems(groups)
    expect(p.filter((x) => x.code === "material").map((x) => x.no)).toEqual([1, 2])
  })
})

describe("rows", () => {
  it("ignores a wholly blank row, and wants a place for a group with lines", () => {
    const g: EditorGroup[] = [newGroup({ lines: [{ ...blankLine(), name: "حديد", material: rebar, quantity: "8", unit: "طن" }, blankLine()] })]
    expect(materialsProblems(g).map((p) => p.code)).toEqual(["no_place"])
    g[0].city = "الرياض"
    expect(materialsProblems(g)).toEqual([])
  })
  it("«كرّر» puts the same material on the next row, sizes cleared", () => {
    const first = { ...blankLine(), name: "اسياخ حديد التسليح", material: { ...rebar, specs: [{ name: { ar: "المقاس", en: "Size" }, value: { ar: "16 mm", en: "16 mm" } }] }, quantity: "8", unit: "طن" }
    const g = repeatLine([newGroup({ lines: [first] })], "", "")
    expect(g[0].lines).toHaveLength(1)
    const key = newGroup({ lines: [first] })
    const out = repeatLine([key], key.key, first.key)
    expect(out[0].lines.map((l) => [l.material?.nodeId, l.material?.specs.length, l.quantity])).toEqual([[rebar.nodeId, 1, "8"], [rebar.nodeId, 0, ""]])
  })
})

describe("one RFQ, as written (PUR-03)", () => {
  const groups: EditorGroup[] = [
    newGroup({ projectId: "p1", label: "مجمع الياسمين", city: "الرياض", district: "حي الياسمين", needBy: "2026-11-10", lines: [{ ...blankLine(), name: "أسمنت", material: cement, quantity: "200", unit: "كيس" }] }),
    newGroup({ projectId: "p2", label: "برج العليا", city: "الرياض", district: "حي العليا", needBy: "2026-11-05", lines: [{ ...blankLine(), name: "حديد 16", material: rebar, quantity: "8", unit: "طن" }, blankLine()] }),
  ]
  const doc = rfqLinesDoc(groups, "ar", (id) => (id === "p1" ? "مجمع الياسمين" : null))
  it("carries every line and every sub-category on one document", () => {
    expect(doc.products).toHaveLength(2)
    expect(doc.subCategoryIds).toEqual([cement.subId, rebar.subId])
    expect(doc.categories).toHaveLength(2)
    expect(doc.products[1]).toMatchObject({ unitOfMeasure: "طن", deliveryCity: "الرياض", deliveryDistrict: "حي العليا", needBy: "2026-11-05", projectId: "p2" })
  })
  it("says the place once when it can, and what the review warns of", () => {
    expect(rfqPlace(groups)).toEqual({ city: "الرياض", district: "", multi: true, cities: ["الرياض"] })
    const f = reviewFacts(groups, index)
    expect(f).toMatchObject({ lines: 2, subs: 2, groups: 2, earliestNeed: "2026-11-05" })
    expect(f.noSpec).toEqual(["أسمنت", "حديد 16"])
  })
  it("suggests a title from the sub-categories and the places", () => {
    expect(suggestTitle(groups, { and: " و", more: (n) => ` +${n}` })).toBe("الاسمنت العادي وحديد التسليح — مجمع الياسمين وبرج العليا")
  })
})

it("words become rows: matched to the tree when they name ONE material clearly, else they wait with «اختر المادة»", () => {
  const lines = linesFromNames(
    [
      { name: "اسياخ حديد التسليح 16", quantity: "8", unit: "طن" },
      { name: "شيء غريب جداً", quantity: "5", unit: "حبة" },
    ],
    index,
  )
  expect(lines[0].material?.nodeId).toBe(rebar.nodeId)
  expect(lines[0].material?.specs.map((s) => s.value.en)).toEqual(["16 mm"])
  expect(lines[0]).toMatchObject({ unit: "طن", unitFromSource: true })
  expect(lines[1].material).toBeNull()
  expect(lines[1].unitFromSource).toBe(true)
})

// PUR-04 in Project Management: a material request line carries the tree node and its spec cells, so an
// incoming line reaches Procurement with its category instead of «اختر المادة».
import { buildLines, procurementItems, type LineDraft } from "@/lib/pm/supply"
import type { MaterialPick } from "@/lib/materials/types"

const material: MaterialPick = {
  nodeId: "node-bar",
  subId: "sub-rebar",
  rootId: "root-iron",
  path: [
    { ar: "الحديد", en: "Iron" },
    { ar: "حديد التسليح", en: "Rebar" },
    { ar: "اسياخ حديد التسليح", en: "Rebar bars" },
  ],
  specs: [{ name: { ar: "المقاس", en: "Size" }, value: { ar: "16 مم", en: "16 mm" } }],
}

const draft = (over: Partial<LineDraft> = {}): LineDraft => ({ itemId: "b1", name: "اسياخ حديد التسليح 16 مم", unit: "طن", qty: 8, ...over })

it("keeps the picked node and spec cells on the line and on what Procurement reads", () => {
  const [line] = buildLines([], [{ id: "b1", code: "03-01" }], [draft({ material })])
  expect(line.material).toEqual(material)
  const [item] = procurementItems({ lines: [line] })
  expect(item).toMatchObject({ name: "اسياخ حديد التسليح 16 مم", unit: "طن", quantity: 8, material })
})

it("a line typed without the tree carries no node (it is categorised in the editor)", () => {
  const [line] = buildLines([], [{ id: "b1", code: "03-01" }], [draft()])
  expect(line).not.toHaveProperty("material")
  expect(procurementItems({ lines: [line] })[0]).not.toHaveProperty("material")
})

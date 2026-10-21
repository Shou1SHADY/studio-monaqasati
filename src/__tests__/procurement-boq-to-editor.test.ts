// PUR-02/03: a project's BOQ lines become the rows of ONE draft in the editor's shape — never a published
// RFQ, never one per section, never the old 16 categories.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { indexTree } from "@/lib/materials/tree"
import type { MaterialTreeFile } from "@/lib/materials/types"
import { boqDraftDoc, type BoqDraftItem } from "@/lib/procurement/boq-to-editor"

const index = indexTree((JSON.parse(readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")) as MaterialTreeFile).roots)

const items: BoqDraftItem[] = [
  { id: "b1", itemNo: "03-01", descriptionAr: "اسياخ حديد التسليح", descriptionEn: "Rebar 16mm", unit: "طن", quantity: 100, draw: 40 },
  { id: "b2", itemNo: "09-02", descriptionAr: "تركيب ستائر خاصة بالموقع", descriptionEn: "", unit: "م²", quantity: 30, draw: 30, requiresWarranty: true },
]

const doc = () =>
  boqDraftDoc({
    items,
    index,
    projectId: "P1",
    projectName: "مجمع الياسمين",
    title: "حديد وتشطيبات",
    city: "الرياض",
    district: "حي الياسمين",
    deadline: "2026-11-01",
    shipmentMode: "single",
    locale: "ar",
    identity: { contractorId: "u1", organizationId: "org", createdByUserId: "u1", createdByUserName: "م. فهد", createdAt: "2026-10-21T08:00:00.000Z" },
  })

describe("BOQ lines prepared for the editor", () => {
  it("is ONE draft — never published from here — in the project's group", () => {
    const d = doc()
    expect(d.status).toBe("Draft")
    expect(d.pricingMode).toBe("line")
    expect(d.materialTree).toBe(true)
    expect(d.projectId).toBe("P1")
    expect(d.city).toBe("الرياض")
    expect(d.editorGroups).toEqual([expect.objectContaining({ projectId: "P1", siteId: "prj_P1", label: "مجمع الياسمين", city: "الرياض", district: "حي الياسمين" })])
    expect((d.products as unknown[]).length).toBe(2)
  })

  it("gives a line the tree recognises its material and sub-category, so suppliers are reached by id", () => {
    const d = doc()
    const [rebar] = d.products as Array<Record<string, unknown>>
    expect((rebar.material as { path: Array<{ ar: string }> }).path.map((p) => p.ar)).toEqual(["الحديد", "حديد التسليح", "اسياخ حديد التسليح"])
    expect(rebar).toMatchObject({ quantity: 40, unitOfMeasure: "طن", boqItemId: "b1", boqItemNo: "03-01", boqTotalQuantity: 100, nameEn: "Rebar 16mm" })
    expect((d.subCategoryIds as string[]).length).toBe(1)
    expect(d.categories).toEqual(["الحديد"])
  })

  it("leaves a line the tree does not recognise uncategorised, for the editor to colour — not filed under an old category", () => {
    const [, other] = (doc().products as Array<Record<string, unknown>>)
    expect(other.material).toBeUndefined()
    expect(other).toMatchObject({ category: "", subCategory: "", boqItemId: "b2", requiresWarranty: true, quantity: 30 })
  })
})

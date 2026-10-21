// PUR-04: the contractor's catalogue keeps the material tree's sub-category beside the words, when the line has one.
jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/fake-firestore").firestoreModule)

import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, resetFakeDb } from "@/test-utils/fake-firestore"
import { upsertCatalogItems } from "@/lib/catalog-utils"

const db = fakeFirestore as unknown as Firestore

beforeEach(() => resetFakeDb())

it("stores the sub-category id of a line written on the tree, and nothing for an older line", async () => {
  await upsertCatalogItems(db, "u1", "org", [
    { category: "الحديد", subCategory: "حديد التسليح", subCategoryId: "sub-rebar", quantity: "10", unit: "طن" },
    { category: "حديد ومعادن", subCategory: "حديد تسليح", quantity: "5", unit: "طن" },
  ])
  const rows = listCollection("contractorCatalog") as Array<{ category: string; subCategoryId?: string }>
  expect(rows).toHaveLength(2)
  expect(rows.find((r) => r.category === "الحديد")?.subCategoryId).toBe("sub-rebar")
  expect(rows.find((r) => r.category === "حديد ومعادن")).not.toHaveProperty("subCategoryId")
})

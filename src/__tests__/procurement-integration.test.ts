/**
 * Procurement's seams with Inventory and Finance (review of 19 Sep 2026):
 *  - goods received from a supplier post Inventory + input VAT against
 *    Suppliers payable, at the offer's price read EXCLUDING VAT;
 *  - stock received with a known price carries its unit cost, averaged by
 *    quantity into a row that already holds stock;
 *  - materials a project consumes post a material issue at the snapshotted cost.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/accounting/hooks", () => ({ onMaterialIssued: jest.fn() }))
jest.mock("@/lib/finance-audit", () => ({ logFinanceAudit: jest.fn() }))
jest.mock("@/hooks/useProjectWasteStats", () => ({
  wasteRecordsCollection: (firestore: unknown, scope: { projectId?: string | null; warehouseId?: string | null }) => {
    const { collection } = jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule
    return scope.projectId ? collection(firestore as never, "projects", scope.projectId, "wasteRecords") : collection(firestore as never, "warehouses", scope.warehouseId as string, "wasteRecords")
  },
}))

import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { postGoodsReceipt, STANDARD_VAT_PERCENT } from "@/lib/accounting/posting-rules"
import { ACC } from "@/lib/accounting/accounts"
import { receiveDelivery } from "@/lib/warehouse-transfer"
import { recordWasteConsumption } from "@/lib/waste-writes"
import { onMaterialIssued } from "@/lib/accounting/hooks"

const db = fakeFirestore as unknown as Firestore
const ORG = "org1"

beforeEach(() => {
  resetFakeDb()
  jest.clearAllMocks()
})

const sum = (lines: Array<{ debit?: number; credit?: number }>, side: "debit" | "credit") => lines.reduce((s, l) => s + (l[side] || 0), 0)

describe("goods received from a supplier reach the books", () => {
  it("posts Inventory and input VAT against Suppliers payable at the gross", () => {
    const r = postGoodsReceipt({ deliveryId: "d1", date: "2026-09-19", net: 10000, vat: 1500, supplierId: "sup1", supplierName: "مؤسسة الروابي", rfqTitle: "حديد تسليح" })
    expect(r.sourceType).toBe("goods_receipt")
    expect(r.sourceId).toBe("d1")
    const byAccount = Object.fromEntries(r.lines.map((l) => [l.account, l]))
    expect(byAccount[ACC.inventoryMaterials].debit).toBe(10000)
    expect(byAccount[ACC.vatInput].debit).toBe(1500)
    expect(byAccount[ACC.suppliersPayable].credit).toBe(11500)
    expect(byAccount[ACC.suppliersPayable].partyName).toBe("مؤسسة الروابي")
    expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"))
    expect(r.empty).toBe(false)
  })

  it("the VAT is the standard rate on the net", () => {
    expect(STANDARD_VAT_PERCENT).toBe(15)
  })

  it("a delivery with no price is not posted", () => {
    expect(postGoodsReceipt({ deliveryId: "d2", date: "2026-09-19", net: 0, vat: 0 }).empty).toBe(true)
  })
})

describe("stock received carries its cost", () => {
  it("a new row is created at the unit cost", async () => {
    await receiveDelivery({ firestore: db, warehouseId: "wh1", organizationId: ORG, items: [{ name: "Cement", unit: "bag", quantity: 100, unitCost: 18 }] })
    const rows = listCollection<{ name: string; quantity: number; unitCost: number | null }>("warehouses/wh1/inventoryItems")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: "Cement", quantity: 100, unitCost: 18 })
  })

  it("merged into existing stock, the cost is the quantity-weighted average", async () => {
    seed("warehouses/wh1/inventoryItems/cem", { name: "Cement", unit: "bag", quantity: 100, unitCost: 16, organizationId: ORG, warehouseId: "wh1" })
    await receiveDelivery({ firestore: db, warehouseId: "wh1", organizationId: ORG, items: [{ name: "cement", unit: "Bag", quantity: 300, unitCost: 20 }] })
    const row = readDoc<{ quantity: number; unitCost: number }>("warehouses/wh1/inventoryItems/cem")!
    expect(row.quantity).toBe(400)
    expect(row.unitCost).toBe(19) // (100×16 + 300×20) / 400
  })

  it("a receipt with no known price leaves the row's cost as it was", async () => {
    seed("warehouses/wh1/inventoryItems/cem", { name: "Cement", unit: "bag", quantity: 10, unitCost: 16, organizationId: ORG, warehouseId: "wh1" })
    await receiveDelivery({ firestore: db, warehouseId: "wh1", organizationId: ORG, items: [{ name: "Cement", unit: "bag", quantity: 5 }] })
    expect(readDoc<{ quantity: number; unitCost: number }>("warehouses/wh1/inventoryItems/cem")).toMatchObject({ quantity: 15, unitCost: 16 })
  })

  it("an uncosted row takes the first known price", async () => {
    seed("warehouses/wh1/inventoryItems/cem", { name: "Cement", unit: "bag", quantity: 10, unitCost: null, organizationId: ORG, warehouseId: "wh1" })
    await receiveDelivery({ firestore: db, warehouseId: "wh1", organizationId: ORG, items: [{ name: "Cement", unit: "bag", quantity: 5, unitCost: 21 }] })
    expect(readDoc<{ quantity: number; unitCost: number }>("warehouses/wh1/inventoryItems/cem")).toMatchObject({ quantity: 15, unitCost: 21 })
  })
})

describe("materials a project consumes reach its cost", () => {
  const rows = [
    { inventoryItemId: "i1", itemName: "Cement", unit: "bag", quantityTaken: 10, quantityUsed: 9, unitCost: 20 },
    { inventoryItemId: "i2", itemName: "Sand", unit: "m3", quantityTaken: 4, quantityUsed: 4, unitCost: null },
  ]
  beforeEach(() => {
    seed("warehouses/wh1/inventoryItems/i1", { name: "Cement", unit: "bag", quantity: 50, unitCost: 20 })
    seed("warehouses/wh1/inventoryItems/i2", { name: "Sand", unit: "m3", quantity: 20, unitCost: null })
  })

  it("posts a material issue at the snapshotted cost — uncosted rows add nothing", async () => {
    const batchId = await recordWasteConsumption(db, {
      rows,
      warehouseId: "wh1",
      scope: { projectId: "p1" },
      projectName: "فلل النخيل",
      wasteTargetPercent: 12,
      userId: "u1",
      userName: "Badr",
      organizationId: ORG,
    })
    expect(onMaterialIssued).toHaveBeenCalledTimes(1)
    const [, actor, issue] = (onMaterialIssued as jest.Mock).mock.calls[0]
    expect(actor).toEqual({ organizationId: ORG, userId: "u1", userName: "Badr" })
    expect(issue).toMatchObject({ batchId, projectId: "p1", projectName: "فلل النخيل", totalValue: 200, wasteValue: 20 })
    expect(readDoc<{ quantity: number }>("warehouses/wh1/inventoryItems/i1")!.quantity).toBe(40)
  })

  it("without an organization nothing is posted (and the issue still lands)", async () => {
    await recordWasteConsumption(db, { rows, warehouseId: "wh1", scope: { projectId: "p1" }, wasteTargetPercent: 12, userId: "u1", userName: "Badr" })
    expect(onMaterialIssued).not.toHaveBeenCalled()
    expect(readDoc<{ quantity: number }>("warehouses/wh1/inventoryItems/i2")!.quantity).toBe(16)
  })
})

/**
 * The v2 write layer's pure seams: the Firestore doc ↔ engine mapping, and the
 * two new ledger rules (per-station material receipts keyed by withdrawal so
 * repeats can't collide, and approved scrap leaving WIP as production cost).
 */

import { isV2Order, toNoteSlice, toOrderSlice, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { postMfgMaterialReceipt, postMfgScrap } from "@/lib/accounting/posting-rules"
import { ACC } from "@/lib/accounting/accounts"
import type { DeliveryNote } from "@/lib/delivery-notes"

const baseOrder = (over: Partial<WorkOrderV2> = {}): WorkOrderV2 =>
  ({
    id: "wo1",
    organizationId: "org1",
    orderNumber: 7,
    title: "كاونتر",
    items: [],
    source: { kind: "quotation", quotationId: "q1" },
    status: "open",
    currentStageIndex: 0,
    stages: [],
    createdByUserId: "u1",
    createdByUserName: "بدر",
    productId: "p1",
    productName: "كاونتر",
    unit: "م²",
    quantity: 10,
    neededBy: "2026-09-20",
    createdAtIso: "2026-09-01T00:00:00Z",
    releasedAt: "2026-09-02T00:00:00Z",
    drawingApprovalStatus: "approved",
    measurement: null,
    slabApproval: null,
    rush: null,
    progress: [{ departmentId: "d1", done: 3, rejected: 1, rework: 0, hours: 2 }],
    materials: [],
    scrapRecords: [],
    shortfall: 0,
    brokenResolved: 0,
    ...over,
  }) as WorkOrderV2

describe("doc ↔ engine mapping", () => {
  it("isV2Order keys off the product card", () => {
    expect(isV2Order({ productId: "p1" })).toBe(true)
    expect(isV2Order({ productId: null })).toBe(false)
    expect(isV2Order({})).toBe(false)
  })

  it("toOrderSlice carries the quotation gate and defaults the optional fields", () => {
    const slice = toOrderSlice(baseOrder({ sourceQuotationWon: false }))
    expect(slice.sourceQuotationId).toBe("q1")
    expect(slice.sourceQuotationWon).toBe(false)
    expect(slice.progress).toHaveLength(1)
    expect(slice.scrap).toEqual([])
    expect(slice.shortfall).toBe(0)
    const bare = toOrderSlice(baseOrder({ progress: undefined, materials: undefined, scrapRecords: undefined }))
    expect(bare.progress).toEqual([])
    expect(bare.materials).toEqual([])
  })

  it("toNoteSlice maps note statuses onto the engine's three", () => {
    const note = (status: DeliveryNote["status"], broken = 0) =>
      toNoteSlice({ item: { name: "x", quantity: 5, unit: "م²", unitCost: null }, brokenQuantity: broken, status })
    expect(note("in_transit")).toEqual({ quantity: 5, brokenQuantity: 0, status: "in_transit" })
    expect(note("received", 2)).toEqual({ quantity: 5, brokenQuantity: 2, status: "received" })
    expect(note("rejected")).toEqual({ quantity: 5, brokenQuantity: 0, status: "rejected" })
  })
})

describe("posting rules — manufacturing v2", () => {
  it("a material receipt moves value from raw stock into WIP, keyed by the withdrawal", () => {
    const r = postMfgMaterialReceipt({
      workOrderId: "wo1",
      orderNumber: 7,
      requestNumber: "MW-ABC123",
      date: "2026-09-12",
      value: 4000,
      projectId: "prj1",
    })
    expect(r.sourceType).toBe("mfg_material_receipt")
    expect(r.sourceId).toBe("wo1__MW-ABC123")
    const debit = r.lines.find((l) => l.debit)
    const credit = r.lines.find((l) => l.credit)
    expect(debit?.account).toBe(ACC.inventoryWip)
    expect(credit?.account).toBe(ACC.inventoryMaterials)
    expect(debit?.debit).toBe(4000)
    expect(credit?.credit).toBe(4000)
    expect(debit?.project).toBe("prj1")
    expect(r.empty).toBe(false)
    // A second withdrawal on the same order gets its own idempotency key.
    expect(postMfgMaterialReceipt({ workOrderId: "wo1", orderNumber: 7, requestNumber: "MW-XYZ789", date: "2026-09-13", value: 100 }).sourceId).toBe(
      "wo1__MW-XYZ789"
    )
  })

  it("an all-unknown-cost receipt posts nothing instead of inventing zeros", () => {
    expect(postMfgMaterialReceipt({ workOrderId: "wo1", orderNumber: 7, requestNumber: "MW-0", date: "2026-09-12", value: 0 }).empty).toBe(true)
  })

  it("approved scrap leaves WIP as production cost, with the reason on the entry", () => {
    const r = postMfgScrap({
      workOrderId: "wo1",
      orderNumber: 7,
      scrapId: "SC-1",
      date: "2026-09-12",
      value: 4257,
      reason: "انكسرت بلاطة على المنشار",
      projectId: "prj1",
    })
    expect(r.sourceType).toBe("mfg_scrap")
    expect(r.sourceId).toBe("SC-1")
    const debit = r.lines.find((l) => l.debit)
    const credit = r.lines.find((l) => l.credit)
    expect(debit?.account).toBe(ACC.costMaterials)
    expect(credit?.account).toBe(ACC.inventoryWip)
    expect(debit?.debit).toBe(4257)
    expect(credit?.credit).toBe(4257)
    expect(r.description).toContain("انكسرت بلاطة")
    const totals = r.lines.reduce((a, l) => a + (l.debit || 0) - (l.credit || 0), 0)
    expect(totals).toBe(0)
  })
})

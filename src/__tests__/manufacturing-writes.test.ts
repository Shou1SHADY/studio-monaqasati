/**
 * The write layer's pure seams: the stored order ↔ engine mapping (including
 * orders written before PRD 1.2, which must keep reading the same), the down
 * payment read from the sales order, and the ledger rules the workshop's cost
 * events ride on.
 */

import { downPaymentOf, isV2Order, sourceOf, toNoteSlice, toOrderSlice, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { postMfgMaterialReceipt, postMfgScrap } from "@/lib/accounting/posting-rules"
import { ACC } from "@/lib/accounting/accounts"
import type { DeliveryNote } from "@/lib/delivery-notes"
import type { SalesOrder } from "@/lib/sales-orders"

const baseOrder = (over: Partial<WorkOrderV2> = {}): WorkOrderV2 =>
  ({
    id: "wo1",
    organizationId: "org1",
    orderNumber: 7,
    title: "كاونتر",
    items: [],
    source: { kind: "manual" },
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
    progress: [{ departmentId: "d1", done: 3, rejected: 1, rework: 0, hours: 2 }],
    materials: [],
    scrapRecords: [],
    shortfall: 0,
    brokenResolved: 0,
    ...over,
  }) as WorkOrderV2

const deposit = (paid: boolean) => ({ payment: { kind: "deposit", depositPercent: 40, depositPaid: paid } }) as Pick<SalesOrder, "payment">

describe("doc ↔ engine mapping", () => {
  it("isV2Order keys off the product card", () => {
    expect(isV2Order({ productId: "p1" })).toBe(true)
    expect(isV2Order({ productId: null })).toBe(false)
    expect(isV2Order({})).toBe(false)
  })

  it("names the source: a sales order, a project, or stock", () => {
    expect(sourceOf(baseOrder({ salesOrderId: "so1" }))).toBe("client")
    expect(sourceOf(baseOrder({ source: { kind: "quotation", quotationId: "q1" } }))).toBe("client")
    expect(sourceOf(baseOrder({ projectId: "p9" }))).toBe("project")
    expect(sourceOf(baseOrder())).toBe("stock")
    expect(sourceOf(baseOrder({ projectId: "p9", sourceKind: "stock" }))).toBe("stock")
  })

  it("reads the down payment from the sales order — never confirms it", () => {
    const client = baseOrder({ sourceKind: "client", salesOrderId: "so1" })
    expect(downPaymentOf(client, deposit(false))).toEqual({ required: true, confirmed: false, percent: 40 })
    expect(downPaymentOf(client, deposit(true))).toEqual({ required: true, confirmed: true, percent: 40 })
    expect(downPaymentOf(client, { payment: { kind: "credit" } } as Pick<SalesOrder, "payment">).required).toBe(false)
    expect(downPaymentOf(baseOrder({ projectId: "p9" }), deposit(false)).required).toBe(false)
    // A pre-1.2 quote-born order whose quote was not won stays gated.
    expect(downPaymentOf(baseOrder({ source: { kind: "quotation", quotationId: "q1" }, sourceQuotationWon: false }), null)).toEqual({ required: true, confirmed: false, percent: null })
  })

  it("maps orders written before PRD 1.2: measurement → survey, approved drawing → A, no closures → auto-closed", () => {
    const slice = toOrderSlice(
      baseOrder({ measurement: { at: "2026-09-01", by: "Sami" }, drawingApprovalStatus: "approved", drawingApprovedAt: "2026-09-02T00:00:00Z", drawingApprovedBy: "Eng. Khalid" })
    )
    expect(slice.survey).toEqual({ at: "2026-09-01", by: "Sami", note: null })
    expect(slice.drawing).toMatchObject({ code: "A", recordedBy: "Eng. Khalid" })
    expect(slice.closures).toBeNull()
    expect(slice.rejects).toEqual([])
    expect(slice.remnants).toEqual([])
    const fresh = toOrderSlice(baseOrder({ closures: [], drawing: null }))
    expect(fresh.closures).toEqual([])
    expect(fresh.drawing).toBeNull()
  })

  it("defaults every optional array and map", () => {
    const bare = toOrderSlice(baseOrder({ progress: undefined, materials: undefined, scrapRecords: undefined }))
    expect(bare.progress).toEqual([])
    expect(bare.materials).toEqual([])
    expect(bare.scrap).toEqual([])
    expect(bare.overrides).toEqual({})
    expect(bare.purchaseRequests).toEqual([])
    expect(bare.changeRequest).toBeNull()
  })

  it("toNoteSlice maps note statuses onto the engine's three and keeps the note's identity", () => {
    const note = (status: DeliveryNote["status"], broken = 0) =>
      toNoteSlice({ id: "n1", noteNumber: "DN-2026/061", sentAt: "2026-09-10T08:00:00Z", toKind: "project", item: { name: "x", quantity: 5, unit: "م²", unitCost: null }, brokenQuantity: broken, status })
    expect(note("in_transit")).toEqual({ id: "n1", number: "DN-2026/061", quantity: 5, brokenQuantity: 0, status: "in_transit", sentAt: "2026-09-10T08:00:00Z", toKind: "project" })
    expect(note("received", 2)).toMatchObject({ brokenQuantity: 2, status: "received" })
    expect(note("rejected")).toMatchObject({ status: "rejected" })
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

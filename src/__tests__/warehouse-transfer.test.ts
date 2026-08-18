import { validateTransfer, itemMergeKey } from "@/lib/warehouse-transfer"

describe("validateTransfer", () => {
  const base = { fromWarehouseId: "central", toWarehouseId: "proj" }

  it("accepts a valid transfer within available stock", () => {
    expect(validateTransfer({ ...base, sourceItem: { quantity: 100 }, quantity: 40 })).toBeNull()
  })

  it("accepts transferring the entire stock", () => {
    expect(validateTransfer({ ...base, sourceItem: { quantity: 5 }, quantity: 5 })).toBeNull()
  })

  it("rejects zero quantity", () => {
    expect(validateTransfer({ ...base, sourceItem: { quantity: 100 }, quantity: 0 })).toBe("invalid_quantity")
  })

  it("rejects negative quantity", () => {
    expect(validateTransfer({ ...base, sourceItem: { quantity: 100 }, quantity: -3 })).toBe("invalid_quantity")
  })

  it("rejects NaN quantity", () => {
    expect(validateTransfer({ ...base, sourceItem: { quantity: 100 }, quantity: NaN })).toBe("invalid_quantity")
  })

  it("rejects more than available stock", () => {
    expect(validateTransfer({ ...base, sourceItem: { quantity: 10 }, quantity: 11 })).toBe("insufficient_stock")
  })

  it("rejects a missing source item", () => {
    expect(validateTransfer({ ...base, sourceItem: null, quantity: 1 })).toBe("insufficient_stock")
  })

  it("rejects barcode/unit-tracked items (their stock moves per physical unit)", () => {
    expect(validateTransfer({ ...base, sourceItem: { quantity: 10, trackingMode: "unit" }, quantity: 1 })).toBe("unit_tracked")
  })

  it("rejects transfers into the same warehouse", () => {
    expect(validateTransfer({ sourceItem: { quantity: 10 }, quantity: 1, fromWarehouseId: "w1", toWarehouseId: "w1" })).toBe("same_warehouse")
  })

  it("checks same_warehouse before quantity, so a broken dialog state fails loud", () => {
    expect(validateTransfer({ sourceItem: { quantity: 10 }, quantity: 0, fromWarehouseId: "w1", toWarehouseId: "w1" })).toBe("same_warehouse")
  })
})

describe("itemMergeKey", () => {
  it("matches identical name+unit", () => {
    expect(itemMergeKey({ name: "أسمنت", unit: "كيس" })).toBe(itemMergeKey({ name: "أسمنت", unit: "كيس" }))
  })

  it("ignores surrounding whitespace and unit casing", () => {
    expect(itemMergeKey({ name: " أسمنت ", unit: "KG" })).toBe(itemMergeKey({ name: "أسمنت", unit: "kg" }))
  })

  it("distinguishes same material in different units", () => {
    expect(itemMergeKey({ name: "أسمنت", unit: "كيس" })).not.toBe(itemMergeKey({ name: "أسمنت", unit: "طن" }))
  })

  it("distinguishes different materials in the same unit", () => {
    expect(itemMergeKey({ name: "أسمنت", unit: "كيس" })).not.toBe(itemMergeKey({ name: "جبس", unit: "كيس" }))
  })
})

/**
 * The manual goods receipt's form (#141): react-hook-form + zod, one message
 * per field in the prototype's wording — never one generic toast.
 */

import { manualReceiptSchema, type ManualReceiptValues } from "@/lib/procurement/manual-receipt-form"

const TODAY = "2026-09-29"
const blank = (over: Partial<ManualReceiptValues> = {}): ManualReceiptValues => ({
  supplierName: "محل الحي",
  supplierOrgId: "",
  poId: "",
  deliveryDate: TODAY,
  driverName: "",
  receiverName: "بدر",
  notes: "",
  reason: "",
  paperNoteNumber: "",
  warehouseId: "",
  projectId: "",
  rows: [{ inventoryItemId: "", itemName: "زوايا", quantity: "20", unit: "حبة", unitPrice: "" }],
  poCounts: {},
  supplierCr: "",
  supplierVat: "",
  contractorCr: "",
  contractorVat: "",
  ...over,
})
const issues = (v: ManualReceiptValues) => {
  const r = manualReceiptSchema(TODAY).safeParse(v)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`)
}

describe("the manual receipt's form", () => {
  it("passes a complete receipt", () => {
    expect(issues(blank())).toEqual([])
    expect(issues(blank({ rows: [{ inventoryItemId: "", itemName: "زوايا", quantity: "٢٠", unit: "", unitPrice: "" }] }))).toEqual([])
  })

  it("names each failing field: supplier, each line's description and quantity, the receiver, the date", () => {
    const v = blank({
      supplierName: " ",
      receiverName: "",
      deliveryDate: "2026-09-30",
      rows: [
        { inventoryItemId: "", itemName: "زوايا", quantity: "20", unit: "", unitPrice: "" },
        { inventoryItemId: "", itemName: "", quantity: "0", unit: "", unitPrice: "" },
      ],
    })
    expect(issues(v)).toEqual(["supplierName:errSupplier", "rows.1.itemName:errLineDesc", "rows.1.quantity:errLineQty", "receiverName:errReceiver", "deliveryDate:errDate"])
  })

  it("against an order: the lines are the order's — at least one counted, and a count is a number", () => {
    const onOrder = blank({ poId: "po1", rows: [{ inventoryItemId: "", itemName: "", quantity: "", unit: "", unitPrice: "" }] })
    expect(issues(onOrder)).toEqual(["poCounts:errCountOne"])
    expect(issues({ ...onOrder, poCounts: { l1: "", l2: "5" } })).toEqual([])
    expect(issues({ ...onOrder, poCounts: { l1: "abc" } })).toEqual(["poCounts:errCountNumber"])
  })
})

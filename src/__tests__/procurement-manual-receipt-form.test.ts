/**
 * The manual goods receipt's form (#141, rewritten for Procurement 2.0 RCV-05): react-hook-form + zod, one message per field in the
 * prototype's wording — never one generic toast. 1.5's «against an order» mode and the receiver / driver / CR / signature fields are gone:
 * the receiver counts a delivery on an order, and a manual receipt is only for what was bought outside the platform.
 */

import { manualReceiptSchema, type ManualReceiptValues } from "@/lib/procurement/manual-receipt-form"

const TODAY = "2026-09-29"
const blank = (over: Partial<ManualReceiptValues> = {}): ManualReceiptValues => ({
  supplierName: "محل الحي",
  supplierOrgId: "",
  deliveryDate: TODAY,
  warehouseId: "wh-main",
  invoiceNumber: "",
  invoiceValue: "",
  after: "later",
  notes: "",
  rows: [{ inventoryItemId: "", itemName: "زوايا", quantity: "20", unit: "حبة", unitPrice: "" }],
  ...over,
})
const issues = (v: ManualReceiptValues) => {
  const r = manualReceiptSchema(TODAY).safeParse(v)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`)
}

describe("the manual receipt's form", () => {
  it("passes a complete receipt", () => {
    expect(issues(blank())).toEqual([])
    expect(issues(blank({ rows: [{ inventoryItemId: "", itemName: "زوايا", quantity: "٢٠", unit: "", unitPrice: "" }], invoiceValue: "1,250.50", after: "cash" }))).toEqual([])
  })

  it("names each failing field: supplier, the location, the date, the invoice value, each line's description and quantity", () => {
    const v = blank({
      supplierName: " ",
      warehouseId: "",
      deliveryDate: "2026-09-30",
      invoiceValue: "abc",
      rows: [
        { inventoryItemId: "", itemName: "زوايا", quantity: "20", unit: "", unitPrice: "" },
        { inventoryItemId: "", itemName: "", quantity: "0", unit: "", unitPrice: "" },
      ],
    })
    expect(issues(v)).toEqual(["supplierName:errSupplier", "warehouseId:errSite", "deliveryDate:errDate", "invoiceValue:errInvoiceValue", "rows.1.itemName:errLineDesc", "rows.1.quantity:errLineQty"])
  })

  it("the invoice value is optional but never negative; the day may be today", () => {
    expect(issues(blank({ invoiceValue: "-5" }))).toEqual(["invoiceValue:errInvoiceValue"])
    expect(issues(blank({ deliveryDate: TODAY }))).toEqual([])
  })
})

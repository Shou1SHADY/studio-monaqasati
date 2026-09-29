// The manual goods receipt's form rules (prototype `manrc.ok`), field by field:
// the supplier as invoiced, each line's description and quantity, who received
// it, a date no later than today — or, against an order, at least one line
// counted. Each failure carries a message CODE the screen renders as
// `Portal.ProcReceipts.manual.<code>` (a line's names the line). The write
// (`createManualReceipt` / `createArrivalWithoutNotice`) checks again.

import { z } from "zod"

/** A quantity typed in either script, with thousands separators. NaN when it is not a number. */
export const manualNum = (s: string): number => Number((s || "").trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,٬\s]/g, ""))

const rowSchema = z.object({ inventoryItemId: z.string(), itemName: z.string(), quantity: z.string(), unit: z.string(), unitPrice: z.string() })

/** `today` is `YYYY-MM-DD`. */
export function manualReceiptSchema(today: string) {
  return z
    .object({
      supplierName: z.string(),
      supplierOrgId: z.string(),
      poId: z.string(),
      deliveryDate: z.string(),
      driverName: z.string(),
      receiverName: z.string(),
      notes: z.string(),
      reason: z.string(),
      paperNoteNumber: z.string(),
      warehouseId: z.string(),
      projectId: z.string(),
      rows: z.array(rowSchema),
      poCounts: z.record(z.string()),
      supplierCr: z.string(),
      supplierVat: z.string(),
      contractorCr: z.string(),
      contractorVat: z.string(),
    })
    .superRefine((v, ctx) => {
      const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
      if (!v.supplierName.trim()) fail(["supplierName"], "errSupplier")
      if (v.poId) {
        const counted = Object.values(v.poCounts).filter((c) => c.trim() !== "")
        if (!counted.length) fail(["poCounts"], "errCountOne")
        else if (counted.some((c) => !Number.isFinite(manualNum(c)) || manualNum(c) < 0)) fail(["poCounts"], "errCountNumber")
      } else {
        v.rows.forEach((r, i) => {
          if (!r.itemName.trim()) fail(["rows", i, "itemName"], "errLineDesc")
          const q = manualNum(r.quantity)
          if (!r.quantity.trim() || !Number.isFinite(q) || q <= 0) fail(["rows", i, "quantity"], "errLineQty")
        })
      }
      if (!v.receiverName.trim()) fail(["receiverName"], "errReceiver")
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.deliveryDate) || v.deliveryDate > today) fail(["deliveryDate"], "errDate")
    })
}

export type ManualReceiptValues = z.infer<ReturnType<typeof manualReceiptSchema>>

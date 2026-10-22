// The manual goods receipt's form rules (PRD 2.0 RCV-05, prototype `manrc`): a purchase made OUTSIDE the platform. The supplier as a free
// text (the corner shop, a vendor not on the platform), where it was delivered, the day (never later than today), the supplier's invoice
// number and value, the same material rows as everywhere, what happens next (a later order · a cash expense) and the attachments.
// Each failure carries a message CODE the screen renders as `Portal.ProcReceipts.manual.<code>` (a line's names the line). The browser's
// form (`manualReceiptSchema`) and the server's body (`manualReceiptBody`) are two views of the same rules.

import { z } from "zod"

/** A quantity typed in either script, with thousands separators. NaN when it is not a number. */
export const manualNum = (s: string): number => Number((s || "").trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,٬\s]/g, ""))

/** What the buyer says happens to the receipt next (WF-20 «ثم ماذا؟»): an order raised later over it, or a cash expense with no order. */
export const MANUAL_AFTER = ["later", "cash"] as const
export type ManualAfter = (typeof MANUAL_AFTER)[number]

const rowSchema = z.object({ inventoryItemId: z.string(), itemName: z.string(), quantity: z.string(), unit: z.string(), unitPrice: z.string() })

/** `today` is `YYYY-MM-DD`. */
export function manualReceiptSchema(today: string) {
  return z
    .object({
      supplierName: z.string(),
      supplierOrgId: z.string(),
      deliveryDate: z.string(),
      warehouseId: z.string(),
      invoiceNumber: z.string(),
      invoiceValue: z.string(),
      after: z.enum(MANUAL_AFTER),
      notes: z.string(),
      rows: z.array(rowSchema),
    })
    .superRefine((v, ctx) => {
      const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
      if (v.supplierName.trim().length < 2) fail(["supplierName"], "errSupplier")
      if (!v.warehouseId.trim()) fail(["warehouseId"], "errSite")
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.deliveryDate) || v.deliveryDate > today) fail(["deliveryDate"], "errDate")
      if (v.invoiceValue.trim() && (!Number.isFinite(manualNum(v.invoiceValue)) || manualNum(v.invoiceValue) < 0)) fail(["invoiceValue"], "errInvoiceValue")
      v.rows.forEach((r, i) => {
        if (!r.itemName.trim()) fail(["rows", i, "itemName"], "errLineDesc")
        const q = manualNum(r.quantity)
        if (!r.quantity.trim() || !Number.isFinite(q) || q <= 0) fail(["rows", i, "quantity"], "errLineQty")
      })
    })
}

export type ManualReceiptValues = z.infer<ReturnType<typeof manualReceiptSchema>>

/** Where an attachment of a manual receipt may live: our own storage, never an address the browser made up. */
const OWN_STORAGE = /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//

export const manualAttachment = z.object({ name: z.string().trim().max(160), url: z.string().url().max(2000).regex(OWN_STORAGE) })

/** The body `POST /api/procurement/manual-receipt` takes. `.strict()` — nothing the server does not read is accepted. */
export const manualReceiptBody = z
  .object({
    supplierName: z.string().trim().min(2).max(200),
    supplierOrgId: z.string().max(128).nullish(),
    deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    warehouseId: z.string().min(1).max(128),
    invoiceNumber: z.string().trim().max(80).nullish(),
    invoiceValue: z.number().min(0).max(1e10).nullish(),
    after: z.enum(MANUAL_AFTER),
    notes: z.string().trim().max(1000).nullish(),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          quantity: z.number().positive().max(1e9),
          unit: z.string().trim().min(1).max(40),
          unitPrice: z.number().min(0).max(1e9).nullish(),
        })
      )
      .min(1)
      .max(100),
    attachments: z.array(manualAttachment).max(10).default([]),
  })
  .strict()
export type ManualReceiptBody = z.infer<typeof manualReceiptBody>

/** The form's values as the server's body. Unit prices and the invoice value travel only for a reader who sees prices; a blank unit is `unitDefault`. */
export function manualFormToBody(v: ManualReceiptValues, attachments: ManualReceiptBody["attachments"], opts: { seesPrices: boolean; unitDefault: string }): ManualReceiptBody {
  const value = v.invoiceValue.trim() ? manualNum(v.invoiceValue) : null
  return {
    supplierName: v.supplierName.trim(),
    supplierOrgId: v.supplierOrgId || null,
    deliveryDate: v.deliveryDate,
    warehouseId: v.warehouseId,
    invoiceNumber: v.invoiceNumber.trim() || null,
    invoiceValue: opts.seesPrices ? value : null,
    after: v.after,
    notes: v.notes.trim() || null,
    items: v.rows.map((r) => ({
      name: r.itemName.trim(),
      quantity: manualNum(r.quantity),
      unit: r.unit.trim() || opts.unitDefault,
      unitPrice: opts.seesPrices && r.unitPrice.trim() && Number.isFinite(manualNum(r.unitPrice)) ? manualNum(r.unitPrice) : null,
    })),
    attachments,
  }
}

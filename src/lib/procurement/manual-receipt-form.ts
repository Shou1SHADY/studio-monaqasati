// The manual goods receipt's form rules (PRD 2.0 RCV-05, prototype `manrc`): a purchase made OUTSIDE the platform. The supplier as a free
// text (the corner shop, a vendor not on the platform), where it was delivered, the day (never later than today), the supplier's invoice
// number and value, the same material rows as everywhere, what happens next (a later order · a cash expense) and the attachments.
// Each failure carries a message CODE the screen renders as `Portal.ProcReceipts.manual.<code>` (a line's names the line). The browser's
// form (`manualReceiptSchema`) and the server's body (`manualReceiptBody`) are two views of the same rules.

import { z } from "zod"
import type { MaterialPick } from "../materials/types"
import type { DeliverySite } from "./delivery-sites"

/** A quantity typed in either script, with thousands separators. NaN when it is not a number. */
export const manualNum = (s: string): number => Number((s || "").trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,٬\s]/g, ""))

/** What the buyer says happens to the receipt next (WF-20 «ثم ماذا؟»): an order raised later over it, or a cash expense with no order. */
export const MANUAL_AFTER = ["later", "cash"] as const
export type ManualAfter = (typeof MANUAL_AFTER)[number]

/** The tree's material as a manual row carries it (RC-03) — the editor's `MaterialPick`, bounded. */
const text = z.object({ ar: z.string().max(200), en: z.string().max(200) })
export const manualMaterial = z.object({
  nodeId: z.string().min(1).max(128),
  subId: z.string().min(1).max(128),
  rootId: z.string().min(1).max(128),
  path: z.array(text).max(8),
  specs: z.array(z.object({ name: text, value: text, free: z.boolean().optional() })).max(20),
  brand: text.nullish(),
  saleUnits: z.array(text.extend({ lengthM: z.number(), from: z.enum(["list", "spec"]) })).max(20).optional(),
  outside: z.boolean().optional(),
})

// `material` and `invoiceName` are optional so a row written before RC-03 (and the tests that build one) still reads.
const rowSchema = z.object({
  inventoryItemId: z.string(),
  itemName: z.string(),
  quantity: z.string(),
  unit: z.string(),
  unitPrice: z.string(),
  material: z.custom<MaterialPick | null>().optional(),
  invoiceName: z.string().optional(),
})

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
    warehouseId: z.string().min(1).max(128).optional(),
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
          /** RC-03: the material row used everywhere — the tree's material and its specs — and the words of the shop's invoice. */
          material: manualMaterial.nullish(),
          invoiceName: z.string().trim().max(200).nullish(),
        })
      )
      .min(1)
      .max(100),
    attachments: z.array(manualAttachment).max(10).default([]),
    /** RC-04: a delivery site with no warehouse — a record of what arrived there, no stock. Exactly one of `warehouseId` / `siteId`. */
    siteId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine((b) => Boolean(b.warehouseId) !== Boolean(b.siteId), { message: "site_missing", path: ["warehouseId"] })
export type ManualReceiptBody = z.infer<typeof manualReceiptBody>

/** Where a manual purchase can be delivered (RC-04): every delivery site — a warehouse, a project's site (its store), a work site
 * with no store — with the company's central store first even before it exists. `warehouseId` null = a record only, no stock. */
export interface ManualPlace {
  /** The picker's value: the site's id, or `wh_<id>` for a store no site names. */
  id: string
  name: string
  warehouseId: string | null
  siteId: string | null
  projectId: string | null
  kind: DeliverySite["kind"]
}

export function manualPlaces(input: {
  sites: ReadonlyArray<Pick<DeliverySite, "id" | "name" | "kind" | "warehouseId" | "projectId" | "retired">>
  warehouses: ReadonlyArray<{ id: string; name: string; projectId?: string | null }>
  orgId: string
  centralName: string
  /** Manufacturing in the package: the workshop's store is a place; off, it is left out. */
  mfgOn?: boolean
}): ManualPlace[] {
  const central = `central_${input.orgId}`
  const out: ManualPlace[] = []
  const usedWh = new Set<string>()
  const centralWh = input.warehouses.find((w) => w.id === central)
  if (input.orgId) {
    out.push({ id: `wh_${central}`, name: centralWh?.name || input.centralName, warehouseId: central, siteId: null, projectId: null, kind: "warehouse" })
    usedWh.add(central)
  }
  for (const s of input.sites) {
    if (s.retired || (input.mfgOn === false && s.kind === "workshop")) continue
    const wh = s.warehouseId || (s.projectId ? input.warehouses.find((w) => w.projectId === s.projectId)?.id : null) || null
    if (wh && usedWh.has(wh)) continue
    if (wh) usedWh.add(wh)
    out.push({ id: s.id, name: s.name, warehouseId: wh, siteId: wh ? null : s.id, projectId: s.projectId || (wh ? input.warehouses.find((w) => w.id === wh)?.projectId : null) || null, kind: s.kind })
  }
  // A store no site names (a project's store with Projects off, an older one) stays pickable, as it was before sites.
  for (const w of input.warehouses) {
    if (usedWh.has(w.id)) continue
    usedWh.add(w.id)
    out.push({ id: `wh_${w.id}`, name: w.name, warehouseId: w.id, siteId: null, projectId: w.projectId || null, kind: w.projectId ? "project" : "warehouse" })
  }
  return out
}

/** The form's values as the server's body. Unit prices and the invoice value travel only for a reader who sees prices; a blank unit is
 * `unitDefault`. `place` is the picked delivery place (RC-04); without one the form's value is read as a warehouse id, as before. */
export function manualFormToBody(v: ManualReceiptValues, attachments: ManualReceiptBody["attachments"], opts: { seesPrices: boolean; unitDefault: string; place?: ManualPlace | null }): ManualReceiptBody {
  const value = v.invoiceValue.trim() ? manualNum(v.invoiceValue) : null
  const place = opts.place ?? null
  const where = place ? (place.warehouseId ? { warehouseId: place.warehouseId } : { siteId: place.siteId || place.id }) : { warehouseId: v.warehouseId }
  return {
    supplierName: v.supplierName.trim(),
    supplierOrgId: v.supplierOrgId || null,
    deliveryDate: v.deliveryDate,
    ...where,
    invoiceNumber: v.invoiceNumber.trim() || null,
    invoiceValue: opts.seesPrices ? value : null,
    after: v.after,
    notes: v.notes.trim() || null,
    items: v.rows.map((r) => ({
      name: r.itemName.trim(),
      quantity: manualNum(r.quantity),
      unit: r.unit.trim() || opts.unitDefault,
      unitPrice: opts.seesPrices && r.unitPrice.trim() && Number.isFinite(manualNum(r.unitPrice)) ? manualNum(r.unitPrice) : null,
      ...(r.material ? { material: r.material } : {}),
      ...(r.invoiceName?.trim() ? { invoiceName: r.invoiceName.trim() } : {}),
    })),
    attachments,
  }
}

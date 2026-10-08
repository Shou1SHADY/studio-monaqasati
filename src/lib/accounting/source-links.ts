// "The document behind the entry" — where in the app an auto entry came from.
//
// An entry stores only `sourceType` + `sourceId` (together they make its id,
// which is what keeps posting idempotent). This maps the pair to the screen
// that shows that document, as a path RELATIVE to the portal root, so the
// journal can offer "open the source document" instead of naming a type and
// leaving the accountant to go and find it.
//
// Null means there is no other document to open: a manual voucher or an
// opening balance IS its own document, and a few sources have no screen of
// their own yet. The shapes of `sourceId` are posting-rules.ts's.

import type { OptionalModule } from "../company-modules"
import type { JournalEntry } from "./journal"

type Portal = "contractor" | "supplier"

const REVERSAL_SUFFIX = "__reversal"

/** The source id as the business wrote it — a reversal carries its original's id plus a suffix. */
export function originalSourceId(entry: Pick<JournalEntry, "sourceId">): string {
  let id = entry.sourceId || ""
  while (id.endsWith(REVERSAL_SUFFIX)) id = id.slice(0, -REVERSAL_SUFFIX.length)
  return id
}

/** Sources whose document lives in an optional module: with that module off the entry stays readable but has no page to open. */
const MODULE_OF_SOURCE: Record<string, OptionalModule> = {
  ipc_claim: "project-management",
  ipc_collection: "project-management",
  retention_release: "project-management",
  pm_sub_certificate: "project-management",
  pm_sub_payment: "project-management",
  pm_cash: "project-management",
  pm_loss: "project-management",
  pm_xfer: "project-management",
  work_order_issue: "manufacturing",
  mfg_material_receipt: "manufacturing",
  mfg_remnant_receipt: "manufacturing",
  mfg_scrap: "manufacturing",
  work_order_delivery: "manufacturing",
  hr_pay: "hr",
  hr_eos: "hr",
  hr_pay_payment: "hr",
  hr_pay_return: "hr",
  hr_advance: "hr",
  hr_settlement: "hr",
  hr_fee: "hr",
  hr_gosi_payment: "hr",
}

export function sourceDocumentPath(entry: Pick<JournalEntry, "sourceType" | "sourceId" | "lines">, portal: Portal, off: ReadonlySet<OptionalModule> = new Set()): string | null {
  const owner = MODULE_OF_SOURCE[entry.sourceType]
  if (owner && off.has(owner)) return null
  const id = originalSourceId(entry)
  const head = id.split("__")[0]
  switch (entry.sourceType) {
    case "ipc_claim":
    case "ipc_collection":
    case "retention_release":
    case "pm_sub_certificate":
    case "pm_sub_payment":
    case "pm_cash":
    case "pm_loss":
    case "pm_xfer": {
      // A claim lives inside its project; the entry's lines carry the project.
      const project = entry.lines.find((l) => l.project)?.project
      return portal === "contractor" && project ? `projects/${project}` : null
    }
    case "sales_payment": {
      // `${quotationId}__${installmentId}` — except a payment against an
      // invoice, which posts as `${invoiceId}__invoice`.
      const [, installment] = id.split("__")
      if (installment === "invoice") return "sales/fulfillment"
      return head ? `sales/quotations/${head}` : "sales/payments"
    }
    case "sales_quotation":
      return head ? `sales/quotations/${head}` : "sales/quotations"
    case "sales_invoice":
    case "sales_credit_note":
    case "sales_delivery":
      return "sales/fulfillment"
    case "work_order_issue":
    case "mfg_material_receipt":
    case "mfg_remnant_receipt":
      // The id is, or starts with, the work order's.
      return head ? `manufacturing/workshop?order=${head}` : "manufacturing/workshop"
    case "mfg_scrap":
      return "manufacturing/workshop"
    case "work_order_delivery":
      return "warehouses/delivery-notes"
    case "goods_receipt":
      // The id is the delivery (receipt) document's; the desk opens it in place.
      return portal === "contractor" && id ? `goods-received?delivery=${id}` : null
    case "guarantee_margin":
    case "guarantee_release":
      return "guarantees"
    case "settlement":
      return "accounting/settlements"
    case "vat_settlement":
      return "accounting/vat"
    case "zakat_provision":
    case "zakat_payment":
      return "accounting/zakat"
    case "wht_remittance":
      return "accounting/wht"
    // HR 1.0 — the Finance desk that posted and paid it.
    case "hr_pay":
    case "hr_eos":
    case "hr_pay_payment":
    case "hr_pay_return":
    case "hr_advance":
    case "hr_settlement":
    case "hr_fee":
    case "hr_gosi_payment":
      return "accounting/hr-desk"
    default:
      return null
  }
}

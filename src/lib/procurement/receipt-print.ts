// The printed goods receipt (PRD 3.0 §8): a unified header with the company's
// identity, a status banner — final when nothing is left open on the order,
// partial with what is outstanding, "no PO — manual" for a receipt with no
// order — the quantity table (on order · per notice · counted · rejected ·
// held · accepted · unit, value only for a reader who sees prices), the
// checklist, driver & vehicle, three signature boxes and the footer. Bilingual
// through the caller's translator, A4, self-contained window. Money is
// written "ر.س"/"SAR": the riyal glyph's font is not in this window.
//
// `buildReceiptPrintHtml` is pure (tested); `printGoodsReceipt` opens it.

import { escapeHtml } from "@/components/accounting/print"
import { acceptedOf, lineToArrive, round2 } from "./po"
import type { DeliveryLine, PurchaseOrder, ReceiptCheck } from "./types"
import type { DeskDelivery } from "./receipt-desk"
import { receiptLinesOf } from "./receipt-desk"
import { RECEIPT_CHECKS } from "./po"

const e = escapeHtml

export type ReceiptPrintCopy = (key: string, params?: Record<string, string | number>) => string

export interface ReceiptPrintCompany {
  name: string
  cr?: string | null
  vat?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
}

export interface ReceiptPrintInput {
  delivery: DeskDelivery
  po: PurchaseOrder | null
  company: ReceiptPrintCompany
  /** Where the goods went, resolved by the caller (warehouse name, project). */
  placeName: string | null
  projectName: string | null
  displayNumber: string
  displayPoNumber: string | null
  withPrices: boolean
  locale: string
  /** `Portal.ProcReceipts.print.*`, already scoped. */
  t: ReceiptPrintCopy
  /** `Portal.Procurement.*` for the coded reasons and the checklist. */
  tp: ReceiptPrintCopy
  now: Date
}

const figure = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n))
const sar = (n: number, locale: string) => (locale === "ar" ? `${figure(n)} ر.س` : `SAR ${figure(n)}`)

function longDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—"
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return e(iso)
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { year: "numeric", month: "long", day: "numeric" })
}
const timeOf = (iso: string | null | undefined, locale: string): string => {
  if (!iso || iso.length === 10) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { hour: "2-digit", minute: "2-digit" })
}

export const RECEIPT_PRINT_CSS = (dir: "rtl" | "ltr") => {
  const start = dir === "rtl" ? "right" : "left"
  const end = dir === "rtl" ? "left" : "right"
  return `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif; color: #000; margin: 0; font-size: 12px; line-height: 1.6; }
  .pd { padding: 4mm; }
  .pdh { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
  .pdh h1 { font-size: 20px; margin: 0; }
  .pdh .sub { color: #444; font-size: 12px; }
  .pdco { text-align: ${end}; font-size: 11px; line-height: 1.7; }
  .pdco b { font-size: 13px; display: block; }
  .pdst { font-weight: 700; font-size: 11.5px; border-radius: 6px; padding: 6px 10px; margin: 8px 0 12px; }
  .pdst.g { background: #eef7ee; color: #2e7d32; }
  .pdst.w { background: #fdf6e6; color: #a67c00; }
  .pdg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0 14px; }
  .pdg div { border: 1px solid #bbb; border-radius: 6px; padding: 7px 9px; min-height: 58px; }
  .pdg small { color: #666; display: block; font-size: 10.5px; }
  .pdg b { display: block; font-size: 12.5px; }
  .pdg span { font-size: 11px; color: #333; display: block; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #999; padding: 5px 7px; text-align: ${start}; vertical-align: top; }
  th { background: #eee; font-size: 11px; }
  td.num, th.num { text-align: ${end}; direction: ltr; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.acc { font-weight: 700; }
  tfoot td { border: none; border-bottom: 1px solid #ddd; padding: 4px 7px; font-weight: 700; }
  .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
  .para { margin: 10px 0; font-size: 11.5px; }
  .para b { display: inline-block; min-width: 110px; }
  .chk { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px 14px; margin: 4px 0; font-size: 11px; }
  .pdsg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
  .pdsg div { border: 1px solid #bbb; border-radius: 6px; padding: 8px 10px; min-height: 76px; }
  .pdsg small { color: #666; display: block; font-size: 10.5px; }
  .pdsg b { display: block; }
  .pdsg .line { border-bottom: 1px dashed #666; height: 26px; margin-top: 8px; font-size: 9.5px; color: #888; }
  .pdsg img { max-height: 40px; display: block; margin-top: 4px; }
  .pdf2 { margin-top: 18px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 9.5px; color: #666; line-height: 1.7; }
  .muted { color: #666; }
  `
}

function companyBlock(c: ReceiptPrintCompany, t: ReceiptPrintCopy): string {
  const bits: string[] = []
  if (c.cr) bits.push(`${e(t("cr"))} <span class="ltr">${e(c.cr)}</span>`)
  if (c.vat) bits.push(`${e(t("vat_no"))} <span class="ltr">${e(c.vat)}</span>`)
  const contact = [c.phone ? `<span class="ltr">${e(c.phone)}</span>` : "", c.email ? `<span class="ltr">${e(c.email)}</span>` : ""].filter(Boolean).join(" · ")
  return `<div class="pdco"><b>${e(c.name || "—")}</b>${bits.length ? `<div>${bits.join(" · ")}</div>` : ""}${c.address ? `<div>${e(c.address)}</div>` : ""}${contact ? `<div>${contact}</div>` : ""}</div>`
}

const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0)

/** The document's body — pure. */
export function buildReceiptPrintHtml(m: ReceiptPrintInput): string {
  const { delivery: d, po, t, tp, locale } = m
  const lines = receiptLinesOf(d)
  const noPo = !po && !d.poId
  const outstanding = po ? po.lines.filter((l) => lineToArrive(l) > 0) : []
  const complete = po ? outstanding.length === 0 : null
  const when = d.confirmedAt || d.deliveryDate || null
  const sub = `${e(m.displayNumber)} · ${longDate(when, locale)}${timeOf(when, locale) ? ` — ${timeOf(when, locale)}` : ""}`

  const banner = noPo
    ? `<div class="pdst w">${e(t("status_no_po"))}</div>`
    : complete
      ? `<div class="pdst g">${e(t("status_final"))}</div>`
      : `<div class="pdst w">${e(t("status_partial", { list: outstanding.map((l) => `${figure(lineToArrive(l))} ${l.unit} ${l.name}`).join("، ") }))}</div>`

  const grid = noPo
    ? `<div class="pdg">
        <div><small>${e(t("supplier_as_written"))}</small><b>${e(d.supplierName || "—")}</b><span>${e(t("not_registered"))}</span></div>
        <div><small>${e(t("reference"))}</small><b>${d.paperNoteNumber ? `<span class="ltr">${e(d.paperNoteNumber)}</span>` : "—"}</b><span>${e(t("no_purchase_order"))}</span></div>
        <div><small>${e(t("place"))}</small><b>${e(m.placeName || t("general_stock"))}</b>${m.projectName ? `<span>${e(m.projectName)}</span>` : ""}</div>
      </div>`
    : `<div class="pdg">
        <div><small>${e(t("supplier"))}</small><b>${e(po?.supplierName || d.supplierName || "—")}</b></div>
        <div><small>${e(t("po_and_notice"))}</small><b><span class="ltr">${e(m.displayPoNumber || d.poNumber || "—")}</span></b><span>${d.noNotice ? e(t("no_prior_notice")) : d.paperNoteNumber ? `${e(t("paper_note"))} <span class="ltr">${e(d.paperNoteNumber)}</span>` : ""}${po?.rfqTitle ? `<br>${e(t("from_rfq"))} ${e(po.rfqTitle)}` : ""}</span></div>
        <div><small>${e(t("place_project"))}</small><b>${e(m.placeName || t("general_stock"))}</b>${m.projectName ? `<span>${e(m.projectName)}</span>` : ""}</div>
      </div>`

  const priced = new Map(po ? po.lines.map((l) => [l.id, l]) : [])
  const withPrices = m.withPrices && po != null && po.lines.every((l) => l.unitPrice != null)
  const rows = lines
    .map((l: DeliveryLine, i) => {
      const pl = priced.get(l.poLineId)
      const acc = l.accepted ?? acceptedOf(l)
      const counted = num(l.counted)
      const value = pl && pl.unitPrice != null ? round2(acc * pl.unitPrice) : null
      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${e(l.name)}</td>
        ${noPo ? "" : `<td class="num">${pl ? figure(num(pl.quantity) - num(pl.cancelled)) : "—"}</td><td class="num">${num(l.noticeQuantity) > 0 ? figure(l.noticeQuantity) : "—"}</td>`}
        <td class="num">${figure(counted)}</td>
        ${noPo ? "" : `<td>${num(l.rejected) > 0 ? `<span class="ltr">${figure(l.rejected)}</span> — ${e(l.rejectReason ? tp(`rejectReason.${l.rejectReason}`) : "")}` : "—"}</td><td>${num(l.held) > 0 ? `<span class="ltr">${figure(l.held)}</span> — ${e(l.holdReason ? tp(`holdReason.${l.holdReason}`) : "")}` : "—"}</td>`}
        <td class="num acc">${figure(acc)}</td>
        <td>${e(l.unit || "—")}</td>
        ${withPrices ? `<td class="num">${value == null ? "—" : figure(value)}</td>` : ""}
      </tr>`
    })
    .join("")
  const total = withPrices ? round2(lines.reduce((s, l) => s + (l.accepted ?? acceptedOf(l)) * num(priced.get(l.poLineId)?.unitPrice), 0)) : null
  const cols = noPo ? 5 : 9
  const table = `<table>
    <thead><tr><th class="num">#</th><th>${e(t("col_description"))}</th>${noPo ? "" : `<th class="num">${e(t("col_on_po"))}</th><th class="num">${e(t("col_per_notice"))}</th>`}<th class="num">${e(t("col_counted"))}</th>${noPo ? "" : `<th>${e(t("col_rejected"))}</th><th>${e(t("col_held"))}</th>`}<th class="num">${e(t("col_accepted"))}</th><th>${e(t("col_unit"))}</th>${withPrices ? `<th class="num">${e(t("col_value"))}</th>` : ""}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${cols}" class="muted">—</td></tr>`}</tbody>
    ${withPrices && total != null ? `<tfoot><tr><td colspan="${cols}">${e(t("accepted_value"))}</td><td class="num">${e(sar(total, locale))}</td></tr></tfoot>` : ""}
  </table>`

  const checks = (d.checklist || []) as ReceiptCheck[]
  const checklist = noPo
    ? ""
    : `<div class="para"><b>${e(t("checklist"))}</b><div class="chk">${RECEIPT_CHECKS.map((c) => `<div>${checks.includes(c) ? "☑" : "☐"} ${e(tp(`checklist.${c}`))}</div>`).join("")}</div></div>`
  const driver = `<div class="para"><b>${e(t("driver_vehicle"))}</b> ${e(d.deliveryPersonName || "—")}${d.vehiclePlate ? ` · <span class="ltr">${e(d.vehiclePlate)}</span>` : ""}</div>`
  const note = d.receiptNote || d.notes ? `<div class="para"><b>${e(noPo ? t("reason_outside") : t("receiver_note"))}</b> ${e(d.receiptNote || d.notes || "")}</div>` : ""

  const sig = (caption: string, name: string, extra: string, image?: string | null) =>
    `<div><small>${e(caption)}</small><b>${e(name || "—")}</b>${extra ? `<span class="muted">${e(extra)}</span>` : ""}${image ? `<img src="${e(image)}" alt="">` : `<div class="line">${e(t("signature"))}</div>`}</div>`
  const receivedLine = `${d.selfReceived ? t("self_received") : t("received_by_role")} · ${longDate(when, locale)} ${timeOf(when, locale)}`.trim()
  const signatures = `<div class="pdsg">
    ${sig(t("sig_supplier"), po?.supplierName || d.supplierName || "", d.deliveryPersonName || "", (d as { supplierSignatureData?: string | null }).supplierSignatureData)}
    ${sig(t("sig_receiver"), d.receivedByName || "", receivedLine, d.receiverSignatureData || (d as { contractorSignatureData?: string | null }).contractorSignatureData)}
    ${sig(t("sig_procurement"), po?.preparedByName || "", "")}
  </div>`

  const footerExtra = noPo ? t("footer_no_po") : t("footer_accepted_only")
  const footer = `<div class="pdf2"><div>${e(footerExtra)}</div><div>${e(t("footer", { company: m.company.name || "—", date: longDate(m.now.toISOString(), locale) }))}</div></div>`

  return `<div class="pdh"><div><h1>${e(noPo ? t("title_no_po") : t("title"))}</h1><div class="sub">${sub}</div></div>${companyBlock(m.company, t)}</div>
    ${banner}${grid}${table}${checklist}${driver}${note}${signatures}${footer}`
}

/** Open the document in its own window; false when the browser blocked the pop-up. */
export function printGoodsReceipt(m: ReceiptPrintInput): boolean {
  const dir: "rtl" | "ltr" = m.locale === "ar" ? "rtl" : "ltr"
  const w = window.open("", "_blank", "width=1000,height=760")
  if (!w) return false
  w.document.write(`<!doctype html><html dir="${dir}" lang="${e(m.locale)}"><head><meta charset="utf-8"><title>${e(m.displayNumber)}</title><style>${RECEIPT_PRINT_CSS(dir)}</style></head><body><div class="pd">${buildReceiptPrintHtml(m)}</div><script>window.onload = function () { window.print() }</script></body></html>`)
  w.document.close()
  return true
}

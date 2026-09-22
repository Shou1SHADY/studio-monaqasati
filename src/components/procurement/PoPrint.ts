// The two printed documents of a purchase order (PRD 3.0 §8): the order
// itself and its receipt statement. A self-contained window, like the
// accounting statements — the portal's chrome never reaches the paper, and
// "Save as PDF" names the file after the document. Every interpolated value
// goes through escapeHtml: names and notes are user text. Money is written
// "ر.س" / "SAR" — the riyal glyph's font is not in this window.

import { escapeHtml } from "@/components/accounting/print"
import { figure, quantityText, sarPlain, type PoPrintModel, type StatementModel } from "./PoModel"

/** `Portal.ProcOrders.print.*`, already scoped by the caller. */
export type PrintCopy = (key: string, params?: Record<string, string | number>) => string

const e = escapeHtml

function longDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—"
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return e(iso)
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { year: "numeric", month: "long", day: "numeric" })
}

const CSS = (dir: "rtl" | "ltr") => {
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
  .pdst.m { background: #f1f1f1; color: #444; }
  .pdg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0 14px; }
  .pdg div { border: 1px solid #bbb; border-radius: 6px; padding: 7px 9px; min-height: 58px; }
  .pdg small { color: #666; display: block; font-size: 10.5px; }
  .pdg b { display: block; font-size: 12.5px; }
  .pdg span { font-size: 11px; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #999; padding: 5px 7px; text-align: ${start}; vertical-align: top; }
  th { background: #eee; font-size: 11px; }
  td.num, th.num { text-align: ${end}; direction: ltr; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { border: none; border-bottom: 1px solid #ddd; padding: 4px 7px; }
  tfoot tr.tot td { font-weight: 700; }
  .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
  .clause { margin: 12px 0; padding: 8px 10px; border: 1px dashed #999; border-radius: 6px; font-size: 11px; }
  .pdsg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
  .pdsg div { border: 1px solid #bbb; border-radius: 6px; padding: 8px 10px; min-height: 76px; }
  .pdsg small { color: #666; display: block; font-size: 10.5px; }
  .pdsg b { display: block; }
  .pdsg .line { border-bottom: 1px dashed #666; height: 26px; margin-top: 8px; font-size: 9.5px; color: #888; }
  .pdf2 { margin-top: 18px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 9.5px; color: #666; line-height: 1.7; }
  .empty { text-align: center; color: #666; }
  .muted { color: #666; }
  `
}

function openWindow(title: string, dir: "rtl" | "ltr", lang: string, body: string): boolean {
  const w = window.open("", "_blank", "width=1000,height=760")
  if (!w) return false
  w.document.write(`<!doctype html><html dir="${dir}" lang="${e(lang)}"><head><meta charset="utf-8"><title>${e(title)}</title><style>${CSS(dir)}</style></head><body><div class="pd">${body}</div><script>window.onload = function () { window.print() }</script></body></html>`)
  w.document.close()
  return true
}

function companyBlock(c: PoPrintModel["company"], t: PrintCopy): string {
  const bits: string[] = []
  if (c.cr) bits.push(`${e(t("cr"))} <span class="ltr">${e(c.cr)}</span>`)
  if (c.vat) bits.push(`${e(t("vat_no"))} <span class="ltr">${e(c.vat)}</span>`)
  const contact = [c.phone ? `<span class="ltr">${e(c.phone)}</span>` : "", c.email ? `<span class="ltr">${e(c.email)}</span>` : ""].filter(Boolean).join(" · ")
  return `<div class="pdco"><b>${e(c.name || "—")}</b>${bits.length ? `<div>${bits.join(" · ")}</div>` : ""}${c.address ? `<div>${e(c.address)}</div>` : ""}${contact ? `<div>${contact}</div>` : ""}</div>`
}

function footer(t: PrintCopy, locale: string, company: string, printedAt: string, extra?: string): string {
  return `<div class="pdf2">${extra ? `<div>${e(extra)}</div>` : ""}<div>${e(t("footer", { company: company || "—", date: longDate(printedAt, locale) }))}</div></div>`
}

// ---------------------------------------------------------------------------
// The purchase order
// ---------------------------------------------------------------------------

export function printPurchaseOrder(m: PoPrintModel, displayNumber: string, locale: string, t: PrintCopy, now = new Date()): boolean {
  const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr"
  const banner =
    m.status === "cancelled"
      ? `<div class="pdst m">${e(t("po_status_cancelled"))}</div>`
      : m.status === "awaiting_approval"
        ? `<div class="pdst w">${e(t("po_status_draft"))}</div>`
        : `<div class="pdst g">${e(t("po_status_approved", { by: m.approvedBy || m.preparedBy, date: longDate(m.approvedAt, locale) }))}</div>`

  const rows = m.lines
    .map(
      (l) =>
        `<tr><td class="num">${l.index}</td><td>${e(l.name)}</td><td class="num">${figure(l.quantity)}</td><td>${e(l.unit || "—")}</td>${
          m.withPrices ? `<td class="num">${l.unitPrice == null ? "—" : figure(l.unitPrice)}</td><td class="num">${l.total == null ? "—" : figure(l.total)}</td>` : ""
        }</tr>`
    )
    .join("")

  const foot = m.withPrices
    ? `<tfoot>
        ${m.lumpSum ? `<tr><td colspan="6" class="muted">${e(t("lump_sum_note"))}</td></tr>` : ""}
        <tr><td colspan="5">${e(t("subtotal"))}</td><td class="num">${figure(m.exVat)}</td></tr>
        <tr><td colspan="5">${e(t("vat_line", { rate: Math.round(m.vatRate * 100) }))}</td><td class="num">${figure(m.vat)}</td></tr>
        <tr class="tot"><td colspan="5">${e(t("total_incl"))}</td><td class="num">${e(sarPlain(m.total, locale))}</td></tr>
      </tfoot>`
    : `<tfoot><tr><td colspan="4" class="muted">${e(t("no_values_copy"))}</td></tr></tfoot>`

  const payment = m.paymentTerms ? e(m.paymentTerms) : e(t("terms_as_offer"))
  const delivery = [m.promisedDate ? `<b>${longDate(m.promisedDate, locale)}</b>` : m.leadTimeDays ? `<b>${e(t("lead_days", { days: m.leadTimeDays }))}</b>` : `<b>${e(t("date_on_acceptance"))}</b>`, m.deliveryLocation ? `<span>${e(m.deliveryLocation)}</span>` : ""].join("")

  const body = `
    <div class="pdh">
      <div><h1>${e(t("po_title"))}</h1><div class="sub"><span class="ltr">${e(displayNumber)}</span> · ${longDate(m.date, locale)}</div><div class="sub">${e(t(`basis_${m.basis}`))}</div></div>
      ${companyBlock(m.company, t)}
    </div>
    ${banner}
    <div class="pdg">
      <div><small>${e(t("to_supplier"))}</small><b>${e(m.supplierName || "—")}</b>${m.projectName ? `<span>${e(t("project"))}: ${e(m.projectName)}</span>` : ""}</div>
      <div><small>${e(t("delivery"))}</small>${delivery}</div>
      <div><small>${e(t("payment"))}</small><b>${payment}</b></div>
    </div>
    ${m.title ? `<div class="muted">${e(t("subject"))}: ${e(m.title)}</div>` : ""}
    <table>
      <thead><tr><th class="num">#</th><th>${e(t("col_description"))}</th><th class="num">${e(t("col_qty"))}</th><th>${e(t("col_unit"))}</th>${m.withPrices ? `<th class="num">${e(t("col_unit_price"))}</th><th class="num">${e(t("col_total"))}</th>` : ""}</tr></thead>
      <tbody>${rows}</tbody>
      ${foot}
    </table>
    <div class="clause">${e(t("po_clause"))}</div>
    <div class="pdsg">
      <div><small>${e(t("prepared_by"))}</small><b>${e(m.preparedBy)}</b><span class="muted">${longDate(m.preparedAt, locale)}</span><div class="line">${e(t("signature"))}</div></div>
      <div><small>${e(t("approved_by"))}</small><b>${e(m.approvedBy || "—")}</b><span class="muted">${m.approvedAt ? longDate(m.approvedAt, locale) : ""}${m.selfApproved ? ` · ${e(t("self_approved"))}` : ""}</span><div class="line">${e(t("signature"))}</div></div>
      <div><small>${e(t("supplier_acceptance"))}</small><b>&nbsp;</b><div class="line">${e(t("signature"))}</div></div>
    </div>
    ${footer(t, locale, m.company.name, now.toISOString(), t("po_footer_extra"))}
  `
  return openWindow(`${t("po_title")} ${displayNumber}`, dir, locale, body)
}

// ---------------------------------------------------------------------------
// The receipt statement
// ---------------------------------------------------------------------------

export function printReceiptStatement(m: StatementModel, displayNumber: string, displayReceipt: (n: string) => string, locale: string, t: PrintCopy): boolean {
  const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr"
  const banner = m.complete ? `<div class="pdst g">${e(t("st_complete"))}</div>` : `<div class="pdst w">${e(t("st_incomplete"))}</div>`
  const lines = m.lines
    .map(
      (l) =>
        `<tr><td class="num">${l.index}</td><td>${e(l.name)}</td><td class="num">${figure(l.ordered)}</td><td class="num"><b>${figure(l.accepted)}</b></td><td class="num">${figure(l.rejected)}</td><td class="num">${figure(l.held)}</td><td class="num">${figure(l.cancelled)}</td><td class="num">${figure(l.outstanding)}</td><td>${e(l.unit || "—")}</td></tr>`
    )
    .join("")
  const receipts = m.receipts.length
    ? m.receipts
        .map(
          (r) =>
            `<tr><td><span class="ltr">${e(displayReceipt(r.number))}</span></td><td>${longDate(r.date, locale)}</td><td class="num">${figure(r.accepted)}</td><td class="num">${figure(r.rejected)}</td><td class="num">${figure(r.held)}</td><td>${e(r.receiver || "—")}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="empty">${e(t("st_no_receipts"))}</td></tr>`
  const outstanding = m.outstanding.length ? `<div class="clause">${e(t("st_outstanding", { lines: m.outstanding.map((l) => `${l.name} ${quantityText(l.quantity, l.unit)}`).join("، "), date: m.promisedDate ? longDate(m.promisedDate, locale) : "—" }))}</div>` : ""

  const body = `
    <div class="pdh">
      <div><h1>${e(t("st_title"))}</h1><div class="sub"><span class="ltr">${e(displayNumber)}</span> · ${e(m.supplierName)}</div></div>
      ${companyBlock(m.company, t)}
    </div>
    ${banner}
    <div class="pdg">
      <div><small>${e(t("to_supplier"))}</small><b>${e(m.supplierName || "—")}</b></div>
      <div><small>${e(t("st_order"))}</small><b>${e(t("approved_on"))} ${longDate(m.approvedAt, locale)}</b><span>${e(t("supplier_date"))}: ${m.promisedDate ? longDate(m.promisedDate, locale) : "—"}</span></div>
      <div><small>${e(t("st_destination"))}</small><b>${e(m.deliveryLocation || "—")}</b>${m.projectName ? `<span>${e(m.projectName)}</span>` : ""}</div>
    </div>
    <table>
      <thead><tr><th class="num">#</th><th>${e(t("col_description"))}</th><th class="num">${e(t("st_col_ordered"))}</th><th class="num">${e(t("st_col_accepted"))}</th><th class="num">${e(t("st_col_rejected"))}</th><th class="num">${e(t("st_col_held"))}</th><th class="num">${e(t("st_col_cancelled"))}</th><th class="num">${e(t("st_col_outstanding"))}</th><th>${e(t("col_unit"))}</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
    <h3 style="margin:16px 0 4px;font-size:13px">${e(t("st_receipts"))}</h3>
    <table>
      <thead><tr><th>${e(t("st_col_receipt"))}</th><th>${e(t("st_col_date"))}</th><th class="num">${e(t("st_col_accepted"))}</th><th class="num">${e(t("st_col_rejected"))}</th><th class="num">${e(t("st_col_held"))}</th><th>${e(t("st_col_receiver"))}</th></tr></thead>
      <tbody>${receipts}</tbody>
    </table>
    ${outstanding}
    <div class="pdsg">
      <div><small>${e(t("supplier_rep"))}</small><b>&nbsp;</b><div class="line">${e(t("signature"))}</div></div>
      <div><small>${e(t("buyer"))}</small><b>&nbsp;</b><div class="line">${e(t("signature"))}</div></div>
      <div><small>${e(t("proc_manager"))}</small><b>&nbsp;</b><div class="line">${e(t("signature"))}</div></div>
    </div>
    ${footer(t, locale, m.company.name, m.printedAt, m.complete ? t("st_footer_final") : t("st_footer_interim"))}
  `
  return openWindow(`${t("st_title")} ${displayNumber}`, dir, locale, body)
}

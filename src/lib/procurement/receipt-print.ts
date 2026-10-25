// The printed goods receipt (PRD 2.0 RCV-04): a unified header with the company's
// identity, a status banner — final when nothing is left open on the order,
// partial with what is outstanding, "no PO — manual" for a receipt with no
// order — the quantity table (on order · counted · rejected · held · accepted ·
// unit, value only for a reader who sees prices), the checklist and the footer.
// DIGITAL: no signature boxes — one line says who registered it, when, and how
// (signed in or by code), because confirming is the signature. Bilingual through
// the caller's translator, A4, self-contained window. Money is written
// "ر.س"/"SAR": the riyal glyph's font is not in this window.
//
// `buildReceiptPrintHtml` is pure (tested); `printGoodsReceipt` opens it.

import { escapeHtml } from "@/components/accounting/print"
import { acceptedOf, lineToArrive, round2 } from "./po"
import type { DeliveryLine, PurchaseOrder, ReceiptCheck } from "./types"
import type { DeskDelivery } from "./receipt-desk"
import { noPoInvoiceValue, receiptLinesOf } from "./receipt-desk"
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

/** The supplier's identity as the paper prints it — whatever of it we know. */
export interface SupplierIdentity {
  cr: string | null
  vat: string | null
  city: string | null
  phone: string | null
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null)

/** A supplier's profile (a user or a secondary company) read as its identity. */
export function supplierIdentityOf(profile: Record<string, unknown> | null | undefined, vatFallback?: string | null): SupplierIdentity | null {
  const p = profile || {}
  const id = { cr: str(p.crNumber), vat: str(p.taxNumber) || str(vatFallback), city: str(p.city) || str(p.location), phone: str(p.phone) || str(p.phoneNumber) }
  return id.cr || id.vat || id.city || id.phone ? id : null
}

export interface ReceiptPrintInput {
  delivery: DeskDelivery
  po: PurchaseOrder | null
  company: ReceiptPrintCompany
  /** The supplier's CR, VAT, city and phone, when known (the order's supplier, or the one a no-PO receipt guessed). */
  supplier?: SupplierIdentity | null
  /** Our number for the supplier's notice, already in the reader's script (`displayNoticeNumber`). */
  noticeNumber?: string | null
  /** Where the goods went, resolved by the caller (warehouse name, project). */
  placeName: string | null
  projectName: string | null
  displayNumber: string
  displayPoNumber: string | null
  withPrices: boolean
  /** What is still to arrive on the order, when the caller has no order document to read it from (the receiver's own copy). */
  outstanding?: Array<{ name: string; unit: string; quantity: number }> | null
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
  .trio { margin-top: 16px; }
  .trio div { min-height: 74px; }
  .sgline { border-top: 1px solid #999; margin-top: 18px; padding-top: 3px; font-size: 10px; color: #444; }
  .dig-note { color: #666; font-size: 10.5px; margin-top: 4px; }
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
  const outstanding = po ? po.lines.filter((l) => lineToArrive(l) > 0).map((l) => ({ name: l.name, unit: l.unit, quantity: lineToArrive(l) })) : m.outstanding ?? []
  const complete = po ? outstanding.length === 0 : m.outstanding ? outstanding.length === 0 : null
  const when = d.confirmedAt || d.deliveryDate || null
  const sub = `${e(m.displayNumber)} · ${longDate(when, locale)}${timeOf(when, locale) ? ` — ${timeOf(when, locale)}` : ""}`

  const hasRejects = lines.some((l) => num(l.rejected) > 0)
  const partial = `<div class="pdst w">${e(t("status_partial", { list: outstanding.map((l) => `${figure(l.quantity)} ${l.unit} ${l.name}`).join("، ") }))}</div>`
  const banner = noPo
    ? `<div class="pdst w">${e(t("status_no_po"))}</div>`
    : hasRejects
      ? `<div class="pdst w">${e(t("status_rejected"))}</div>${complete ? `<div class="pdst g">${e(t("status_final"))}</div>` : partial}`
      : complete
        ? `<div class="pdst g">${e(t("status_matched"))} — ${e(t("status_final"))}</div>`
        : partial

  const idLine = (cr: string | null | undefined, vat: string | null | undefined) =>
    `${e(t("cr"))} <span class="ltr">${e(cr || "—")}</span> · ${e(t("vat_no"))} <span class="ltr">${e(vat || "—")}</span>`
  const sup = m.supplier || null
  const stored = d as { supplierCrNumber?: string | null; supplierVatNumber?: string | null }
  // A no-PO receipt prints the CR/VAT typed on it; else those of the registered supplier it names; else says it is not registered.
  const noPoIdentity =
    stored.supplierCrNumber || stored.supplierVatNumber ? idLine(stored.supplierCrNumber, stored.supplierVatNumber) : sup && (sup.cr || sup.vat) ? idLine(sup.cr, sup.vat) : e(t("not_registered"))
  const place = [sup?.city ? e(sup.city) : "", sup?.phone ? `<span class="ltr">${e(sup.phone)}</span>` : ""].filter(Boolean).join(" · ")
  const noticeBits = d.noNotice
    ? e(t("no_prior_notice"))
    : [m.noticeNumber ? `<bdi>${e(m.noticeNumber)}</bdi>` : "", d.paperNoteNumber ? `${e(t("paper_note"))} <span class="ltr">${e(d.paperNoteNumber)}</span>` : ""].filter(Boolean).join(" · ")
  const grid = noPo
    ? `<div class="pdg">
        <div><small>${e(t("supplier_as_written"))}</small><b>${e(d.supplierName || "—")}</b><span>${noPoIdentity}</span></div>
        <div><small>${e(t("notice_or_invoice"))}</small><b>${d.invoiceNumber || d.paperNoteNumber ? `<span class="ltr">${e(d.invoiceNumber || d.paperNoteNumber || "")}</span>` : "—"}</b><span>${e(t(d.after === "later" ? "after_later" : d.after === "cash" ? "after_cash" : "no_purchase_order"))}</span></div>
        <div><small>${e(t("place"))}</small><b>${e(m.placeName || t("general_stock"))}</b>${m.projectName ? `<span>${e(m.projectName)}</span>` : ""}</div>
      </div>`
    : `<div class="pdg">
        <div><small>${e(t("supplier"))}</small><b>${e(po?.supplierName || d.supplierName || "—")}</b>${sup ? `<span>${idLine(sup.cr, sup.vat)}</span>` : ""}${place ? `<span>${place}</span>` : ""}</div>
        <div><small>${e(t("po_and_notice"))}</small><b><span class="ltr">${e(m.displayPoNumber || d.poNumber || "—")}</span></b><span>${noticeBits}${po?.rfqTitle ? `<br>${e(t("from_rfq"))} ${e(po.rfqTitle)}` : ""}</span></div>
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
        ${noPo ? "" : `<td class="num">${pl ? figure(num(pl.quantity) - num(pl.cancelled)) : "—"}</td>`}
        <td class="num">${figure(counted)}</td>
        ${noPo ? "" : `<td>${num(l.rejected) > 0 ? `<span class="ltr">${figure(l.rejected)}</span> — ${e(l.rejectReason ? tp(`rejectReason.${l.rejectReason}`) : "")}` : "—"}</td><td>${num(l.held) > 0 ? `<span class="ltr">${figure(l.held)}</span> — ${e(l.holdReason ? tp(`holdReason.${l.holdReason}`) : "")}` : "—"}</td>`}
        <td class="num acc">${figure(acc)}</td>
        <td>${e(l.unit || "—")}</td>
        ${withPrices ? `<td class="num">${value == null ? "—" : figure(value)}</td>` : ""}
      </tr>`
    })
    .join("")
  const total = withPrices ? round2(lines.reduce((s, l) => s + (l.accepted ?? acceptedOf(l)) * num(priced.get(l.poLineId)?.unitPrice), 0)) : null
  const cols = noPo ? 5 : 8
  // A no-PO receipt prints what was typed from the shop invoice — its unit prices and total, for a reader who sees prices.
  const typed = (d.items || []).filter((it) => it.name)
  const typedPriced = m.withPrices && typed.some((it) => it.unitPrice != null && Number.isFinite(Number(it.unitPrice)))
  const noPoTable = `<table>
    <thead><tr><th class="num">#</th><th>${e(t("col_description"))}</th><th class="num">${e(t("col_qty"))}</th><th>${e(t("col_unit"))}</th>${typedPriced ? `<th class="num">${e(t("col_unit_price"))}</th><th class="num">${e(t("col_value"))}</th>` : ""}</tr></thead>
    <tbody>${
      typed
        .map((it, i) => {
          const q = num(it.quantity)
          const p = it.unitPrice != null && Number.isFinite(Number(it.unitPrice)) ? Number(it.unitPrice) : null
          return `<tr><td class="num">${i + 1}</td><td>${e(it.name || "")}</td><td class="num">${figure(q)}</td><td>${e(it.unitOfMeasure || it.unit || "—")}</td>${typedPriced ? `<td class="num">${p == null ? "—" : figure(p)}</td><td class="num">${p == null ? "—" : figure(round2(q * p))}</td>` : ""}</tr>`
        })
        .join("") || `<tr><td colspan="${typedPriced ? 6 : 4}" class="muted">—</td></tr>`
    }</tbody>
    ${typedPriced ? `<tfoot><tr><td colspan="5">${e(t("invoice_as_received"))}</td><td class="num">${e(sar(noPoInvoiceValue(d) ?? 0, locale))}</td></tr></tfoot>` : ""}
  </table>`
  const table = noPo ? noPoTable : `<table>
    <thead><tr><th class="num">#</th><th>${e(t("col_description"))}</th>${noPo ? "" : `<th class="num">${e(t("col_on_po"))}</th>`}<th class="num">${e(t("col_counted"))}</th>${noPo ? "" : `<th>${e(t("col_rejected"))}</th><th>${e(t("col_held"))}</th>`}<th class="num">${e(t("col_accepted"))}</th><th>${e(t("col_unit"))}</th>${withPrices ? `<th class="num">${e(t("col_value"))}</th>` : ""}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${cols}" class="muted">—</td></tr>`}</tbody>
    ${withPrices && total != null ? `<tfoot><tr><td colspan="${cols}">${e(t("accepted_value"))}</td><td class="num">${e(sar(total, locale))}</td></tr></tfoot>` : ""}
  </table>`

  const checks = (d.checklist || []) as ReceiptCheck[]
  const checklist = noPo
    ? ""
    : `<div class="para"><b>${e(t("checklist"))}</b><div class="chk">${RECEIPT_CHECKS.map((c) => `<div>${checks.includes(c) ? "☑" : "☐"} ${e(tp(`checklist.${c}`))}</div>`).join("")}</div></div>`
  const driver = `<div class="para"><b>${e(t("driver_vehicle"))}</b> ${e(d.deliveryPersonName || "—")}${d.vehiclePlate ? ` · <span class="ltr">${e(d.vehiclePlate)}</span>` : ""}</div>`
  const fw = d.forwardedTo || null
  const forwarded = fw
    ? `<div class="para"><b>${e(t(fw.auto ? "forwarded_title_auto" : "forwarded_title"))}</b> ${e(fw.name)}${fw.userId ? "" : ` — ${e(t("forwarded_by_link"))} <span class="ltr">${e(fw.phoneMasked)}</span>`} · ${e(fw.auto ? t("forwarded_by_auto") : t("forwarded_by", { name: fw.byName }))}</div>`
    : ""
  const invoiceValue = m.withPrices && !typedPriced && d.invoiceValue != null && Number.isFinite(Number(d.invoiceValue)) ? `<div class="para"><b>${e(t("invoice_as_received"))}:</b> ${e(sar(Number(d.invoiceValue), locale))}</div>` : ""
  const note = d.receiptNote || d.notes ? `<div class="para"><b>${e(noPo ? t("reason_outside") : t("receiver_note"))}</b> ${e(d.receiptNote || d.notes || "")}</div>` : ""

  const when2 = `${longDate(when, locale)} ${timeOf(when, locale)}`.trim()
  const manual = d.source === "manual"
  const via = manual ? t("via_manual") : d.confirmedVia === "login" || d.receiverReport?.verifiedBy === "login" ? t("via_login") : t("via_code")
  const who = manual ? d.confirmedByName || d.receivedByName || "—" : d.receivedByName || "—"
  const recordedLabel = manual ? t("registered_by_procurement") : d.selfReceived ? t("self_received") : t("registered_by")
  const digital = `<div class="pdg trio">
    <div><small>${e(recordedLabel)}</small><b>${e(who)}</b><div class="sgline">${e(t("sig_confirmed"))}</div><div class="dig-note">${e(when2)} · ${e(via)}</div></div>
    <div><small>${e(t("sig_buyer"))}</small><b>${e(po?.preparedByName || "—")}</b><div class="sgline">${e(t("sig_reviewed"))}</div></div>
    <div><small>${e(t("supplier"))}</small><b>${e(po?.supplierName || d.supplierName || "—")}</b><div class="sgline">${e(t("sig_copy"))}</div></div>
  </div><div class="dig-note">${e(t("no_signature_note"))}</div>`

  const footerExtra = noPo ? t("footer_no_po") : t("footer_accepted_only")
  const footer = `<div class="pdf2"><div>${e(footerExtra)}</div><div>${e(t("footer", { company: m.company.name || "—", date: longDate(m.now.toISOString(), locale) }))}</div></div>`

  return `<div class="pdh"><div><h1>${e(noPo ? t("title_no_po") : t("title"))}</h1><div class="sub">${sub}</div></div>${companyBlock(m.company, t)}</div>
    ${banner}${grid}${table}${invoiceValue}${checklist}${driver}${forwarded}${note}${digital}${footer}`
}

/** The whole self-contained page: its own styles, A4, and — when it is meant to be printed at once — the print dialog on load. */
export function receiptDocumentHtml(m: ReceiptPrintInput, opts: { autoPrint: boolean } = { autoPrint: true }): string {
  const dir: "rtl" | "ltr" = m.locale === "ar" ? "rtl" : "ltr"
  return `<!doctype html><html dir="${dir}" lang="${e(m.locale)}"><head><meta charset="utf-8"><title>${e(m.displayNumber)}</title><style>${RECEIPT_PRINT_CSS(dir)}</style></head><body><div class="pd">${buildReceiptPrintHtml(m)}</div>${opts.autoPrint ? "<script>window.onload = function () { window.print() }</script>" : ""}</body></html>`
}

/** Open the document in its own window; false when the browser blocked the pop-up. */
export function printGoodsReceipt(m: ReceiptPrintInput): boolean {
  const w = window.open("", "_blank", "width=1000,height=760")
  if (!w) return false
  w.document.write(receiptDocumentHtml(m))
  w.document.close()
  return true
}

/** What the receiver's page keeps of the receipt it just made, enough to print it without signing in (the server returns it). */
export interface ReceiptPrintFacts {
  docNumber: string
  supplierName: string
  poNumber: string | null
  rfqTitle: string
  receiverName: string
  at: string
  lines: DeliveryLine[]
  placeName: string | null
  selfReceived: boolean
  companyName: string
  via: "login" | "sms_code"
  /** The order has nothing left to arrive after this receipt; null when there is no order. */
  complete: boolean | null
  remaining: Array<{ name: string; unit: string; quantity: number }>
}

/** The printable input for a receipt known only by its facts — the receiver's «PDF» on the done screen. */
export function receiptPrintInputFromFacts(f: ReceiptPrintFacts, m: Pick<ReceiptPrintInput, "locale" | "displayNumber" | "displayPoNumber" | "t" | "tp" | "now">): ReceiptPrintInput {
  const delivery: DeskDelivery = {
    id: f.docNumber,
    status: "confirmed",
    docNumber: f.docNumber,
    poId: f.poNumber ? "order" : null,
    poNumber: f.poNumber,
    supplierName: f.supplierName,
    rfqTitle: f.rfqTitle,
    lines: f.lines,
    receivedByName: f.receiverName,
    confirmedAt: f.at,
    deliveryDate: f.at.slice(0, 10),
    selfReceived: f.selfReceived,
    confirmedVia: f.via,
  }
  return { ...m, delivery, po: null, company: { name: f.companyName }, placeName: f.placeName, projectName: null, withPrices: false, outstanding: f.complete === false ? f.remaining : f.complete === true ? [] : null }
}

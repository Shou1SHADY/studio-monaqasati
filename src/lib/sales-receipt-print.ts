// The printed receipt voucher (سند قبض, 11 Oct 2026): the company's identity, the voucher's number and date, who paid,
// the amount in figures and in words, what it pays for, how it was paid, and two signature boxes. Bilingual through the
// caller's translator, A4, a self-contained window. Money is written "ر.س"/"SAR": the riyal glyph's font is not in
// this window.
//
// `buildReceiptVoucherHtml` is pure (tested); `printReceiptVoucher` opens it.

import { escapeHtml as e, openPrintWindow } from "@/components/accounting/print"
import { amountInWords } from "./amount-in-words"
import type { QuotationBranding } from "./crm"
import { displayDocNumber } from "./sales-numbering"
import type { ReceiptVoucher } from "./sales-receipts"

export type VoucherCopy = (key: string, params?: Record<string, string | number>) => string

const money = (amount: number, locale: string) =>
  `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${locale === "ar" ? "ر.س" : "SAR"}`

const longDate = (iso: string, locale: string) =>
  new Date(iso).toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric" })

export function buildReceiptVoucherHtml(v: ReceiptVoucher, branding: QuotationBranding, locale: string, t: VoucherCopy): string {
  const ltr = (s: string) => `<span dir="ltr">${e(s)}</span>`
  const ids = [branding.crNumber && `${t("rv_cr")} ${ltr(branding.crNumber)}`, branding.vatNumber && `${t("rv_vat")} ${ltr(branding.vatNumber)}`].filter(Boolean).join(" · ")
  const contact = [branding.address, branding.phone && ltr(branding.phone), branding.email && ltr(branding.email)].filter(Boolean).join(" · ")
  const row = (label: string, value: string) => `<tr><th>${e(label)}</th><td>${value}</td></tr>`
  return `
<div class="head">
  <div>
    <h1>${e(t("rv_title"))}</h1>
    <div class="muted">${e(t("rv_number"))} ${ltr(displayDocNumber(v.receiptNumber, locale))} · ${e(longDate(v.date, locale))}</div>
  </div>
  <div style="text-align:end">
    ${branding.logoUrl ? `<img src="${e(branding.logoUrl)}" alt="" style="max-height:56px;max-width:180px">` : ""}
    <div><b>${e(branding.companyName || "—")}</b></div>
    ${ids ? `<div class="muted">${ids}</div>` : ""}
    ${contact ? `<div class="muted">${contact}</div>` : ""}
  </div>
</div>
<table>
  ${row(t("rv_received_from"), e(v.contactName || "—"))}
  ${row(t("rv_amount"), `<b>${ltr(money(v.amount, locale))}</b>`)}
  ${row(t("rv_amount_words"), e(amountInWords(v.amount, locale)))}
  ${row(t("rv_for"), `${e(v.installmentLabel)} · ${t("rv_quotation")} ${ltr(displayDocNumber(v.quotationNumber, locale))}`)}
  ${row(t("rv_method"), e(v.method ? t(`rv_method_${v.method}`) : "—"))}
  ${v.reference ? row(t("rv_reference"), ltr(v.reference)) : ""}
  ${v.note ? row(t("rv_note"), e(v.note)) : ""}
</table>
<div class="foot">
  <div class="sign">${e(t("rv_received_by"))}<br><b>${e(v.receivedBy || "—")}</b></div>
  <div class="sign">${e(t("rv_stamp"))}</div>
</div>`
}

/** Open the voucher in its own window; false when the browser blocked the pop-up. */
export function printReceiptVoucher(v: ReceiptVoucher, branding: QuotationBranding, locale: string, t: VoucherCopy): boolean {
  return openPrintWindow({
    title: displayDocNumber(v.receiptNumber, locale),
    dir: locale === "ar" ? "rtl" : "ltr",
    bodyHtml: buildReceiptVoucherHtml(v, branding, locale, t),
  })
}

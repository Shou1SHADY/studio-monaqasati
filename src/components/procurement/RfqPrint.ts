// The RFQ as a printable document (R-39, prototype `printRFQ`): for a supplier
// who is not on the platform — the lines with blank price columns, the price
// basis / lead time / terms to fill in, and a stamp block. A self-contained
// window like the order's print; every value goes through escapeHtml.

import { escapeHtml } from "@/components/accounting/print"
import type { ProcurementPolicies } from "@/lib/procurement/types"

export type RfqPrintCopy = (key: string, params?: Record<string, string | number>) => string

export interface RfqPrintModel {
  number: string
  title: string
  issuedAt: string | null
  deadline: string | null
  directAward: boolean
  city: string
  contact: string
  company: { name: string; vat: string | null; cr: string | null }
  lines: Array<{ name: string; spec: string | null; quantity: number; unit: string; needBy: string | null }>
  notes: string | null
  warranty: boolean
  /** The org seals prices until the deadline — only then may the document promise it. */
  sealed: boolean
  /** The guest link a supplier off the platform quotes through, when one exists. */
  guestUrl?: string | null
}

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
  .pdco { text-align: ${end}; font-size: 11px; line-height: 1.7; }
  .pdco b { font-size: 13px; display: block; }
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
  td.num { text-align: ${end}; direction: ltr; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.blank { min-width: 90px; }
  .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
  .muted { color: #555; }
  .pdf2 { margin-top: 18px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 9.5px; color: #666; line-height: 1.7; }
  `
}

export function printRfq(m: RfqPrintModel, locale: string, t: RfqPrintCopy, now = new Date()): boolean {
  const w = openRfqPrintWindow()
  if (!w) return false
  writeRfqPrint(w, m, locale, t, now)
  return true
}

/** Opened inside the click — a window opened after an await is a popup the browser blocks. */
export const openRfqPrintWindow = (): Window | null => window.open("", "_blank", "width=1000,height=760")

/** The document with the guest link, which is fetched after the window opened. */
export async function printRfqWithLink(m: RfqPrintModel, locale: string, t: RfqPrintCopy, guestUrl: Promise<string | null>, now = new Date()): Promise<boolean> {
  const w = openRfqPrintWindow()
  if (!w) return false
  const url = await guestUrl.catch(() => null)
  writeRfqPrint(w, { ...m, guestUrl: url }, locale, t, now)
  return true
}

export function writeRfqPrint(w: Window, m: RfqPrintModel, locale: string, t: RfqPrintCopy, now = new Date()): void {
  const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr"
  const rows = m.lines
    .map(
      (l, i) =>
        `<tr><td class="num">${i + 1}</td><td>${e(l.name)}${l.spec ? `<br><small class="muted">${e(l.spec)}</small>` : ""}</td><td class="num">${l.quantity.toLocaleString("en-US")}</td><td>${e(l.unit || "—")}</td><td>${l.needBy ? longDate(l.needBy, locale) : "—"}</td><td class="blank"></td><td class="blank"></td></tr>`
    )
    .join("")
  const co = [m.company.cr ? `${e(t("cr"))} <span class="ltr">${e(m.company.cr)}</span>` : "", m.company.vat ? `${e(t("vat"))} <span class="ltr">${e(m.company.vat)}</span>` : ""].filter(Boolean).join(" · ")
  const body = `
    <div class="pdh">
      <div><h1>${e(t("title"))}</h1><div><span class="ltr">${e(m.number)}</span></div><div class="muted">${e(m.title)}</div></div>
      <div class="pdco"><b>${e(m.company.name || "—")}</b>${co ? `<div>${co}</div>` : ""}<div>${e(t("issued"))} ${longDate(m.issuedAt, locale)}</div></div>
    </div>
    <div class="pdg">
      <div><small>${e(t("due"))}</small><b>${m.directAward ? e(t("direct")) : longDate(m.deadline, locale)}</b></div>
      <div><small>${e(t("delivery_to"))}</small><b>${e(m.city || "—")}</b><span>${e(t("address_later"))}</span></div>
      <div><small>${e(t("contact"))}</small><b>${e(m.contact || "—")}</b><span>${e(t("procurement"))}</span></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>${e(t("col_description"))}</th><th>${e(t("col_qty"))}</th><th>${e(t("col_unit"))}</th><th>${e(t("col_need"))}</th><th>${e(t("col_unit_price"))}</th><th>${e(t("col_total"))}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="6">${e(t("subtotal"))}</td><td></td></tr>
        <tr><td colspan="6">${e(t("vat_line"))}</td><td></td></tr>
        <tr><td colspan="6"><b>${e(t("total"))}</b></td><td></td></tr>
      </tfoot>
    </table>
    <div class="pdg">
      <div><small>${e(t("basis"))}</small><b>☐ ${e(t("basis_site"))} &nbsp; ☐ ${e(t("basis_exw"))}</b></div>
      <div><small>${e(t("lead"))}</small><b>____ ${e(t("lead_days"))}</b></div>
      <div><small>${e(t("terms"))}</small><b>________ · ${e(t("until"))} ____</b></div>
    </div>
    ${m.notes || m.warranty ? `<p>${m.notes ? `<b>${e(t("notes"))}:</b> ${e(m.notes)}<br>` : ""}${m.warranty ? e(t("warranty")) : ""}</p>` : ""}
    <p>${e(t("how_to_quote", { sealed: m.sealed ? 1 : 0 }))}</p>
    ${m.guestUrl ? `<p><b>${e(t("guest_link"))}:</b> <span class="ltr">${e(m.guestUrl)}</span></p>` : ""}
    <div class="pdg"><div><small>${e(t("supplier"))}</small><b>&nbsp;</b></div><div><small>${e(t("supplier_vat"))}</small><b>&nbsp;</b></div><div><small>${e(t("stamp"))}</small><b>&nbsp;</b></div></div>
    <div class="pdf2">${e(t("footer", { company: m.company.name || "—", date: longDate(now.toISOString(), locale) }))}</div>
  `
  w.document.write(`<!doctype html><html dir="${dir}" lang="${e(locale)}"><head><meta charset="utf-8"><title>${e(`${t("title")} ${m.number}`)}</title><style>${CSS(dir)}</style></head><body><div class="pd">${body}</div><script>window.onload = function () { window.print() }</script></body></html>`)
  w.document.close()
}

/** The model from a stored RFQ. */
export function rfqPrintModel(
  rfq: {
    rfqNumber?: string | null
    id: string
    title?: string | null
    createdAt?: unknown
    deadline?: string | null
    directAward?: boolean | null
    city?: string | null
    createdByUserName?: string | null
    notes?: string | null
    requiresWarranty?: boolean | null
    needBy?: string | null
    products?: Array<{ name?: string | null; description?: string | null; quantity?: number | string | null; unitOfMeasure?: string | null; unit?: string | null; needBy?: string | null }> | null
  },
  company: RfqPrintModel["company"],
  displayNumber: string,
  cityLabel: string,
  policies: Pick<ProcurementPolicies, "sealOffersUntilDeadline">
): RfqPrintModel {
  const created = typeof rfq.createdAt === "string" ? rfq.createdAt : null
  return {
    sealed: policies.sealOffersUntilDeadline && !rfq.directAward,
    number: displayNumber,
    title: rfq.title || "",
    issuedAt: created,
    deadline: rfq.deadline || null,
    directAward: Boolean(rfq.directAward),
    city: cityLabel,
    contact: rfq.createdByUserName || "",
    company,
    lines: (rfq.products || []).map((p) => ({
      name: p.name || p.description || "",
      spec: p.name && p.description && p.description !== p.name ? p.description : null,
      quantity: Number(p.quantity) || 0,
      unit: p.unitOfMeasure || p.unit || "",
      needBy: p.needBy || rfq.needBy || null,
    })),
    notes: rfq.notes || null,
    warranty: Boolean(rfq.requiresWarranty),
  }
}

"use client"

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatDocumentDate,
  formatDocumentMoney,
  quotationDocumentTotals,
  validityDaysBetween,
  type QuotationSheetData,
} from "@/lib/quotation-document"

/** A width-constrained LTR run for figures inside RTL text. */
function Num({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn("tabular-nums", className)}>
      {children}
    </span>
  )
}

/** One "label: value" line of an identity block; renders nothing when empty. */
function InfoLine({ label, value, ltr = false }: { label: string; value: string | null | undefined; ltr?: boolean }) {
  if (!value || !value.trim()) return null
  return (
    <p className="leading-normal">
      <span className="text-muted-foreground">{label}: </span>
      {ltr ? <Num>{value}</Num> : <span dir="auto">{value}</span>}
    </p>
  )
}

/**
 * The branded A4 quotation (عرض سعر). Pure presentation: the builder feeds it
 * the live form, the detail page a saved quotation, and the same markup is what
 * prints — the browser's "Save as PDF" turns it into the file, so Arabic is
 * shaped by the browser itself rather than a PDF library that cannot join it.
 *
 * On screen it is a fixed 210mm sheet (the builder scales it to its column);
 * in print it drops its own margins and lets `@page` own the paper, so long
 * item lists flow onto more pages with the table header repeated and no row
 * split across a page break.
 */
export function QuotationPdfSheet({ data, className }: { data: QuotationSheetData; className?: string }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const { branding, customer } = data
  const totals = quotationDocumentTotals({
    items: data.items,
    amount: data.amount,
    vatPercent: data.vatPercent,
    installments: data.installments,
  })
  const validityDays = validityDaysBetween(data.date, data.validUntil)
  const money = formatDocumentMoney
  const currency = t("mfg_sar")
  const hasSchedule = !!data.installments && data.installments.length > 0
  const companyName = branding.companyName.trim()

  return (
    <article
      dir={isRtl ? "rtl" : "ltr"}
      lang={locale}
      aria-label={t("sales_qb_sheet_title")}
      className={cn(
        "quotation-sheet relative mx-auto flex w-[210mm] min-h-[297mm] flex-col bg-white px-[14mm] pb-[12mm] pt-0 text-[12px] leading-normal text-foreground font-body",
        "[-webkit-print-color-adjust:exact] [print-color-adjust:exact]",
        "print:w-full print:min-h-0 print:px-0 print:pb-0",
        className
      )}
    >
      {/* Brand band — navy with a teal rule, the platform's two brand tokens. */}
      <div aria-hidden="true" className="-mx-[14mm] mb-[7mm] print:mx-0 print:mb-5">
        <div className="h-[5mm] bg-primary" />
        <div className="h-[1.2mm] bg-accent" />
      </div>

      {/* Letterhead + document identity */}
      <header className="flex items-start justify-between gap-6 break-inside-avoid">
        <div className="flex min-w-0 items-start gap-4">
          {branding.logoUrl ? (
            // A plain <img>: the logo is a blob: URL while it uploads and a
            // Firebase Storage URL after (no next/image remote pattern), and it
            // must be a real, already-decoded element when the page prints.
            <img
              src={branding.logoUrl}
              alt={companyName ? t("sales_qb_logo_alt", { company: companyName }) : t("sales_qb_logo_alt_generic")}
              className="h-[22mm] w-auto max-w-[48mm] shrink-0 object-contain"
            />
          ) : (
            <div className="grid h-[22mm] w-[22mm] shrink-0 place-items-center rounded-md border border-dashed border-border text-muted-foreground print:hidden">
              <ImageIcon size={22} aria-hidden="true" />
              <span className="sr-only">{t("sales_qb_logo_empty")}</span>
            </div>
          )}
          <div className="min-w-0 space-y-0.5 text-[11px]">
            <p className="text-[17px] font-bold leading-snug text-primary" dir="auto">
              {companyName || t("sales_qb_sheet_company_placeholder")}
            </p>
            <InfoLine label={t("sales_qb_cr_number")} value={branding.crNumber} ltr />
            <InfoLine label={t("sales_qb_vat_number")} value={branding.vatNumber} ltr />
            <InfoLine label={t("sales_qb_address")} value={branding.address} />
            <InfoLine label={t("sales_qb_phone")} value={branding.phone} ltr />
            <InfoLine label={t("sales_qb_email")} value={branding.email} ltr />
            <InfoLine label={t("sales_qb_website")} value={branding.website} ltr />
          </div>
        </div>
        <div className="shrink-0 text-end">
          <h2 className="text-[26px] font-bold leading-tight text-primary">{t("sales_qb_sheet_title")}</h2>
          <p className="text-[11px] font-semibold text-muted-foreground">{t("sales_qb_sheet_title_alt")}</p>
          <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-muted-foreground">{t("sales_qb_sheet_number")}</dt>
            <dd className="font-bold"><Num>{data.quotationNumber || "—"}</Num></dd>
            <dt className="text-muted-foreground">{t("sales_qb_sheet_date")}</dt>
            <dd className="font-semibold">{formatDocumentDate(data.date, locale)}</dd>
            <dt className="text-muted-foreground">{t("sales_qb_valid_until")}</dt>
            <dd className="font-semibold">{formatDocumentDate(data.validUntil, locale)}</dd>
          </dl>
        </div>
      </header>

      {/* Customer + at-a-glance total */}
      <section className="mt-5 grid grid-cols-[minmax(0,1fr)_62mm] gap-4 break-inside-avoid">
        <div className="rounded-md border border-border px-4 py-3">
          <h3 className="mb-1.5 text-[10.5px] font-bold text-cta">{t("sales_qb_sheet_bill_to")}</h3>
          <p className="text-[14px] font-bold text-primary" dir="auto">{customer.name || t("sales_qb_sheet_customer_placeholder")}</p>
          <div className="mt-1 space-y-0.5 text-[11px]">
            {customer.company && <p dir="auto">{customer.company}</p>}
            <InfoLine label={t("sales_qb_cr_number")} value={customer.crNumber} ltr />
            <InfoLine label={t("sales_qb_phone")} value={customer.phone} ltr />
            <InfoLine label={t("sales_qb_email")} value={customer.email} ltr />
            <InfoLine label={t("sales_qb_city")} value={customer.city} />
          </div>
        </div>
        <div className="flex flex-col justify-between rounded-md bg-primary px-4 py-3 text-white">
          <div>
            <p className="text-[10.5px] font-semibold text-white/70">{t("sales_qb_sheet_total_due")}</p>
            <p className="mt-1 text-[20px] font-bold leading-tight">
              <Num>{money(totals.total)}</Num>
            </p>
            <p className="text-[10.5px] text-white/70">{t("sales_qb_sheet_currency_vat", { currency, percent: totals.vatPercent })}</p>
          </div>
          {validityDays != null && (
            <p className="mt-3 border-t border-white/20 pt-2 text-[10.5px] text-white/80">
              {t("sales_validity_line", { days: validityDays })}
            </p>
          )}
        </div>
      </section>

      {/* Items */}
      <section className="mt-5">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="bg-primary text-white">
              <th scope="col" className="w-[9mm] px-2 py-2 text-center font-semibold">#</th>
              <th scope="col" className="px-2 py-2 text-start font-semibold">{t("sales_qb_sheet_col_description")}</th>
              <th scope="col" className="w-[17mm] px-2 py-2 text-center font-semibold">{t("sales_col_qty")}</th>
              <th scope="col" className="w-[17mm] px-2 py-2 text-center font-semibold">{t("sales_col_unit")}</th>
              <th scope="col" className="w-[27mm] px-2 py-2 text-end font-semibold">{t("sales_col_unit_price")}</th>
              <th scope="col" className="w-[30mm] px-2 py-2 text-end font-semibold">{t("sales_col_total")}</th>
            </tr>
          </thead>
          <tbody>
            {totals.lines.length > 0 ? (
              totals.lines.map((line) => (
                <tr key={line.index} className="break-inside-avoid border-b border-border even:bg-muted/50">
                  <td className="px-2 py-1.5 text-center text-muted-foreground"><Num>{line.index}</Num></td>
                  <td className="px-2 py-1.5 font-semibold" dir="auto">{line.name}</td>
                  <td className="px-2 py-1.5 text-center"><Num>{line.quantity.toLocaleString("en-US")}</Num></td>
                  <td className="px-2 py-1.5 text-center" dir="auto">{line.unit || "—"}</td>
                  <td className="px-2 py-1.5 text-end"><Num>{money(line.unitPrice)}</Num></td>
                  <td className="px-2 py-1.5 text-end font-bold"><Num>{money(line.total)}</Num></td>
                </tr>
              ))
            ) : (
              <tr className="break-inside-avoid border-b border-border">
                <td className="px-2 py-3 text-center text-muted-foreground"><Num>1</Num></td>
                <td className="px-2 py-3 font-semibold" colSpan={4}>
                  {totals.subtotal > 0 ? t("sales_qb_sheet_lump_sum") : <span className="font-normal text-muted-foreground">{t("sales_qb_sheet_no_items")}</span>}
                </td>
                <td className="px-2 py-3 text-end font-bold"><Num>{money(totals.subtotal)}</Num></td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Payment schedule beside the totals */}
      <section className="mt-4 grid grid-cols-[minmax(0,1fr)_80mm] items-start gap-6 break-inside-avoid">
        <div>
          {hasSchedule && (
            <>
              <h3 className="mb-1.5 text-[12px] font-bold text-primary">{t("sales_section_schedule")}</h3>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b-2 border-primary text-muted-foreground">
                    <th scope="col" className="py-1.5 text-start font-semibold">{t("sales_col_installment")}</th>
                    <th scope="col" className="w-[16mm] py-1.5 text-center font-semibold">{t("sales_col_share")}</th>
                    <th scope="col" className="w-[30mm] py-1.5 text-end font-semibold">{t("sales_qb_sheet_col_amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.schedule.map((s, i) => (
                    <tr key={`${s.id}-${i}`} className="break-inside-avoid border-b border-border">
                      <td className="py-1.5" dir="auto">{s.label.trim() || "—"}</td>
                      <td className="py-1.5 text-center"><Num>{`${Number(s.percent) || 0}%`}</Num></td>
                      <td className="py-1.5 text-end font-semibold"><Num>{money(s.amount)}</Num></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10px] text-muted-foreground">{t("sales_qb_sheet_schedule_note")}</p>
            </>
          )}
        </div>
        <dl className="overflow-hidden rounded-md border border-border text-[11.5px]">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">{t("sales_qb_sheet_subtotal")}</dt>
            <dd className="font-semibold"><Num>{money(totals.subtotal)}</Num></dd>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
            <dt className="text-muted-foreground">{t("sales_qb_sheet_vat", { percent: totals.vatPercent })}</dt>
            <dd className="font-semibold"><Num>{money(totals.vat)}</Num></dd>
          </div>
          <div className="flex items-center justify-between gap-3 bg-primary px-3 py-2.5 text-white">
            <dt className="font-bold">{t("sales_qb_sheet_grand_total")}</dt>
            <dd className="whitespace-nowrap text-[13px] font-bold"><Num>{`${money(totals.total)} ${currency}`}</Num></dd>
          </div>
        </dl>
      </section>

      {data.terms && data.terms.trim() && (
        <section className="mt-5 break-inside-avoid">
          <h3 className="mb-1 border-s-[3px] border-accent ps-2 text-[12px] font-bold text-primary">{t("sales_qb_terms")}</h3>
          <p className="whitespace-pre-line text-[11px] leading-relaxed" dir="auto">{data.terms.trim()}</p>
        </section>
      )}

      {data.notes && data.notes.trim() && (
        <section className="mt-4 break-inside-avoid">
          <h3 className="mb-1 border-s-[3px] border-accent ps-2 text-[12px] font-bold text-primary">{t("crm_notes")}</h3>
          <p className="whitespace-pre-line text-[11px] leading-relaxed" dir="auto">{data.notes.trim()}</p>
        </section>
      )}

      {/* Signatures and footer travel together — pushed to the foot of a
          short first page on screen, never split from each other in print. */}
      <div className="mt-auto break-inside-avoid pt-6">
        <section className="grid grid-cols-2 gap-8">
          <div>
            <p className="text-[11px] font-bold text-primary" dir="auto">
              {companyName ? t("sales_qb_sheet_for_company", { company: companyName }) : t("sales_qb_sheet_issuer")}
            </p>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_24mm] items-end gap-3">
              <div className="flex flex-col gap-4 text-[10.5px] text-muted-foreground">
                <p className="border-b border-dashed border-muted-foreground/40 pb-1">{t("sales_qb_sheet_signature")}</p>
                <p className="border-b border-dashed border-muted-foreground/40 pb-1">{t("sales_qb_sheet_name")}</p>
              </div>
              <div className="grid h-[24mm] place-items-center rounded-full border border-dashed border-muted-foreground/40 text-[10px] text-muted-foreground">
                {t("sales_qb_sheet_stamp")}
              </div>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold text-primary">{t("sales_qb_sheet_customer_acceptance")}</p>
            <div className="mt-2 flex flex-col gap-4 text-[10.5px] text-muted-foreground">
              <p className="border-b border-dashed border-muted-foreground/40 pb-1">{t("sales_qb_sheet_name")}</p>
              <p className="border-b border-dashed border-muted-foreground/40 pb-1">{t("sales_qb_sheet_signature")}</p>
              <p className="border-b border-dashed border-muted-foreground/40 pb-1">{t("sales_qb_sheet_date")}</p>
            </div>
          </div>
        </section>

        <footer className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-2 text-[9.5px] text-muted-foreground">
          <p className="min-w-0 truncate" dir="auto">
            {[companyName, branding.crNumber && `${t("sales_qb_cr_number")} ${branding.crNumber}`, branding.vatNumber && `${t("sales_qb_vat_number")} ${branding.vatNumber}`, branding.website]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
          <p className="shrink-0"><Num>{data.quotationNumber}</Num></p>
        </footer>
      </div>
    </article>
  )
}

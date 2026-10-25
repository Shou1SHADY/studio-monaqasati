"use client"

// The fact rows of the comparison (CMP-04): the total INCLUDING VAT with how far it is from the lowest complete offer, the lead time, the
// payment terms («يخالف شروطك»), the validity, the official quote, and the commitment with OUR experience of the supplier. One component
// per fact so the grid (suppliers as columns) and the table (suppliers as rows) say the same words.

import { useLocale, useTranslations } from "next-intl"
import { Star } from "lucide-react"
import { moneyFigure } from "@/components/procurement/PoModel"
import type { CompareColumn, Experience } from "@/lib/procurement/compare-model"
import { displayPoNumber } from "@/lib/procurement/format"
import { cn } from "@/lib/utils"

export const FACT_IDS = ["total", "lead", "terms", "valid", "quote", "commitment"] as const
export type FactId = (typeof FACT_IDS)[number]

const sar = (h: number | null | undefined): string => moneyFigure(h == null ? null : h / 100)

export function FactCell({ id, col, showPrices }: { id: FactId; col: CompareColumn; showPrices: boolean }) {
  const t = useTranslations("Portal.Procurement.cmp2")
  const locale = useLocale()
  const f = col.facts
  const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { day: "numeric", month: "short" }) : "—")
  switch (id) {
    case "total":
      if (!showPrices || f.grossH == null) return <span className="text-muted-foreground">—</span>
      return (
        <span className="block">
          <b dir="ltr" className="tabular-nums">
            {sar(f.grossH)}
          </b>
          <small className="block text-[11px] font-normal text-muted-foreground">{f.vatRate > 0 ? t("incl_vat") : t("no_vat")}</small>
          {f.partial ? (
            <small className="block text-[11px] font-semibold text-warning">{t("partial", { covered: f.partial.covered, of: f.partial.of })}</small>
          ) : f.isLowestComplete ? (
            <small className="block text-[11px] font-bold text-success">{t("lowest_complete")}</small>
          ) : f.deltaPct != null ? (
            <small dir="ltr" className="block text-[11px] font-semibold text-muted-foreground">
              +{f.deltaPct}%
            </small>
          ) : null}
        </span>
      )
    case "lead":
      return <span>{f.leadDays != null ? t("days", { days: f.leadDays }) : t("lead_none")}</span>
    case "terms":
      return (
        <span className="block">
          {f.advancePercent != null ? t("terms_advance", { percent: f.advancePercent, days: f.creditDays ?? 0 }) : f.creditDays != null ? t("terms_credit", { days: f.creditDays }) : f.paymentText || t("terms_none")}
          {f.differsTerms && <small className="block text-[11px] font-bold text-warning">{t("differs_terms")}</small>}
        </span>
      )
    case "valid":
      return (
        <span className="block">
          {day(f.validUntil)}
          {f.validity === "soon" && <small className="block text-[11px] font-bold text-warning">{t("validity_soon")}</small>}
          {f.validity === "expired" && <small className="block text-[11px] font-bold text-destructive">{t("validity_expired")}</small>}
        </span>
      )
    case "quote":
      return <span className={cn("text-xs font-semibold", f.hasQuote ? "text-success" : "text-warning")}>{f.hasQuote ? t("quote_attached") : t("quote_missing")}</span>
    case "commitment":
      return (
        <span className="block text-xs">
          {f.experience && f.experience.orders > 0 ? (
            <>
              {f.experience.onTimePercent != null && <b dir="ltr">{f.experience.onTimePercent}%</b>}
              {f.experience.rating != null && (
                <span className="ms-1 inline-flex items-center gap-0.5" dir="ltr" aria-label={t("rating_label", { rating: f.experience.rating })}>
                  <Star size={11} className="fill-warning text-warning" aria-hidden="true" />
                  {f.experience.rating}
                </span>
              )}{" "}
              {t("experience_orders", { count: f.experience.orders })}
              {f.experience.rejectPercent != null && f.experience.rejectPercent > 0 ? ` · ${t("experience_rejects", { percent: f.experience.rejectPercent })}` : ""}
              <ExperienceNotes exp={f.experience} />
            </>
          ) : (
            <span className="text-muted-foreground">{t("new_to_us")}</span>
          )}
        </span>
      )
  }
}

/** The two facts that warn (prototype `expTx`): the latest rejection at our gate with its reason and order, and what is late now. */
export function ExperienceNotes({ exp }: { exp: Pick<Experience, "lastReject" | "lateNow"> }) {
  const t = useTranslations("Portal.Procurement.cmp2")
  const tr = useTranslations("Portal.Procurement.rejectReason")
  const locale = useLocale()
  const r = exp.lastReject
  const late = exp.lateNow ?? 0
  if (!r && !late) return null
  return (
    <small className="mt-0.5 block text-[11px] font-semibold text-warning" dir="auto">
      {r
        ? t("experience_last_reject", {
            qty: r.qty.toLocaleString("en-US", { maximumFractionDigits: 3 }),
            unit: r.unit,
            reason: r.reason && tr.has(r.reason) ? tr(r.reason) : tr("other"),
            po: r.poNo ? displayPoNumber(r.poNo, locale) : "—",
          })
        : null}
      {r && late ? " · " : null}
      {late ? t("experience_late_now", { count: late }) : null}
    </small>
  )
}

"use client"

import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Clock, FileCheck2, FileText, Send, ShieldQuestion } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatCrmDate,
  formatSar,
  gatesRemaining,
  isOpportunityOpen,
  type CrmOpportunity,
  type GateContext,
  type PipelineFigure,
} from "@/lib/crm"
import type { PricingState } from "@/lib/crm-journey"
import { displayDocNumber } from "@/lib/sales-numbering"

/** A document number or an amount set inside a sentence, isolated left-to-right — without it the Arabic prefix and the
 * figures of «ع.س-2026/118-2 · 44,800 ر.س» are reordered by the sentence around them. */
export const ltr = (text: string | null | undefined) => (text ? `\u2066${text}\u2069` : "")

/** A document number inside a sentence, isolated by its own first letter — «ع.س-2026/118-2» reads as Arabic numbers do
 * everywhere else, «QT-2026/118-2» as Latin. */
export const iso = (text: string | null | undefined) => (text ? `\u2068${text}\u2069` : "")

/** Today as yyyy-mm-dd in the reader's own calendar day (deadlines are days, not instants). */
export function todayKey(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${m}-${d}`
}

/** Whole days from a yyyy-mm-dd or ISO day to today. */
export function daysSince(iso: string | null | undefined, today: string): number {
  if (!iso) return 0
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 86_400_000))
}

/** «ف-2026/014» — the deal's number (OPP-02). Nothing for a deal recorded before numbers existed. */
export function OppNumber({ number, className }: { number?: string | null; className?: string }) {
  const locale = useLocale()
  if (!number) return null
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-black text-primary-foreground", className)}>
      <bdi dir="ltr">{displayDocNumber(number, locale)}</bdi>
    </span>
  )
}

/** The deal's figure as the board counts it (OPP-08): the amount with what it is — «estimate» or «offer» — or «no
 * estimate», never «0 SAR». A deal held out of the totals says so. */
export function OppFigure({
  opp,
  figure,
  className,
}: {
  opp: CrmOpportunity
  figure: PipelineFigure
  className?: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const open = isOpportunityOpen(opp)
  const probability = open ? (typeof opp.probability === "number" ? `${opp.probability}%` : t("crm_prob_by_stage")) : null
  return (
    <div className={cn("flex items-baseline justify-between gap-2", className)}>
      {figure.amount === null ? (
        <span className="text-xs font-bold text-muted-foreground">{t("crm_no_estimate")}</span>
      ) : (
        <span className={cn("text-sm font-black", figure.overdue ? "text-muted-foreground line-through" : "text-foreground")} dir="ltr">
          {formatSar(figure.amount, locale)}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground">
        {figure.overdue
          ? t("crm_out_of_total")
          : [figure.kind === "offer" ? t("crm_figure_offer") : figure.kind === "estimate" ? t("crm_figure_estimate") : "", figure.kind === "offer" ? "" : probability]
              .filter(Boolean)
              .join(" · ")}
      </span>
    </div>
  )
}

/** One line under a deal saying what it is waiting for — the next fact that moves it (OPP-05, OPP-08 #5). */
export function OppStatusLine({
  opp,
  pricing,
  gateCtx,
  today,
  className,
}: {
  opp: CrmOpportunity
  pricing: PricingState
  gateCtx: GateContext
  today: string
  className?: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  if (!isOpportunityOpen(opp)) return null
  const tone = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"

  if (pricing.kind === "offer") {
    return pricing.expired ? (
      <span className={cn(tone, "bg-warning/10 text-warning", className)}>
        <AlertTriangle size={11} aria-hidden="true" />
        {t("crm_status_offer_expired")}
      </span>
    ) : (
      <span className={cn(tone, "bg-indigo/10 text-indigo", className)}>
        <FileText size={11} aria-hidden="true" />
        {pricing.quote.validUntil
          ? t("crm_status_offer_sent_until", { date: formatCrmDate(pricing.quote.validUntil, locale) })
          : t("crm_status_offer_sent")}
      </span>
    )
  }
  if (pricing.kind === "at_sales" || pricing.kind === "revision") {
    return (
      <span className={cn(tone, "bg-indigo/10 text-indigo", className)}>
        <Clock size={11} aria-hidden="true" />
        {t(pricing.kind === "revision" ? "crm_status_revision" : "crm_status_at_sales", { days: daysSince(pricing.request.requestedAt, today) })}
      </span>
    )
  }
  if (pricing.kind === "declined") {
    return (
      <span className={cn(tone, "bg-destructive/10 text-destructive", className)}>
        <AlertTriangle size={11} aria-hidden="true" />
        {t("crm_status_declined")}
      </span>
    )
  }
  if (opp.stage === "new") {
    const left = gatesRemaining(opp, gateCtx)
    if (left.some((g) => g.id === "go_no_go") && !opp.goDecision) {
      return (
        <span className={cn(tone, "bg-warning/10 text-warning", className)}>
          <ShieldQuestion size={11} aria-hidden="true" />
          {t("crm_status_go_pending")}
        </span>
      )
    }
    if (left.length > 0) {
      return (
        <span className={cn(tone, "bg-warning/10 text-warning", className)}>
          <AlertTriangle size={11} aria-hidden="true" />
          {t("crm_gates_blocking", { count: left.length })}
        </span>
      )
    }
  }
  if (opp.stage === "qualified") {
    return (
      <span className={cn(tone, "bg-cta/10 text-cta", className)}>
        <Send size={11} aria-hidden="true" />
        {t("crm_status_ready_to_price")}
      </span>
    )
  }
  if (opp.stage === "new") {
    return (
      <span className={cn(tone, "bg-success/10 text-success", className)}>
        <FileCheck2 size={11} aria-hidden="true" />
        {t("crm_status_ready_to_qualify")}
      </span>
    )
  }
  return null
}

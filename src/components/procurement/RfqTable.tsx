"use client"

// The RFQs as a list (the reference prototype's list view): the RFQ with its
// number, city, products and author under it; the project; the offers; the
// deadline and its pill; the estimate at the last price we paid (money
// holders only); the stage. A selection column carries the bulk actions.

import { useLocale, useTranslations } from "next-intl"
import { FileText, LayoutGrid, Lock } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { RfqStagePill, type RfqRow } from "@/components/procurement/RfqCard"
import { displayCity } from "@/lib/constants"
import { displayDocNumber } from "@/lib/procurement/format"
import { deadlinePill, productCount, rfqStage } from "@/lib/procurement/rfq-view"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

export interface RfqTableRow {
  rfq: RfqRow
  projectName: string | null
  sealed: boolean
  estimate: number | null
}

export function RfqTable({
  rows,
  now,
  seesPrices,
  selected,
  onToggle,
  onToggleAll,
  onGlance,
}: {
  rows: RfqTableRow[]
  now: Date
  seesPrices: boolean
  selected: string[]
  onToggle: (id: string) => void
  onToggleAll: () => void
  onGlance: (rfq: RfqRow) => void
}) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const all = rows.length > 0 && selected.length === rows.length

  return (
    <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="border-b text-xs font-semibold text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-3">
              <Checkbox checked={all ? true : selected.length ? "indeterminate" : false} onCheckedChange={onToggleAll} aria-label={t("rfq_select_all")} />
            </th>
            <th className="px-3 py-3 text-start">{t("rfqv_col_rfq")}</th>
            <th className="px-3 py-3 text-start">{t("rfqv_col_project")}</th>
            <th className="px-3 py-3 text-start">{t("rfqv_col_offers")}</th>
            <th className="px-3 py-3 text-start">{t("rfqv_col_deadline")}</th>
            {seesPrices && <th className="px-3 py-3 text-start">{t("rfqv_col_estimate")}</th>}
            <th className="px-3 py-3 text-start">{t("rfqv_col_status")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ rfq, projectName, sealed, estimate }) => {
            const stage = rfqStage(rfq, now)
            const pill = deadlinePill(rfq, now)
            const offers = rfq.offersCount ?? 0
            const isSelected = selected.includes(rfq.id)
            const meta = [
              rfq.rfqNumber ? displayDocNumber(rfq.rfqNumber, locale) : `#${rfq.id.slice(0, 6)}`,
              rfq.city ? `${displayCity(rfq.city, locale)}${rfq.district ? ` — ${displayCity(rfq.district, locale)}` : ""}` : null,
              t("rfqv_products", { count: productCount(rfq) }),
              rfq.createdByUserName || null,
            ].filter(Boolean)
            return (
              <tr key={rfq.id} className={cn("hover:bg-muted/30", isSelected && "bg-module/5")}>
                <td className="px-3 py-3">
                  <Checkbox checked={isSelected} onCheckedChange={() => onToggle(rfq.id)} aria-label={rfq.title} />
                </td>
                <td className="max-w-[360px] px-3 py-3">
                  <button type="button" onClick={() => onGlance(rfq)} className="block max-w-full truncate text-start font-bold text-foreground hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm" dir="auto">
                    {rfq.title}
                  </button>
                  <span className="block truncate text-[11px] text-muted-foreground">{meta.join(" · ")}</span>
                </td>
                <td className="px-3 py-3">
                  {projectName ? (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-cta/20 bg-cta/5 px-2 py-0.5 text-[11px] font-semibold text-cta">
                      <LayoutGrid size={12} aria-hidden="true" />
                      {projectName}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {stage === "draft" ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <button type="button" onClick={() => onGlance(rfq)} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", offers > 0 ? "border-success/25 bg-success/5 text-success" : "border-border text-muted-foreground")}>
                        <FileText size={12} aria-hidden="true" />
                        {t("rfqv_offers", { count: offers })}
                        {sealed && offers > 0 && <Lock size={11} aria-label={t("rfqv_sealed")} />}
                      </span>
                    </button>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3" suppressHydrationWarning>
                  <span className="text-foreground">{rfq.deadline ? new Date(rfq.deadline).toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "long" }) : t("rfq_not_set")}</span>
                  {pill?.kind === "passed" && <span className="ms-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">{t("rfqv_passed")}</span>}
                  {pill?.kind === "soon" && <span className="ms-2 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">{t("rfqv_soon", { days: pill.days })}</span>}
                </td>
                {seesPrices && (
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums" dir="ltr">
                    {estimate !== null ? sarLtr(Math.round(estimate).toLocaleString("en-US")) : <span className="text-muted-foreground">—</span>}
                  </td>
                )}
                <td className="px-3 py-3">
                  <RfqStagePill stage={stage} sealed={sealed} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

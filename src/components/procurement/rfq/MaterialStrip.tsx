"use client"

// «الأقل لكل مادة» (CMP-14): per material the lowest supplier, his effective price and how many live offers there are — and, when the
// lowest is not a verified supplier with an official quote, the next one who is and how much more he asks for the quantity. «رتّب بها»
// (CMP-15) sorts the suppliers by that material's effective price.

import { useTranslations } from "next-intl"
import { ArrowDownUp } from "lucide-react"
import { moneyFigure } from "@/components/procurement/PoModel"
import type { CompareColumn, StripEntry } from "@/lib/procurement/compare-model"
import { cn } from "@/lib/utils"

const sar = (h: number | null | undefined): string => moneyFigure(h == null ? null : h / 100)

export function MaterialStrip({ strip, columns, sortLine, onSort, showPrices }: { strip: StripEntry[]; columns: CompareColumn[]; sortLine: number | null; onSort: (li: number | null) => void; showPrices: boolean }) {
  const t = useTranslations("Portal.Procurement.cmp2")
  if (!strip.length || !showPrices) return null
  const nameOf = (id: string | null) => columns.find((c) => c.offer.id === id)?.name || "—"
  return (
    <div className="rounded-xl border bg-muted/20 p-3" aria-label={t("strip_title")}>
      <p className="mb-2 text-xs font-bold">
        {t("strip_title")} <span className="font-normal text-muted-foreground">{t("strip_sub")}</span>
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {strip.map((s) => (
          <li key={s.li} className="rounded-lg border bg-card px-3 py-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <b className="min-w-0 truncate" dir="auto">
                {s.name}
              </b>
              <button
                type="button"
                aria-pressed={sortLine === s.li}
                onClick={() => onSort(sortLine === s.li ? null : s.li)}
                className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", sortLine === s.li && "text-module")}
              >
                <ArrowDownUp size={11} aria-hidden="true" />
                {sortLine === s.li ? t("sorted_by") : t("sort_by")}
              </button>
            </div>
            {s.lowestOfferId ? (
              <p className="mt-1">
                <b dir="auto">{nameOf(s.lowestOfferId)}</b> · <bdi dir="ltr">{sar(s.lowestEffH)}</bdi> {t("per_unit", { unit: s.unit })} · {t("live_offers", { count: s.liveCount })}
                {s.lowestIsSafe && <span className="ms-1 text-success">{t("verified_quote")}</span>}
              </p>
            ) : (
              <p className="mt-1 text-muted-foreground">{t("no_live_line")}</p>
            )}
            {s.safe && (
              <p className="mt-0.5 text-muted-foreground">
                {t("next_safe", { name: nameOf(s.safe.offerId), more: sar(s.safe.moreH) })}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

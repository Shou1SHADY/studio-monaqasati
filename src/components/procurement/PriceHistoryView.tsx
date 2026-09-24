"use client"

// The Suppliers tab's price-history segment (PRD 3.0 §7.2, §4 `PH`).
//
// One row per material we have committed to a price for, sharpest rise first,
// because the question this screen answers is "what is getting more expensive".
// The last few points draw a bar chart rather than a number: a series is easier
// to read than a percentage, and the percentage is there beside it for the one
// number somebody will quote.
//
// A material with a single point has no change to show — and a first price of
// zero has no percentage at all, which is why it reads "—" rather than a figure
// nobody could defend.

import { Fragment, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, LineChart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PRICE_RISE_ALARM_PERCENT, priceTrends, sparkHeights, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { displayPoNumber } from "@/lib/procurement/format"

export function PriceHistoryView({
  history,
  locale,
  fmtDate,
}: {
  history: PriceHistoryEntry[]
  locale: string
  fmtDate: (value: unknown, locale: string) => string
}) {
  const t = useTranslations("Portal.ProcPrices")
  const [openKey, setOpenKey] = useState<string | null>(null)
  const trends = useMemo(() => priceTrends(history), [history])

  if (!trends.length) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-16 text-center text-muted-foreground">
        <LineChart size={44} className="mx-auto mb-4 opacity-20" />
        <p className="text-lg font-bold">{t("history.emptyTitle")}</p>
        <p className="mt-1 text-sm">{t("history.emptyDesc")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("history.intro")}</p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="p-3 text-start font-bold">{t("history.colMaterial")}</th>
              <th className="p-3 text-start font-bold">{t("history.colSeries")}</th>
              <th className="p-3 text-start font-bold">{t("history.colLast")}</th>
              <th className="p-3 text-start font-bold">{t("history.colChange")}</th>
            </tr>
          </thead>
          <tbody>
            {trends.map((tr) => {
              const heights = sparkHeights(tr)
              const open = openKey === tr.materialKey
              const change = tr.changePercent
              return (
                <Fragment key={tr.materialKey}>
                  <tr className="border-t">
                    <td className="p-3">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenKey(open ? null : tr.materialKey)}
                        className="flex items-center gap-1.5 text-start font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
                        {tr.name}
                      </button>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("history.points", { count: tr.points.length })}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex h-8 items-end gap-1" dir="ltr" role="img" aria-label={t("history.seriesLabel", { from: tr.first, to: tr.last })}>
                        {heights.map((h, i) => (
                          <span
                            key={i}
                            style={{ height: `${h}%` }}
                            className={cn("w-2 rounded-sm", tr.points[i].price === tr.max && tr.max > tr.min * 1.02 ? "bg-amber-400" : "bg-module/50")}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <b className="tabular-nums" dir="ltr">
                        {tr.last}
                      </b>
                      <span className="block text-[11px] text-muted-foreground">{`/ ${tr.unit}`}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {`${tr.points[tr.points.length - 1].supplierName || "—"} · ${fmtDate(tr.points[tr.points.length - 1].day, locale)}`}
                      </span>
                    </td>
                    <td className="p-3">
                      {change == null || tr.points.length < 2 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge
                          variant="outline"
                          className={cn(
                            "border font-bold tabular-nums",
                            change > PRICE_RISE_ALARM_PERCENT ? "bg-destructive/10 text-destructive border-destructive/20" : change > 0 ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-success/10 text-success border-success/20"
                          )}
                        >
                          <span dir="ltr">{`${change > 0 ? "+" : ""}${change}%`}</span>
                        </Badge>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-t bg-muted/20">
                      <td colSpan={4} className="p-3">
                        <ul className="space-y-1.5">
                          {[...tr.points].reverse().map((p) => (
                            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2">
                              <span>
                                <b>{p.supplierName || "—"}</b>
                                <span className="text-muted-foreground">
                                  {` · ${fmtDate(p.day, locale)}`}
                                  {p.poNumber ? ` · ${displayPoNumber(p.poNumber, locale)}` : ""}
                                </span>
                              </span>
                              <b className="tabular-nums" dir="ltr">
                                {p.price}
                              </b>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

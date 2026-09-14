"use client"

import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Coins, Factory, Info, Package, PackageCheck, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { valuationShares, type InventoryValuation } from "@/lib/inventory-valuation"

type SegmentKey = "materials" | "wip" | "finishedGoods"

// Token colours only. The bar fill and the row's icon tint carry identity;
// every number and label stays in text tokens, so a segment is never told
// apart by colour alone.
const SEGMENTS: Array<{ key: SegmentKey; label: string; icon: LucideIcon; fill: string; tint: string; ink: string }> = [
  { key: "materials", label: "inv_val_materials", icon: Package, fill: "bg-accent", tint: "bg-accent/10", ink: "text-accent" },
  { key: "wip", label: "inv_val_wip", icon: Factory, fill: "bg-warning", tint: "bg-warning/10", ink: "text-warning" },
  { key: "finishedGoods", label: "inv_val_finished", icon: PackageCheck, fill: "bg-success", tint: "bg-success/10", ink: "text-success" },
]

/**
 * The Inventory module's headline: what the company's stock is worth after
 * manufacturing has moved value around — construction materials on the shelf,
 * work in progress inside open work orders, and finished goods that landed on
 * a signed delivery note. Figures come from `valueInventory`
 * (src/lib/inventory-valuation.ts), which documents every rule.
 */
export function InventoryValuationCard({
  valuation,
  isLoading,
  partial = false,
  className,
}: {
  valuation: InventoryValuation | null
  isLoading: boolean
  partial?: boolean
  className?: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const nf = (n: number) => n.toLocaleString(locale === "ar" ? "ar-SA" : "en-US", { maximumFractionDigits: 2 })

  if (isLoading || !valuation) {
    return (
      <Card className={className} aria-busy="true">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-7 w-40" />
            </div>
          </div>
          <Skeleton className="h-2.5 w-full rounded-full" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {SEGMENTS.map((s) => (
              <Skeleton key={s.key} className="h-[72px] w-full rounded-xl" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const { materials, wip, finishedGoods, total } = valuation
  const holdsAnything = materials.itemCount + materials.releasedLines + wip.orderCount + finishedGoods.itemCount > 0

  if (!holdsAnything) {
    return (
      <Card className={className}>
        <CardContent className="p-4 sm:p-5 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Coins size={18} className="text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground">{t("inv_val_empty_title")}</h2>
            <p className="text-xs text-muted-foreground">{t("inv_val_empty_desc")}</p>
            {partial && <p className="text-[11px] text-warning mt-1">{t("inv_val_partial_hint")}</p>}
          </div>
        </CardContent>
      </Card>
    )
  }

  const shares = valuationShares(valuation)
  const values: Record<SegmentKey, number> = { materials: materials.value, wip: wip.value, finishedGoods: finishedGoods.value }
  const counts: Record<SegmentKey, string> = {
    materials: t("inv_val_items", { count: materials.itemCount, n: nf(materials.itemCount) }),
    wip: t("inv_val_orders", { count: wip.orderCount, n: nf(wip.orderCount) }),
    finishedGoods: t("inv_val_items", { count: finishedGoods.itemCount, n: nf(finishedGoods.itemCount) }),
  }
  const unpriced: Record<SegmentKey, number> = {
    materials: materials.unpricedCount,
    wip: wip.unpricedOrders,
    finishedGoods: finishedGoods.unpricedCount,
  }
  const anyUnpriced = unpriced.materials + unpriced.wip + unpriced.finishedGoods > 0
  const barLabel = t("inv_val_bar_label", {
    materials: nf(shares.materials),
    wip: nf(shares.wip),
    finished: nf(shares.finishedGoods),
  })

  return (
    <Card className={className}>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Coins size={18} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold text-muted-foreground">{t("inv_val_title")}</h2>
            {total > 0 ? (
              <p className="text-2xl font-black text-foreground leading-tight">
                <span dir="ltr" className="tabular-nums">{nf(total)}</span>
                <span className="text-xs font-semibold text-muted-foreground ms-1.5">{t("inv_val_sar")}</span>
              </p>
            ) : (
              // Zero would read as "worthless" when it means "no costs on file yet".
              <p className="text-sm font-bold text-muted-foreground mt-1">{t("inv_val_no_cost_yet")}</p>
            )}
          </div>
          <p className="hidden md:block text-[11px] text-muted-foreground max-w-xs text-end">{t("inv_val_desc")}</p>
        </div>

        {/* Composition — flex follows the page direction, so the first segment
            sits where the first row below it starts. */}
        <div
          role="img"
          aria-label={barLabel}
          className={cn("flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full", total > 0 ? "bg-card" : "bg-muted")}
        >
          {total > 0 &&
            SEGMENTS.filter((s) => values[s.key] > 0).map((s) => (
              <div
                key={s.key}
                className={cn("h-full min-w-1 rounded-full", s.fill)}
                style={{ width: `${(values[s.key] / total) * 100}%` }}
                title={`${t(s.label)} — ${nf(values[s.key])} ${t("inv_val_sar")}`}
              />
            ))}
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SEGMENTS.map((s) => {
            const Icon = s.icon
            const value = values[s.key]
            return (
              <li key={s.key} className="rounded-xl border bg-muted/40 px-3.5 py-2.5 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn("h-6 w-6 rounded-md flex items-center justify-center shrink-0", s.tint)}>
                    <Icon size={13} className={s.ink} aria-hidden="true" />
                  </span>
                  <p className="text-[11px] font-semibold text-muted-foreground truncate flex-1">{t(s.label)}</p>
                  <span className="text-[11px] font-bold text-foreground tabular-nums">
                    {t("inv_val_share", { percent: nf(shares[s.key]) })}
                  </span>
                </div>
                <p className="mt-1 text-lg font-black text-foreground">
                  {value > 0 || unpriced[s.key] === 0 ? (
                    <>
                      <span dir="ltr" className="tabular-nums">{nf(value)}</span>
                      <span className="text-xs font-semibold text-muted-foreground ms-1">{t("inv_val_sar")}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground" aria-hidden="true">—</span>
                      <span className="sr-only">{t("inv_val_no_cost_yet")}</span>
                    </>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                  <span>{counts[s.key]}</span>
                  {unpriced[s.key] > 0 && (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertTriangle size={10} aria-hidden="true" />
                      {t("inv_val_unpriced_count", { count: nf(unpriced[s.key]) })}
                    </span>
                  )}
                </p>
                {s.key === "materials" && materials.releasedValue > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {t("inv_val_released", { value: nf(materials.releasedValue) })}
                  </p>
                )}
              </li>
            )
          })}
        </ul>

        {(anyUnpriced || partial) && (
          <div className="space-y-1">
            {anyUnpriced && (
              <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Info size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
                {t("inv_val_unpriced_hint")}
              </p>
            )}
            {partial && (
              <p className="text-[11px] text-warning flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
                {t("inv_val_partial_hint")}
              </p>
            )}
          </div>
        )}
        <p className="md:hidden text-[11px] text-muted-foreground">{t("inv_val_desc")}</p>
      </CardContent>
    </Card>
  )
}

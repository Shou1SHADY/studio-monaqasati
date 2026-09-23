"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarRange, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { cn } from "@/lib/utils"
import type { AccountingData } from "@/hooks/useAccounting"
import { MONEY_SCALES } from "@/lib/accounting/display"
import { fiscalYearLabel, isValidIsoDate, type FiscalPeriod } from "@/lib/accounting/periods"

const CUSTOM_KEY = "CUSTOM"

/** "01/04/2026 – 30/06/2026" — day-first, the way the period reads on a Saudi statement. */
export function periodRangeText(period: Pick<FiscalPeriod, "from" | "to">): string {
  const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  return `${dmy(period.from)} – ${dmy(period.to)}`
}

export function periodLabel(period: FiscalPeriod, locale: string): string {
  return locale === "ar" ? period.labelAr : period.labelEn
}

/**
 * The reporting controls every accounting screen shares: fiscal year, a preset
 * from that year (computed from the company's fiscal start month), a custom
 * date range, the display scale and the project filter. All of it lives in the
 * shared preferences store, so the selection follows the reader across screens.
 */
export function AccountingToolbar({
  data,
  showPeriod = true,
  showProject = true,
  showScale = true,
}: {
  data: AccountingData
  showPeriod?: boolean
  showProject?: boolean
  showScale?: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isCustom = data.period.key === CUSTOM_KEY
  const [rangeOpen, setRangeOpen] = useState(false)
  const [from, setFrom] = useState(data.period.from)
  const [to, setTo] = useState(data.period.to)

  useEffect(() => {
    if (rangeOpen) {
      setFrom(data.period.from)
      setTo(data.period.to)
    }
  }, [rangeOpen, data.period.from, data.period.to])

  const groups: Array<{ labelKey: string; kinds: FiscalPeriod["kind"][] }> = [
    { labelKey: "acc_period_group_year", kinds: ["year", "ytd"] },
    { labelKey: "acc_period_group_half", kinds: ["half"] },
    { labelKey: "acc_period_group_quarter", kinds: ["quarter"] },
    { labelKey: "acc_period_group_month", kinds: ["month"] },
  ]
  const startMonth = data.settings.fiscalYearStartMonth
  const rangeValid = isValidIsoDate(from) && isValidIsoDate(to)

  const onPeriodChange = (key: string) => {
    if (key === CUSTOM_KEY) {
      setRangeOpen(true)
      return
    }
    data.setPeriodKey(key)
  }

  const applyRange = () => {
    if (!rangeValid) return
    data.setCustomRange(from, to)
    setRangeOpen(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-2">
      {showPeriod && (
        <>
          {!isCustom && (
            <div className="w-36">
              <SearchableSelect
                size="sm"
                className="h-9"
                ariaLabel={t("acc_fiscal_year")}
                value={String(data.fiscalYear)}
                onChange={(v) => data.setFiscalYear(Number(v))}
                options={data.fiscalYears.map((fy) => ({
                  value: String(fy),
                  label: t("acc_fiscal_year_short", { year: fiscalYearLabel(fy, startMonth) }),
                }))}
                placeholder={t("acc_fiscal_year")}
                searchPlaceholder={t("acc_search_options")}
                noResultsText={t("acc_no_options")}
              />
            </div>
          )}

          <div className="w-64">
            <SearchableSelect
              size="sm"
              className="h-9"
              ariaLabel={t("acc_period")}
              value={data.period.key}
              onChange={onPeriodChange}
              displayLabel={isCustom ? t("acc_period_custom") : periodLabel(data.period, locale)}
              options={[
                ...groups.flatMap((g) =>
                  data.periodOptions
                    .filter((p) => g.kinds.includes(p.kind))
                    .map((p) => ({ value: p.key, label: periodLabel(p, locale), group: t(g.labelKey) }))
                ),
                { value: CUSTOM_KEY, label: t("acc_period_custom_pick"), group: t("acc_period_custom") },
              ]}
              placeholder={t("acc_period")}
              searchPlaceholder={t("acc_search_options")}
              noResultsText={t("acc_no_options")}
            />
          </div>

          <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("h-9 gap-1.5 text-xs tabular-nums", isCustom && "border-primary text-primary")}
                aria-label={t("acc_period_custom_pick")}
              >
                <CalendarRange size={14} aria-hidden="true" />
                <span dir="ltr">{periodRangeText(data.period)}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-3" dir={locale === "ar" ? "rtl" : "ltr"}>
              <p className="text-sm font-bold">{t("acc_period_custom")}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="acc-range-from" className="text-xs">{t("acc_date_from")}</Label>
                  <Input id="acc-range-from" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="acc-range-to" className="text-xs">{t("acc_date_to")}</Label>
                  <Input id="acc-range-to" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                {isCustom ? (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => { data.setPeriodKey("FY"); setRangeOpen(false) }}>
                    {t("acc_period_back_to_presets")}
                  </Button>
                ) : (
                  <span />
                )}
                <Button size="sm" className="gap-1.5 text-xs" disabled={!rangeValid} onClick={applyRange}>
                  <Check size={13} aria-hidden="true" />
                  {t("acc_apply")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}

      {/* Financials by project are a per-client customisation (finance review,
          23 Sep 2026) — the filter appears only where Settings switched it on. */}
      {showProject && data.settings.projectReports && data.projects.length > 0 && (
        <div className="w-52">
          <SearchableSelect
            size="sm"
            className="h-9"
            ariaLabel={t("acc_filter_project")}
            value={data.filter.project || "__all__"}
            onChange={(v) => data.setFilter({ ...data.filter, project: v === "__all__" ? null : v })}
            options={[
              { value: "__all__", label: t("acc_filter_all_projects") },
              ...data.projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
            placeholder={t("acc_filter_project")}
            searchPlaceholder={t("acc_search_options")}
            noResultsText={t("acc_no_options")}
          />
        </div>
      )}

      {showScale && (
        <div
          role="radiogroup"
          aria-label={t("acc_scale_label")}
          className="ms-auto flex items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5"
        >
          {MONEY_SCALES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={data.scale === s}
              onClick={() => data.setScale(s)}
              className={cn(
                "h-8 px-2.5 rounded-md text-[11px] font-bold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                data.scale === s ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-white"
              )}
            >
              {t(`acc_scale_${s}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** "Amounts in SAR thousands" — printed under statements whenever figures are scaled. */
export function ScaleCaption({ scale }: { scale: AccountingData["scale"] }) {
  const t = useTranslations("Portal.Shared")
  return <span className="text-[11px] font-semibold text-muted-foreground">{t(`acc_scale_caption_${scale}`)}</span>
}

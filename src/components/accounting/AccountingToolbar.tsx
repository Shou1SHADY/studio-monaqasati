"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarRange, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
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
            <Select value={String(data.fiscalYear)} onValueChange={(v) => data.setFiscalYear(Number(v))}>
              <SelectTrigger className="h-9 w-36 text-xs" aria-label={t("acc_fiscal_year")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.fiscalYears.map((fy) => (
                  <SelectItem key={fy} value={String(fy)} className="text-xs">
                    {t("acc_fiscal_year_short", { year: fiscalYearLabel(fy, startMonth) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={data.period.key} onValueChange={onPeriodChange}>
            <SelectTrigger className="h-9 w-64 text-xs" aria-label={t("acc_period")}>
              <SelectValue>{isCustom ? t("acc_period_custom") : periodLabel(data.period, locale)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {groups.map((g, gi) => (
                <SelectGroup key={g.labelKey}>
                  {gi > 0 && <SelectSeparator />}
                  <SelectLabel className="text-[10px] text-muted-foreground">{t(g.labelKey)}</SelectLabel>
                  {data.periodOptions
                    .filter((p) => g.kinds.includes(p.kind))
                    .map((p) => (
                      <SelectItem key={p.key} value={p.key} className="text-xs">
                        {periodLabel(p, locale)}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
              <SelectSeparator />
              <SelectItem value={CUSTOM_KEY} className="text-xs font-semibold">
                {t("acc_period_custom_pick")}
              </SelectItem>
            </SelectContent>
          </Select>

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

      {showProject && data.projects.length > 0 && (
        <Select
          value={data.filter.project || "__all__"}
          onValueChange={(v) => data.setFilter({ ...data.filter, project: v === "__all__" ? null : v })}
        >
          <SelectTrigger className="h-9 w-52 text-xs" aria-label={t("acc_filter_project")}>
            <SelectValue placeholder={t("acc_filter_project")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="text-xs">
              {t("acc_filter_all_projects")}
            </SelectItem>
            {data.projects.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

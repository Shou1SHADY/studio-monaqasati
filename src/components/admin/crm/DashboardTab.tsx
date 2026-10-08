"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { CalendarDays, Loader2, Target, Trophy, TrendingUp } from "lucide-react"
import type { AdminCrm } from "@/hooks/useAdminCrm"
import { LEAD_CHANNELS, OPEN_STAGES, leadDashboard, stageTotals } from "@/lib/admin-crm"
import { CrmKpi, Money, STAGE_TONE } from "./parts"


function Bars({ title, icon: Icon, rows }: { title: string; icon: typeof Target; rows: Array<{ key: string; label: string; value: number; extra?: React.ReactNode; bar: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b bg-muted/30 px-4 py-3 text-sm font-bold">
        <Icon size={16} className="text-muted-foreground" aria-hidden="true" />
        {title}
      </header>
      <ul className="space-y-4 p-4">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{r.label}</span>
              <span className="flex items-center gap-2">
                {r.extra}
                <span className="font-black tabular-nums" dir="ltr">{r.value}</span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="presentation">
              <div className={`h-full rounded-full ${r.bar}`} style={{ width: `${Math.round((r.value / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** ADM-01/03: what the old page showed in a second row of cards — this week, this month, the sources, the conversion — now where it belongs: its own tab. */
export function DashboardTab({ crm }: { crm: AdminCrm }) {
  const t = useTranslations("Portal.Admin.Crm")
  const d = useMemo(() => leadDashboard(crm.leadRows, new Date()), [crm.leadRows])
  const totals = useMemo(() => stageTotals(crm.leadRows), [crm.leadRows])
  // Never a row of zeros while the leads are still arriving.
  if (crm.loading.leads) {
    return (
      <div className="flex justify-center p-16">
        <Loader2 className="animate-spin text-primary" size={28} aria-label={t("loading")} />
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CrmKpi icon={TrendingUp} label={t("intake_week")} value={d.thisWeek} hint={t("intake_week_hint", { n: d.lastWeek })} />
        <CrmKpi icon={CalendarDays} label={t("intake_month")} value={d.thisMonth} hint={t("intake_month_hint", { n: d.lastMonth })} />
        <CrmKpi icon={Trophy} label={t("converted_month")} value={d.convertedThisMonth} hint={t("converted_month_hint", { n: d.convertedLastMonth })} tone="success" />
        <CrmKpi icon={Target} label={t("conversion_rate")} value={d.conversionRate === null ? "—" : `${d.conversionRate}%`} hint={t("conversion_hint")} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Bars
          title={t("intake_sources")}
          icon={TrendingUp}
          rows={LEAD_CHANNELS.map((c) => ({ key: c, label: t(`channel_${c}`), value: d.bySource[c], bar: "bg-primary" }))}
        />
        <Bars
          title={t("open_stages")}
          icon={Target}
          rows={OPEN_STAGES.map((s) => ({
            key: s,
            label: t(`stage_${s}`),
            value: d.openByStage[s],
            bar: STAGE_TONE[s].bar,
            extra: totals[s].value > 0 ? <Money amount={totals[s].value} className="text-xs text-muted-foreground" /> : null,
          }))}
        />
      </div>
    </div>
  )
}

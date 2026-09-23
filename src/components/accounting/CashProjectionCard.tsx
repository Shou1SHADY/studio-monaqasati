"use client"

// The dashboard's cash projection (finance review, 23 Sep 2026): today's cash,
// plus what clients owe and when it should arrive, less what the company owes
// and when it falls due — actual cash to the left of today, projected to the
// right, so the reader sees where the balance is heading and its lowest point.
//
// Two panels, one scale each (never a dual axis): the balance line on top,
// weekly/monthly receipts and payments as bars beneath. Actual and projected
// cash are the same entity in the same hue — the projection is dashed.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronDown, TrendingUp } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { cn } from "@/lib/utils"
import type { AccountingData } from "@/hooks/useAccounting"
import { cashProjection, type ProjectionHorizon, type ProjectionItemKind } from "@/lib/accounting/cash-projection"
import { formatMoney, formatMoneyCompact } from "@/lib/accounting/display"
import { isoToday } from "@/lib/accounting/periods"
import { AccountingSection, Money, useMoneyFormat } from "./AccountingShell"
import { ScaleCaption } from "./AccountingToolbar"
import { Kpi } from "./AccountingParts"
import { CHART_INK, CHART_SERIES } from "./chart-palette"

const RECEIPTS = CHART_SERIES[3]
const PAYMENTS = CHART_SERIES[2]
const BALANCE = CHART_SERIES[1]

const KIND_KEY: Record<ProjectionItemKind, string> = {
  receivable: "acc_proj_kind_receivable",
  unbilled: "acc_proj_kind_unbilled",
  payable: "acc_proj_kind_payable",
  vat: "acc_proj_kind_vat",
  wht: "acc_proj_kind_wht",
  payroll: "acc_proj_kind_payroll",
  zakat: "acc_proj_kind_zakat",
}

function ProjTooltip({
  active,
  payload,
  label,
  scale,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number | null; color?: string; dataKey?: string }>
  label?: string
  scale: AccountingData["scale"]
}) {
  const rows = (payload ?? []).filter((p) => p.value !== null && p.value !== undefined)
  if (!active || rows.length === 0) return null
  // Today carries both the actual and the projected point — show it once, as actual.
  const hasActual = rows.some((r) => r.dataKey === "actual")
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-bold">{label}</p>
      {rows
        .filter((p) => !(p.dataKey === "projected" && hasActual))
        .map((p) => (
          <p key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden="true" />
              {p.name}
            </span>
            <span className="font-bold tabular-nums" dir="ltr">{formatMoney(p.value ?? 0, scale)}</span>
          </p>
        ))}
    </div>
  )
}

export function CashProjectionCard({ data }: { data: AccountingData }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const { compact } = useMoneyFormat()
  const [horizon, setHorizon] = useState<ProjectionHorizon>("weeks")
  const [details, setDetails] = useState(false)
  const [openBucket, setOpenBucket] = useState<number | null>(null)
  const today = isoToday()

  const p = useMemo(
    () =>
      cashProjection(data.entries, {
        asOf: today,
        horizon,
        customerTermDays: data.settings.customerTermDays,
        supplierTermDays: data.settings.supplierTermDays,
        fiscalYearStartMonth: data.settings.fiscalYearStartMonth,
        historyCount: horizon === "weeks" ? 8 : 6,
      }),
    [data.entries, today, horizon, data.settings.customerTermDays, data.settings.supplierTermDays, data.settings.fiscalYearStartMonth]
  )

  const bucketLabel = (i: number) => (horizon === "weeks" ? t("acc_proj_week_short", { n: i + 1 }) : monthName(p.buckets[i].to, locale))
  const todayLabel = t("acc_proj_today")
  const balanceRows = [
    ...p.history.slice(0, -1).map((h, i) => ({
      label: horizon === "weeks" ? t("acc_proj_week_ago", { n: p.history.length - 1 - i }) : monthName(h.date, locale),
      actual: h.balance,
      projected: null as number | null,
    })),
    { label: todayLabel, actual: p.opening, projected: p.opening as number | null },
    ...p.buckets.map((b, i) => ({ label: bucketLabel(i), actual: null as number | null, projected: b.balance })),
  ]
  const flowRows = p.buckets.map((b, i) => ({ label: bucketLabel(i), receipts: b.receipts, payments: b.payments }))
  const tickScale = data.scale === "units" ? "thousands" : data.scale
  const hasFlows = p.buckets.some((b) => b.receipts || b.payments)

  return (
    <AccountingSection
      collapsible
      id="projection"
      defaultOpen
      title={t(horizon === "weeks" ? "acc_proj_title_weeks" : "acc_proj_title_months")}
      icon={TrendingUp}
      summary={<span dir="ltr">{compact(p.opening)} → {compact(p.closing)}</span>}
      action={
        <div className="flex items-center gap-2">
          <ScaleCaption scale={data.scale} />
          <div role="radiogroup" aria-label={t("acc_proj_horizon")} className="flex items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5">
            {(["weeks", "months"] as ProjectionHorizon[]).map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={horizon === h}
                onClick={() => { setHorizon(h); setOpenBucket(null) }}
                className={cn(
                  "h-7 rounded-md px-2.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  horizon === h ? "bg-primary text-white" : "text-slate-600 hover:bg-white"
                )}
              >
                {t(h === "weeks" ? "acc_proj_13_weeks" : "acc_proj_6_months")}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label={t("acc_proj_kpi_today")} value={compact(p.opening)} hint={t("acc_proj_kpi_today_hint")} />
          <Kpi label={t("acc_proj_kpi_locked")} value={compact(p.locked)} hint={t("acc_proj_kpi_locked_hint")} tone="warn" />
          <Kpi
            label={t("acc_proj_kpi_lowest")}
            value={compact(p.lowest.balance)}
            hint={t("acc_proj_kpi_lowest_hint", { when: bucketLabel(p.lowest.index) })}
            tone={p.lowest.balance < 0 ? "bad" : "default"}
          />
          <Kpi label={t("acc_proj_kpi_end")} value={compact(p.closing)} hint={t("acc_proj_kpi_end_hint", { in: compact(p.beyond.receipts), out: compact(p.beyond.payments) })} tone={p.closing >= p.opening ? "good" : "warn"} />
        </div>

        <div className="rounded-xl border bg-white">
          <div className="flex flex-wrap items-center gap-4 px-5 pt-3 text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{t("acc_proj_balance")}</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ backgroundColor: BALANCE }} aria-hidden="true" />{t("acc_proj_actual")}</span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed" style={{ borderColor: BALANCE }} aria-hidden="true" />
              {t("acc_proj_projected")}
            </span>
          </div>
          <div className="h-56 px-2" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={balanceRows} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
                <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
                <XAxis dataKey="label" reversed={isRtl} tick={{ fontSize: 10, fill: CHART_INK.axis }} axisLine={{ stroke: CHART_INK.baseline }} tickLine={false} interval="preserveStartEnd" />
                <YAxis
                  orientation={isRtl ? "right" : "left"}
                  tick={{ fontSize: 11, fill: CHART_INK.axis }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={(v: number) => formatMoneyCompact(v, tickScale)}
                />
                <ReferenceLine x={todayLabel} stroke={CHART_INK.baseline} strokeDasharray="2 3" label={{ value: todayLabel, position: "top", fontSize: 10, fill: CHART_INK.axis }} />
                {p.lowest.balance < 0 && <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeWidth={1} />}
                <Tooltip content={<ProjTooltip scale={data.scale} />} />
                <Line dataKey="actual" name={t("acc_proj_actual")} stroke={BALANCE} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: "#ffffff", fill: BALANCE }} connectNulls={false} type="monotone" />
                <Line dataKey="projected" name={t("acc_proj_projected")} stroke={BALANCE} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3, strokeWidth: 2, stroke: BALANCE, fill: "#ffffff" }} connectNulls={false} type="monotone" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t px-5 pt-3 text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{t(horizon === "weeks" ? "acc_proj_flows_weekly" : "acc_proj_flows_monthly")}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: RECEIPTS }} aria-hidden="true" />{t("acc_proj_receipts")}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PAYMENTS }} aria-hidden="true" />{t("acc_proj_payments")}</span>
          </div>
          {hasFlows ? (
            <div className="h-44 px-2 pb-2" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flowRows} margin={{ top: 8, right: 12, left: 12, bottom: 4 }} barGap={2}>
                  <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
                  <XAxis dataKey="label" reversed={isRtl} tick={{ fontSize: 10, fill: CHART_INK.axis }} axisLine={{ stroke: CHART_INK.baseline }} tickLine={false} />
                  <YAxis
                    orientation={isRtl ? "right" : "left"}
                    tick={{ fontSize: 11, fill: CHART_INK.axis }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                    tickFormatter={(v: number) => formatMoneyCompact(v, tickScale)}
                  />
                  <Tooltip content={<ProjTooltip scale={data.scale} />} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
                  <Bar dataKey="receipts" name={t("acc_proj_receipts")} fill={RECEIPTS} radius={[4, 4, 0, 0]} maxBarSize={14} />
                  <Bar dataKey="payments" name={t("acc_proj_payments")} fill={PAYMENTS} radius={[4, 4, 0, 0]} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="p-8 text-center text-xs text-muted-foreground">{t("acc_proj_no_flows")}</p>
          )}
        </div>

        {(p.overdue.receipts > 0 || p.overdue.payments > 0) && (
          <p className="text-xs text-muted-foreground">
            {t("acc_proj_overdue_note", { in: compact(p.overdue.receipts), out: compact(p.overdue.payments) })}
          </p>
        )}

        <div>
          <button
            type="button"
            aria-expanded={details}
            onClick={() => setDetails((d) => !d)}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-xs font-bold hover:border-module hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("acc_proj_details")}
            <ChevronDown size={13} className={cn("transition-transform", details && "rotate-180")} aria-hidden="true" />
          </button>
          {details && (
            <div className="mt-2 overflow-x-auto rounded-xl border bg-white">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-muted/40 font-black text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{t(horizon === "weeks" ? "acc_proj_week" : "acc_wht_month")}</th>
                    <th className="px-3 py-2 text-start">{t("acc_date_from")}</th>
                    <th className="px-3 py-2 text-start">{t("acc_date_to")}</th>
                    <th className="px-3 py-2 text-end">{t("acc_proj_receipts")}</th>
                    <th className="px-3 py-2 text-end">{t("acc_proj_payments")}</th>
                    <th className="px-3 py-2 text-end">{t("acc_proj_net")}</th>
                    <th className="px-3 py-2 text-end">{t("acc_proj_balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t bg-muted/20 font-bold">
                    <td className="px-3 py-2" colSpan={6}>{t("acc_proj_kpi_today")}</td>
                    <td className="px-3 py-2 text-end"><Money value={p.opening} /></td>
                  </tr>
                  {p.buckets.map((b) => (
                    <BucketRows key={b.index} bucket={b} label={bucketLabel(b.index)} open={openBucket === b.index} onToggle={() => setOpenBucket(openBucket === b.index ? null : b.index)} />
                  ))}
                  <tr className="border-t text-muted-foreground">
                    <td className="px-3 py-2" colSpan={3}>{t("acc_proj_beyond")}</td>
                    <td className="px-3 py-2 text-end"><Money value={p.beyond.receipts} /></td>
                    <td className="px-3 py-2 text-end"><Money value={p.beyond.payments} /></td>
                    <td className="px-3 py-2" colSpan={2} />
                  </tr>
                </tbody>
              </table>
              <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
                {t("acc_proj_method", { customer: data.settings.customerTermDays, supplier: data.settings.supplierTermDays })}
              </p>
            </div>
          )}
        </div>
      </div>
    </AccountingSection>
  )
}

function BucketRows({
  bucket,
  label,
  open,
  onToggle,
}: {
  bucket: ReturnType<typeof cashProjection>["buckets"][number]
  label: string
  open: boolean
  onToggle: () => void
}) {
  const t = useTranslations("Portal.Shared")
  return (
    <>
      <tr className="border-t">
        <td className="px-3 py-2">
          <button
            type="button"
            aria-expanded={open}
            disabled={bucket.items.length === 0}
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded font-semibold hover:text-cta disabled:cursor-default disabled:hover:text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {bucket.items.length > 0 && <ChevronDown size={12} className={cn("transition-transform", !open && "-rotate-90 rtl:rotate-90")} aria-hidden="true" />}
            {label}
          </button>
        </td>
        <td className="px-3 py-2 tabular-nums" dir="ltr">{bucket.from}</td>
        <td className="px-3 py-2 tabular-nums" dir="ltr">{bucket.to}</td>
        <td className="px-3 py-2 text-end"><Money value={bucket.receipts} /></td>
        <td className="px-3 py-2 text-end"><Money value={bucket.payments} /></td>
        <td className="px-3 py-2 text-end"><Money value={bucket.net} /></td>
        <td className="px-3 py-2 text-end font-bold"><Money value={bucket.balance} /></td>
      </tr>
      {open &&
        bucket.items.map((it, i) => (
          <tr key={i} className="bg-muted/20 text-muted-foreground">
            <td className="px-3 py-1.5 ps-8" colSpan={2}>
              {t(KIND_KEY[it.kind])}
              {it.party ? ` — ${it.party}` : ""}
              {it.overdue && <span className="ms-1.5 font-bold text-destructive">· {t("acc_proj_overdue")}</span>}
            </td>
            <td className="px-3 py-1.5 tabular-nums" dir="ltr">{it.date}</td>
            <td className="px-3 py-1.5 text-end">{it.direction === "in" ? <Money value={it.amount} /> : ""}</td>
            <td className="px-3 py-1.5 text-end">{it.direction === "out" ? <Money value={it.amount} /> : ""}</td>
            <td colSpan={2} />
          </tr>
        ))}
    </>
  )
}

function monthName(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", { month: "short", year: "2-digit" })
}

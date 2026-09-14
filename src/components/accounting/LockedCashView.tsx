"use client"

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Hourglass, Lock } from "lucide-react"
import { useAccounting, type AccountingData } from "@/hooks/useAccounting"
import { cn } from "@/lib/utils"
import { ACC } from "@/lib/accounting/accounts"
import { cashConversionCycle, type CashConversionCycle } from "@/lib/accounting/analytics"
import { elapsedDays } from "@/lib/accounting/periods"
import { lockedCash } from "@/lib/accounting/statements"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingSection, AccountingShell, Money, useMoneyFormat } from "./AccountingShell"
import { AccountingToolbar, ScaleCaption } from "./AccountingToolbar"
import { EmptyBooks, Kpi, LoadingBooks } from "./AccountingParts"
import { CHART_SERIES } from "./chart-palette"

const DAYS_FMT = (d: number | null) => (d === null ? "—" : `${Math.round(d)}`)

/**
 * How many days each locked balance takes to come back as cash. Receivables
 * turn at the collection cycle; inventory must first be sold, then collected.
 * Balances released by an event rather than a cycle (retention, guarantee
 * margins, VAT input) say what releases them instead of inventing a number.
 */
function daysToCash(code: string, ccc: CashConversionCycle): { days: number | null; eventKey?: string } {
  switch (code) {
    case ACC.clientsReceivable:
    case ACC.contractAsset:
      return { days: ccc.dso }
    case "1104":
      return { days: ccc.dio === null && ccc.dso === null ? null : (ccc.dio ?? 0) + (ccc.dso ?? 0) }
    case ACC.retentionReceivable:
      return { days: null, eventKey: "acc_ccc_event_retention" }
    case ACC.advancesToSuppliers:
      return { days: null, eventKey: "acc_ccc_event_supplier_advance" }
    case ACC.vatInput:
      return { days: null, eventKey: "acc_ccc_event_vat" }
    case ACC.guaranteeCashMargin:
      return { days: null, eventKey: "acc_ccc_event_guarantee" }
    case ACC.refundableDeposits:
      return { days: null, eventKey: "acc_ccc_event_deposit" }
    default:
      return { days: null, eventKey: "acc_ccc_event_prepaid" }
  }
}

export function LockedCashView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const data = useAccounting()
  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_locked")}
      description={t("acc_locked_desc")}
      icon={Lock}
      toolbar={<AccountingToolbar data={data} />}
    >
      {data.isLoading ? <LoadingBooks /> : data.entries.length === 0 ? <EmptyBooks /> : <LockedCashBody data={data} />}
    </AccountingShell>
  )
}

function LockedCashBody({ data }: { data: AccountingData }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { compact } = useMoneyFormat()
  const locked = useMemo(() => lockedCash(data.windows.closing), [data.windows.closing])
  const days = elapsedDays(data.period.from, data.period.to)
  const ccc = useMemo(() => cashConversionCycle(data.windows, days), [data.windows, days])
  const max = Math.max(...locked.rows.map((r) => r.value), 1)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={t("acc_locked_available")} value={compact(locked.availableCash)} hint={t("acc_locked_available_hint")} tone="good" />
        <Kpi label={t("acc_locked_total")} value={compact(locked.total)} hint={t("acc_locked_total_hint")} tone="warn" />
        <Kpi label={t("acc_locked_ratio")} value={`${Math.round(locked.ratio * 100)}%`} hint={t("acc_locked_ratio_hint")} />
        <Kpi
          label={t("acc_ccc_title_short")}
          value={ccc.ccc === null ? "—" : t("acc_ccc_days", { days: DAYS_FMT(ccc.ccc) })}
          hint={t("acc_ccc_kpi_hint")}
          tone={ccc.ccc === null ? "default" : ccc.ccc > 90 ? "bad" : ccc.ccc > 45 ? "warn" : "good"}
        />
      </div>

      <CashConversionCycleCard ccc={ccc} />

      <AccountingSection title={t("acc_locked_title")} icon={Lock} action={<ScaleCaption scale={data.scale} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-start">{t("acc_locked_item")}</th>
                <th className="px-5 py-2.5 text-end w-32">{t("acc_amount")}</th>
                <th className="px-5 py-2.5 text-start w-40">{t("acc_locked_share")}</th>
                <th className="px-5 py-2.5 text-start w-44">{t("acc_ccc_col_days_to_cash")}</th>
                <th className="px-5 py-2.5 text-start">{t("acc_locked_reason")}</th>
              </tr>
            </thead>
            <tbody>
              {locked.rows.length === 0 && (
                <tr className="border-t">
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted-foreground">{t("acc_locked_nothing")}</td>
                </tr>
              )}
              {locked.rows.map((row) => {
                const turn = daysToCash(row.code, ccc)
                return (
                  <tr key={row.code} className="border-t">
                    <td className="px-5 py-3 font-semibold">
                      <span className="font-mono text-[11px] text-muted-foreground me-1.5" dir="ltr">{row.code}</span>
                      {locale === "ar" ? row.labelAr : row.labelEn}
                    </td>
                    <td className="px-5 py-3 text-end">
                      <Money value={row.value} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-warning rounded-full" style={{ width: `${(row.value / max) * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {turn.days !== null ? (
                        <span className="inline-flex items-center gap-1.5 font-bold">
                          <Hourglass size={12} className="text-muted-foreground" aria-hidden="true" />
                          {t("acc_ccc_days", { days: DAYS_FMT(turn.days) })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{turn.eventKey ? t(turn.eventKey) : "—"}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{t(`acc_locked_reason_${row.code}`)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </AccountingSection>
    </div>
  )
}

/**
 * The cash conversion cycle as a timeline. Day 0 is when the company pays for
 * materials' worth of cost; the top track is how long that cost sits as
 * inventory (DIO) and then as a receivable (DSO) before cash comes back; the
 * middle track is how long suppliers wait to be paid (DPO). What is left
 * between the end of the payables track and the end of the operating track is
 * the cash gap — the days the company finances itself.
 */
export function CashConversionCycleCard({ ccc, compact = false }: { ccc: CashConversionCycle; compact?: boolean }) {
  const t = useTranslations("Portal.Shared")
  const { compact: money } = useMoneyFormat()
  const dio = ccc.dio ?? 0
  const dso = ccc.dso ?? 0
  const dpo = ccc.dpo ?? 0
  const operating = dio + dso
  const span = Math.max(operating, dpo, 1)
  const pct = (d: number) => `${Math.max(0, Math.min(100, (d / span) * 100))}%`
  const gapStart = Math.min(dpo, operating)
  const gap = Math.max(0, operating - dpo)
  const unavailable = ccc.dso === null && ccc.dio === null

  const metrics = [
    { key: "dio", label: t("acc_ccc_dio"), full: t("acc_ccc_dio_full"), days: ccc.dio, color: CHART_SERIES[2], detail: t("acc_ccc_dio_detail", { balance: money(ccc.inventory), flow: money(ccc.costOfRevenue), days: ccc.days }) },
    { key: "dso", label: t("acc_ccc_dso"), full: t("acc_ccc_dso_full"), days: ccc.dso, color: CHART_SERIES[1], detail: t("acc_ccc_dso_detail", { balance: money(ccc.receivables), flow: money(ccc.revenue), days: ccc.days }) },
    { key: "dpo", label: t("acc_ccc_dpo"), full: t("acc_ccc_dpo_full"), days: ccc.dpo, color: CHART_SERIES[3], detail: t("acc_ccc_dpo_detail", { balance: money(ccc.payables), flow: money(ccc.costOfRevenue), days: ccc.days }) },
  ]

  const Segment = ({ start, length, color, label, title }: { start: number; length: number; color: string; label: string; title: string }) =>
    length > 0 ? (
      <div
        className="absolute inset-y-0 rounded flex items-center justify-center overflow-hidden"
        style={{ insetInlineStart: pct(start), width: pct(length), backgroundColor: color }}
        title={title}
      >
        {(length / span) * 100 > 14 && <span className="px-1 text-[11px] font-bold text-white whitespace-nowrap">{label}</span>}
      </div>
    ) : null

  return (
    <AccountingSection title={t("acc_ccc_title")} icon={Hourglass}>
      <div className="p-5 space-y-5">
        {unavailable ? (
          <p className="text-sm text-muted-foreground">{t("acc_ccc_unavailable")}</p>
        ) : (
          <>
            <div className={cn("grid gap-3", compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 lg:grid-cols-4")}>
              {metrics.map((m) => (
                <div key={m.key} className="rounded-xl border p-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: m.color }} aria-hidden="true" />
                    {m.label}
                  </p>
                  <p className="mt-1 text-2xl font-black" dir="ltr">{DAYS_FMT(m.days)}<span className="ms-1 text-xs font-semibold text-muted-foreground">{t("acc_ccc_days_unit")}</span></p>
                  <p className="text-[11px] text-muted-foreground">{m.full}</p>
                  {!compact && <p className="mt-1 text-[10px] text-muted-foreground">{m.detail}</p>}
                </div>
              ))}
              <div className={cn("rounded-xl border p-3", gap > 0 ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5")}>
                <p className="text-xs font-bold text-muted-foreground">{t("acc_ccc_title_short")}</p>
                <p className="mt-1 text-2xl font-black" dir="ltr">{DAYS_FMT(ccc.ccc)}<span className="ms-1 text-xs font-semibold text-muted-foreground">{t("acc_ccc_days_unit")}</span></p>
                <p className="text-[11px] text-muted-foreground">{t("acc_ccc_formula")}</p>
              </div>
            </div>

            <div className="space-y-2" aria-hidden="true">
              <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3">
                <span className="text-[11px] font-semibold text-muted-foreground">{t("acc_ccc_track_operating")}</span>
                <div className="relative h-7 rounded bg-muted/50">
                  <Segment start={0} length={dio} color={CHART_SERIES[2]} label={`${t("acc_ccc_dio")} ${DAYS_FMT(ccc.dio)}`} title={`${t("acc_ccc_dio_full")}: ${DAYS_FMT(ccc.dio)}`} />
                  <Segment start={dio} length={dso} color={CHART_SERIES[1]} label={`${t("acc_ccc_dso")} ${DAYS_FMT(ccc.dso)}`} title={`${t("acc_ccc_dso_full")}: ${DAYS_FMT(ccc.dso)}`} />
                </div>
              </div>
              <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3">
                <span className="text-[11px] font-semibold text-muted-foreground">{t("acc_ccc_track_payables")}</span>
                <div className="relative h-7 rounded bg-muted/50">
                  <Segment start={0} length={dpo} color={CHART_SERIES[3]} label={`${t("acc_ccc_dpo")} ${DAYS_FMT(ccc.dpo)}`} title={`${t("acc_ccc_dpo_full")}: ${DAYS_FMT(ccc.dpo)}`} />
                </div>
              </div>
              <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3">
                <span className="text-[11px] font-semibold text-muted-foreground">{t("acc_ccc_track_gap")}</span>
                <div className="relative h-7 rounded bg-muted/50">
                  {gap > 0 ? (
                    <div
                      className="absolute inset-y-0 rounded border-2 border-warning bg-warning/15 flex items-center justify-center overflow-hidden"
                      style={{ insetInlineStart: pct(gapStart), width: pct(gap) }}
                    >
                      <span className="px-1 text-[11px] font-black text-warning whitespace-nowrap">{t("acc_ccc_days", { days: DAYS_FMT(gap) })}</span>
                    </div>
                  ) : (
                    <span className="absolute inset-0 flex items-center px-2 text-[11px] font-bold text-success">{t("acc_ccc_no_gap")}</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-[7.5rem_1fr] gap-3">
                <span />
                <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
                  <span>{t("acc_ccc_day", { day: 0 })}</span>
                  <span>{t("acc_ccc_day", { day: Math.round(span / 2) })}</span>
                  <span>{t("acc_ccc_day", { day: Math.round(span) })}</span>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {gap > 0 ? t("acc_ccc_gap_explainer", { days: DAYS_FMT(gap) }) : t("acc_ccc_no_gap_explainer")}
            </p>
            <p className="text-[10px] text-muted-foreground">{t("acc_ccc_method_note", { days: ccc.days })}</p>
          </>
        )}
      </div>
    </AccountingSection>
  )
}

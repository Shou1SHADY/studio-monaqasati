"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Boxes,
  Briefcase,
  CheckCircle2,
  FilePlus2,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Lock,
  Power,
  Receipt,
  Scale,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { Bar, CartesianGrid, ComposedChart, Area, AreaChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Link, useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { usePermissions } from "@/hooks/usePermissions"
import { useAccounting, type AccountingData } from "@/hooks/useAccounting"
import { cn } from "@/lib/utils"
import { ACC, CHART_OF_ACCOUNTS, accountName } from "@/lib/accounting/accounts"
import { integrityChecks, nodeNatural } from "@/lib/accounting/balances"
import {
  agingReport,
  cashConversionCycle,
  expenseBreakdown,
  liquidity,
  monthlyTrend,
  projectProfitability,
  type MonthPoint,
} from "@/lib/accounting/analytics"
import { formatMoney, formatMoneyCompact } from "@/lib/accounting/display"
import { elapsedDays, fiscalMonths, fiscalYearLabel, fiscalYearOf, MONTH_NAMES_AR, MONTH_NAMES_EN } from "@/lib/accounting/periods"
import { balanceSheetTree, incomeStatementTree, type TreeNode } from "@/lib/accounting/statement-tree"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingSection, AccountingShell, Money, accountingBasePath, useMoneyFormat } from "./AccountingShell"
import { AccountingToolbar, ScaleCaption, periodLabel, periodRangeText } from "./AccountingToolbar"
import { EmptyBooks, Kpi, LoadingBooks, SOURCE_LABEL_KEY } from "./AccountingParts"
import { StatementTreeTable } from "./StatementTreeTable"
import { AccountBreakdownSheet } from "./AccountBreakdownSheet"
import { CashConversionCycleCard } from "./LockedCashView"
import { accountNode } from "./AccountBreakdownSheet"
import { CHART_INK, CHART_SERIES } from "./chart-palette"

/**
 * The Finance & Accounting dashboard: the company's position for the selected
 * period at a glance — performance and margins, cash and liquidity, where cash
 * is locked and for how long, what is owed both ways and how old it is, the
 * cost mix, inventory across materials / WIP / finished goods, project
 * results, and the statements themselves, expandable in place.
 */
export function AccountingDashboard({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const router = useRouter()
  const data = useAccounting()
  const { can, isLoading: permsLoading } = usePermissions()
  const canView = can("accounting.view")
  const canDocuments = can("invoices.manage")

  // A documents clerk (invoices.manage without accounting.view) opens Finance on
  // the documents desk instead of a dashboard they may not read.
  useEffect(() => {
    if (!permsLoading && !canView && canDocuments) router.replace(`/${portal}/guarantees`)
  }, [permsLoading, canView, canDocuments, router, portal])

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_page_title")}
      description={t("acc_page_desc")}
      icon={LayoutDashboard}
      action={
        can("accounting.post") && (
          <Button asChild className="gap-2">
            <Link href={`${accountingBasePath(portal)}/journal/new`}>
              <FilePlus2 size={16} aria-hidden="true" />
              {t("acc_nav_new_entry")}
            </Link>
          </Button>
        )
      }
      toolbar={<AccountingToolbar data={data} />}
    >
      {data.isLoading ? (
        <LoadingBooks />
      ) : data.entries.length === 0 ? (
        <div className="space-y-4">
          {!data.isEnabled && <ModuleOffCard portal={portal} canEnable={can("accounting.close")} />}
          <EmptyBooks />
        </div>
      ) : (
        <DashboardBody portal={portal} data={data} canDocuments={canDocuments} canPost={can("accounting.post")} />
      )}
    </AccountingShell>
  )
}

function ModuleOffCard({ portal, canEnable }: { portal: CrmPortal; canEnable: boolean }) {
  const t = useTranslations("Portal.Shared")
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
      <div className="flex items-start gap-3">
        <Power size={18} className="mt-0.5 shrink-0 text-warning" />
        <div>
          <p className="text-sm font-bold">{t("acc_dash_module_off_title")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("acc_dash_module_off_desc")}</p>
        </div>
      </div>
      {canEnable && (
        <Button asChild size="sm" variant="outline">
          <Link href={`${accountingBasePath(portal)}/settings`}>{t("acc_nav_settings")}</Link>
        </Button>
      )}
    </div>
  )
}

const pctText = (part: number, whole: number) => (whole > 0.005 ? `${Math.round((part / whole) * 1000) / 10}%` : "—")

function DashboardBody({ portal, data, canDocuments, canPost }: { portal: CrmPortal; data: AccountingData; canDocuments: boolean; canPost: boolean }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { compact } = useMoneyFormat()
  const base = accountingBasePath(portal)
  const [selected, setSelected] = useState<TreeNode | null>(null)

  const { windows, entries } = data
  const income = useMemo(() => incomeStatementTree(windows.movement), [windows.movement])
  const position = useMemo(() => balanceSheetTree(windows.closing), [windows.closing])
  const checks = useMemo(() => integrityChecks(entries, windows), [entries, windows])
  const failing = checks.filter((c) => !c.ok)
  const liq = useMemo(() => liquidity(windows.closing), [windows.closing])
  const days = elapsedDays(data.period.from, data.period.to)
  const ccc = useMemo(() => cashConversionCycle(windows, days), [windows, days])

  const trendYear = data.period.fiscalYear ?? fiscalYearOf(data.period.to, data.settings.fiscalYearStartMonth)
  const months = useMemo(() => fiscalMonths(trendYear, data.settings.fiscalYearStartMonth), [trendYear, data.settings.fiscalYearStartMonth])
  const trend = useMemo(() => monthlyTrend(entries, months, data.filter), [entries, months, data.filter])
  const expenses = useMemo(() => expenseBreakdown(windows.movement), [windows.movement])
  const receivableAging = useMemo(
    () => agingReport(entries, { accounts: [ACC.clientsReceivable], side: "debit", asOf: data.period.to, filter: data.filter }),
    [entries, data.period.to, data.filter]
  )
  const payableAging = useMemo(
    () => agingReport(entries, { accounts: [ACC.suppliersPayable], side: "credit", asOf: data.period.to, filter: data.filter }),
    [entries, data.period.to, data.filter]
  )
  const projects = useMemo(() => projectProfitability(entries, data.period.from, data.period.to), [entries, data.period.from, data.period.to])
  const recent = useMemo(
    () => [...entries].sort((a, b) => (a.date === b.date ? b.entryNumber - a.entryNumber : a.date < b.date ? 1 : -1)).slice(0, 6),
    [entries]
  )

  const totals = income.statement.totals
  const revenue = totals.revenue || 0
  const gross = totals.grossProfit || 0
  const net = totals.netProfit || 0
  const receivables = nodeNatural(windows.closing, ACC.clientsReceivable) + nodeNatural(windows.closing, ACC.retentionReceivable)
  const payables = nodeNatural(windows.closing, ACC.suppliersPayable) + nodeNatural(windows.closing, ACC.subcontractorRetentionPayable)
  const cashAccounts = CHART_OF_ACCOUNTS.filter((a) => a.postable && a.code.startsWith("1101"))
    .map((a) => ({ code: a.code, value: nodeNatural(windows.closing, a.code) }))
    .filter((a) => Math.abs(a.value) > 0.005)

  return (
    <div className="space-y-4">
      {failing.length > 0 && (
        <Link href={`${base}/checks`} className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-destructive">{t("acc_checks_failing_title")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{failing.map((c) => (locale === "ar" ? c.labelAr : c.labelEn)).join(" · ")}</p>
          </div>
        </Link>
      )}

      {/* Performance */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("acc_kpi_revenue")} value={compact(revenue)} hint={t("acc_kpi_revenue_hint")} />
        <Kpi label={t("acc_kpi_gross_profit")} value={compact(gross)} hint={t("acc_kpi_margin", { value: pctText(gross, revenue) })} tone={gross >= 0 ? "good" : "bad"} />
        <Kpi label={t("acc_kpi_net_profit")} value={compact(net)} hint={t("acc_kpi_margin", { value: pctText(net, revenue) })} tone={net >= 0 ? "good" : "bad"} />
        <Link href={`${base}/cash-flow`} title={t("acc_nav_cashflow")} className="rounded-xl text-start transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Kpi label={t("acc_kpi_cash")} value={compact(liq.cash)} hint={t("acc_kpi_cash_hint")} />
        </Link>
      </div>

      {/* Position */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          title={t("acc_tree_open_breakdown")}
          onClick={() => setSelected(accountNode([ACC.clientsReceivable, ACC.retentionReceivable], receivables, { ar: t("acc_kpi_receivables"), en: t("acc_kpi_receivables") }))}
          className="rounded-xl text-start transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Kpi label={t("acc_kpi_receivables")} value={compact(receivables)} hint={t("acc_dash_receivables_hint", { overdue: compact(receivableAging.buckets[2] + receivableAging.buckets[3]) })} tone="warn" />
        </button>
        <button
          type="button"
          title={t("acc_tree_open_breakdown")}
          onClick={() => setSelected(accountNode([ACC.suppliersPayable, ACC.subcontractorRetentionPayable], payables, { ar: t("acc_dash_payables"), en: t("acc_dash_payables") }))}
          className="rounded-xl text-start transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Kpi label={t("acc_dash_payables")} value={compact(payables)} hint={t("acc_dash_payables_hint", { overdue: compact(payableAging.buckets[2] + payableAging.buckets[3]) })} />
        </button>
        <Kpi
          label={t("acc_dash_working_capital")}
          value={compact(liq.workingCapital)}
          hint={t("acc_dash_current_ratio", { ratio: liq.currentRatio === null ? "—" : liq.currentRatio.toFixed(2), quick: liq.quickRatio === null ? "—" : liq.quickRatio.toFixed(2) })}
          tone={liq.workingCapital >= 0 ? "good" : "bad"}
        />
        <Link href={`${base}/locked#ccc`} className="rounded-xl text-start transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Kpi
            label={t("acc_ccc_title_short")}
            value={ccc.ccc === null ? "—" : t("acc_ccc_days", { days: Math.round(ccc.ccc) })}
            hint={t("acc_dash_ccc_hint", { dso: ccc.dso === null ? "—" : Math.round(ccc.dso), dio: ccc.dio === null ? "—" : Math.round(ccc.dio), dpo: ccc.dpo === null ? "—" : Math.round(ccc.dpo) })}
            tone={ccc.ccc === null ? "default" : ccc.ccc > 90 ? "bad" : ccc.ccc > 45 ? "warn" : "good"}
          />
        </Link>
      </div>

      {/* Trend + cash */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AccountingSection
          title={t("acc_dash_trend_title", { year: fiscalYearLabel(trendYear, data.settings.fiscalYearStartMonth) })}
          icon={BarChart3}
          className="lg:col-span-2"
          action={<ScaleCaption scale={data.scale} />}
        >
          <MonthlyPerformanceChart points={trend} scale={data.scale} />
        </AccountingSection>
        <AccountingSection title={t("acc_dash_cash_title")} icon={Wallet}>
          <CashTrendChart points={trend} scale={data.scale} />
          <div className="border-t px-5 py-3 space-y-1.5">
            {cashAccounts.length === 0 && <p className="text-xs text-muted-foreground">{t("acc_dash_no_cash_accounts")}</p>}
            {cashAccounts.map((a) => (
              <button
                key={a.code}
                type="button"
                title={t("acc_tree_open_breakdown")}
                onClick={() => setSelected(accountNode([a.code], a.value))}
                className="flex w-full items-center justify-between gap-2 rounded text-start text-xs hover:text-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Landmark size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="font-mono text-muted-foreground" dir="ltr">{a.code}</span>
                  <span className="truncate underline-offset-4 decoration-dotted hover:underline">{accountName(a.code, locale)}</span>
                </span>
                <Money value={a.value} className="font-bold" />
              </button>
            ))}
          </div>
        </AccountingSection>
      </div>

      {/* Mix, inventory, aging */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AccountingSection title={t("acc_dash_expense_mix_title")} icon={TrendingUp}>
          <div className="p-5 space-y-2.5">
            {expenses.length === 0 && <p className="text-xs text-muted-foreground">{t("acc_dash_no_expenses")}</p>}
            {expenses.map((e) => {
              const total = expenses.reduce((s, x) => s + x.value, 0)
              return (
                <div key={e.code}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{locale === "ar" ? e.nameAr : e.nameEn}</span>
                    <span className="shrink-0 font-bold" dir="ltr">
                      {formatMoneyCompact(e.value, data.scale)} <span className="font-normal text-muted-foreground">· {pctText(e.value, total)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted/60 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: pctText(e.value, expenses[0].value), backgroundColor: CHART_SERIES[1] }} />
                  </div>
                </div>
              )
            })}
          </div>
        </AccountingSection>

        <InventoryCompositionCard data={data} />

        <AccountingSection title={t("acc_dash_aging_title")} icon={Receipt} action={<span className="text-[10px] text-muted-foreground" dir="ltr">{data.period.to}</span>}>
          <div className="p-5 space-y-5">
            <AgingBars label={t("acc_dash_aging_receivables")} buckets={receivableAging.buckets} color={CHART_SERIES[1]} scale={data.scale} />
            <AgingBars label={t("acc_dash_aging_payables")} buckets={payableAging.buckets} color={CHART_SERIES[2]} scale={data.scale} />
            <Link href={`${base}/settlements`} className="inline-flex items-center gap-1 text-xs font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
              <ArrowLeftRight size={12} aria-hidden="true" />
              {t("acc_nav_settlements")}
            </Link>
          </div>
        </AccountingSection>
      </div>

      <CashConversionCycleCard ccc={ccc} compact />

      {/* Statements, expandable in place */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AccountingSection title={`${t("acc_nav_income")} · ${periodLabel(data.period, locale)}`} icon={TrendingUp}>
          <StatementTreeTable nodes={income.nodes} onSelect={setSelected} headerExtra={<ScaleCaption scale={data.scale} />} />
        </AccountingSection>
        <AccountingSection
          title={`${t("acc_nav_balance")} · ${periodRangeText(data.period).split(" – ")[1]}`}
          icon={Scale}
          action={
            position.statement.difference === 0 ? (
              <Badge className="border-none bg-success/10 text-success gap-1"><CheckCircle2 size={11} />{t("acc_tb_balanced")}</Badge>
            ) : (
              <Badge className="border-none bg-destructive/10 text-destructive">{t("acc_bs_unbalanced")}</Badge>
            )
          }
        >
          <StatementTreeTable nodes={position.nodes} onSelect={setSelected} headerExtra={<ScaleCaption scale={data.scale} />} />
        </AccountingSection>
      </div>
      <AccountBreakdownSheet node={selected} data={data} portal={portal} onClose={() => setSelected(null)} />

      {/* Projects, recent activity, shortcuts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AccountingSection title={t("acc_dash_projects_title")} icon={Briefcase} className="lg:col-span-2" action={<ScaleCaption scale={data.scale} />}>
          {projects.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">{t("acc_dash_no_projects")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start">{t("acc_filter_project")}</th>
                    <th className="px-4 py-2.5 text-end">{t("acc_kpi_revenue")}</th>
                    <th className="px-4 py-2.5 text-end">{t("acc_dash_cost")}</th>
                    <th className="px-4 py-2.5 text-end">{t("acc_dash_profit")}</th>
                    <th className="px-4 py-2.5 text-start w-40">{t("acc_dash_margin")}</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.slice(0, 8).map((p) => (
                    <tr key={p.project} className="border-t">
                      <td className="px-4 py-2.5 font-semibold">{p.projectName || data.projects.find((x) => x.id === p.project)?.name || p.project}</td>
                      <td className="px-4 py-2.5 text-end"><Money value={p.revenue} /></td>
                      <td className="px-4 py-2.5 text-end"><Money value={p.cost} /></td>
                      <td className="px-4 py-2.5 text-end font-bold"><Money value={p.profit} /></td>
                      <td className="px-4 py-2.5">
                        {p.margin === null ? (
                          <span className="text-xs text-muted-foreground">{t("acc_dash_no_revenue_yet")}</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                              <div className={cn("h-full rounded-full", p.margin >= 0 ? "bg-success" : "bg-destructive")} style={{ width: `${Math.min(100, Math.abs(p.margin))}%` }} />
                            </div>
                            <span className={cn("w-12 text-end text-xs font-bold tabular-nums", p.margin < 0 && "text-destructive")} dir="ltr">{p.margin}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AccountingSection>

        <div className="space-y-4">
          <AccountingSection title={t("acc_dash_shortcuts_title")} icon={LayoutDashboard}>
            <div className="grid grid-cols-2 gap-2 p-4">
              {[
                canPost && { href: `${base}/journal/new`, icon: FilePlus2, key: "acc_nav_new_entry" },
                { href: `${base}/statements`, icon: FileSpreadsheet, key: "acc_nav_account_statements" },
                { href: `${base}/cash-flow`, icon: Wallet, key: "acc_nav_cashflow" },
                { href: `${base}/settlements`, icon: ArrowLeftRight, key: "acc_nav_settlements" },
                { href: `${base}/locked`, icon: Lock, key: "acc_nav_locked" },
                { href: `${base}/audit-trail`, icon: BookOpen, key: "acc_nav_audit_trail" },
                canDocuments && { href: `/${portal}/guarantees`, icon: Receipt, key: "fin_nav_guarantees" },
              ]
                .filter(Boolean)
                .map((item) => {
                  const it = item as { href: string; icon: typeof FilePlus2; key: string }
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <it.icon size={14} aria-hidden="true" />
                      {t(it.key)}
                    </Link>
                  )
                })}
            </div>
          </AccountingSection>

          <AccountingSection title={t("acc_dash_recent_title")} icon={BookOpen}>
            <ul className="divide-y">
              {recent.map((e) => (
                <li key={e.id}>
                  <Link href={`${base}/journal?entry=${encodeURIComponent(e.id)}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">
                        <span className="me-1 tabular-nums text-muted-foreground" dir="ltr">#{e.entryNumber}</span>
                        {e.description}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        <span dir="ltr">{e.date}</span>
                        {SOURCE_LABEL_KEY[e.sourceType] && ` · ${t(SOURCE_LABEL_KEY[e.sourceType])}`}
                        {e.status === "draft" && ` · ${t("acc_status_draft")}`}
                      </span>
                    </span>
                    <Money value={e.totalDebit} className="shrink-0 text-xs font-bold" />
                  </Link>
                </li>
              ))}
            </ul>
          </AccountingSection>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────────────────────

function monthShort(point: MonthPoint, locale: string): string {
  // labelEn is "April 2026"; the month name alone keeps the axis quiet.
  const idx = MONTH_NAMES_EN.findIndex((m) => point.labelEn.startsWith(m))
  if (idx < 0) return point.key
  return locale === "ar" ? MONTH_NAMES_AR[idx] : MONTH_NAMES_EN[idx].slice(0, 3)
}

function ChartTooltip({
  active,
  payload,
  label,
  scale,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>
  label?: string
  scale: AccountingData["scale"]
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-bold">{label}</p>
      {payload.map((p) => (
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

function SeriesLegend({ items }: { items: Array<{ label: string; color: string; kind: "bar" | "line" }> }) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 pt-3 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.kind === "bar" ? (
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: i.color }} aria-hidden="true" />
          ) : (
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: i.color }} aria-hidden="true" />
          )}
          {i.label}
        </span>
      ))}
    </div>
  )
}

function MonthlyPerformanceChart({ points, scale }: { points: MonthPoint[]; scale: AccountingData["scale"] }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const rows = points.map((p) => ({ ...p, month: monthShort(p, locale) }))
  const hasData = points.some((p) => p.revenue !== 0 || p.expenses !== 0)
  return (
    <div>
      <SeriesLegend
        items={[
          { label: t("acc_kpi_revenue"), color: CHART_SERIES[1], kind: "bar" },
          { label: t("acc_dash_expenses"), color: CHART_SERIES[2], kind: "bar" },
          { label: t("acc_kpi_net_profit"), color: CHART_SERIES[3], kind: "line" },
        ]}
      />
      {hasData ? (
        <div className="h-72 px-2 pb-2" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 12, right: 12, left: 12, bottom: 4 }} barGap={2}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis dataKey="month" reversed={isRtl} tick={{ fontSize: 11, fill: CHART_INK.axis }} axisLine={{ stroke: CHART_INK.baseline }} tickLine={false} />
              <YAxis
                orientation={isRtl ? "right" : "left"}
                tick={{ fontSize: 11, fill: CHART_INK.axis }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={(v: number) => formatMoneyCompact(v, scale === "units" ? "thousands" : scale)}
              />
              <Tooltip content={<ChartTooltip scale={scale} />} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
              <Bar dataKey="revenue" name={t("acc_kpi_revenue")} fill={CHART_SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="expenses" name={t("acc_dash_expenses")} fill={CHART_SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Line dataKey="profit" name={t("acc_kpi_net_profit")} stroke={CHART_SERIES[3]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: CHART_SERIES[3] }} activeDot={{ r: 5 }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="p-10 text-center text-xs text-muted-foreground">{t("acc_dash_no_trend")}</p>
      )}
      <details className="border-t px-5 py-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">{t("acc_dash_show_table")}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-start">{t("acc_period")}</th>
                <th className="py-1 text-end">{t("acc_kpi_revenue")}</th>
                <th className="py-1 text-end">{t("acc_dash_expenses")}</th>
                <th className="py-1 text-end">{t("acc_kpi_net_profit")}</th>
                <th className="py-1 text-end">{t("acc_kpi_cash")}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key} className="border-t border-border/50">
                  <td className="py-1">{locale === "ar" ? p.labelAr : p.labelEn}</td>
                  <td className="py-1 text-end"><Money value={p.revenue} /></td>
                  <td className="py-1 text-end"><Money value={p.expenses} /></td>
                  <td className="py-1 text-end"><Money value={p.profit} /></td>
                  <td className="py-1 text-end"><Money value={p.cash} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function CashTrendChart({ points, scale }: { points: MonthPoint[]; scale: AccountingData["scale"] }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const rows = points.map((p) => ({ ...p, month: monthShort(p, locale) }))
  const last = points[points.length - 1]
  return (
    <div>
      <p className="px-5 pt-3 text-xs text-muted-foreground">
        {t("acc_dash_cash_month_end")} <span className="font-bold text-foreground" dir="ltr">{last ? formatMoneyCompact(last.cash, scale) : "—"}</span>
      </p>
      <div className="h-40 px-2" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
            <XAxis dataKey="month" reversed={isRtl} tick={{ fontSize: 10, fill: CHART_INK.axis }} axisLine={{ stroke: CHART_INK.baseline }} tickLine={false} interval="preserveStartEnd" />
            <YAxis hide />
            <Tooltip content={<ChartTooltip scale={scale} />} />
            <Area dataKey="cash" name={t("acc_kpi_cash")} stroke={CHART_SERIES[1]} strokeWidth={2} fill={CHART_SERIES[1]} fillOpacity={0.1} type="monotone" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const BUCKET_KEYS = ["acc_aging_0_30", "acc_aging_31_60", "acc_aging_61_90", "acc_aging_90_plus"]

function AgingBars({ label, buckets, color, scale }: { label: string; buckets: [number, number, number, number]; color: string; scale: AccountingData["scale"] }) {
  const t = useTranslations("Portal.Shared")
  const max = Math.max(...buckets.map((b) => Math.abs(b)), 1)
  const total = buckets.reduce((s, b) => s + b, 0)
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-bold">{label}</span>
        <span className="font-bold" dir="ltr">{formatMoneyCompact(total, scale)}</span>
      </div>
      <div className="space-y-1">
        {buckets.map((b, i) => (
          <div key={BUCKET_KEYS[i]} className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">{t(BUCKET_KEYS[i])}</span>
            <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(Math.max(0, b) / max) * 100}%`, backgroundColor: color }} />
            </div>
            <span className={cn("text-end tabular-nums", i === 3 && b > 0.5 && "font-bold text-destructive")} dir="ltr">{formatMoneyCompact(b, scale)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function InventoryCompositionCard({ data }: { data: AccountingData }) {
  const t = useTranslations("Portal.Shared")
  const segments = [
    { code: ACC.inventoryMaterials, key: "acc_dash_inv_materials", color: CHART_SERIES[1] },
    { code: ACC.inventoryWip, key: "acc_dash_inv_wip", color: CHART_SERIES[2] },
    { code: ACC.inventoryFinishedGoods, key: "acc_dash_inv_finished", color: CHART_SERIES[3] },
  ].map((s) => ({ ...s, value: nodeNatural(data.windows.closing, s.code) }))
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0)
  return (
    <AccountingSection title={t("acc_dash_inventory_title")} icon={Boxes}>
      <div className="p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">{t("acc_dash_inventory_total")}</span>
          <span className="text-xl font-black" dir="ltr">{formatMoneyCompact(total, data.scale)}</span>
        </div>
        {total > 0.005 ? (
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {segments
              .filter((s) => s.value > 0.005)
              .map((s) => (
                <div key={s.code} className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} />
              ))}
          </div>
        ) : (
          <div className="h-3 w-full rounded-full bg-muted/60" aria-hidden="true" />
        )}
        <div className="space-y-1.5">
          {segments.map((s) => (
            <div key={s.code} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden="true" />
                <span className="font-mono text-muted-foreground" dir="ltr">{s.code}</span>
                {t(s.key)}
              </span>
              <span className="font-bold" dir="ltr">
                {formatMoneyCompact(s.value, data.scale)} <span className="font-normal text-muted-foreground">· {pctText(Math.max(0, s.value), total)}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">{t("acc_dash_inventory_note")}</p>
      </div>
    </AccountingSection>
  )
}

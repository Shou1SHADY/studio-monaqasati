"use client"

// The Accounting screens. Each is a pure read of `useAccounting()` — the
// statements are computed in src/lib/accounting, so nothing here does
// arithmetic beyond formatting.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  FileText,
  ListTree,
  Lock,
  Percent,
  PieChart,
  Scale,
  ShieldCheck,
  TrendingUp,
  Loader2,
  Banknote,
} from "lucide-react"
import { collection, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingShell, AccountingSection, Money } from "./AccountingShell"
import { useAccounting, type AccountingData } from "@/hooks/useAccounting"
import { CHART_OF_ACCOUNTS, accountName, ACC } from "@/lib/accounting/accounts"
import {
  accountLedger,
  integrityChecks,
  nodeNatural,
  trialBalance,
} from "@/lib/accounting/balances"
import {
  balanceSheet,
  cashFlowStatement,
  equityStatement,
  incomeStatement,
  lockedCash,
  type StatementRow,
} from "@/lib/accounting/statements"
import { ACCOUNTING_PERIODS, periodOf, type JournalEntry } from "@/lib/accounting/journal"

// ─────────────────────────────────────────────────────────────────────────────
// Shared chrome
// ─────────────────────────────────────────────────────────────────────────────

function PeriodBar({ data }: { data: AccountingData }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={data.period.key} onValueChange={data.setPeriodKey}>
        <SelectTrigger className="h-9 w-56 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {data.periodOptions.map((p) => (
            <SelectItem key={p.key} value={p.key} className="text-xs">
              {locale === "ar" ? p.labelAr : p.labelEn}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {data.projects.length > 0 && (
        <Select
          value={data.filter.project || "__all__"}
          onValueChange={(v) => data.setFilter({ ...data.filter, project: v === "__all__" ? null : v })}
        >
          <SelectTrigger className="h-9 w-56 text-xs">
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
    </div>
  )
}

function EmptyBooks() {
  const t = useTranslations("Portal.Shared")
  return (
    <div className="p-12 text-center text-muted-foreground border border-dashed rounded-xl">
      <BookOpen size={36} className="mx-auto mb-3 opacity-20" />
      <p className="text-sm font-semibold text-foreground">{t("acc_empty_title")}</p>
      <p className="text-xs mt-1 max-w-md mx-auto">{t("acc_empty_desc")}</p>
    </div>
  )
}

function Kpi({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string
  value: string
  hint?: string
  tone?: "default" | "good" | "warn" | "bad"
}) {
  return (
    <div className="p-4 rounded-xl border bg-white">
      <p className="text-xs text-muted-foreground font-semibold">{label}</p>
      <p
        className={cn(
          "text-xl font-black mt-1 tabular-nums",
          tone === "good" && "text-success",
          tone === "warn" && "text-warning",
          tone === "bad" && "text-destructive"
        )}
        dir="ltr"
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 })

/** Renders a statement row spec — headers, lines, subtotals and totals each
 * carry their own weight so the hierarchy reads without needing indentation. */
function StatementTable({ rows, locale }: { rows: StatementRow[]; locale: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, i) => {
            const label = locale === "ar" ? row.labelAr : row.labelEn
            if (row.type === "header") {
              return (
                <tr key={i} className="bg-muted/40">
                  <td colSpan={2} className="px-5 py-2 text-xs font-black text-muted-foreground">
                    {label}
                  </td>
                </tr>
              )
            }
            const isTotal = row.type === "total"
            const isSubtotal = row.type === "subtotal"
            return (
              <tr
                key={i}
                className={cn(
                  "border-t",
                  isTotal && "bg-primary/5 font-black",
                  isSubtotal && "font-bold bg-muted/20"
                )}
              >
                <td className={cn("px-5 py-2.5", !isTotal && !isSubtotal && "ps-8 text-muted-foreground")}>{label}</td>
                <td className="px-5 py-2.5 text-end">
                  <Money value={row.value} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export function AccountingDashboard({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  const { windows, entries } = data

  const is = useMemo(() => incomeStatement(windows.movement), [windows.movement])
  const bs = useMemo(() => balanceSheet(windows.closing), [windows.closing])
  const cf = useMemo(() => cashFlowStatement(windows), [windows])
  const checks = useMemo(() => integrityChecks(entries, windows), [entries, windows])
  const failing = checks.filter((c) => !c.ok)

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_page_title")}
      description={t("acc_page_desc")}
      action={<PeriodBar data={data} />}
    >
      {data.isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : entries.length === 0 ? (
        <EmptyBooks />
      ) : (
        <>
          {failing.length > 0 && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5">
              <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-destructive">{t("acc_checks_failing_title")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {failing.map((c) => (locale === "ar" ? c.labelAr : c.labelEn)).join(" · ")}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={t("acc_kpi_revenue")} value={fmt(is.totals.revenue || 0)} hint={t("acc_kpi_revenue_hint")} />
            <Kpi
              label={t("acc_kpi_net_profit")}
              value={fmt(is.totals.netProfit || 0)}
              hint={t("acc_kpi_net_profit_hint")}
              tone={(is.totals.netProfit || 0) >= 0 ? "good" : "bad"}
            />
            <Kpi label={t("acc_kpi_cash")} value={fmt(cf.closingCash)} hint={t("acc_kpi_cash_hint")} />
            <Kpi
              label={t("acc_kpi_receivables")}
              value={fmt(nodeNatural(windows.closing, ACC.clientsReceivable))}
              hint={t("acc_kpi_receivables_hint")}
              tone="warn"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AccountingSection title={t("acc_nav_income")} icon={TrendingUp}>
              <StatementTable rows={is.rows.filter((r) => r.type !== "line")} locale={locale} />
            </AccountingSection>
            <AccountingSection title={t("acc_position_summary")} icon={Scale}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      [t("acc_bs_total_assets"), bs.totalAssets],
                      [bs.currentLiabilities.labelAr, bs.currentLiabilities.total],
                      [bs.equity.labelAr, bs.equity.total],
                    ].map(([label, value], i) => (
                      <tr key={i} className="border-t">
                        <td className="px-5 py-2.5">{label as string}</td>
                        <td className="px-5 py-2.5 text-end">
                          <Money value={value as number} />
                        </td>
                      </tr>
                    ))}
                    <tr className={cn("border-t font-black", bs.difference === 0 ? "bg-success/5" : "bg-destructive/5")}>
                      <td className="px-5 py-2.5">{t("acc_bs_balanced")}</td>
                      <td className="px-5 py-2.5 text-end">
                        {bs.difference === 0 ? (
                          <span className="text-success flex items-center gap-1.5 justify-end">
                            <CheckCircle2 size={14} />
                            {t("acc_yes")}
                          </span>
                        ) : (
                          <Money value={bs.difference} />
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </AccountingSection>
          </div>
        </>
      )}
    </AccountingShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Statements
// ─────────────────────────────────────────────────────────────────────────────

function StatementPage({
  portal,
  titleKey,
  descKey,
  icon,
  render,
}: {
  portal: CrmPortal
  titleKey: string
  descKey: string
  icon: typeof TrendingUp
  render: (data: AccountingData, locale: string) => React.ReactNode
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  return (
    <AccountingShell
      portal={portal}
      title={t(titleKey)}
      description={t(descKey)}
      icon={icon}
      action={<PeriodBar data={data} />}
    >
      {data.isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : data.entries.length === 0 ? (
        <EmptyBooks />
      ) : (
        render(data, locale)
      )}
    </AccountingShell>
  )
}

export function IncomeStatementView({ portal }: { portal: CrmPortal }) {
  return (
    <StatementPage
      portal={portal}
      titleKey="acc_nav_income"
      descKey="acc_income_desc"
      icon={TrendingUp}
      render={(data, locale) => (
        <AccountingSection title={data.period.labelAr} icon={TrendingUp}>
          <StatementTable rows={incomeStatement(data.windows.movement).rows} locale={locale} />
        </AccountingSection>
      )}
    />
  )
}

export function BalanceSheetView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  return (
    <StatementPage
      portal={portal}
      titleKey="acc_nav_balance"
      descKey="acc_balance_desc"
      icon={Scale}
      render={(data, locale) => {
        const bs = balanceSheet(data.windows.closing)
        const sections = [bs.currentAssets, bs.nonCurrentAssets, bs.currentLiabilities, bs.nonCurrentLiabilities, bs.equity]
        return (
          <div className="space-y-4">
            {bs.difference !== 0 && (
              <div className="flex items-start gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5">
                <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-destructive">{t("acc_bs_unbalanced")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("acc_bs_difference")}: {bs.difference.toLocaleString("en-US")}
                  </p>
                </div>
              </div>
            )}
            {sections.map((sec) => (
              <AccountingSection key={sec.labelAr} title={locale === "ar" ? sec.labelAr : sec.labelEn} icon={Scale}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {sec.rows.map((row) => (
                        <tr key={row.code} className="border-t">
                          <td className="px-5 py-2.5 text-muted-foreground">
                            {locale === "ar" ? row.labelAr : row.labelEn}
                          </td>
                          <td className="px-5 py-2.5 text-end">
                            <Money value={row.value} />
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/20 font-black">
                        <td className="px-5 py-2.5">{t("acc_total")}</td>
                        <td className="px-5 py-2.5 text-end">
                          <Money value={sec.total} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </AccountingSection>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Kpi label={t("acc_bs_total_assets")} value={fmt(bs.totalAssets)} />
              <Kpi
                label={t("acc_bs_total_liab_equity")}
                value={fmt(bs.totalLiabilitiesAndEquity)}
                tone={bs.difference === 0 ? "good" : "bad"}
              />
            </div>
          </div>
        )
      }}
    />
  )
}

export function CashFlowView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  return (
    <StatementPage
      portal={portal}
      titleKey="acc_nav_cashflow"
      descKey="acc_cashflow_desc"
      icon={Banknote}
      render={(data, locale) => {
        const cf = cashFlowStatement(data.windows)
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label={t("acc_cf_operating")} value={fmt(cf.operating)} tone={cf.operating >= 0 ? "good" : "bad"} />
              <Kpi label={t("acc_cf_investing")} value={fmt(cf.investing)} />
              <Kpi label={t("acc_cf_financing")} value={fmt(cf.financing)} />
              <Kpi
                label={t("acc_cf_net_change")}
                value={fmt(cf.netChange)}
                tone={cf.netChange >= 0 ? "good" : "bad"}
                hint={cf.difference === 0 ? t("acc_cf_reconciled") : t("acc_cf_not_reconciled")}
              />
            </div>
            <AccountingSection title={data.period.labelAr} icon={Banknote}>
              <StatementTable rows={cf.rows} locale={locale} />
            </AccountingSection>
          </div>
        )
      }}
    />
  )
}

export function EquityView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  return (
    <StatementPage
      portal={portal}
      titleKey="acc_nav_equity"
      descKey="acc_equity_desc"
      icon={PieChart}
      render={(data, locale) => {
        const eq = equityStatement(data.windows)
        return (
          <AccountingSection title={data.period.labelAr} icon={PieChart}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5 text-start">{t("acc_equity_movement")}</th>
                    <th className="px-5 py-2.5 text-end">{t("acc_equity_capital")}</th>
                    <th className="px-5 py-2.5 text-end">{t("acc_equity_retained")}</th>
                    <th className="px-5 py-2.5 text-end">{t("acc_total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {eq.rows.map((row, i) => (
                    <tr key={i} className={cn("border-t", i === eq.rows.length - 1 && "bg-primary/5 font-black")}>
                      <td className="px-5 py-2.5">{locale === "ar" ? row.labelAr : row.labelEn}</td>
                      <td className="px-5 py-2.5 text-end">
                        <Money value={row.capital} />
                      </td>
                      <td className="px-5 py-2.5 text-end">
                        <Money value={row.retained} />
                      </td>
                      <td className="px-5 py-2.5 text-end">
                        <Money value={row.total} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AccountingSection>
        )
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Books
// ─────────────────────────────────────────────────────────────────────────────

export function ChartOfAccountsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_coa")}
      description={t("acc_coa_desc")}
      icon={ListTree}
      action={<PeriodBar data={data} />}
    >
      <AccountingSection title={t("acc_coa_title")} icon={ListTree}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-start w-28">{t("acc_account_code")}</th>
                <th className="px-5 py-2.5 text-start">{t("acc_account_name")}</th>
                <th className="px-5 py-2.5 text-start w-24">{t("acc_account_nature")}</th>
                <th className="px-5 py-2.5 text-end w-40">{t("acc_closing_balance")}</th>
              </tr>
            </thead>
            <tbody>
              {CHART_OF_ACCOUNTS.map((a) => (
                <tr key={a.code} className={cn("border-t", a.level <= 2 && "bg-muted/20 font-bold")}>
                  <td className="px-5 py-2 tabular-nums text-muted-foreground" dir="ltr">
                    {a.code}
                  </td>
                  <td className="px-5 py-2" style={{ paddingInlineStart: `${a.level * 14}px` }}>
                    {locale === "ar" ? a.nameAr : a.nameEn}
                    {!a.postable && (
                      <Badge variant="outline" className="ms-2 text-[10px]">
                        {t("acc_rollup")}
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-2 text-xs text-muted-foreground">
                    {a.nature === "D" ? t("acc_debit") : t("acc_credit")}
                  </td>
                  <td className="px-5 py-2 text-end">
                    <Money value={nodeNatural(data.windows.closing, a.code)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AccountingSection>
    </AccountingShell>
  )
}

export function TrialBalanceView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  return (
    <StatementPage
      portal={portal}
      titleKey="acc_nav_trial_balance"
      descKey="acc_tb_desc"
      icon={Scale}
      render={(data, locale) => {
        const tb = trialBalance(data.windows)
        return (
          <AccountingSection
            title={data.period.labelAr}
            icon={Scale}
            action={
              <Badge className={cn("border-none", tb.difference === 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                {tb.difference === 0 ? t("acc_tb_balanced") : `${t("acc_bs_difference")}: ${tb.difference}`}
              </Badge>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start">{t("acc_account_name")}</th>
                    <th className="px-4 py-2.5 text-end">{t("acc_movement_debit")}</th>
                    <th className="px-4 py-2.5 text-end">{t("acc_movement_credit")}</th>
                    <th className="px-4 py-2.5 text-end">{t("acc_closing_debit")}</th>
                    <th className="px-4 py-2.5 text-end">{t("acc_closing_credit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tb.rows.map((row) => (
                    <tr key={row.code} className="border-t">
                      <td className="px-4 py-2">
                        <span className="text-muted-foreground tabular-nums me-2" dir="ltr">
                          {row.code}
                        </span>
                        {accountName(row.code, locale)}
                      </td>
                      <td className="px-4 py-2 text-end"><Money value={row.movementDebit} /></td>
                      <td className="px-4 py-2 text-end"><Money value={row.movementCredit} /></td>
                      <td className="px-4 py-2 text-end"><Money value={row.closingDebit} /></td>
                      <td className="px-4 py-2 text-end"><Money value={row.closingCredit} /></td>
                    </tr>
                  ))}
                  <tr className="border-t bg-primary/5 font-black">
                    <td className="px-4 py-2.5">{t("acc_total")}</td>
                    <td className="px-4 py-2.5 text-end"><Money value={tb.totals.movementDebit} /></td>
                    <td className="px-4 py-2.5 text-end"><Money value={tb.totals.movementCredit} /></td>
                    <td className="px-4 py-2.5 text-end"><Money value={tb.totals.closingDebit} /></td>
                    <td className="px-4 py-2.5 text-end"><Money value={tb.totals.closingCredit} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </AccountingSection>
        )
      }}
    />
  )
}

const SOURCE_LABEL_KEY: Record<string, string> = {
  ipc_claim: "acc_src_ipc_claim",
  ipc_collection: "acc_src_ipc_collection",
  sales_quotation: "acc_src_sales_quotation",
  sales_payment: "acc_src_sales_payment",
  work_order_issue: "acc_src_work_order_issue",
  work_order_delivery: "acc_src_work_order_delivery",
  material_issue: "acc_src_material_issue",
  payroll: "acc_src_payroll",
  manual_voucher: "acc_src_manual_voucher",
  opening: "acc_src_opening",
}

export function JournalView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  const [openId, setOpenId] = useState<string | null>(null)

  const inPeriod = useMemo(
    () =>
      data.entries
        .filter((e) => e.date >= data.period.from && e.date <= data.period.to)
        .sort((a, b) => (a.date === b.date ? b.entryNumber - a.entryNumber : a.date < b.date ? 1 : -1)),
    [data.entries, data.period]
  )

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_journal")}
      description={t("acc_journal_desc")}
      icon={BookOpen}
      action={<PeriodBar data={data} />}
    >
      {data.isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : inPeriod.length === 0 ? (
        <EmptyBooks />
      ) : (
        <AccountingSection title={t("acc_journal_entries", { count: inPeriod.length })} icon={BookOpen}>
          <div className="divide-y">
            {inPeriod.map((entry) => (
              <JournalRow
                key={entry.id}
                entry={entry}
                locale={locale}
                open={openId === entry.id}
                onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
              />
            ))}
          </div>
        </AccountingSection>
      )}
    </AccountingShell>
  )
}

function JournalRow({
  entry,
  locale,
  open,
  onToggle,
}: {
  entry: JournalEntry
  locale: string
  open: boolean
  onToggle: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const srcKey = SOURCE_LABEL_KEY[entry.sourceType]
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-start flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black text-muted-foreground tabular-nums" dir="ltr">
              #{entry.entryNumber}
            </span>
            <span className="font-semibold text-sm truncate">{entry.description}</span>
            {srcKey && (
              <Badge variant="outline" className="text-[10px]">
                {t(srcKey)}
              </Badge>
            )}
            {entry.status === "draft" && (
              <Badge className="bg-warning/10 text-warning border-none text-[10px]">{t("acc_status_draft")}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">
            {entry.date}
          </p>
        </div>
        <Money value={entry.totalDebit} className="text-sm font-bold shrink-0" />
      </button>
      {open && (
        <div className="px-5 pb-4 bg-muted/20">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground font-bold">
              <tr>
                <th className="py-2 text-start">{t("acc_account_name")}</th>
                <th className="py-2 text-end w-28">{t("acc_debit")}</th>
                <th className="py-2 text-end w-28">{t("acc_credit")}</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="py-1.5">
                    <span className="tabular-nums text-muted-foreground me-2" dir="ltr">
                      {line.account}
                    </span>
                    {accountName(line.account, locale)}
                    {line.note && <span className="text-muted-foreground"> — {line.note}</span>}
                  </td>
                  <td className="py-1.5 text-end">{line.debit ? <Money value={line.debit} /> : "—"}</td>
                  <td className="py-1.5 text-end">{line.credit ? <Money value={line.credit} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function LedgerView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  const [account, setAccount] = useState<string>(ACC.bankMain)

  const ledger = useMemo(
    () => accountLedger(data.entries, account, data.period.from, data.period.to, data.filter),
    [data.entries, account, data.period, data.filter]
  )

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_ledger")}
      description={t("acc_ledger_desc")}
      icon={FileText}
      action={<PeriodBar data={data} />}
    >
      <div className="flex items-center gap-2">
        <Select value={account} onValueChange={setAccount}>
          <SelectTrigger className="h-9 w-80 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHART_OF_ACCOUNTS.filter((a) => a.postable).map((a) => (
              <SelectItem key={a.code} value={a.code} className="text-xs">
                {a.code} — {locale === "ar" ? a.nameAr : a.nameEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AccountingSection title={accountName(account, locale)} icon={FileText}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-start w-28">{t("acc_date")}</th>
                <th className="px-4 py-2.5 text-start">{t("acc_description")}</th>
                <th className="px-4 py-2.5 text-end w-28">{t("acc_debit")}</th>
                <th className="px-4 py-2.5 text-end w-28">{t("acc_credit")}</th>
                <th className="px-4 py-2.5 text-end w-32">{t("acc_balance")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t bg-muted/20 font-bold">
                <td className="px-4 py-2" colSpan={4}>
                  {t("acc_opening_balance")}
                </td>
                <td className="px-4 py-2 text-end">
                  <Money value={ledger.openingBalance} />
                </td>
              </tr>
              {ledger.rows.map((row, i) => (
                <tr key={i} className="border-t">
                  <td className="px-4 py-2 tabular-nums text-muted-foreground" dir="ltr">
                    {row.date}
                  </td>
                  <td className="px-4 py-2">{row.description}</td>
                  <td className="px-4 py-2 text-end">{row.debit ? <Money value={row.debit} /> : "—"}</td>
                  <td className="px-4 py-2 text-end">{row.credit ? <Money value={row.credit} /> : "—"}</td>
                  <td className="px-4 py-2 text-end">
                    <Money value={row.balance} />
                  </td>
                </tr>
              ))}
              <tr className="border-t bg-primary/5 font-black">
                <td className="px-4 py-2.5" colSpan={4}>
                  {t("acc_closing_balance")}
                </td>
                <td className="px-4 py-2.5 text-end">
                  <Money value={ledger.closingBalance} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AccountingSection>
    </AccountingShell>
  )
}

export function ChecksView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  return (
    <StatementPage
      portal={portal}
      titleKey="acc_nav_checks"
      descKey="acc_checks_desc"
      icon={ShieldCheck}
      render={(data, locale) => {
        const checks = integrityChecks(data.entries, data.windows)
        const bs = balanceSheet(data.windows.closing)
        const cf = cashFlowStatement(data.windows)
        const all = [
          ...checks,
          {
            id: "balance_sheet",
            labelAr: "توازن المركز المالي",
            labelEn: "Statement of financial position balances",
            ok: bs.difference === 0,
            detail: `${t("acc_bs_total_assets")} ${fmt(bs.totalAssets)} / ${fmt(bs.totalLiabilitiesAndEquity)}`,
          },
          {
            id: "cash_flow",
            labelAr: "مطابقة التدفق النقدي مع رصيد البنك",
            labelEn: "Cash flow reconciles to the bank balance",
            ok: cf.difference === 0,
            detail: `${fmt(cf.openingCash)} + ${fmt(cf.netChange)} = ${fmt(cf.closingCash)}`,
          },
        ]
        const allOk = all.every((c) => c.ok)
        return (
          <div className="space-y-4">
            <div
              className={cn(
                "flex items-start gap-3 p-4 rounded-xl border",
                allOk ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"
              )}
            >
              {allOk ? (
                <CheckCircle2 size={18} className="text-success shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
              )}
              <div>
                <p className={cn("text-sm font-bold", allOk ? "text-success" : "text-destructive")}>
                  {allOk ? t("acc_checks_all_ok") : t("acc_checks_failing_title")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {allOk ? t("acc_checks_all_ok_desc") : t("acc_checks_failing_desc")}
                </p>
              </div>
            </div>
            <AccountingSection title={t("acc_checks_title")} icon={ShieldCheck}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {all.map((c) => (
                      <tr key={c.id} className="border-t">
                        <td className="px-5 py-3 w-24">
                          <Badge
                            className={cn(
                              "border-none",
                              c.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                            )}
                          >
                            {c.ok ? t("acc_check_ok") : t("acc_check_failed")}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 font-semibold">{locale === "ar" ? c.labelAr : c.labelEn}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AccountingSection>
          </div>
        )
      }}
    />
  )
}

export function PeriodsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canClose = can("accounting.close")
  const data = useAccounting()
  const [busy, setBusy] = useState<string | null>(null)

  // Every month that carries an entry, newest first — the only periods there is
  // anything to close.
  const months = useMemo(() => {
    const set = new Set(data.entries.map((e) => periodOf(e.date)))
    return Array.from(set).sort().reverse()
  }, [data.entries])

  const toggle = async (month: string, close: boolean) => {
    if (!firestore || busy) return
    setBusy(month)
    try {
      const existing = data.periods.find((p) => p.period === month)
      if (existing) {
        await updateDoc(doc(firestore, ACCOUNTING_PERIODS, existing.id), {
          status: close ? "closed" : "open",
          closedAt: close ? new Date().toISOString() : null,
          closedByUserId: close ? data.userId : null,
          closedByUserName: close ? data.userName : null,
        })
      } else {
        await addDoc(collection(firestore, ACCOUNTING_PERIODS), {
          organizationId: data.organizationId,
          period: month,
          status: close ? "closed" : "open",
          closedAt: close ? new Date().toISOString() : null,
          closedByUserId: close ? data.userId : null,
          closedByUserName: close ? data.userName : null,
          createdAt: serverTimestamp(),
        })
      }
      toast({ title: close ? t("acc_period_closed") : t("acc_period_reopened") })
    } catch (err) {
      console.error(err)
      toast({ title: t("acc_save_error"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <AccountingShell portal={portal} title={t("acc_nav_periods")} description={t("acc_periods_desc")} icon={CalendarClock}>
      <AccountingSection title={t("acc_periods_title")} icon={CalendarClock}>
        {months.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("acc_empty_title")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-start">{t("acc_period")}</th>
                  <th className="px-5 py-2.5 text-start">{t("acc_status")}</th>
                  <th className="px-5 py-2.5 text-end">{t("acc_action")}</th>
                </tr>
              </thead>
              <tbody>
                {months.map((month) => {
                  const rec = data.periods.find((p) => p.period === month)
                  const closed = rec?.status === "closed"
                  return (
                    <tr key={month} className="border-t">
                      <td className="px-5 py-3 tabular-nums" dir="ltr">
                        {month}
                      </td>
                      <td className="px-5 py-3">
                        <Badge
                          className={cn(
                            "border-none",
                            closed ? "bg-muted text-muted-foreground" : "bg-success/10 text-success"
                          )}
                        >
                          {closed ? t("acc_period_status_closed") : t("acc_period_status_open")}
                        </Badge>
                        {closed && rec?.closedByUserName && (
                          <span className="text-[11px] text-muted-foreground ms-2">{rec.closedByUserName}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-end">
                        {canClose && (
                          <Button
                            size="sm"
                            variant={closed ? "outline" : "default"}
                            className="gap-1.5 h-8"
                            disabled={busy === month}
                            onClick={() => toggle(month, !closed)}
                          >
                            {busy === month ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : closed ? (
                              <CalendarClock size={13} />
                            ) : (
                              <Lock size={13} />
                            )}
                            {closed ? t("acc_reopen_period") : t("acc_close_period")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </AccountingSection>
    </AccountingShell>
  )
}

export function VatView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  return (
    <StatementPage
      portal={portal}
      titleKey="acc_nav_vat"
      descKey="acc_vat_desc"
      icon={Percent}
      render={(data) => {
        const output = nodeNatural(data.windows.movement, ACC.vatOutput)
        const input = nodeNatural(data.windows.movement, ACC.vatInput)
        const net = Math.round((output - input) * 100) / 100
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Kpi label={t("acc_vat_output")} value={fmt(output)} hint={t("acc_vat_output_hint")} />
              <Kpi label={t("acc_vat_input")} value={fmt(input)} hint={t("acc_vat_input_hint")} />
              <Kpi
                label={net >= 0 ? t("acc_vat_payable") : t("acc_vat_reclaim")}
                value={fmt(Math.abs(net))}
                tone={net >= 0 ? "warn" : "good"}
                hint={t("acc_vat_net_hint")}
              />
            </div>
            <AccountingSection title={t("acc_vat_title")} icon={Percent}>
              <div className="p-5 text-sm text-muted-foreground">{t("acc_vat_explainer")}</div>
            </AccountingSection>
          </div>
        )
      }}
    />
  )
}

export function LockedCashView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  return (
    <StatementPage
      portal={portal}
      titleKey="acc_nav_locked"
      descKey="acc_locked_desc"
      icon={Lock}
      render={(data, locale) => {
        const locked = lockedCash(data.windows.closing)
        const max = Math.max(...locked.rows.map((r) => r.value), 1)
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Kpi label={t("acc_locked_available")} value={fmt(locked.availableCash)} hint={t("acc_locked_available_hint")} tone="good" />
              <Kpi label={t("acc_locked_total")} value={fmt(locked.total)} hint={t("acc_locked_total_hint")} tone="warn" />
              <Kpi label={t("acc_locked_ratio")} value={`${Math.round(locked.ratio * 100)}%`} hint={t("acc_locked_ratio_hint")} />
            </div>
            <AccountingSection title={t("acc_locked_title")} icon={Lock}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2.5 text-start">{t("acc_locked_item")}</th>
                      <th className="px-5 py-2.5 text-end w-32">{t("acc_amount")}</th>
                      <th className="px-5 py-2.5 text-start w-40">{t("acc_locked_share")}</th>
                      <th className="px-5 py-2.5 text-start">{t("acc_locked_reason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locked.rows.map((row) => (
                      <tr key={row.code} className="border-t">
                        <td className="px-5 py-3 font-semibold">{locale === "ar" ? row.labelAr : row.labelEn}</td>
                        <td className="px-5 py-3 text-end">
                          <Money value={row.value} />
                        </td>
                        <td className="px-5 py-3">
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-warning rounded-full" style={{ width: `${(row.value / max) * 100}%` }} />
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{row.reasonAr}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AccountingSection>
          </div>
        )
      }}
    />
  )
}

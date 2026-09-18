"use client"

// The Accounting screens. Each is a pure read of `useAccounting()` — the
// statements are computed in src/lib/accounting, so nothing here does
// arithmetic beyond formatting.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  FilePlus2,
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
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Send,
  Trash2,
} from "lucide-react"
import { collection, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingShell, AccountingSection, Money, accountingBasePath, useMoneyFormat } from "./AccountingShell"
import { AccountingToolbar, ScaleCaption, periodLabel, periodRangeText } from "./AccountingToolbar"
import { StatementTreeTable } from "./StatementTreeTable"
import { AccountBreakdownSheet, accountNode } from "./AccountBreakdownSheet"
import { useAccounting, type AccountingData } from "@/hooks/useAccounting"
import { CHART_OF_ACCOUNTS, accountName, naturalSign, ACC } from "@/lib/accounting/accounts"
import { accountLedger, integrityChecks, nodeNatural, trialBalance } from "@/lib/accounting/balances"
import { balanceSheet, cashFlowStatement, equityStatement } from "@/lib/accounting/statements"
import { balanceSheetTree, cashFlowTree, incomeStatementTree, type TreeNode } from "@/lib/accounting/statement-tree"
import { ACCOUNTING_PERIODS, ClosedPeriodError, periodOf, type JournalEntry } from "@/lib/accounting/journal"
import { deleteDraftEntry, postDraftEntry, reverseJournalEntry } from "@/lib/accounting/manual-entry"
import { isoToday } from "@/lib/accounting/periods"

import { EmptyBooks, Kpi, LoadingBooks } from "./AccountingParts"
import { JournalEntryBadges, JournalEntryFacts, JournalEntryLines, JournalEntrySheet } from "./JournalEntrySheet"

export { AccountingDashboard } from "./FinanceDashboard"
export { LockedCashView } from "./LockedCashView"
export { NewJournalEntryView } from "./JournalEntryForm"
export { AccountStatementsView } from "./AccountStatementsView"
export { SettlementsView } from "./SettlementsView"
export { AuditTrailView } from "./AuditTrailView"
export { AccountingSettingsView } from "./AccountingSettingsView"

// ─────────────────────────────────────────────────────────────────────────────
// Shared chrome
// ─────────────────────────────────────────────────────────────────────────────

/** A screen that reads the period: shell, shared toolbar, loading and empty states. */
function StatementPage({
  portal,
  titleKey,
  descKey,
  icon,
  action,
  render,
}: {
  portal: CrmPortal
  titleKey: string
  descKey: string
  icon: typeof TrendingUp
  action?: ReactNode
  render: (data: AccountingData, locale: string) => ReactNode
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
      action={action}
      toolbar={<AccountingToolbar data={data} />}
    >
      {data.isLoading ? <LoadingBooks /> : data.entries.length === 0 ? <EmptyBooks /> : render(data, locale)}
    </AccountingShell>
  )
}

function periodTitle(data: AccountingData, locale: string): string {
  return `${periodLabel(data.period, locale)} · ${periodRangeText(data.period)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Statements — expandable, every figure drills into its accounts
// ─────────────────────────────────────────────────────────────────────────────

function TreeStatement({
  portal,
  data,
  locale,
  icon,
  nodes,
}: {
  portal: CrmPortal
  data: AccountingData
  locale: string
  icon: typeof TrendingUp
  nodes: TreeNode[]
}) {
  const [selected, setSelected] = useState<TreeNode | null>(null)
  return (
    <>
      <AccountingSection title={periodTitle(data, locale)} icon={icon}>
        <StatementTreeTable nodes={nodes} onSelect={setSelected} initialDepth={1} headerExtra={<ScaleCaption scale={data.scale} />} />
      </AccountingSection>
      <AccountBreakdownSheet node={selected} data={data} portal={portal} onClose={() => setSelected(null)} />
    </>
  )
}

export function IncomeStatementView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  return (
    <StatementPage
      portal={portal}
      titleKey="acc_nav_income"
      descKey="acc_income_desc"
      icon={TrendingUp}
      render={(data, locale) => {
        const { nodes, statement } = incomeStatementTree(data.windows.movement)
        const revenue = statement.totals.revenue || 0
        const margin = (v: number) => (revenue > 0 ? `${Math.round((v / revenue) * 1000) / 10}%` : "—")
        return (
          <div className="space-y-4">
            <IncomeKpis data={data} revenue={revenue} gross={statement.totals.grossProfit || 0} operating={statement.totals.operating || 0} net={statement.totals.netProfit || 0} margin={margin} t={t} />
            <TreeStatement portal={portal} data={data} locale={locale} icon={TrendingUp} nodes={nodes} />
          </div>
        )
      }}
    />
  )
}

function IncomeKpis({
  revenue,
  gross,
  operating,
  net,
  margin,
  t,
}: {
  data: AccountingData
  revenue: number
  gross: number
  operating: number
  net: number
  margin: (v: number) => string
  t: ReturnType<typeof useTranslations>
}) {
  const { compact } = useMoneyFormat()
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi label={t("acc_kpi_revenue")} value={compact(revenue)} />
      <Kpi label={t("acc_kpi_gross_profit")} value={compact(gross)} hint={t("acc_kpi_margin", { value: margin(gross) })} tone={gross >= 0 ? "good" : "bad"} />
      <Kpi label={t("acc_kpi_operating_profit")} value={compact(operating)} hint={t("acc_kpi_margin", { value: margin(operating) })} tone={operating >= 0 ? "good" : "bad"} />
      <Kpi label={t("acc_kpi_net_profit")} value={compact(net)} hint={t("acc_kpi_margin", { value: margin(net) })} tone={net >= 0 ? "good" : "bad"} />
    </div>
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
        const { nodes, statement: bs } = balanceSheetTree(data.windows.closing)
        return (
          <div className="space-y-4">
            {bs.difference !== 0 && (
              <div className="flex items-start gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5">
                <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-destructive">{t("acc_bs_unbalanced")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("acc_bs_difference")}: <Money value={bs.difference} />
                  </p>
                </div>
              </div>
            )}
            <BalanceKpis totalAssets={bs.totalAssets} totalLe={bs.totalLiabilitiesAndEquity} balanced={bs.difference === 0} t={t} />
            <TreeStatement portal={portal} data={data} locale={locale} icon={Scale} nodes={nodes} />
          </div>
        )
      }}
    />
  )
}

function BalanceKpis({ totalAssets, totalLe, balanced, t }: { totalAssets: number; totalLe: number; balanced: boolean; t: ReturnType<typeof useTranslations> }) {
  const { compact } = useMoneyFormat()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Kpi label={t("acc_bs_total_assets")} value={compact(totalAssets)} />
      <Kpi label={t("acc_bs_total_liab_equity")} value={compact(totalLe)} />
      <Kpi label={t("acc_bs_balanced")} value={balanced ? t("acc_yes") : t("acc_no")} tone={balanced ? "good" : "bad"} />
    </div>
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
        const { nodes, statement: cf } = cashFlowTree(data.windows)
        return (
          <div className="space-y-4">
            <CashFlowKpis cf={cf} t={t} />
            <TreeStatement portal={portal} data={data} locale={locale} icon={Banknote} nodes={nodes} />
          </div>
        )
      }}
    />
  )
}

function CashFlowKpis({ cf, t }: { cf: ReturnType<typeof cashFlowStatement>; t: ReturnType<typeof useTranslations> }) {
  const { compact } = useMoneyFormat()
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi label={t("acc_cf_operating")} value={compact(cf.operating)} tone={cf.operating >= 0 ? "good" : "bad"} />
      <Kpi label={t("acc_cf_investing")} value={compact(cf.investing)} />
      <Kpi label={t("acc_cf_financing")} value={compact(cf.financing)} />
      <Kpi
        label={t("acc_cf_net_change")}
        value={compact(cf.netChange)}
        tone={cf.netChange >= 0 ? "good" : "bad"}
        hint={cf.difference === 0 ? t("acc_cf_reconciled") : t("acc_cf_not_reconciled")}
      />
    </div>
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
          <AccountingSection title={periodTitle(data, locale)} icon={PieChart} action={<ScaleCaption scale={data.scale} />}>
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
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<TreeNode | null>(null)
  const q = query.trim().toLowerCase()
  const rows = CHART_OF_ACCOUNTS.filter(
    (a) => !q || a.code.startsWith(q) || a.nameAr.includes(query.trim()) || a.nameEn.toLowerCase().includes(q)
  )
  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_coa")}
      description={t("acc_coa_desc")}
      icon={ListTree}
      toolbar={<AccountingToolbar data={data} showProject={false} />}
    >
      <AccountingSection
        title={t("acc_coa_title")}
        icon={ListTree}
        action={
          <div className="relative w-56">
            <Search size={13} className="absolute top-1/2 -translate-y-1/2 start-2.5 text-muted-foreground pointer-events-none" aria-hidden="true" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("acc_coa_search")} aria-label={t("acc_coa_search")} className="h-8 ps-8 text-xs" />
          </div>
        }
      >
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
              {rows.map((a) => (
                <tr key={a.code} className={cn("border-t", a.level <= 2 && "bg-muted/20 font-bold")}>
                  <td className="px-5 py-2 tabular-nums text-muted-foreground" dir="ltr">
                    {a.postable ? (
                      <Link href={`${accountingBasePath(portal)}/ledger?account=${a.code}`} className="hover:text-primary hover:underline">
                        {a.code}
                      </Link>
                    ) : (
                      a.code
                    )}
                  </td>
                  <td className="px-5 py-2" style={{ paddingInlineStart: `${a.level * 14}px` }}>
                    <button
                      type="button"
                      title={t("acc_tree_open_breakdown")}
                      onClick={() => setSelected(accountNode([a.code], nodeNatural(data.windows.closing, a.code)))}
                      className="text-start rounded hover:text-primary hover:underline underline-offset-4 decoration-dotted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {locale === "ar" ? a.nameAr : a.nameEn}
                    </button>
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
      <AccountBreakdownSheet node={selected} data={data} portal={portal} onClose={() => setSelected(null)} />
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
            title={periodTitle(data, locale)}
            icon={Scale}
            action={
              <div className="flex items-center gap-2">
                <ScaleCaption scale={data.scale} />
                <Badge className={cn("border-none", tb.difference === 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                  {tb.difference === 0 ? t("acc_tb_balanced") : `${t("acc_bs_difference")}: ${tb.difference}`}
                </Badge>
              </div>
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
                        <Link
                          href={`${accountingBasePath(portal)}/ledger?account=${row.code}`}
                          className="group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="text-muted-foreground tabular-nums me-2" dir="ltr">
                            {row.code}
                          </span>
                          <span className="group-hover:text-primary group-hover:underline underline-offset-4 decoration-dotted">{accountName(row.code, locale)}</span>
                        </Link>
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

type KindFilter = "all" | "auto" | "manual"
type StatusFilter = "all" | "posted" | "draft"

export function JournalView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  const { can } = usePermissions()
  const canPost = can("accounting.post")
  const [openId, setOpenId] = useState<string | null>(null)
  // An entry reached by link (dashboard, audit trail, "entry saved", a ledger
  // row). It opens in the panel rather than in the list: the list shows only
  // the selected period and filters, and a link must land regardless of both.
  const [linkedId, setLinkedId] = useState<string | null>(null)
  const [kind, setKind] = useState<KindFilter>("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [search, setSearch] = useState("")

  useEffect(() => {
    // Arriving from "entry saved" or the audit trail: open that entry.
    try {
      const id = new URLSearchParams(window.location.search).get("entry")
      if (id) setLinkedId(id)
    } catch {
      /* not in a browser */
    }
  }, [])

  const byId = useMemo(() => new Map(data.entries.map((e) => [e.id, e])), [data.entries])
  const q = search.trim().toLowerCase()
  const inPeriod = useMemo(
    () =>
      data.entries
        .filter((e) => e.date >= data.period.from && e.date <= data.period.to)
        .filter((e) => kind === "all" || (kind === "manual" ? e.kind === "manual" : e.kind !== "manual"))
        .filter((e) => status === "all" || e.status === status)
        .filter(
          (e) =>
            !q ||
            e.description.toLowerCase().includes(q) ||
            String(e.entryNumber) === q ||
            (e.reference || "").toLowerCase().includes(q) ||
            e.lines.some((l) => l.account.startsWith(q) || (l.partyName || "").toLowerCase().includes(q))
        )
        .sort((a, b) => (a.date === b.date ? b.entryNumber - a.entryNumber : a.date < b.date ? 1 : -1)),
    [data.entries, data.period, kind, status, q]
  )
  const totals = inPeriod.filter((e) => e.status === "posted").reduce((s, e) => s + e.totalDebit, 0)
  // A year of entries is thousands of rows; the page shows them a page at a time.
  const PAGE = 25
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setLimit(PAGE), [data.period.from, data.period.to, kind, status, q])
  const shown = inPeriod.slice(0, limit)
  // دفتر اليومية is a DAY book: entries read under their day, with the day's total.
  const days = useMemo(() => {
    const out: { date: string; entries: JournalEntry[]; posted: number }[] = []
    for (const e of shown) {
      const last = out[out.length - 1]
      const day = last && last.date === e.date ? last : (out.push({ date: e.date, entries: [], posted: 0 }), out[out.length - 1])
      day.entries.push(e)
      if (e.status === "posted") day.posted += e.totalDebit
    }
    return out
  }, [shown])
  const formatDay = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_journal")}
      description={t("acc_journal_desc")}
      icon={BookOpen}
      action={
        canPost && (
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 sm:max-w-72">
          <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("acc_journal_search")} aria-label={t("acc_journal_search")} className="h-9 ps-9 text-xs" />
        </div>
        <Select value={kind} onValueChange={(v) => setKind(v as KindFilter)}>
          <SelectTrigger className="h-9 w-40 text-xs" aria-label={t("acc_journal_kind")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">{t("acc_journal_kind_all")}</SelectItem>
            <SelectItem value="auto" className="text-xs">{t("acc_journal_kind_auto")}</SelectItem>
            <SelectItem value="manual" className="text-xs">{t("acc_journal_kind_manual")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="h-9 w-36 text-xs" aria-label={t("acc_status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">{t("acc_journal_status_all")}</SelectItem>
            <SelectItem value="posted" className="text-xs">{t("acc_status_posted")}</SelectItem>
            <SelectItem value="draft" className="text-xs">{t("acc_status_draft")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {data.isLoading ? (
        <LoadingBooks />
      ) : inPeriod.length === 0 ? (
        <EmptyBooks />
      ) : (
        <AccountingSection
          title={t("acc_journal_entries", { count: inPeriod.length })}
          icon={BookOpen}
          action={
            <span className="text-xs text-muted-foreground flex items-center gap-2">
              {t("acc_journal_posted_total")} <Money value={totals} className="font-bold text-foreground" /> <ScaleCaption scale={data.scale} />
            </span>
          }
        >
          {days.map((day) => (
            <div key={day.date}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-y bg-muted/40 px-5 py-1.5 text-[11px] font-bold text-muted-foreground first:border-t-0">
                <span>
                  {formatDay(day.date)} <span className="font-normal">· {t("acc_journal_day_entries", { count: day.entries.length })}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  {t("acc_journal_day_total")} <Money value={day.posted} className="text-foreground" />
                </span>
              </div>
              <div className="divide-y">
                {day.entries.map((entry) => (
                  <JournalRow
                    key={entry.id}
                    entry={entry}
                    data={data}
                    portal={portal}
                    locale={locale}
                    canPost={canPost}
                    reversal={entry.reversedByEntryId ? byId.get(entry.reversedByEntryId) : undefined}
                    reverses={entry.reversesEntryId ? byId.get(entry.reversesEntryId) : undefined}
                    open={openId === entry.id}
                    onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
                    onOpenEntry={setLinkedId}
                  />
                ))}
              </div>
            </div>
          ))}
          {inPeriod.length > limit && (
            <div className="border-t p-3 text-center">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLimit((n) => n + PAGE)}>
                {t("acc_show_more", { count: Math.min(PAGE, inPeriod.length - limit) })}
              </Button>
            </div>
          )}
        </AccountingSection>
      )}
      <JournalEntrySheet
        entry={linkedId && !data.isLoading ? byId.get(linkedId) ?? null : null}
        entries={data.entries}
        portal={portal}
        onClose={() => setLinkedId(null)}
        onOpenEntry={setLinkedId}
        showJournalLink={false}
      />
    </AccountingShell>
  )
}

function JournalRow({
  entry,
  data,
  portal,
  locale,
  canPost,
  reversal,
  reverses,
  open,
  onToggle,
  onOpenEntry,
}: {
  entry: JournalEntry
  data: AccountingData
  portal: CrmPortal
  locale: string
  canPost: boolean
  reversal?: JournalEntry
  reverses?: JournalEntry
  open: boolean
  onToggle: () => void
  onOpenEntry: (id: string) => void
}) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const Closed = locale === "ar" ? ChevronLeft : ChevronRight
  const [busy, setBusy] = useState<"post" | "delete" | "reverse" | null>(null)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [reverseDate, setReverseDate] = useState(isoToday())
  const [reverseReason, setReverseReason] = useState("")

  const fail = (err: unknown) => {
    console.error(err)
    toast({
      title: err instanceof ClosedPeriodError ? t("acc_entry_closed_period", { period: err.period }) : t("acc_save_error"),
      variant: "destructive",
    })
  }

  const post = async () => {
    if (!firestore || busy) return
    setBusy("post")
    try {
      await postDraftEntry(firestore, entry)
      toast({ title: t("acc_entry_posted", { number: entry.entryNumber }) })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!firestore || busy) return
    setBusy("delete")
    try {
      await deleteDraftEntry(firestore, entry)
      toast({ title: t("acc_entry_draft_deleted") })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const reverse = async () => {
    if (!firestore || busy) return
    setBusy("reverse")
    try {
      const res = await reverseJournalEntry(firestore, {
        original: entry,
        date: reverseDate,
        reason: reverseReason,
        userId: data.userId,
        userName: data.userName,
      })
      setReverseOpen(false)
      toast({ title: t("acc_entry_reversed", { number: entry.entryNumber, reversal: res.entryNumber }) })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const canReverse = canPost && entry.status === "posted" && !entry.reversedByEntryId && !entry.reversesEntryId

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-start flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {open ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" /> : <Closed size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black text-muted-foreground tabular-nums" dir="ltr">
              #{entry.entryNumber}
            </span>
            <span className={cn("font-semibold text-sm truncate", entry.reversedByEntryId && "line-through decoration-muted-foreground/60")}>{entry.description}</span>
            <JournalEntryBadges entry={entry} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
            <span dir="ltr">{entry.date}</span>
            {entry.reference && <span>· {t("acc_entry_reference")}: {entry.reference}</span>}
            {entry.createdByUserName && <span>· {entry.createdByUserName}</span>}
          </p>
        </div>
        <Money value={entry.totalDebit} className="text-sm font-bold shrink-0" />
      </button>
      {open && (
        <div className="px-5 pb-4 pt-1 bg-muted/20 space-y-3">
          <JournalEntryFacts entry={entry} portal={portal} />
          <JournalEntryLines entry={entry} portal={portal} />
          {(reversal || reverses) && (
            <p className="text-[11px] text-muted-foreground">
              {reversal && t("acc_entry_reversed_by", { number: reversal.entryNumber, date: reversal.date })}
              {reverses && t("acc_entry_reverses", { number: reverses.entryNumber })}
              <button
                type="button"
                onClick={() => onOpenEntry((reversal || reverses)!.id)}
                className="ms-2 font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                {t("acc_entry_open_other", { number: (reversal || reverses)!.entryNumber })}
              </button>
            </p>
          )}
          {canPost && (entry.status === "draft" || canReverse) && (
            <div className="flex flex-wrap items-center gap-2">
              {entry.status === "draft" && (
                <>
                  <Button size="sm" className="h-8 gap-1.5" onClick={post} disabled={!!busy}>
                    {busy === "post" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {t("acc_entry_post_draft")}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={remove} disabled={!!busy}>
                    {busy === "delete" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    {t("acc_entry_delete_draft")}
                  </Button>
                </>
              )}
              {canReverse && (
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setReverseOpen(true)} disabled={!!busy}>
                  <Undo2 size={13} />
                  {t("acc_entry_reverse")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog open={reverseOpen} onOpenChange={(o) => { if (!busy) setReverseOpen(o) }}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("acc_entry_reverse_title", { number: entry.entryNumber })}</DialogTitle>
            <DialogDescription>{t("acc_entry_reverse_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor={`rev-date-${entry.id}`}>{t("acc_date")}</Label>
              <Input id={`rev-date-${entry.id}`} type="date" dir="ltr" value={reverseDate} onChange={(e) => setReverseDate(e.target.value)} />
              {data.periods.some((p) => p.period === periodOf(reverseDate) && p.status === "closed") && (
                <p className="text-[11px] text-destructive">{t("acc_entry_closed_period", { period: periodOf(reverseDate) })}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rev-reason-${entry.id}`}>{t("acc_entry_reverse_reason")}</Label>
              <Input id={`rev-reason-${entry.id}`} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseOpen(false)} disabled={!!busy}>{t("acc_cancel")}</Button>
            <Button onClick={reverse} disabled={!!busy || !reverseDate} className="gap-1.5">
              {busy === "reverse" ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
              {t("acc_entry_reverse")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function LedgerView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  const [account, setAccount] = useState<string>(ACC.bankMain)
  const [entryId, setEntryId] = useState<string | null>(null)

  useEffect(() => {
    // Deep links from the statements, the chart of accounts and the trial balance.
    try {
      const code = new URLSearchParams(window.location.search).get("account")
      if (code && CHART_OF_ACCOUNTS.some((a) => a.code === code && a.postable)) setAccount(code)
    } catch {
      /* not in a browser */
    }
  }, [])

  const ledger = useMemo(
    () => accountLedger(data.entries, account, data.period.from, data.period.to, data.filter),
    [data.entries, account, data.period, data.filter]
  )
  const nat = (v: number) => naturalSign(account, v)

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_ledger")}
      description={t("acc_ledger_desc")}
      icon={FileText}
      toolbar={<AccountingToolbar data={data} />}
    >
      <div className="flex items-center gap-2">
        <Select value={account} onValueChange={setAccount}>
          <SelectTrigger className="h-9 w-80 text-xs" aria-label={t("acc_account_name")}>
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

      <AccountingSection title={`${account} — ${accountName(account, locale)}`} icon={FileText} action={<ScaleCaption scale={data.scale} />}>
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
                  <Money value={nat(ledger.openingBalance)} />
                </td>
              </tr>
              {ledger.rows.map((row, i) => (
                <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2 tabular-nums text-muted-foreground" dir="ltr">
                    {row.date}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setEntryId(row.entryId)}
                      title={t("acc_entry_details")}
                      className="text-start hover:text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      <span className="text-muted-foreground tabular-nums me-1.5" dir="ltr">#{row.entryNumber}</span>
                      {row.description}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-end">{row.debit ? <Money value={row.debit} /> : "—"}</td>
                  <td className="px-4 py-2 text-end">{row.credit ? <Money value={row.credit} /> : "—"}</td>
                  <td className="px-4 py-2 text-end">
                    <Money value={nat(row.balance)} />
                  </td>
                </tr>
              ))}
              <tr className="border-t bg-primary/5 font-black">
                <td className="px-4 py-2.5" colSpan={4}>
                  {t("acc_closing_balance")}
                </td>
                <td className="px-4 py-2.5 text-end">
                  <Money value={nat(ledger.closingBalance)} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AccountingSection>
      <JournalEntrySheet
        entry={entryId ? data.entries.find((e) => e.id === entryId) ?? null : null}
        entries={data.entries}
        portal={portal}
        onClose={() => setEntryId(null)}
        onOpenEntry={setEntryId}
      />
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
        const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 })
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
      render={(data) => <VatBody data={data} t={t} />}
    />
  )
}

function VatBody({ data, t }: { data: AccountingData; t: ReturnType<typeof useTranslations> }) {
  const { compact } = useMoneyFormat()
  const output = nodeNatural(data.windows.movement, ACC.vatOutput)
  const input = nodeNatural(data.windows.movement, ACC.vatInput)
  const net = Math.round((output - input) * 100) / 100
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label={t("acc_vat_output")} value={compact(output)} hint={t("acc_vat_output_hint")} />
        <Kpi label={t("acc_vat_input")} value={compact(input)} hint={t("acc_vat_input_hint")} />
        <Kpi
          label={net >= 0 ? t("acc_vat_payable") : t("acc_vat_reclaim")}
          value={compact(Math.abs(net))}
          tone={net >= 0 ? "warn" : "good"}
          hint={t("acc_vat_net_hint")}
        />
      </div>
      <AccountingSection title={t("acc_vat_title")} icon={Percent}>
        <div className="p-5 text-sm text-muted-foreground">{t("acc_vat_explainer")}</div>
      </AccountingSection>
    </div>
  )
}

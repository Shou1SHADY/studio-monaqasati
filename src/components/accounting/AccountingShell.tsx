"use client"

import type { ElementType, ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Calculator } from "lucide-react"
import { Link, usePathname } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { usePermissions } from "@/hooks/usePermissions"
import { useMoneyScale } from "@/hooks/useAccountingPrefs"
import { formatMoney, formatMoneyCompact, type MoneyScale } from "@/lib/accounting/display"
import type { PermissionId } from "@/lib/permissions"
import type { CrmPortal } from "@/components/crm/CrmShell"

export function accountingBasePath(portal: CrmPortal): string {
  return `/${portal}/accounting`
}

interface ShellTab {
  /** Relative to the accounting base; absolute (leading "/") hrefs are built from the portal root. */
  segment: string
  labelKey: string
  permission: PermissionId
  /** Lives outside /accounting (the Finance documents desk). */
  portalRoot?: boolean
}

/**
 * Finance and Accounting are one module: the documents desk (invoices,
 * guarantees) and the books those documents post into. Tabs are grouped the way
 * a finance team works — overview, documents, statements to read, tools to keep
 * the books, taxes — and each tab keeps the permission it always had, so a
 * documents clerk never sees the ledger and an accountant never needs the
 * documents right to read a statement.
 */
const TAB_GROUPS: Array<{ labelKey: string; tabs: ShellTab[] }> = [
  {
    labelKey: "acc_nav_group_overview",
    tabs: [
      { segment: "", labelKey: "acc_nav_dashboard", permission: "accounting.view" },
      { segment: "locked", labelKey: "acc_nav_locked", permission: "accounting.view" },
    ],
  },
  {
    labelKey: "fin_nav_group_documents",
    tabs: [
      { segment: "invoices", labelKey: "fin_nav_invoices", permission: "invoices.manage", portalRoot: true },
      { segment: "guarantees", labelKey: "fin_nav_guarantees", permission: "invoices.manage", portalRoot: true },
    ],
  },
  {
    labelKey: "acc_nav_group_statements",
    tabs: [
      { segment: "income-statement", labelKey: "acc_nav_income", permission: "accounting.view" },
      { segment: "balance-sheet", labelKey: "acc_nav_balance", permission: "accounting.view" },
      { segment: "cash-flow", labelKey: "acc_nav_cashflow", permission: "accounting.view" },
      { segment: "equity", labelKey: "acc_nav_equity", permission: "accounting.view" },
    ],
  },
  {
    labelKey: "acc_nav_group_tools",
    tabs: [
      { segment: "journal/new", labelKey: "acc_nav_new_entry", permission: "accounting.post" },
      { segment: "journal", labelKey: "acc_nav_journal", permission: "accounting.view" },
      { segment: "ledger", labelKey: "acc_nav_ledger", permission: "accounting.view" },
      { segment: "statements", labelKey: "acc_nav_account_statements", permission: "accounting.view" },
      { segment: "settlements", labelKey: "acc_nav_settlements", permission: "accounting.view" },
      { segment: "trial-balance", labelKey: "acc_nav_trial_balance", permission: "accounting.view" },
      { segment: "chart-of-accounts", labelKey: "acc_nav_coa", permission: "accounting.view" },
      { segment: "audit-trail", labelKey: "acc_nav_audit_trail", permission: "accounting.view" },
      { segment: "checks", labelKey: "acc_nav_checks", permission: "accounting.view" },
      { segment: "periods", labelKey: "acc_nav_periods", permission: "accounting.close" },
    ],
  },
  {
    labelKey: "acc_nav_group_tax",
    tabs: [{ segment: "vat", labelKey: "acc_nav_vat", permission: "accounting.view" }],
  },
  {
    labelKey: "acc_nav_group_settings",
    tabs: [{ segment: "settings", labelKey: "acc_nav_settings", permission: "accounting.view" }],
  },
]

export function AccountingShell({
  portal,
  title,
  description,
  icon: Icon = Calculator,
  action,
  toolbar,
  children,
}: {
  portal: CrmPortal
  title: string
  description: string
  icon?: ElementType
  action?: ReactNode
  /** Period, scale and filter controls — a full-width row under the tabs. */
  toolbar?: ReactNode
  children: ReactNode
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const pathname = usePathname()
  const { can } = usePermissions()
  const base = accountingBasePath(portal)

  const hrefOf = (tab: ShellTab) => (tab.portalRoot ? `/${portal}/${tab.segment}` : tab.segment ? `${base}/${tab.segment}` : base)
  const allHrefs = TAB_GROUPS.flatMap((g) => g.tabs.map(hrefOf))
  // Longest matching href wins, so /journal/new never also lights up /journal.
  const activeHref = allHrefs
    .filter((href) => pathname === href || (href !== base && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0]

  const groups = TAB_GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((tab) => can(tab.permission)) })).filter((g) => g.tabs.length > 0)

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <Icon size={22} className="shrink-0" aria-hidden="true" />
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        {action && <div className="shrink-0 flex flex-wrap items-center gap-2">{action}</div>}
      </div>

      <nav aria-label={t("acc_page_title")} className="rounded-xl border bg-muted/30 p-2 space-y-1.5">
        {groups.map((group) => (
          <div key={group.labelKey} className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-bold text-muted-foreground px-1.5 shrink-0 min-w-16">{t(group.labelKey)}</span>
            {group.tabs.map((tab) => {
              const href = hrefOf(tab)
              const isActive = href === activeHref
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    isActive ? "bg-primary text-white" : "bg-white text-slate-600 hover:text-foreground"
                  )}
                >
                  {t(tab.labelKey)}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {toolbar}

      {children}
    </div>
  )
}

export function AccountingSection({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string
  icon?: ElementType
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-xl border bg-white overflow-hidden", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b bg-muted/30">
        <h2 className="text-sm font-black text-foreground flex items-center gap-2">
          {Icon && <Icon size={15} className="text-primary" aria-hidden="true" />}
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Money, right-aligned with tabular figures so columns line up, in the
 * reader's chosen scale (as reported, thousands, millions). */
export function Money({ value, className, scale }: { value: number | null; className?: string; scale?: MoneyScale }) {
  const current = useMoneyScale()
  if (value === null) return <span className="text-muted-foreground">—</span>
  return (
    <span dir="ltr" className={cn("tabular-nums", value < -0.004 && "text-destructive", className)}>
      {formatMoney(value, scale ?? current)}
    </span>
  )
}

/** Formatting helpers bound to the reader's scale, for KPIs and chart labels. */
export function useMoneyFormat() {
  const scale = useMoneyScale()
  return {
    scale,
    format: (value: number) => formatMoney(value, scale),
    compact: (value: number) => formatMoneyCompact(value, scale),
  }
}

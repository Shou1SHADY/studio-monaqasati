"use client"

import { type ElementType, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Calculator, ChevronDown, FileText, LayoutDashboard, Percent, Scale, Settings2, Wrench } from "lucide-react"
import { Link, usePathname } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { usePermissions } from "@/hooks/usePermissions"
import { setAccountingPrefs, useAccountingPrefs, useMoneyScale } from "@/hooks/useAccountingPrefs"
import { formatMoney, formatMoneyCompact, type MoneyScale } from "@/lib/accounting/display"
import type { PermissionId } from "@/lib/permissions"
import type { CrmPortal } from "@/components/crm/CrmShell"
import type { ExportDoc } from "@/lib/accounting/export"
import { ExportMenu } from "./ExportMenu"

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
  /** Only where the company buys through Procurement — the contractor portal. */
  contractorOnly?: boolean
}

/**
 * Finance and Accounting are one module: the documents desk (invoices,
 * guarantees) and the books those documents post into. Tabs are grouped the way
 * a finance team works — overview, documents, statements to read, tools to keep
 * the books, taxes — and each tab keeps the permission it always had, so a
 * documents clerk never sees the ledger and an accountant never needs the
 * documents right to read a statement.
 */
const GROUP_ICON: Record<string, ElementType> = {
  acc_nav_group_overview: LayoutDashboard,
  fin_nav_group_documents: FileText,
  acc_nav_group_statements: Scale,
  acc_nav_group_tools: Wrench,
  acc_nav_group_tax: Percent,
  acc_nav_group_settings: Settings2,
}

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
      // Finance's counterpart to Sales: transfer notices, holds, credit notes.
      { segment: "sales-desk", labelKey: "fin_nav_sales_desk", permission: "invoices.manage" },
      // Finance approves the purchase orders Procurement prepares (22 Sep review).
      { segment: "procurement-desk", labelKey: "fin_nav_procurement_desk", permission: "po.approve", contractorOnly: true },
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
    tabs: [
      { segment: "vat", labelKey: "acc_nav_vat", permission: "accounting.view" },
      { segment: "wht", labelKey: "acc_nav_wht", permission: "accounting.view" },
      { segment: "zakat", labelKey: "acc_nav_zakat", permission: "accounting.view" },
    ],
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
  exportDoc,
  exportXbrl = true,
  children,
}: {
  portal: CrmPortal
  title: string
  description: string
  icon?: ElementType
  action?: ReactNode
  /** Period, scale and filter controls — a full-width row under the tabs. */
  toolbar?: ReactNode
  /** Builds what the screen shows for "Export to" (Excel, PDF, XBRL). Absent:
   * the screen has nothing to export. Null while the books are loading. */
  exportDoc?: () => ExportDoc | null
  /** False where the screen's export has no XBRL form (trial balance, chart of accounts). */
  exportXbrl?: boolean
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

  const groups = TAB_GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((tab) => can(tab.permission) && (!tab.contractorOnly || portal === "contractor")),
  })).filter((g) => g.tabs.length > 0)
  // The rail shows the groups; the active group's pages sit under it as pills.
  // The old six-row box of every page at once was taller than some screens'
  // content — Manufacturing's one-row rail is the pattern the customer asked for.
  const activeGroup = groups.find((g) => g.tabs.some((tab) => hrefOf(tab) === activeHref)) ?? groups[0]

  return (
    <div className="space-y-5" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-module/10 text-module">
            <Icon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-primary">{title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
        </div>
        {(action || exportDoc) && (
          <div className="shrink-0 flex flex-wrap items-center gap-2">
            {action}
            {exportDoc && <ExportMenu build={exportDoc} hasXbrl={exportXbrl} />}
          </div>
        )}
      </div>

      <nav aria-label={t("acc_page_title")} className="space-y-2">
        <ul className="flex items-center gap-1 overflow-x-auto border-b">
          {groups.map((group) => {
            const isActive = group === activeGroup
            const first = group.tabs[0]
            const GroupIcon = GROUP_ICON[group.labelKey] ?? Calculator
            return (
              <li key={group.labelKey} className="shrink-0">
                <Link
                  href={hrefOf(first)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-bold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t",
                    isActive ? "border-module text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  <GroupIcon size={15} className={cn("shrink-0", isActive && "text-module")} aria-hidden="true" />
                  {t(group.labelKey)}
                </Link>
              </li>
            )
          })}
        </ul>
        {activeGroup && activeGroup.tabs.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            {activeGroup.tabs.map((tab) => {
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
                    isActive ? "bg-module text-module-foreground" : "bg-white border text-slate-600 hover:text-foreground"
                  )}
                >
                  {t(tab.labelKey)}
                </Link>
              )
            })}
          </div>
        )}
      </nav>

      {/* The period, scale and filter stay in reach while a long statement scrolls. */}
      {toolbar && <div className="sticky top-0 z-20 -mx-1 bg-background px-1 pb-2">{toolbar}</div>}

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
  collapsible,
  id,
  defaultOpen = true,
  summary,
}: {
  title: string
  icon?: ElementType
  action?: ReactNode
  children: ReactNode
  className?: string
  /** A heading with its content folded underneath, opening on click — the
   * order drawer's pattern in Manufacturing. `id` remembers the reader's choice. */
  collapsible?: boolean
  id?: string
  defaultOpen?: boolean
  /** The figure that still shows while the section is closed. */
  summary?: ReactNode
}) {
  const prefs = useAccountingPrefs()
  const open = collapsible ? (id && id in prefs.openSections ? prefs.openSections[id] : defaultOpen) : true
  const heading = (
    <h2 className="text-sm font-black text-foreground flex items-center gap-2">
      {Icon && <Icon size={15} className="text-module" aria-hidden="true" />}
      {title}
    </h2>
  )
  if (collapsible) {
    return (
      <details
        open={open}
        onToggle={(e) => {
          if (id) setAccountingPrefs({ openSections: { ...prefs.openSections, [id]: e.currentTarget.open } })
        }}
        className={cn("group rounded-xl border bg-white overflow-hidden", className)}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-muted/30 group-open:border-b [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <span className="flex min-w-0 items-center gap-2">
            <ChevronDown size={15} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            {heading}
          </span>
          <span className="flex flex-wrap items-center gap-3">
            {summary && <span className="text-xs font-semibold text-muted-foreground">{summary}</span>}
            {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
          </span>
        </summary>
        {children}
      </details>
    )
  }
  return (
    <section className={cn("rounded-xl border bg-white overflow-hidden", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b bg-muted/30">
        {heading}
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

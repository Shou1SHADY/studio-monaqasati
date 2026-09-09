"use client"

import type { ElementType, ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Calculator } from "lucide-react"
import { Link, usePathname } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import type { CrmPortal } from "@/components/crm/CrmShell"

export function accountingBasePath(portal: CrmPortal): string {
  return `/${portal}/accounting`
}

/**
 * Grouped tabs rather than one long rail. Accounting has thirteen screens, and a
 * flat strip of thirteen tabs is a wall — grouping them the way an accountant
 * thinks (what I read, what I keep, what I file) keeps any one row short enough
 * to scan.
 */
const TAB_GROUPS: Array<{ labelKey: string; tabs: Array<{ segment: string; labelKey: string }> }> = [
  {
    labelKey: "acc_nav_group_statements",
    tabs: [
      { segment: "income-statement", labelKey: "acc_nav_income" },
      { segment: "balance-sheet", labelKey: "acc_nav_balance" },
      { segment: "cash-flow", labelKey: "acc_nav_cashflow" },
      { segment: "equity", labelKey: "acc_nav_equity" },
    ],
  },
  {
    labelKey: "acc_nav_group_books",
    tabs: [
      { segment: "chart-of-accounts", labelKey: "acc_nav_coa" },
      { segment: "trial-balance", labelKey: "acc_nav_trial_balance" },
      { segment: "journal", labelKey: "acc_nav_journal" },
      { segment: "ledger", labelKey: "acc_nav_ledger" },
      { segment: "checks", labelKey: "acc_nav_checks" },
      { segment: "periods", labelKey: "acc_nav_periods" },
    ],
  },
  {
    labelKey: "acc_nav_group_tax",
    tabs: [{ segment: "vat", labelKey: "acc_nav_vat" }],
  },
]

export function AccountingShell({
  portal,
  title,
  description,
  icon: Icon = Calculator,
  action,
  children,
}: {
  portal: CrmPortal
  title: string
  description: string
  icon?: ElementType
  action?: ReactNode
  children: ReactNode
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const pathname = usePathname()
  const base = accountingBasePath(portal)

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
        {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
      </div>

      <nav aria-label={t("acc_page_title")} className="rounded-xl border bg-muted/30 p-2 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <Link
            href={base}
            aria-current={pathname === base ? "page" : undefined}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              pathname === base ? "bg-primary text-white" : "bg-white text-slate-600 hover:text-foreground"
            )}
          >
            {t("acc_nav_dashboard")}
          </Link>
          <Link
            href={`${base}/locked`}
            aria-current={pathname === `${base}/locked` ? "page" : undefined}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              pathname === `${base}/locked` ? "bg-primary text-white" : "bg-white text-slate-600 hover:text-foreground"
            )}
          >
            {t("acc_nav_locked")}
          </Link>
        </div>
        {TAB_GROUPS.map((group) => (
          <div key={group.labelKey} className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-bold text-muted-foreground px-1.5 shrink-0">{t(group.labelKey)}</span>
            {group.tabs.map((tab) => {
              const href = `${base}/${tab.segment}`
              const isActive = pathname === href || pathname.startsWith(`${href}/`)
              return (
                <Link
                  key={tab.segment}
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
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b bg-muted/30">
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

/** Money, right-aligned with tabular figures so columns line up. */
export function Money({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  return (
    <span dir="ltr" className={cn("tabular-nums", value < 0 && "text-destructive", className)}>
      {value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  )
}

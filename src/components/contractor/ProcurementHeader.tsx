"use client"

// The head of every Procurement page: the module's icon tile, the page title
// and its one or two actions, an optional strip of three numbers (Today only —
// each a door to the list behind it), and a rail to move between
// Procurement's pages.
//
// Procurement's pages used to share nothing but the sidebar — each had its own
// title block and no way across. This is the pattern Manufacturing and Finance
// use (one row of tabs, the active one in the module's colour), with the same
// permission per tab as the module's sidebar entries in portal-components.ts.
// The rail is the PRD's (§7.2): Today · RFQs · purchase requests · orders ·
// goods received · suppliers · reports · settings. Which tabs a member sees
// is decided in `src/lib/procurement/shell.ts`, so a test can read it.

import type { ElementType, ReactNode } from "react"
import { useTranslations } from "next-intl"
import { BarChart3, ClipboardList, FileText, Inbox, PackageCheck, Settings2, Sunrise, Users } from "lucide-react"
import { Link, usePathname } from "@/i18n/routing"
import { usePermissions } from "@/hooks/usePermissions"
import { activeProcTab, visibleProcTabs, type ProcTabId } from "@/lib/procurement/shell"
import { cn } from "@/lib/utils"

const TAB_ICON: Record<ProcTabId, ElementType> = {
  today: Sunrise,
  rfqs: FileText,
  requests: Inbox,
  orders: ClipboardList,
  receipts: PackageCheck,
  suppliers: Users,
  reports: BarChart3,
  settings: Settings2,
}

export interface ProcurementKpi {
  id: string
  label: string
  /** Already formatted — the header never sees a raw amount. */
  value: string
  note: string
  tone: "good" | "bad" | "warn" | "neutral"
  href: string
  icon?: ElementType
}

const TONE_CHIP: Record<ProcurementKpi["tone"], string> = {
  good: "bg-success/10 text-success",
  bad: "bg-destructive/10 text-destructive",
  warn: "bg-warning/10 text-warning",
  neutral: "bg-muted text-muted-foreground",
}

export function ProcurementHeader({
  icon: Icon,
  title,
  description,
  action,
  kpis,
}: {
  icon: ElementType
  title: string
  description: string
  action?: ReactNode
  /** Three numbers, each a link — rendered between the title and the rail. */
  kpis?: ProcurementKpi[]
}) {
  const tNav = useTranslations("Portal.Sidebar")
  const tShared = useTranslations("Portal.Shared")
  const pathname = usePathname()
  const { can } = usePermissions()
  const tabs = visibleProcTabs(can)
  const active = activeProcTab(tabs, pathname)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-module/10 text-module">
            <Icon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-primary">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>

      {kpis && kpis.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:gap-3" aria-label={tShared("proc_kpis_label")}>
          {kpis.map((kpi) => {
            const KpiIcon = kpi.icon
            return (
              <li key={kpi.id} className="min-w-0">
                <Link
                  href={kpi.href}
                  className="block h-full rounded-xl border bg-white p-3 transition-colors hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-4"
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold leading-snug text-muted-foreground sm:text-xs">
                    {KpiIcon && <KpiIcon size={14} className="hidden shrink-0 text-module sm:block" aria-hidden="true" />}
                    <span className="line-clamp-2">{kpi.label}</span>
                  </p>
                  <p className="mt-1.5 truncate text-lg font-black tabular-nums text-foreground sm:text-2xl" dir="ltr">
                    {kpi.value}
                  </p>
                  <p className={cn("mt-1.5 inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold sm:text-[11px]", TONE_CHIP[kpi.tone])}>{kpi.note}</p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {tabs.length > 1 && (
        <nav aria-label={tShared("proc_nav_label")}>
          <ul className="-mx-4 flex items-center gap-1 overflow-x-auto border-b px-4 [scrollbar-width:thin] sm:mx-0 sm:px-0">
            {tabs.map((tab) => {
              const isActive = tab === active
              const TabIcon = TAB_ICON[tab.id]
              return (
                <li key={tab.href} className="shrink-0">
                  <Link
                    href={tab.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "-mb-px flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-t border-b-2 px-3 py-2.5 text-sm font-bold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive ? "border-module text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                    )}
                  >
                    <TabIcon size={15} className={cn("shrink-0", isActive && "text-module")} aria-hidden="true" />
                    {tNav(tab.labelKey)}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </div>
  )
}

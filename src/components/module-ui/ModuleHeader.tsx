"use client"

// The head of a module page, as every Mdmak module shows it (PM 1.0 §5): a
// breadcrumb, the module tile with the title and its status, one or two
// actions, three numbers that change with permission (each a door to the list
// behind it), and a rail of tabs with computed counts. Which tabs and numbers a
// member sees is decided by the caller, so a test can read it.

import type { ElementType, ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"

export interface ModuleKpi {
  id: string
  label: string
  /** Already formatted — the header never sees a raw amount. */
  value: string
  note?: string
  tone?: "good" | "bad" | "warn" | "neutral"
  href?: string
  icon?: ElementType
}

export interface ModuleTab {
  id: string
  label: string
  href: string
  icon?: ElementType
  /** Computed from the data; red when `urgent`. */
  count?: number
  urgent?: boolean
}

const TONE_CHIP: Record<NonNullable<ModuleKpi["tone"]>, string> = {
  good: "bg-success/10 text-success",
  bad: "bg-destructive/10 text-destructive",
  warn: "bg-warning/10 text-warning",
  neutral: "bg-muted text-muted-foreground",
}

function KpiBody({ kpi }: { kpi: ModuleKpi }) {
  const Icon = kpi.icon
  return (
    <>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold leading-snug text-muted-foreground sm:text-xs">
        {Icon && <Icon size={14} className="hidden shrink-0 text-module sm:block" aria-hidden="true" />}
        <span className="line-clamp-2">{kpi.label}</span>
      </p>
      <p className="mt-1.5 truncate text-lg font-black tabular-nums text-foreground sm:text-2xl" dir="ltr">
        {kpi.value}
      </p>
      {kpi.note && <p className={cn("mt-1.5 inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold sm:text-[11px]", TONE_CHIP[kpi.tone ?? "neutral"])}>{kpi.note}</p>}
    </>
  )
}

export function ModuleHeader({
  icon: Icon,
  title,
  status,
  description,
  crumbs,
  actions,
  kpis,
  kpisLabel,
  tabs,
  activeTab,
  tabsLabel,
}: {
  icon: ElementType
  title: ReactNode
  status?: ReactNode
  description?: ReactNode
  crumbs?: Array<{ label: string; href?: string }>
  actions?: ReactNode
  kpis?: ModuleKpi[]
  kpisLabel?: string
  tabs?: ModuleTab[]
  activeTab?: string
  tabsLabel?: string
}) {
  return (
    <div className="space-y-4">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label={tabsLabel}>
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {c.href ? (
                  <Link href={c.href} className="rounded font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {c.label}
                  </Link>
                ) : (
                  <span className="font-semibold text-foreground">{c.label}</span>
                )}
                {i < crumbs.length - 1 && <ChevronLeft size={12} className="rtl-flip rotate-180 rtl:rotate-0" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-module/10 text-module">
            <Icon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black text-primary">{title}</h1>
              {status}
            </div>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {kpis && kpis.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:gap-3" aria-label={kpisLabel}>
          {kpis.map((kpi) => (
            <li key={kpi.id} className="min-w-0">
              {kpi.href ? (
                <Link
                  href={kpi.href}
                  className="block h-full rounded-xl border bg-card p-3 transition-colors hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-4"
                >
                  <KpiBody kpi={kpi} />
                </Link>
              ) : (
                <div className="h-full rounded-xl border bg-card p-3 sm:p-4">
                  <KpiBody kpi={kpi} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {tabs && tabs.length > 1 && (
        <nav aria-label={tabsLabel}>
          <ul className="sticky top-0 z-10 -mx-4 flex items-center gap-1 overflow-x-auto border-b bg-background px-4 [scrollbar-width:thin] sm:mx-0 sm:px-0">
            {tabs.map((tab) => {
              const on = tab.id === activeTab
              const TabIcon = tab.icon
              return (
                <li key={tab.id} className="shrink-0">
                  <Link
                    href={tab.href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "-mb-px flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-t border-b-2 px-3 py-2.5 text-sm font-bold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-module text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                    )}
                  >
                    {TabIcon && <TabIcon size={15} className={cn("shrink-0", on && "text-module")} aria-hidden="true" />}
                    {tab.label}
                    {tab.count !== undefined && tab.count > 0 && (
                      <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums leading-5", tab.urgent ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground")}>{tab.count}</span>
                    )}
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

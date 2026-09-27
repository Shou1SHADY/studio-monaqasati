"use client"

// The head of every Procurement page, as the reference prototype draws it: the
// page title and its description, the viewer's authority and the page's one
// action, the three numbers (each a door to the list behind it) on EVERY tab,
// and the rail — each tab with the count of what waits on it.
//
// The rail is the PRD's (§7.2): Today · RFQs · purchase requests · orders ·
// goods received · suppliers · reports · settings. Which tabs a member sees
// is decided in `src/lib/procurement/shell.ts`, so a test can read it; the
// numbers come from `useProcurementShell`, derived on every read.

import type { ElementType, ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Lock } from "lucide-react"
import { Link, usePathname } from "@/i18n/routing"
import { usePermissions } from "@/hooks/usePermissions"
import { useProcurementShell } from "@/hooks/useProcurementShell"
import { activeProcTab, visibleProcTabs } from "@/lib/procurement/shell"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

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

/** A figure with the sign, compacted the way the prototype's tiles show it. */
const compact = (n: number) => {
  const abs = Math.abs(n)
  const figure = abs >= 1_000_000 ? `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M` : abs >= 10_000 ? `${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K` : Math.round(n).toLocaleString("en-US")
  return sarLtr(figure)
}

export function ProcurementHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  const tNav = useTranslations("Portal.Sidebar")
  const tShared = useTranslations("Portal.Shared")
  const tToday = useTranslations("Portal.ProcToday")
  const pathname = usePathname()
  const { can } = usePermissions()
  const tabs = visibleProcTabs(can)
  const active = activeProcTab(tabs, pathname)
  const shell = useProcurementShell()

  const kpis: ProcurementKpi[] = (shell.kpis?.tiles ?? []).map((k) => ({
    id: k.id,
    label: tToday(k.labelKey),
    value: k.unit === "money" ? compact(k.value) : k.value.toLocaleString("en-US"),
    note: tToday(k.noteKey, k.noteParams),
    tone: k.tone,
    href: k.href,
  }))
  const authority =
    shell.approvalLimit === "any"
      ? tShared("proc_authority_any")
      : typeof shell.approvalLimit === "number"
        ? tShared("proc_authority_limit", { limit: sarLtr(shell.approvalLimit.toLocaleString("en-US")) })
        : null

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {(authority || action) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {authority && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground">
                <Lock size={12} aria-hidden="true" />
                {authority}
              </span>
            )}
            {action}
          </div>
        )}
      </div>

      {kpis.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={tShared("proc_kpis_label")}>
          {kpis.map((kpi) => (
            <li key={kpi.id} className="min-w-0">
              <Link
                href={kpi.href}
                className="block h-full rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-5"
              >
                <p className="text-xs font-semibold text-muted-foreground">{kpi.label}</p>
                <p className="mt-2 truncate text-2xl font-black tabular-nums text-foreground" dir="ltr">
                  {kpi.value}
                </p>
                <p className={cn("mt-2 inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE_CHIP[kpi.tone])}>{kpi.note}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {tabs.length > 1 && (
        <nav aria-label={tShared("proc_nav_label")}>
          <ul className="-mx-4 flex items-center gap-1 overflow-x-auto border-b px-4 [scrollbar-width:thin] sm:mx-0 sm:px-0">
            {tabs.map((tab) => {
              const isActive = tab === active
              const count = shell.counts[tab.id]
              return (
                <li key={tab.href} className="shrink-0">
                  <Link
                    href={tab.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "-mb-px flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-bold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive ? "border-module text-module" : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tNav(tab.labelKey)}
                    {count !== undefined && count > 0 && (
                      <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums leading-5", isActive ? "bg-module/10 text-module" : "bg-muted text-muted-foreground")}>{count}</span>
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

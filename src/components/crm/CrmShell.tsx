"use client"

import type { ElementType, ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Contact, Target, FileText } from "lucide-react"
import { Link, usePathname } from "@/i18n/routing"
import { cn } from "@/lib/utils"

export type CrmPortal = "contractor" | "supplier"

export function crmBasePath(portal: CrmPortal): string {
  return portal === "contractor" ? "/contractor/crm" : "/supplier/crm"
}

const CRM_TABS: Array<{ segment: string; labelKey: string; icon: ElementType }> = [
  { segment: "leads", labelKey: "crm_nav_leads", icon: Contact },
  { segment: "opportunities", labelKey: "crm_nav_opportunities", icon: Target },
  { segment: "rfqs", labelKey: "crm_nav_rfqs", icon: FileText },
]

/**
 * The three CRM pages share one header: title, description, primary action and
 * the tab rail that moves between them. The rail is real links (not client
 * state) so each page keeps its own URL, is bookmarkable, and the sidebar's
 * active-item resolution still works.
 */
export function CrmShell({
  portal,
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  portal: CrmPortal
  title: string
  description: string
  icon: ElementType
  action?: ReactNode
  children: ReactNode
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const pathname = usePathname()
  const base = crmBasePath(portal)

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <Icon size={22} className="shrink-0" />
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <nav aria-label={t("crm_page_title")} className="border-b border-border">
        <ul className="flex items-center gap-1 -mb-px overflow-x-auto">
          {CRM_TABS.map((tab) => {
            const href = `${base}/${tab.segment}`
            const isActive = pathname === href || pathname.startsWith(`${href}/`)
            const TabIcon = tab.icon
            return (
              <li key={tab.segment}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 rounded-t-md transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  )}
                >
                  <TabIcon size={15} className="shrink-0" />
                  {t(tab.labelKey)}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {children}
    </div>
  )
}

/** One number with a label — the row of these across the top of each CRM page. */
export function CrmStat({
  icon: Icon,
  label,
  value,
  accent = "primary",
  hint,
}: {
  icon: ElementType
  label: string
  value: string | number
  accent?: "primary" | "accent" | "success" | "warning" | "destructive" | "cta"
  hint?: string
}) {
  const accentClass = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/10 text-accent",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    destructive: "bg-destructive/10 text-destructive",
    cta: "bg-cta/10 text-cta",
  }[accent]

  return (
    <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
      <span className={cn("grid place-items-center h-10 w-10 rounded-lg shrink-0", accentClass)} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground truncate">{label}</p>
        <p className="text-lg font-black text-foreground truncate" dir="ltr">
          {value}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground truncate">{hint}</p>}
      </div>
    </div>
  )
}

export function CrmStatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>
}

/** Consistent empty/zero state for every CRM list. */
export function CrmEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ElementType
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <Icon size={48} className="text-muted-foreground/20" aria-hidden="true" />
      <p className="font-bold text-muted-foreground">{title}</p>
      {description && <p className="text-sm text-muted-foreground/70 max-w-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Skeleton rows — shown while the Firestore listener settles, so the page
 * does not collapse to a spinner and then jump to a full layout. */
export function CrmListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl border bg-muted/30 animate-pulse" />
      ))}
    </div>
  )
}

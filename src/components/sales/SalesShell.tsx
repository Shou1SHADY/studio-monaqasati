"use client"

import type { ElementType, ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { LayoutDashboard, FileText, Banknote, Tags, HandCoins } from "lucide-react"
import { Link, usePathname } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import type { CrmPortal } from "@/components/crm/CrmShell"

export function salesBasePath(portal: CrmPortal): string {
  return `/${portal}/sales`
}

const SALES_TABS: Array<{ segment: string; labelKey: string; icon: ElementType }> = [
  { segment: "", labelKey: "sales_nav_dashboard", icon: LayoutDashboard },
  { segment: "quotations", labelKey: "sales_nav_quotations", icon: FileText },
  { segment: "payments", labelKey: "sales_nav_payments", icon: Banknote },
  { segment: "price-list", labelKey: "sales_nav_price_list", icon: Tags },
]

/**
 * The Sales pages share one header and tab rail, the way the CRM does. Tabs
 * are real links: each page has its own URL, is bookmarkable, and the sidebar
 * highlights the right item — no page pretends to be another by filtering.
 */
export function SalesShell({
  portal,
  title,
  description,
  icon: Icon = HandCoins,
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
  const base = salesBasePath(portal)

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

      <nav aria-label={t("sales_page_title")} className="border-b border-border">
        <ul className="flex items-center gap-1 -mb-px overflow-x-auto">
          {SALES_TABS.map((tab) => {
            const href = tab.segment ? `${base}/${tab.segment}` : base
            const isActive = tab.segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base
            const TabIcon = tab.icon
            return (
              <li key={tab.segment || "dashboard"}>
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
                  <TabIcon size={15} className="shrink-0" aria-hidden="true" />
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

/** A titled card section used across the Sales pages. */
export function SalesSection({
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

"use client"

import type { ElementType, ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Factory, CalendarCheck2, Inbox, Calculator, Layers, SlidersHorizontal } from "lucide-react"
import { Link, usePathname } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { usePermissions } from "@/hooks/usePermissions"
import type { CrmPortal } from "@/components/crm/CrmShell"

export function mfgBasePath(portal: CrmPortal): string {
  return `/${portal}/manufacturing`
}

const MFG_TABS: Array<{ segment: string; labelKey: string; icon: ElementType; requires?: "manage" }> = [
  { segment: "", labelKey: "mfg2_nav_workshop", icon: Factory },
  { segment: "today", labelKey: "mfg2_nav_today", icon: CalendarCheck2 },
  { segment: "requests", labelKey: "mfg2_nav_requests", icon: Inbox },
  { segment: "estimates", labelKey: "mfg2_nav_estimates", icon: Calculator },
  { segment: "products", labelKey: "mfg2_nav_products", icon: Layers },
  { segment: "settings", labelKey: "mfg2_nav_settings", icon: SlidersHorizontal, requires: "manage" },
]

/** The Manufacturing pages share one header and tab rail, like Sales and CRM.
 * Tabs are real links — each page is its own URL. */
export function MfgShell({
  portal,
  title,
  description,
  action,
  children,
}: {
  portal: CrmPortal
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const pathname = usePathname()
  const base = mfgBasePath(portal)
  const { can } = usePermissions()

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <Factory size={22} className="shrink-0" aria-hidden="true" />
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
      </div>

      <nav aria-label={t("mfg_page_title")} className="border-b border-border">
        <ul className="flex items-center gap-1 -mb-px overflow-x-auto">
          {MFG_TABS.filter((tab) => tab.requires !== "manage" || can("manufacturing.manage")).map((tab) => {
            const href = tab.segment ? `${base}/${tab.segment}` : base
            const isActive = tab.segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base
            const TabIcon = tab.icon
            return (
              <li key={tab.segment || "workshop"}>
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

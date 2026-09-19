"use client"

// The head of every Procurement page: the module's icon tile, the page title
// and its one or two actions, and a rail to move between Procurement's pages.
//
// Procurement's pages used to share nothing but the sidebar — each had its own
// title block and no way across. This is the pattern Manufacturing and Finance
// use (one row of tabs, the active one in the module's colour), with the same
// permission per tab as the module's sidebar entries in portal-components.ts.

import type { ElementType, ReactNode } from "react"
import { useTranslations } from "next-intl"
import { FileText, Inbox, PackageCheck, Users } from "lucide-react"
import { Link, usePathname } from "@/i18n/routing"
import { usePermissions } from "@/hooks/usePermissions"
import type { PermissionId } from "@/lib/permissions"
import { cn } from "@/lib/utils"

interface ProcurementTab {
  href: string
  labelKey: string
  icon: ElementType
  permission: PermissionId
}

const TABS: ProcurementTab[] = [
  { href: "/contractor/rfqs", labelKey: "contractor_rfqs", icon: FileText, permission: "rfq.manage" },
  { href: "/contractor/rfqs/requests", labelKey: "contractor_purchase_requests", icon: Inbox, permission: "rfq.manage" },
  { href: "/contractor/suppliers", labelKey: "contractor_browse_suppliers", icon: Users, permission: "suppliers.manage" },
  { href: "/contractor/goods-received", labelKey: "contractor_goods_received", icon: PackageCheck, permission: "deliveries.confirm" },
]

export function ProcurementHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ElementType
  title: string
  description: string
  action?: ReactNode
}) {
  const tNav = useTranslations("Portal.Sidebar")
  const tShared = useTranslations("Portal.Shared")
  const pathname = usePathname()
  const { can } = usePermissions()
  const tabs = TABS.filter((tab) => can(tab.permission))
  // Longest match wins: /rfqs/requests must not also light up /rfqs.
  const active = tabs
    .filter((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]

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

      {tabs.length > 1 && (
        <nav aria-label={tShared("proc_nav_label")}>
          <ul className="flex items-center gap-1 overflow-x-auto border-b">
            {tabs.map((tab) => {
              const isActive = tab === active
              const TabIcon = tab.icon
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

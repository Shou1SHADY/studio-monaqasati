"use client"

// The head of every HR 1.0 page (PRD §5): the module tile and title, three
// numbers, and the tabs this person's role sees — Today first (TD-01), My file
// for everyone on the record (ES-00). A tab the role does not hold shows
// nothing but the reason: the screen is not a guard, but it never shows a
// door it would refuse.

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { CalendarCheck2, FileUser, LayoutDashboard, Lock, MapPin, Receipt, Settings2, Users, BarChart3, Loader2 } from "lucide-react"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { ModuleHeader, type ModuleKpi, type ModuleTab } from "@/components/module-ui/ModuleHeader"
import { useHrAccess, type HrAccess } from "@/hooks/useHrAccess"
import type { HrTab } from "@/lib/hr/access"

export type HrPortal = "contractor" | "supplier"

/** Tabs built so far — an optional feature's tab appears once it is built. */
export const HR_BUILT_TABS: readonly HrTab[] = ["today", "people", "sites", "payroll", "settings"]

const ICON: Partial<Record<HrTab, typeof Users>> = {
  today: LayoutDashboard,
  people: Users,
  sites: MapPin,
  attendance: CalendarCheck2,
  payroll: Receipt,
  reports: BarChart3,
  settings: Settings2,
  me: FileUser,
}

export const hrHref = (portal: HrPortal, tab: HrTab) => (tab === "today" ? `/${portal}/hr` : `/${portal}/hr/${tab}`)

export function HrShell({
  portal,
  tab,
  title,
  description,
  kpis,
  actions,
  children,
}: {
  portal: HrPortal
  tab: HrTab
  title?: ReactNode
  description?: ReactNode
  kpis?: ModuleKpi[]
  actions?: ReactNode
  children: (access: HrAccess) => ReactNode
}) {
  const t = useTranslations("Portal.HR")
  const access = useHrAccess()
  const tabs = access.tabs.filter((x) => HR_BUILT_TABS.includes(x))
  const rail: ModuleTab[] = tabs.map((x) => ({ id: x, label: t(`tab.${x}`), href: hrHref(portal, x), icon: ICON[x] }))
  const mayOpen = tabs.includes(tab)

  return (
    <div className="space-y-6">
      <ModuleHeader
        icon={Users}
        title={title ?? t(`tab.${tab}`)}
        description={description ?? t(`tab_desc.${tab}`)}
        crumbs={[{ label: t("module"), href: hrHref(portal, "today") }, { label: t(`tab.${tab}`) }]}
        actions={mayOpen ? actions : undefined}
        kpis={mayOpen ? kpis : undefined}
        kpisLabel={t("kpis_label")}
        tabs={rail}
        activeTab={tab}
        tabsLabel={t("tabs_label")}
      />
      {access.isLoading ? (
        <div className="flex justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : mayOpen ? (
        children(access)
      ) : (
        <EmptyState icon={Lock} title={t("no_access_title")} description={t(access.ctx.employeeId || access.ctx.roles.size ? "no_access_desc" : "no_record_desc")} />
      )}
    </div>
  )
}

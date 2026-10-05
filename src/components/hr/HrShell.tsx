"use client"

// The head of every HR 1.0 page (PRD §5): the module tile and title, three
// numbers, and the tabs this person's role sees — Today first (TD-01), My file
// for everyone on the record (ES-00). A tab the role does not hold shows
// nothing but the reason: the screen is not a guard, but it never shows a
// door it would refuse.

import { useEffect, useMemo, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { CalendarCheck2, FileUser, LayoutDashboard, Lock, MapPin, Receipt, Settings2, Users, BarChart3, Loader2 } from "lucide-react"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { ModuleHeader, type ModuleKpi, type ModuleTab } from "@/components/module-ui/ModuleHeader"
import { useHrAccess, type HrAccess } from "@/hooks/useHrAccess"
import { useHrTodayCounts } from "@/hooks/useHrTodayCounts"
import { useRouter } from "@/i18n/routing"
import { hrTabs, type HrTab } from "@/lib/hr/access"
import { featureSet, perfLabelKey, sitesLabelKey, type HrSettings } from "@/lib/hr/settings"

export type HrPortal = "contractor" | "supplier"

/** ST-06 — a tab's label key under `Portal.HR.tab`: the workplaces in the company's own word, the growth tab by
 * which of its features is on. */
export function tabLabelKey(tab: HrTab, settings: Pick<HrSettings, "businessType" | "features">): string {
  if (tab === "sites") return sitesLabelKey(settings.businessType)
  if (tab === "perf") return perfLabelKey(featureSet(settings))
  return tab
}

/** Tabs built so far — an optional feature's tab appears once it is built. */
export const HR_BUILT_TABS: readonly HrTab[] = ["today", "people", "sites", "payroll", "reports", "settings", "me"]

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

const noKpis = (): ModuleKpi[] | undefined => undefined

export const hrHref = (portal: HrPortal, tab: HrTab) => (tab === "today" ? `/${portal}/hr` : `/${portal}/hr/${tab}`)

export function HrShell({
  portal,
  tab,
  title,
  description,
  kpis,
  useKpis = noKpis,
  actions,
  children,
}: {
  portal: HrPortal
  tab: HrTab
  title?: ReactNode
  description?: ReactNode
  kpis?: ModuleKpi[]
  /** A hook computing the header's three numbers from the viewer's access (TD-04) — a stable function per page. */
  useKpis?: (access: HrAccess, portal: HrPortal) => ModuleKpi[] | undefined
  actions?: ReactNode
  children: (access: HrAccess) => ReactNode
}) {
  const t = useTranslations("Portal.HR")
  const access = useHrAccess()
  const computed = useKpis(access, portal)
  // TD-04 — each tab's number is the count of its screen; the platforms tab follows who holds government relations.
  const { counts, govHeld } = useHrTodayCounts(access)
  const tabs = useMemo(
    () => (govHeld === undefined ? access.tabs : hrTabs(access.ctx, featureSet(access.settings), { govHeld })).filter((x) => HR_BUILT_TABS.includes(x)),
    [access.tabs, access.ctx, access.settings, govHeld]
  )
  const label = (x: HrTab) => t(`tab.${tabLabelKey(x, access.settings)}` as "tab.today")
  const rail: ModuleTab[] = tabs.map((x) => ({ id: x, label: label(x), href: hrHref(portal, x), icon: ICON[x], count: counts[x]?.count, urgent: counts[x]?.urgent }))
  const mayOpen = tabs.includes(tab)
  const router = useRouter()
  // TD-01 — the module's home is Today; a person whose role has no Today (an
  // employee with My file only) lands on his first tab instead of a refusal.
  const first = tabs[0]
  useEffect(() => {
    if (!access.isLoading && tab === "today" && !mayOpen && first) router.replace(hrHref(portal, first))
  }, [access.isLoading, tab, mayOpen, first, portal, router])

  return (
    <div className="space-y-6">
      <ModuleHeader
        icon={Users}
        title={title ?? label(tab)}
        description={description ?? t(`tab_desc.${tab}`)}
        crumbs={[{ label: t("module"), href: hrHref(portal, "today") }, { label: label(tab) }]}
        actions={mayOpen ? actions : undefined}
        kpis={mayOpen ? (kpis ?? computed) : undefined}
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

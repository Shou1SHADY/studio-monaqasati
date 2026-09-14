"use client"

// The Manufacturing module page: one session (live data, the computed world,
// who is looking and as which role), the frame with its tab rail, and the tab's
// body. Every tab is a real URL; older URLs keep working:
//   /manufacturing, /manufacturing/today  → Today (every role's first page)
//   /manufacturing/workshop, /orders       → the Workshop, as a list
//   /manufacturing/floor                   → the Workshop, as the department board
//   /manufacturing/estimates               → Requests, on its cost-statements segment

import { Suspense } from "react"
import { useTranslations } from "next-intl"
import { Lock } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { usePermissions } from "@/hooks/usePermissions"
import { MfgUiProvider, useMfgUi } from "./MfgUiContext"
import { MfgShell, type MfgTabId } from "./MfgShell"
import { MfgTodayView } from "./MfgTodayView"
import { MfgWorkshopView } from "./MfgWorkshopView"
import { MfgRequestsView } from "./MfgRequestsView"
import { MfgProductsView } from "./MfgProductsView"
import { MfgSettingsView } from "./MfgSettingsView"
import { MfgEmpty, MfgPanel } from "./ui/MfgUi"

export type MfgTab = MfgTabId | "orders" | "floor" | "estimates"

function shellTab(tab: MfgTab): MfgTabId {
  if (tab === "orders" || tab === "floor") return "workshop"
  if (tab === "estimates") return "requests"
  return tab
}

/** Requests, Products and Settings belong to the manager, the cost controller
 * and management (PRD §4). */
const FULL_TABS: MfgTabId[] = ["requests", "products", "settings"]

function TabBody({ tab }: { tab: MfgTab }) {
  const t = useTranslations("Portal.Shared")
  const { perms, data } = useMfgUi()
  const { isLoading } = usePermissions()
  const full = perms.canManage || perms.canCost || perms.canView
  if (FULL_TABS.includes(shellTab(tab)) && !full && !isLoading && data.ready) {
    return (
      <MfgPanel>
        <MfgEmpty icon={Lock} title={t("mfw_no_access_title")} hint={t("mfw_no_access_hint")} />
      </MfgPanel>
    )
  }
  switch (tab) {
    case "workshop":
    case "orders":
      return <MfgWorkshopView />
    case "floor":
      return <MfgWorkshopView initialView="board" />
    case "requests":
      return <MfgRequestsView />
    case "estimates":
      return <MfgRequestsView initialSegment="estimates" />
    case "products":
      return <MfgProductsView />
    case "settings":
      return <MfgSettingsView />
    default:
      return <MfgTodayView />
  }
}

function BodyFallback() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted/60" />
      ))}
    </div>
  )
}

export function MfgPage({ portal, tab }: { portal: CrmPortal; tab: MfgTab }) {
  return (
    <PortalLayout>
      <MfgUiProvider portal={portal}>
        <MfgShell tab={shellTab(tab)}>
          <Suspense fallback={<BodyFallback />}>
            <TabBody tab={tab} />
          </Suspense>
        </MfgShell>
      </MfgUiProvider>
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { MfgUiProvider, useMfgUi } from "./MfgUiContext"
import { MfgShell, type MfgTabId } from "./MfgShell"
import { MfgTodayView } from "./MfgTodayView"
import { MfgOrdersView } from "./MfgOrdersView"
import { MfgFloorView } from "./MfgFloorView"
import { MfgRequestsView } from "./MfgRequestsView"
import { MfgProductsView } from "./MfgProductsView"
import { MfgSettingsView } from "./MfgSettingsView"

/** Route segments. `workshop` and `today` are the module home; `estimates`
 * opens Requests on its cost-estimates segment (both are older URLs kept
 * working). */
export type MfgTab = MfgTabId | "workshop" | "estimates"

function shellTab(tab: MfgTab): MfgTabId {
  if (tab === "workshop") return "today"
  if (tab === "estimates") return "requests"
  return tab
}

function TabBody({ tab }: { tab: MfgTab }) {
  const { data } = useMfgUi()
  switch (tab) {
    case "requests":
      return <MfgRequestsView data={data} />
    case "estimates":
      return <MfgRequestsView data={data} initialSegment="estimates" />
    case "orders":
      return <MfgOrdersView />
    case "floor":
      return <MfgFloorView />
    case "products":
      return <MfgProductsView data={data} />
    case "settings":
      return <MfgSettingsView data={data} />
    default:
      return <MfgTodayView />
  }
}

export function MfgPage({ portal, tab }: { portal: CrmPortal; tab: MfgTab }) {
  return (
    <PortalLayout>
      <MfgUiProvider portal={portal}>
        <MfgShell tab={shellTab(tab)}>
          <TabBody tab={tab} />
        </MfgShell>
      </MfgUiProvider>
    </PortalLayout>
  )
}

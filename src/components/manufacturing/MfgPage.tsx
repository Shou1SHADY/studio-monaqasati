"use client"

import { useTranslations } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { useMfgData } from "@/hooks/useMfgData"
import { ManufacturingView } from "./ManufacturingView"
import { MfgShell } from "./MfgShell"
import { MfgTodayView } from "./MfgTodayView"
import { MfgRequestsView } from "./MfgRequestsView"
import { MfgEstimatesView } from "./MfgEstimatesView"
import { MfgProductsView } from "./MfgProductsView"
import { MfgSettingsView } from "./MfgSettingsView"
import { MfgNewOrderFromProductButton } from "./MfgWorkshopExtras"

export type MfgTab = "workshop" | "today" | "requests" | "estimates" | "products" | "settings"

function TabBody({ tab, portal }: { tab: MfgTab; portal: CrmPortal }) {
  const data = useMfgData()
  switch (tab) {
    case "today":
      return <MfgTodayView data={data} portal={portal} />
    case "requests":
      return <MfgRequestsView data={data} />
    case "estimates":
      return <MfgEstimatesView data={data} />
    case "products":
      return <MfgProductsView data={data} />
    case "settings":
      return <MfgSettingsView data={data} />
    default:
      return <ManufacturingView hideTitle />
  }
}

export function MfgPage({ portal, tab }: { portal: CrmPortal; tab: MfgTab }) {
  const t = useTranslations("Portal.Shared")
  return (
    <PortalLayout>
      <MfgShell
        portal={portal}
        title={t("mfg_page_title")}
        description={t(`mfg2_tab_desc_${tab}`)}
        action={tab === "workshop" ? <MfgNewOrderFromProductButton /> : undefined}
      >
        <TabBody tab={tab} portal={portal} />
      </MfgShell>
    </PortalLayout>
  )
}

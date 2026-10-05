"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrPlatformsView, usePlatformsKpis } from "@/components/hr/HrPlatformsView"
import { HrShell } from "@/components/hr/HrShell"

export default function HrPlatformsPage() {
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="platforms" useKpis={usePlatformsKpis}>
        {(access) => <HrPlatformsView access={access} portal="supplier" />}
      </HrShell>
    </PortalLayout>
  )
}

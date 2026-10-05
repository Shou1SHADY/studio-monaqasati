"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrHiringView, useHiringKpis } from "@/components/hr/HrHiringView"
import { HrShell } from "@/components/hr/HrShell"

export default function HrHiringPage() {
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="hiring" useKpis={useHiringKpis}>
        {(access) => <HrHiringView access={access} portal="supplier" />}
      </HrShell>
    </PortalLayout>
  )
}

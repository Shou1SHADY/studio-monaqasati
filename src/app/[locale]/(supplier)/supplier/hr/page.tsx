"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrShell } from "@/components/hr/HrShell"
import { HrTodayView } from "@/components/hr/HrTodayView"
import { useHrTodayKpis } from "@/hooks/useHrTodayKpis"

export default function HrTodayPage() {
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="today" useKpis={useHrTodayKpis}>
        {(access) => <HrTodayView access={access} portal="supplier" />}
      </HrShell>
    </PortalLayout>
  )
}

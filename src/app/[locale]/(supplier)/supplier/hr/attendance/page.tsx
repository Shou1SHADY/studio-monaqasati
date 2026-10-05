"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrAttendanceView, useAttendanceKpis } from "@/components/hr/HrAttendanceView"
import { HrShell } from "@/components/hr/HrShell"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"

export default function HrAttendancePage() {
  const { user } = useUser()
  const { profile } = usePermissions()
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="attendance" useKpis={useAttendanceKpis}>
        {(access) => <HrAttendanceView access={access} actor={{ uid: user?.uid ?? "", name: (profile?.name as string) || null }} portal="supplier" />}
      </HrShell>
    </PortalLayout>
  )
}

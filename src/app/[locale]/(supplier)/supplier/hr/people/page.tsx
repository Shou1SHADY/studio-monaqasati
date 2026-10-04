"use client"

import { Suspense } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { HrShell } from "@/components/hr/HrShell"
import { HrPeopleView } from "@/components/hr/HrPeopleView"
import { usePermissions } from "@/hooks/usePermissions"

export default function HrPeoplePage() {
  const { profile } = usePermissions()
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="people">
        {(access) => (
          // useSearchParams (Today's KPI filters) needs a boundary for the static shell.
          <Suspense fallback={null}>
            <HrPeopleView access={access} portal="supplier" actorName={(profile?.name as string) || ""} />
          </Suspense>
        )}
      </HrShell>
    </PortalLayout>
  )
}

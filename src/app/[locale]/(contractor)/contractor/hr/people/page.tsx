"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrShell } from "@/components/hr/HrShell"
import { HrPeopleView } from "@/components/hr/HrPeopleView"
import { usePermissions } from "@/hooks/usePermissions"

export default function HrPeoplePage() {
  const { profile } = usePermissions()
  return (
    <PortalLayout>
      <HrShell portal="contractor" tab="people">
        {(access) => <HrPeopleView access={access} portal="contractor" actorName={(profile?.name as string) || ""} />}
      </HrShell>
    </PortalLayout>
  )
}

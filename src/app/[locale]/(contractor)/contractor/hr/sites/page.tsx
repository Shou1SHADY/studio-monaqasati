"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrShell } from "@/components/hr/HrShell"
import { HrSitesView } from "@/components/hr/HrSitesView"
import { usePermissions } from "@/hooks/usePermissions"

export default function HrSitesPage() {
  const { profile } = usePermissions()
  return (
    <PortalLayout>
      <HrShell portal="contractor" tab="sites">
        {(access) => <HrSitesView access={access} actorName={(profile?.name as string) || ""} />}
      </HrShell>
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrMyFile } from "@/components/hr/HrMyFile"
import { HrShell } from "@/components/hr/HrShell"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"

export default function HrMyFilePage() {
  const { user } = useUser()
  const { profile } = usePermissions()
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="me">
        {(access) => <HrMyFile access={access} actor={{ uid: user?.uid ?? "", name: (profile?.name as string) || null }} />}
      </HrShell>
    </PortalLayout>
  )
}

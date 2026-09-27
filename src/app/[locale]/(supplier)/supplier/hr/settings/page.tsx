"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { HrShell } from "@/components/hr/HrShell"
import { HrSettingsView } from "@/components/hr/HrSettingsView"

export default function HrSettingsPage() {
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="settings">
        {(access) => <HrSettingsView access={access} />}
      </HrShell>
    </PortalLayout>
  )
}

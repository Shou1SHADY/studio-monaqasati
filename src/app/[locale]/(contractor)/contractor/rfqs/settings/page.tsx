"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementSettings } from "@/components/procurement/ProcurementSettings"

export default function ProcurementSettingsPage() {
  return (
    <PortalLayout>
      <ProcurementSettings />
    </PortalLayout>
  )
}

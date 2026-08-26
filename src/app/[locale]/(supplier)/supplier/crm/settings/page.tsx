"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmSettingsView } from "@/components/crm/CrmSettingsView"

export default function SupplierCrmSettingsPage() {
  return (
    <PortalLayout>
      <CrmSettingsView portal="supplier" />
    </PortalLayout>
  )
}

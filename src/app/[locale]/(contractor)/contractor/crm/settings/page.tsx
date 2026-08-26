"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmSettingsView } from "@/components/crm/CrmSettingsView"

export default function ContractorCrmSettingsPage() {
  return (
    <PortalLayout>
      <CrmSettingsView portal="contractor" />
    </PortalLayout>
  )
}

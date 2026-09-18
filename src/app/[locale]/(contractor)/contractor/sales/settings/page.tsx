"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesSettingsView } from "@/components/sales/SalesSettingsView"

export default function ContractorSalesSettingsPage() {
  return (
    <PortalLayout>
      <SalesSettingsView portal="contractor" />
    </PortalLayout>
  )
}

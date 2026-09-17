"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesSettingsView } from "@/components/sales/SalesSettingsView"

export default function SupplierSalesSettingsPage() {
  return (
    <PortalLayout>
      <SalesSettingsView portal="supplier" />
    </PortalLayout>
  )
}

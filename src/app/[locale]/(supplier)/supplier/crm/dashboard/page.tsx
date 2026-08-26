"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmDashboardView } from "@/components/crm/CrmDashboardView"

export default function SupplierCrmDashboardPage() {
  return (
    <PortalLayout>
      <CrmDashboardView portal="supplier" />
    </PortalLayout>
  )
}

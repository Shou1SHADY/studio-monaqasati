"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesDashboardView } from "@/components/sales/SalesDashboardView"

export default function ContractorSalesPage() {
  return (
    <PortalLayout>
      <SalesDashboardView portal="contractor" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesDashboardView } from "@/components/sales/SalesDashboardView"

export default function SupplierSalesPage() {
  return (
    <PortalLayout>
      <SalesDashboardView portal="supplier" />
    </PortalLayout>
  )
}

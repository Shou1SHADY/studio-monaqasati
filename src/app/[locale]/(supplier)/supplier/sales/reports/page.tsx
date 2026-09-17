"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesReportsView } from "@/components/sales/SalesReportsView"

export default function SupplierSalesReportsPage() {
  return (
    <PortalLayout>
      <SalesReportsView portal="supplier" />
    </PortalLayout>
  )
}

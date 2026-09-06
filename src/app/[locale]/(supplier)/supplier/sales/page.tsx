"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesView } from "@/components/sales/SalesView"

export default function SupplierSalesPage() {
  return (
    <PortalLayout>
      <SalesView portal="supplier" />
    </PortalLayout>
  )
}

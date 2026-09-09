"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesOrdersView } from "@/components/sales/SalesOrdersView"

export default function SupplierSalesOrdersPage() {
  return (
    <PortalLayout>
      <SalesOrdersView portal="supplier" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesOrdersView } from "@/components/sales/SalesOrdersView"

export default function ContractorSalesOrdersPage() {
  return (
    <PortalLayout>
      <SalesOrdersView portal="contractor" />
    </PortalLayout>
  )
}

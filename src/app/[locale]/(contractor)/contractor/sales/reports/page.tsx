"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesReportsView } from "@/components/sales/SalesReportsView"

export default function ContractorSalesReportsPage() {
  return (
    <PortalLayout>
      <SalesReportsView portal="contractor" />
    </PortalLayout>
  )
}

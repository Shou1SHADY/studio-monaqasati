"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { QuotationsListView } from "@/components/sales/QuotationsListView"

export default function SupplierSalesQuotationsPage() {
  return (
    <PortalLayout>
      <QuotationsListView portal="supplier" />
    </PortalLayout>
  )
}

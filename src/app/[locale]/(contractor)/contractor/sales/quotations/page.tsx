"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { QuotationsListView } from "@/components/sales/QuotationsListView"

export default function ContractorSalesQuotationsPage() {
  return (
    <PortalLayout>
      <QuotationsListView portal="contractor" />
    </PortalLayout>
  )
}

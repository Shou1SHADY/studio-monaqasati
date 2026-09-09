"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { ChartOfAccountsView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingChartOfAccountsPage() {
  return (
    <PortalLayout>
      <ChartOfAccountsView portal="supplier" />
    </PortalLayout>
  )
}

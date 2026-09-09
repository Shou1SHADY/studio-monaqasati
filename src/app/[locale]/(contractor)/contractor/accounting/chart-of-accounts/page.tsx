"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { ChartOfAccountsView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingChartOfAccountsPage() {
  return (
    <PortalLayout>
      <ChartOfAccountsView portal="contractor" />
    </PortalLayout>
  )
}

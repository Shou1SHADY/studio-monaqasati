"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { AccountingDashboard } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingDashboardPage() {
  return (
    <PortalLayout>
      <AccountingDashboard portal="contractor" />
    </PortalLayout>
  )
}

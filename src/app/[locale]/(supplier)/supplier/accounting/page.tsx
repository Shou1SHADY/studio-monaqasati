"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { AccountingDashboard } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingDashboardPage() {
  return (
    <PortalLayout>
      <AccountingDashboard portal="supplier" />
    </PortalLayout>
  )
}

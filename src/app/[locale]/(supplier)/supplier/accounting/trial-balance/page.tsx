"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { TrialBalanceView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingTrialBalancePage() {
  return (
    <PortalLayout>
      <TrialBalanceView portal="supplier" />
    </PortalLayout>
  )
}

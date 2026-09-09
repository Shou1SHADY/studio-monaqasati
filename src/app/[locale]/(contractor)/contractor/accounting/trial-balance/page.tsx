"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { TrialBalanceView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingTrialBalancePage() {
  return (
    <PortalLayout>
      <TrialBalanceView portal="contractor" />
    </PortalLayout>
  )
}

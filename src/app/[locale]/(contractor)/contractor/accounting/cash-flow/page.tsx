"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CashFlowView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingCashFlowPage() {
  return (
    <PortalLayout>
      <CashFlowView portal="contractor" />
    </PortalLayout>
  )
}

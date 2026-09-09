"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CashFlowView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingCashFlowPage() {
  return (
    <PortalLayout>
      <CashFlowView portal="supplier" />
    </PortalLayout>
  )
}

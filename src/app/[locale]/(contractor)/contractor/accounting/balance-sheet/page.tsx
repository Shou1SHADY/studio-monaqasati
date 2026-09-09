"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { BalanceSheetView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingBalanceSheetPage() {
  return (
    <PortalLayout>
      <BalanceSheetView portal="contractor" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { BalanceSheetView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingBalanceSheetPage() {
  return (
    <PortalLayout>
      <BalanceSheetView portal="supplier" />
    </PortalLayout>
  )
}

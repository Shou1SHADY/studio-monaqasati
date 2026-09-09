"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { LockedCashView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingLockedPage() {
  return (
    <PortalLayout>
      <LockedCashView portal="supplier" />
    </PortalLayout>
  )
}

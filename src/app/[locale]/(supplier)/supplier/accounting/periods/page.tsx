"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { PeriodsView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingPeriodsPage() {
  return (
    <PortalLayout>
      <PeriodsView portal="supplier" />
    </PortalLayout>
  )
}

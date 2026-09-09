"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { EquityView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingEquityPage() {
  return (
    <PortalLayout>
      <EquityView portal="supplier" />
    </PortalLayout>
  )
}

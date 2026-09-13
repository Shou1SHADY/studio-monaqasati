"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SettlementsView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingSettlementsPage() {
  return (
    <PortalLayout>
      <SettlementsView portal="supplier" />
    </PortalLayout>
  )
}

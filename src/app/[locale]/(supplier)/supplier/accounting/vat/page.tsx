"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { VatView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingVatPage() {
  return (
    <PortalLayout>
      <VatView portal="supplier" />
    </PortalLayout>
  )
}

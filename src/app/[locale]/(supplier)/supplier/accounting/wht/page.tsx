"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { WhtView } from "@/components/accounting/TaxViews"

export default function SupplierAccountingWhtPage() {
  return (
    <PortalLayout>
      <WhtView portal="supplier" />
    </PortalLayout>
  )
}

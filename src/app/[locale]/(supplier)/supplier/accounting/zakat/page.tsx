"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { ZakatView } from "@/components/accounting/TaxViews"

export default function SupplierAccountingZakatPage() {
  return (
    <PortalLayout>
      <ZakatView portal="supplier" />
    </PortalLayout>
  )
}

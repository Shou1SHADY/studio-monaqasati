"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { ZakatView } from "@/components/accounting/TaxViews"

export default function ContractorAccountingZakatPage() {
  return (
    <PortalLayout>
      <ZakatView portal="contractor" />
    </PortalLayout>
  )
}

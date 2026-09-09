"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { VatView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingVatPage() {
  return (
    <PortalLayout>
      <VatView portal="contractor" />
    </PortalLayout>
  )
}

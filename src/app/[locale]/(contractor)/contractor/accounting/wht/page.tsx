"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { WhtView } from "@/components/accounting/TaxViews"

export default function ContractorAccountingWhtPage() {
  return (
    <PortalLayout>
      <WhtView portal="contractor" />
    </PortalLayout>
  )
}

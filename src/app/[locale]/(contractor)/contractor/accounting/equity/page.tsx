"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { EquityView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingEquityPage() {
  return (
    <PortalLayout>
      <EquityView portal="contractor" />
    </PortalLayout>
  )
}

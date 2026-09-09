"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { PeriodsView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingPeriodsPage() {
  return (
    <PortalLayout>
      <PeriodsView portal="contractor" />
    </PortalLayout>
  )
}

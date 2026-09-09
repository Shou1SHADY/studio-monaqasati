"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { LockedCashView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingLockedPage() {
  return (
    <PortalLayout>
      <LockedCashView portal="contractor" />
    </PortalLayout>
  )
}

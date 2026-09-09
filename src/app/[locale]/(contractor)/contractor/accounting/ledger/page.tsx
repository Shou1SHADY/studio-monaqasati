"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { LedgerView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingLedgerPage() {
  return (
    <PortalLayout>
      <LedgerView portal="contractor" />
    </PortalLayout>
  )
}

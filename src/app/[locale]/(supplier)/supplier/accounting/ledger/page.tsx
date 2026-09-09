"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { LedgerView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingLedgerPage() {
  return (
    <PortalLayout>
      <LedgerView portal="supplier" />
    </PortalLayout>
  )
}

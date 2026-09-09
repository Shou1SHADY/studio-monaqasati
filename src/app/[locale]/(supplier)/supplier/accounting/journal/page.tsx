"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { JournalView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingJournalPage() {
  return (
    <PortalLayout>
      <JournalView portal="supplier" />
    </PortalLayout>
  )
}

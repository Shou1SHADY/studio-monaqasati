"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { NewJournalEntryView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingNewJournalEntryPage() {
  return (
    <PortalLayout>
      <NewJournalEntryView portal="supplier" />
    </PortalLayout>
  )
}

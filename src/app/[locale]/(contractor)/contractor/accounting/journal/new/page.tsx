"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { NewJournalEntryView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingNewJournalEntryPage() {
  return (
    <PortalLayout>
      <NewJournalEntryView portal="contractor" />
    </PortalLayout>
  )
}

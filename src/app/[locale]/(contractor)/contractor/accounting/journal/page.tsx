"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { JournalView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingJournalPage() {
  return (
    <PortalLayout>
      <JournalView portal="contractor" />
    </PortalLayout>
  )
}

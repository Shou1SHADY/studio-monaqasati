"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { ChecksView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingChecksPage() {
  return (
    <PortalLayout>
      <ChecksView portal="contractor" />
    </PortalLayout>
  )
}

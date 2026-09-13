"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SettlementsView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingSettlementsPage() {
  return (
    <PortalLayout>
      <SettlementsView portal="contractor" />
    </PortalLayout>
  )
}

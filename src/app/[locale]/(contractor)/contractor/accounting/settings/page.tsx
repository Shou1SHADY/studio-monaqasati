"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { AccountingSettingsView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingSettingsPage() {
  return (
    <PortalLayout>
      <AccountingSettingsView portal="contractor" />
    </PortalLayout>
  )
}

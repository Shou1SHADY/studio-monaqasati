"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { AccountingSettingsView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingSettingsPage() {
  return (
    <PortalLayout>
      <AccountingSettingsView portal="supplier" />
    </PortalLayout>
  )
}

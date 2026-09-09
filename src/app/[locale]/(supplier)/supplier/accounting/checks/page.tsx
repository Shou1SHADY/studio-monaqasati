"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { ChecksView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingChecksPage() {
  return (
    <PortalLayout>
      <ChecksView portal="supplier" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { AccountStatementsView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingAccountStatementsPage() {
  return (
    <PortalLayout>
      <AccountStatementsView portal="supplier" />
    </PortalLayout>
  )
}

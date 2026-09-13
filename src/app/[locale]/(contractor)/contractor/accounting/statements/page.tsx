"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { AccountStatementsView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingAccountStatementsPage() {
  return (
    <PortalLayout>
      <AccountStatementsView portal="contractor" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { IncomeStatementView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingIncomeStatementPage() {
  return (
    <PortalLayout>
      <IncomeStatementView portal="contractor" />
    </PortalLayout>
  )
}

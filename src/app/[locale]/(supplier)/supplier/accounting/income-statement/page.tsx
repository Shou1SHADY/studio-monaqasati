"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { IncomeStatementView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingIncomeStatementPage() {
  return (
    <PortalLayout>
      <IncomeStatementView portal="supplier" />
    </PortalLayout>
  )
}

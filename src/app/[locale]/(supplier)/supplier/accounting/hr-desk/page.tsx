"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { FinanceHrDesk } from "@/components/accounting/FinanceHrDesk"

export default function SupplierFinanceHrDeskPage() {
  return (
    <PortalLayout>
      <FinanceHrDesk portal="supplier" />
    </PortalLayout>
  )
}

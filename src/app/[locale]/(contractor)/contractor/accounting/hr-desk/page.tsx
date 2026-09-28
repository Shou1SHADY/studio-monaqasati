"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { FinanceHrDesk } from "@/components/accounting/FinanceHrDesk"

export default function ContractorFinanceHrDeskPage() {
  return (
    <PortalLayout>
      <FinanceHrDesk portal="contractor" />
    </PortalLayout>
  )
}

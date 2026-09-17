"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { FinanceSalesDesk } from "@/components/accounting/FinanceSalesDesk"

export default function ContractorFinanceSalesDeskPage() {
  return (
    <PortalLayout>
      <FinanceSalesDesk portal="contractor" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { FinanceProcurementDesk } from "@/components/accounting/FinanceProcurementDesk"

export default function ContractorFinanceProcurementDeskPage() {
  return (
    <PortalLayout>
      <FinanceProcurementDesk portal="contractor" />
    </PortalLayout>
  )
}

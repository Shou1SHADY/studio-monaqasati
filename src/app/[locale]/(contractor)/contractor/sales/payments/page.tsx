"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { PaymentsView } from "@/components/sales/PaymentsView"

export default function ContractorSalesPaymentsPage() {
  return (
    <PortalLayout>
      <PaymentsView portal="contractor" />
    </PortalLayout>
  )
}

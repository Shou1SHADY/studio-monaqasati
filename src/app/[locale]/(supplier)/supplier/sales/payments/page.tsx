"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { PaymentsView } from "@/components/sales/PaymentsView"

export default function SupplierSalesPaymentsPage() {
  return (
    <PortalLayout>
      <PaymentsView portal="supplier" />
    </PortalLayout>
  )
}

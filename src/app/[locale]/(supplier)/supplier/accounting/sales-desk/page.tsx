"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { FinanceSalesDesk } from "@/components/accounting/FinanceSalesDesk"

export default function SupplierFinanceSalesDeskPage() {
  return (
    <PortalLayout>
      <FinanceSalesDesk portal="supplier" />
    </PortalLayout>
  )
}

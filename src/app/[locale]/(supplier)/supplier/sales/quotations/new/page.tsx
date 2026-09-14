"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { QuotationBuilderView } from "@/components/sales/QuotationBuilderView"

export default function SupplierSalesNewQuotationPage() {
  return (
    <PortalLayout>
      <QuotationBuilderView portal="supplier" />
    </PortalLayout>
  )
}

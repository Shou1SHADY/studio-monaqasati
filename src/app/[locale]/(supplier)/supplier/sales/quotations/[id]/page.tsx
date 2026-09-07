"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { QuotationDetailView } from "@/components/sales/QuotationDetailView"

export default function SupplierSalesQuotationDetailPage() {
  return (
    <PortalLayout>
      <QuotationDetailView portal="supplier" />
    </PortalLayout>
  )
}

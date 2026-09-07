"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { QuotationDetailView } from "@/components/sales/QuotationDetailView"

export default function ContractorSalesQuotationDetailPage() {
  return (
    <PortalLayout>
      <QuotationDetailView portal="contractor" />
    </PortalLayout>
  )
}

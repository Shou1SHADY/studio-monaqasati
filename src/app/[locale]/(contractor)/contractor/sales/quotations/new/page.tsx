"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { QuotationBuilderView } from "@/components/sales/QuotationBuilderView"

export default function ContractorSalesNewQuotationPage() {
  return (
    <PortalLayout>
      <QuotationBuilderView portal="contractor" />
    </PortalLayout>
  )
}

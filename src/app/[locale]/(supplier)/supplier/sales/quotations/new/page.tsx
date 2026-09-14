"use client"

import { Suspense } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { QuotationBuilderView } from "@/components/sales/QuotationBuilderView"

export default function SupplierSalesNewQuotationPage() {
  return (
    <PortalLayout>
      <Suspense>
        <QuotationBuilderView portal="supplier" />
      </Suspense>
    </PortalLayout>
  )
}

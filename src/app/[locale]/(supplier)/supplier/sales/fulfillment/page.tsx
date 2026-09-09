"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesFulfillmentView } from "@/components/sales/SalesFulfillmentView"

export default function SupplierSalesFulfillmentPage() {
  return (
    <PortalLayout>
      <SalesFulfillmentView portal="supplier" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { PriceListView } from "@/components/sales/PriceListView"

export default function SupplierPriceListPage() {
  return (
    <PortalLayout>
      <PriceListView portal="supplier" />
    </PortalLayout>
  )
}
